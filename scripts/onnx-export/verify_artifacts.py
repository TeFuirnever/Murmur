#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20260930_T413_OnnxExportPipeline] Ticket #413 acceptance: verify ONNX
int8 model artifacts against the committed trust-chain pin
(scripts/onnx-export/model-pin.json). Two modes:

  local (default)  verify a local artifact tree (what the export pipeline
                   produced, or a copy someone handed you):
      python verify_artifacts.py --artifacts scripts/onnx-export/work/artifacts

  --from-release   download every pinned asset from OUR GitHub Release
                   mirror into --download-dir, then verify the downloaded
                   bytes against the pin — the acceptance check that the
                   MIRROR, not just the local disk, carries the pinned
                   bytes:
      python verify_artifacts.py --from-release --download-dir /tmp/mirror-check

  --via-api        verify the MIRROR without downloading: GitHub computes
                   a server-side sha256 digest for every release asset;
                   each pinned sha256 is compared against it, and any
                   release asset the pin does not list is reported. Fast
                   and complete for all assets regardless of size:
      python verify_artifacts.py --via-api

Verification is strict-set (onnx_export_common.check_manifest): missing
file, hash mismatch, and any UNLISTED file all fail.
"""

import argparse
import json
import os
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from onnx_export_common import check_manifest  # noqa: E402

DEFAULT_PIN = os.path.join(HERE, "model-pin.json")


def log(message: str) -> None:
    print(f"[verify] {message}", flush=True)


def verify_via_api(pin: dict) -> bool:
    """Compare every pinned sha256 against GitHub's server-side asset
    digests (no download). Also flags release assets absent from the pin —
    a stray upload must surface, mirroring check_manifest's strict set."""
    tag = pin["release"]["tag"]
    release = requests.get(
        f"https://api.github.com/repos/TeFuirnever/Murmur/releases/tags/{tag}",
        timeout=30,
    )
    release.raise_for_status()
    assets = release.json()["assets"]
    digest_by_name = {}
    size_by_name = {}
    for asset in assets:
        digest = asset.get("digest") or ""
        if digest.startswith("sha256:"):
            digest_by_name[asset["name"]] = digest[len("sha256:"):]
        size_by_name[asset["name"]] = asset["size"]

    problems = []
    pinned_asset_names = set()
    for key, entry in pin["models"].items():
        for file_entry in entry["files"]:
            names = file_entry.get("asset_parts") or [file_entry["asset"]]
            pinned_asset_names.update(names)
            for name in names:
                server_sha = digest_by_name.get(name)
                if server_sha is None:
                    problems.append(f"{key}/{name}: not on the release (or digest unavailable)")
                elif name == file_entry["asset"] and server_sha != file_entry["sha256"]:
                    problems.append(
                        f"{key}/{name}: sha256 mismatch (pin {file_entry['sha256']} vs release {server_sha})"
                    )
            # A split file must still expose its canonical single-asset name
            # only when it is NOT split (parts replace it on the mirror).
            if file_entry.get("asset_parts") and file_entry["asset"] in digest_by_name:
                problems.append(
                    f"{key}/{file_entry['asset']}: split into parts but a stale "
                    "single asset is still on the release"
                )
    meta_asset_names = {"LICENSE.upstream", "murmur-onnx-models-manifest.json"}
    for name in sorted(set(digest_by_name)):
        if name not in pinned_asset_names and name not in meta_asset_names:
            problems.append(f"release asset not in pin: {name}")

    for problem in problems:
        log(f"FAIL {problem}")
    if not problems:
        checked = len(pinned_asset_names)
        log(f"OK {checked} pinned assets match GitHub server-side sha256 digests")
    return not problems


def download(url: str, target: str) -> None:
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with requests.get(url, stream=True, timeout=600) as resp:
        resp.raise_for_status()
        tmp = target + ".part"
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
        os.replace(tmp, target)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pin", default=DEFAULT_PIN)
    parser.add_argument("--artifacts", default=os.path.join(HERE, "work", "artifacts"))
    parser.add_argument("--from-release", action="store_true",
                        help="download assets from the pinned GitHub Release first")
    parser.add_argument("--via-api", action="store_true",
                        help="verify the release mirror via GitHub server-side asset digests")
    parser.add_argument("--download-dir", default=os.path.join(HERE, "work", "mirror-check"))
    # [20261006_Diag_444_Fp32AsrVariant] Ticket #444 (T4b): verify a local
    # tree against a STANDALONE pin-shaped manifest instead of the committed
    # int8 pin — the fp32 diagnostic variant (stage_fp32_asr.py output) is
    # not described by model-pin.json and must never be.
    parser.add_argument("--manifest", default=None,
                        help="verify against a standalone manifest JSON "
                        "(e.g. work/artifacts-fp32/manifest.json) instead of "
                        "the committed pin; release modes are unavailable")
    args = parser.parse_args()

    if args.manifest and (args.from_release or args.via_api):
        parser.error("--manifest cannot be combined with --from-release/--via-api")

    with open(args.manifest or args.pin, encoding="utf-8") as f:
        pin = json.load(f)

    if args.via_api:
        all_ok = verify_via_api(pin)
        print("VERIFY:", "PASS" if all_ok else "FAIL")
        return 0 if all_ok else 1

    # Standalone manifests (e.g. the fp32 diagnostic variant) carry no
    # release section — the mirror URL is only needed when downloading.
    base_url = (pin.get("release") or {}).get("asset_base_url", "")

    all_ok = True
    for key, entry in pin["models"].items():
        root = (
            os.path.join(args.download_dir, entry["name"])
            if args.from_release
            else os.path.join(args.artifacts, entry["name"])
        )
        if args.from_release:
            for file_entry in entry["files"]:
                target = os.path.join(root, file_entry["path"])
                if os.path.exists(target):
                    log(f"{key}/{file_entry['path']}: already downloaded, reusing")
                    continue
                parts = file_entry.get("asset_parts")
                if parts:
                    log(f"{key}/{file_entry['path']}: downloading {len(parts)} split parts")
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with open(target, "wb") as out:
                        for part in parts:
                            part_file = target + f".{part.rsplit('.', 1)[-1]}.dl"
                            download(base_url + part, part_file)
                            with open(part_file, "rb") as chunk:
                                while True:
                                    block = chunk.read(1024 * 1024)
                                    if not block:
                                        break
                                    out.write(block)
                            os.unlink(part_file)
                else:
                    log(f"{key}/{file_entry['path']}: downloading {base_url}{file_entry['asset']}")
                    download(base_url + file_entry["asset"], target)
        problems = check_manifest(root, entry["files"])
        if problems:
            all_ok = False
            for problem in problems:
                log(f"FAIL {key}: {problem}")
        else:
            total = sum(f["size_bytes"] for f in entry["files"])
            log(f"OK {key} ({len(entry['files'])} files, {total / 1024 / 1024:.1f} MiB, "
                f"checkpoint {entry['modelscope_repo']}@{entry['model_revision']} "
                f"commit {entry['checkpoint_commit'][:12]})")

    print("VERIFY:", "PASS" if all_ok else "FAIL")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
