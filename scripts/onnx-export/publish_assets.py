#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20260930_T413_OnnxExportPipeline] Publish the pinned artifacts to the
Murmur GitHub Release mirror (ticket #413).

Why this exists: single-request uploads of the two large graphs
(345MB ASR / 283MB Punc) repeatedly die mid-body — the local uplink
stalls long enough for GitHub's upload-inactivity 408 to fire, and
release assets cannot be resumed. Files above SINGLE_ASSET_MAX_BYTES are
therefore published as SPLIT PARTS (`<asset>.partNN`, in order); the
assembled bytes are still guarded by the SAME per-file sha256 in the pin
(downloader contract: fetch parts in order, concatenate, hash-check
against files[].sha256 before use). Small files upload as single assets.

The script is idempotent: assets already on the release with matching
server-side digests are skipped, and the pin is rewritten to record
exactly what the mirror carries (files[].asset_parts when a file is
split). Ends with a full --via-api verification of every pinned asset.

Usage (any python with requests; gh CLI for auth):
  python scripts/onnx-export/publish_assets.py [--artifacts ...] [--pin ...]
"""

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from onnx_export_common import sha256_file  # noqa: E402

REPO = "TeFuirnever/Murmur"
# Below this size a single request reliably completes on this uplink
# (the 28-34MB graphs and every config landed first try).
SINGLE_ASSET_MAX_BYTES = 64 * 1024 * 1024
# Split-part size: an 80MB part is ~9-12 min at the observed 100-270KB/s —
# short enough that a stall costs one part, not a 45-minute attempt.
PART_SIZE_BYTES = 80 * 1024 * 1024
UPLOAD_API = f"https://uploads.github.com/repos/{REPO}/releases"


def log(message: str) -> None:
    print(f"[publish] {message}", flush=True)


def gh_auth_header() -> dict:
    token = subprocess.run(
        ["gh", "auth", "token"], capture_output=True, text=True, check=True
    ).stdout.strip()
    return {"Authorization": f"Bearer {token}"}


def release_id(tag: str, headers: dict) -> int:
    resp = requests.get(
        f"https://api.github.com/repos/{REPO}/releases/tags/{tag}", headers=headers, timeout=30
    )
    resp.raise_for_status()
    return resp.json()["id"]


def release_assets(rid: int, headers: dict) -> dict:
    resp = requests.get(
        f"https://api.github.com/repos/{REPO}/releases/{rid}/assets",
        headers=headers, timeout=30,
    )
    resp.raise_for_status()
    out = {}
    for asset in resp.json():
        digest = asset.get("digest") or ""
        out[asset["name"]] = {
            "sha256": digest[len("sha256:"):] if digest.startswith("sha256:") else None,
            "size": asset["size"],
            "id": asset["id"],
        }
    return out


def delete_asset(asset_info: dict, headers: dict) -> None:
    resp = requests.delete(
        f"https://api.github.com/repos/{REPO}/releases/assets/{asset_info['id']}",
        headers=headers, timeout=30,
    )
    resp.raise_for_status()


def curl_upload(rid: int, name: str, path: str, headers: dict, max_retries: int = 15) -> bool:
    """Stall-resistant single-asset upload (curl aborts if the body flows
    below 10KB/s for 60s, then retries with a fresh connection)."""
    auth_arg_file = tempfile.NamedTemporaryFile("w", delete=False, suffix=".curlconf")
    try:
        auth_arg_file.write(f'header = "Authorization: {headers["Authorization"]}"\n')
        auth_arg_file.close()
        os.chmod(auth_arg_file.name, 0o600)
        for attempt in range(1, max_retries + 1):
            log(f"upload {name} attempt {attempt} ({os.path.getsize(path)//1024//1024} MiB)")
            proc = subprocess.run(
                [
                    "curl", "-sS", "-o", "/tmp/publish-upload-body.json",
                    "-w", "%{http_code}",
                    "--config", auth_arg_file.name,
                    "-X", "POST",
                    "-H", "Content-Type: application/octet-stream",
                    "--data-binary", f"@{path}",
                    "--speed-limit", "10240", "--speed-time", "60",
                    "--connect-timeout", "20",
                    f"{UPLOAD_API}/{rid}/assets?name={name}",
                ],
                capture_output=True, text=True,
            )
            code = proc.stdout.strip()
            if code == "201":
                return True
            body = ""
            try:
                body = open("/tmp/publish-upload-body.json").read()[:200]
            except OSError:
                pass
            log(f"upload {name} attempt {attempt} -> HTTP {code or 'ERR'} {body} {proc.stderr[:120]}")
            import time

            time.sleep(min(attempt * 10, 60))
        return False
    finally:
        os.unlink(auth_arg_file.name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pin", default=os.path.join(HERE, "model-pin.json"))
    parser.add_argument("--artifacts", default=os.path.join(HERE, "work", "artifacts"))
    args = parser.parse_args()

    with open(args.pin, encoding="utf-8") as f:
        pin = json.load(f)
    headers = gh_auth_header()
    rid = release_id(pin["release"]["tag"], headers)
    pin_changed = False

    for key, entry in pin["models"].items():
        for file_entry in entry["files"]:
            source = os.path.join(args.artifacts, entry["name"], file_entry["path"])
            if not os.path.exists(source):
                raise RuntimeError(f"artifact missing locally: {source}")
            actual = sha256_file(source)
            if actual != file_entry["sha256"]:
                raise RuntimeError(f"local artifact drifted from pin: {source}")

            assets = release_assets(rid, headers)
            asset = file_entry["asset"]
            size = file_entry["size_bytes"]
            parts = file_entry.get("asset_parts")

            if parts:
                needed = [name for name in parts if (assets.get(name) or {}).get("sha256") is None]
                if needed:
                    with tempfile.TemporaryDirectory() as tmp:
                        for idx, offset in enumerate(range(0, size, PART_SIZE_BYTES)):
                            name = f"{asset}.part{idx:02d}"
                            if name not in needed:
                                continue
                            part_path = os.path.join(tmp, name)
                            with open(source, "rb") as src, open(part_path, "wb") as dst:
                                src.seek(offset)
                                dst.write(src.read(PART_SIZE_BYTES))
                            if not curl_upload(rid, name, part_path, headers):
                                raise RuntimeError(f"part upload failed: {name}")
                    pin_changed = True
                continue

            on_mirror = (assets.get(asset) or {}).get("sha256")
            if on_mirror == file_entry["sha256"]:
                continue  # already published as a single asset

            if size <= SINGLE_ASSET_MAX_BYTES:
                if on_mirror is not None:
                    log(f"replacing existing asset {asset} (digest mismatch)")
                    delete_asset(assets[asset], headers)
                if curl_upload(rid, asset, source, headers):
                    pin_changed = True
                    continue

            # Large file, single upload not (yet) landed: publish as parts.
            part_names = [
                f"{asset}.part{idx:02d}" for idx in range(math.ceil(size / PART_SIZE_BYTES))
            ]
            log(f"{key}/{file_entry['path']}: publishing as {len(part_names)} split parts")
            with tempfile.TemporaryDirectory() as tmp:
                for idx, offset in enumerate(range(0, size, PART_SIZE_BYTES)):
                    name = part_names[idx]
                    if (assets.get(name) or {}).get("sha256") is not None:
                        continue
                    part_path = os.path.join(tmp, name)
                    with open(source, "rb") as src, open(part_path, "wb") as dst:
                        src.seek(offset)
                        dst.write(src.read(PART_SIZE_BYTES))
                    if not curl_upload(rid, name, part_path, headers):
                        raise RuntimeError(f"part upload failed: {name}")
            file_entry["asset_parts"] = part_names
            pin_changed = True

    if pin_changed:
        with open(args.pin, "w", encoding="utf-8") as f:
            json.dump(pin, f, ensure_ascii=False, indent=2)
            f.write("\n")
        log(f"pin updated with mirror layout: {args.pin}")

    # Final gate: every pinned asset (or part set) verified server-side.
    result = subprocess.run(
        [sys.executable, os.path.join(HERE, "verify_artifacts.py"), "--via-api"],
    )
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
