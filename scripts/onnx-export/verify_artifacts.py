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
    parser.add_argument("--download-dir", default=os.path.join(HERE, "work", "mirror-check"))
    args = parser.parse_args()

    with open(args.pin, encoding="utf-8") as f:
        pin = json.load(f)
    base_url = pin["release"]["asset_base_url"]

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
