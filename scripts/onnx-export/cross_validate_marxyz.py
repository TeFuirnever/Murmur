#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20260930_T413_OnnxExportPipeline] Ticket #413 acceptance: cross-validate
the self-exported SeACo ONNX int8 artifacts against the community repo
(marxyz) — bytes AND behavior.

The community repo is a VERIFICATION SAMPLE only, never a download source
(spec #412 decision 6). Two layers are compared for the ASR model:

  1. Byte layer: per-file sha256 of every runtime file in the marxyz
     snapshot vs our artifact. Non-onnx files (config.yaml / am.mvn /
     tokens.json / seg_dict) are copies of the SAME official checkpoint
     files, so they must be BYTE-IDENTICAL. The onnx graphs are expected
     to differ (export toolchain versions/timestamps are not pinned by
     upstream); sizes are recorded and any >2x drift flagged.
  2. Behavior layer: same wav through both models via funasr_onnx
     SeacoParaformer — identical output, or the difference explained in
     the report.

Usage (inside the pipeline venv):
  python scripts/onnx-export/cross_validate_marxyz.py \
      [--artifacts scripts/onnx-export/work/artifacts] [--wav PATH] \
      [--cache scripts/onnx-export/work/marxyz] \
      [--out scripts/onnx-export/work/cross_validation.json]
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from onnx_export_common import MODEL_SPECS, sha256_file  # noqa: E402

MARXYZ_REPO = "marxyz/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-onnx-quant"
MARXYZ_REVISION = "master"

# Non-onnx runtime files must match the official checkpoint bytes exactly.
BYTE_IDENTICAL_EXPECTED = ["config.yaml", "am.mvn", "tokens.json", "seg_dict"]
# ONNX graphs legitimately differ between export toolchains; flag gross
# size drift so a silently-wrong graph does not hide behind "expected
# difference".
ONNX_SIZE_DRIFT_RATIO = 2.0

# Behavioral comparison: identical transcripts pass outright; otherwise a
# char similarity at/above this level passes as an EXPLAINED delta
# (same official weights, independent quantization runs can flip rare
# argmax ties). Below it the difference is unexplained and validation
# fails.
MIN_BEHAVIOR_SIMILARITY = 0.995


def log(message: str) -> None:
    print(f"[cross] {message}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", default=os.path.join(HERE, "work", "artifacts"))
    parser.add_argument("--wav", default=os.path.join(HERE, "work", "smoke-40s.wav"))
    parser.add_argument("--cache", default=os.path.join(HERE, "work", "marxyz"))
    parser.add_argument("--out", default=os.path.join(HERE, "work", "cross_validation.json"))
    args = parser.parse_args()

    from modelscope import snapshot_download

    spec = MODEL_SPECS["asr"]
    ours_dir = os.path.join(args.artifacts, spec["name"])

    log(f"downloading community sample {MARXYZ_REPO}@{MARXYZ_REVISION}")
    marxyz_dir = snapshot_download(MARXYZ_REPO, revision=MARXYZ_REVISION, cache_dir=args.cache)

    # --- 1. byte layer ---------------------------------------------------
    byte_rows = []
    for rel in spec["runtime_files"]:
        ours = os.path.join(ours_dir, rel)
        theirs = os.path.join(marxyz_dir, rel)
        if not os.path.exists(theirs):
            byte_rows.append(
                {"path": rel, "status": "absent-in-marxyz",
                 "ours_sha256": sha256_file(ours)}
            )
            continue
        ours_sha, theirs_sha = sha256_file(ours), sha256_file(theirs)
        ours_size, theirs_size = os.path.getsize(ours), os.path.getsize(theirs)
        if ours_sha == theirs_sha:
            status = "identical"
        elif rel in BYTE_IDENTICAL_EXPECTED:
            status = "MISMATCH-NON-ONNX"  # must never happen: same official source
        else:
            drift = max(ours_size, theirs_size) / max(1, min(ours_size, theirs_size))
            status = "differs-expected" if drift <= ONNX_SIZE_DRIFT_RATIO else "differs-GROSS"
        byte_rows.append(
            {
                "path": rel,
                "status": status,
                "ours_sha256": ours_sha,
                "marxyz_sha256": theirs_sha,
                "ours_size": ours_size,
                "marxyz_size": theirs_size,
            }
        )
        log(f"{rel}: {status} (ours {ours_size}B, marxyz {theirs_size}B)")

    # --- 2. behavior layer ----------------------------------------------
    behavior = None
    if os.path.exists(args.wav):
        from funasr_onnx import SeacoParaformer
        import soundfile as sf

        audio, rate = sf.read(args.wav, dtype="float32")
        ours_model = SeacoParaformer(ours_dir, quantize=True)
        theirs_model = SeacoParaformer(marxyz_dir, quantize=True)
        # funasr_onnx 0.4.3 returns "preds" (space-joined chars), not "text".
        ours_text = "".join(ours_model(audio, "")[0].get("preds", "").split())
        theirs_text = "".join(theirs_model(audio, "")[0].get("preds", "").split())
        from smoke_inference import char_similarity

        similarity = char_similarity(ours_text, theirs_text)
        behavior = {
            "wav": os.path.abspath(args.wav),
            "ours_text": ours_text,
            "marxyz_text": theirs_text,
            "identical": ours_text == theirs_text,
            "char_similarity": round(similarity, 6),
            # A vacuous comparison (both empty) must never count as a pass.
            "nonempty": bool(ours_text) and bool(theirs_text),
            # Quantization/graph-layout deltas can flip a rare argmax; a
            # near-identical transcript with the difference recorded and
            # explained satisfies the ticket's acceptance ("输出一致或差异
            # 已解释"). Below the threshold the difference is NOT explained
            # and the validation fails.
            "delta_explained": similarity >= MIN_BEHAVIOR_SIMILARITY,
        }
        log(f"behavior: identical={behavior['identical']} similarity={similarity:.4f}")
        log(f"  ours  : {ours_text[:80]}")
        log(f"  marxyz: {theirs_text[:80]}")
        if not behavior["identical"]:
            diff = [(i, a, b) for i, (a, b) in enumerate(zip(ours_text, theirs_text)) if a != b]
            log(f"  char diffs: {diff[:10]}")

    non_onnx_bad = [r for r in byte_rows if r["status"] == "MISMATCH-NON-ONNX"]
    gross = [r for r in byte_rows if r["status"] == "differs-GROSS"]
    ok = (
        not non_onnx_bad
        and not gross
        and behavior is not None
        and behavior["nonempty"]
        and behavior["delta_explained"]
    )

    report = {
        "community_sample_repo": MARXYZ_REPO,
        "community_sample_revision": MARXYZ_REVISION,
        "policy": "community repo is verification sample only, never a download source",
        "byte_comparison": byte_rows,
        "behavior_comparison": behavior,
        "verdict": "PASS" if ok else "FAIL",
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    log(f"report: {args.out} -> {report['verdict']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
