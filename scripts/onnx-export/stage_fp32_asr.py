#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20261006_Diag_444_Fp32AsrVariant] Ticket #444 (spec #412 T4b): stage the
fp32 ASR variant of the T1 self-export pipeline and verify it.

The T4 NO-GO verdict (#416) left one open question: is the English hotword
zero-effect on hw_jedediah int8 quantization sensitivity, or an export-path
problem? Answering it needs the SeACo main graph (bb) in fp32, produced by
the SAME T1 pipeline as the pinned int8 graph, and verified before use.

What this script does (work dir default scripts/onnx-export/work, gitignored):

  1. Offline trust chain: the cached official checkpoint snapshot's
     non-graph runtime files must sha256-match the committed int8 pin
     entries (the T1 export run already hub-verified these bytes; the pin
     carries the hashes — no network needed).
  2. T1 export call: funasr AutoModel(...).export(type="onnx",
     quantize=True, output_dir=work/stage-fp32-diag/asr) — the exact call
     export_onnx_models.export_funasr_model makes (quantize=True exports
     BOTH the fp32 graphs and their int8 counterparts). Skipped when the
     stage already holds both graphs (--skip-export, or auto-detected).
  3. Export determinism record: the fresh stage's model_quant.onnx is
     sha256-compared against the pinned artifact graph; the result is
     RECORDED (not enforced) in the summary — byte equality strengthens
     "same toolchain + checkpoint as the shipped int8 graph".
  4. Assembly: work/artifacts-fp32/asr-seaco-paraformer/ gets the exact
     quantize=False runtime set (onnx_export_common.FP32_ASR_RUNTIME_FILES)
     — graphs from the stage, every other file byte-exact from the
     snapshot — rebuilt from scratch on every run.
  5. Strict manifest: work/artifacts-fp32/manifest.json (pin-shaped,
     models.asr.files) is written and verified (check_manifest + set
     drift vs FP32_ASR_RUNTIME_FILES). verify_artifacts.py --manifest
     consumes the same file.

This is DIAGNOSTIC tooling: it never touches work/artifacts (the pinned
int8 tree), model-pin.json, or any release asset.

Usage (inside the pipeline venv — scripts/onnx-export/.venv):
  python scripts/onnx-export/stage_fp32_asr.py [--skip-export] [--work-dir DIR]
"""

import argparse
import datetime
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from onnx_export_common import (  # noqa: E402
    FP32_ASR_RUNTIME_FILES,
    MODEL_SPECS,
    PIN_SCHEMA_VERSION,
    build_file_manifest,
    check_manifest,
    sha256_file,
)

ASR_SPEC = MODEL_SPECS["asr"]
SNAPSHOT_NON_GRAPH_FILES = tuple(
    rel for rel in FP32_ASR_RUNTIME_FILES if not rel.endswith(".onnx")
)
FP32_GRAPHS = ("model.onnx", "model_eb.onnx")
MODELSCOPE_CACHE_DIRNAME = "models"


def log(message: str) -> None:
    print(f"[stage-fp32] {message}", flush=True)


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested in tests/python/test_stage_fp32_asr.py)
# ---------------------------------------------------------------------------

def verify_snapshot_against_pin(snapshot_dir, pin_files):
    """Offline trust chain: every non-graph pin entry must hash-match the
    snapshot bytes. Graph pin entries (model_quant.onnx / model_eb_quant.onnx)
    describe EXPORT outputs and are ignored here. Returns problems ([]==ok)."""
    problems = []
    for entry in pin_files:
        rel = entry.get("path")
        if rel.endswith(".onnx"):
            continue
        local = os.path.join(snapshot_dir, rel)
        if not os.path.isfile(local):
            problems.append(f"snapshot missing file: {rel}")
            continue
        actual = sha256_file(local)
        if actual != entry.get("sha256"):
            problems.append(
                f"snapshot sha256 mismatch: {rel} "
                f"(pin {entry.get('sha256')}, got {actual})"
            )
    return problems


def assemble_fp32_variant(stage_dir, snapshot_dir, artifact_dir):
    """Copy the exact quantize=False runtime set into artifact_dir — graphs
    from the export stage, everything else byte-exact from the snapshot.
    Returns problems ([]==ok); on problems nothing is left half-written
    beyond the files that did copy (callers verify before use)."""
    problems = []
    plan = []
    for rel in FP32_ASR_RUNTIME_FILES:
        if rel in FP32_GRAPHS:
            source = os.path.join(stage_dir, rel)
        else:
            source = os.path.join(snapshot_dir, rel)
        if not os.path.isfile(source):
            problems.append(f"source missing for {rel}: {source}")
            continue
        plan.append((rel, source))
    if problems:
        return problems
    os.makedirs(artifact_dir, exist_ok=True)
    for rel, source in plan:
        shutil.copyfile(source, os.path.join(artifact_dir, rel))
    return problems


def build_fp32_manifest(artifact_dir, meta):
    """Pin-shaped standalone manifest of the staged fp32 dir."""
    files = [
        {
            "path": entry["path"],
            "sha256": entry["sha256"],
            "size_bytes": entry["size_bytes"],
        }
        for entry in build_file_manifest(artifact_dir)
    ]
    return {
        "schema_version": PIN_SCHEMA_VERSION,
        "generated_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "variant": "fp32",
        "models": {
            "asr": {
                "name": ASR_SPEC["name"],
                "modelscope_repo": ASR_SPEC["modelscope_repo"],
                "model_revision": ASR_SPEC["model_revision"],
                **meta,
                "files": files,
            }
        },
    }


def verify_staged_fp32(artifact_dir, manifest):
    """Strict verification of the staged fp32 dir: exact file set (drift vs
    FP32_ASR_RUNTIME_FILES fails even when disk matches the manifest),
    per-file sha256, strict on-disk set. Returns problems ([]==ok)."""
    problems = []
    entries = manifest.get("models", {}).get("asr", {}).get("files")
    if not isinstance(entries, list):
        return ["fp32 manifest has no asr files list"]
    problems.extend(check_manifest(artifact_dir, entries))
    listed = {entry.get("path") for entry in entries}
    expected = set(FP32_ASR_RUNTIME_FILES)
    if listed != expected:
        problems.append(
            f"fp32 manifest set drift: {sorted(listed)} != {sorted(expected)}"
        )
    return problems


# ---------------------------------------------------------------------------
# Pipeline steps (funasr/torch imports stay lazy — stdlib-only until main)
# ---------------------------------------------------------------------------

def locate_snapshot(work_dir):
    """The modelscope snapshot_download cache layout:
    <cache>/models/<org>--<repo>/snapshots/<revision>/."""
    snapshot_root = os.path.join(
        work_dir,
        "snapshots",
        MODELSCOPE_CACHE_DIRNAME,
        "iic--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "snapshots",
        ASR_SPEC["model_revision"],
    )
    if not os.path.isdir(snapshot_root):
        raise RuntimeError(
            f"cached checkpoint snapshot not found: {snapshot_root} "
            "(run scripts/onnx-export/export_onnx_models.py once first)"
        )
    return snapshot_root


def run_t1_export(snapshot_dir, stage_dir):
    """The exact T1 pipeline export call (mirrors
    export_onnx_models.export_funasr_model): funasr AutoModel + export
    type=onnx quantize=True — quantize=True emits the fp32 graphs AND
    their int8 counterparts, so this one call produces the fp32 bb/eb
    graphs the diagnosis consumes."""
    from funasr import AutoModel

    os.makedirs(stage_dir, exist_ok=True)
    log(f"loading torch checkpoint from {snapshot_dir}")
    model = AutoModel(
        model=snapshot_dir,
        disable_update=True,
        disable_pbar=True,
        log_level="ERROR",
    )
    started = time.perf_counter()
    model.export(type="onnx", quantize=True, output_dir=stage_dir)
    log(f"funasr export done in {time.perf_counter() - started:.1f}s -> {stage_dir}")


def stage_has_graphs(stage_dir):
    return all(
        os.path.isfile(os.path.join(stage_dir, rel)) for rel in FP32_GRAPHS
    )


def record_export_determinism(fresh_stage_dir, pinned_artifacts_dir):
    """sha256-compare the fresh int8 graph against the pinned artifact
    graph. RECORDED, not enforced: equality evidences 'same toolchain and
    checkpoint as the shipped int8 graph'; a mismatch is honest data for
    the diagnosis report, not a failure."""
    fresh = os.path.join(fresh_stage_dir, "model_quant.onnx")
    pinned = os.path.join(pinned_artifacts_dir, "model_quant.onnx")
    if not os.path.isfile(pinned):
        return {"pinned_int8_graph_present": False, "identical": None}
    identical = sha256_file(fresh) == sha256_file(pinned)
    log(f"fresh stage int8 graph byte-identical to pinned artifact: {identical}")
    return {"pinned_int8_graph_present": True, "identical": identical}


def tool_versions() -> dict:
    import funasr
    import torch
    import onnx
    import onnxruntime

    return {
        "funasr": funasr.__version__,
        "torch": torch.__version__,
        "onnx": onnx.__version__,
        "onnxruntime": onnxruntime.__version__,
    }


def safe_yaml_check(path: str) -> None:
    """config.yaml must parse with safe_load before it enters the variant
    dir (same RCE-surface discipline as the T1 pipeline)."""
    import yaml

    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise RuntimeError(f"{path}: safe_load produced a non-dict config")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--work-dir",
        default=os.path.join(HERE, "work"),
        help="working directory (default: scripts/onnx-export/work)",
    )
    parser.add_argument(
        "--skip-export",
        action="store_true",
        help="reuse an existing stage-fp32-diag/asr dir instead of re-running "
        "the T1 export (reruns after a first successful staging)",
    )
    args = parser.parse_args()

    work = os.path.abspath(args.work_dir)
    stage_dir = os.path.join(work, "stage-fp32-diag", "asr")
    pinned_artifacts_dir = os.path.join(work, "artifacts", ASR_SPEC["name"])
    artifact_dir = os.path.join(work, "artifacts-fp32", ASR_SPEC["name"])
    manifest_path = os.path.join(work, "artifacts-fp32", "manifest.json")

    pin_path = os.path.join(HERE, "model-pin.json")
    with open(pin_path, encoding="utf-8") as f:
        pin = json.load(f)
    pin_asr = pin["models"]["asr"]

    snapshot_dir = locate_snapshot(work)
    log(f"snapshot: {snapshot_dir}")
    problems = verify_snapshot_against_pin(snapshot_dir, pin_asr["files"])
    if problems:
        for problem in problems:
            log(f"FAIL snapshot trust chain: {problem}")
        return 1
    log("snapshot non-graph files match the committed pin sha256 entries")

    if args.skip_export and not stage_has_graphs(stage_dir):
        log(f"FAIL --skip-export but stage has no graphs: {stage_dir}")
        return 1
    if not args.skip_export and not stage_has_graphs(stage_dir):
        run_t1_export(snapshot_dir, stage_dir)

    determinism = record_export_determinism(stage_dir, pinned_artifacts_dir)

    # Rebuild the variant dir from scratch each run: a stale file from an
    # earlier staging must never ride along (strict-set discipline).
    if os.path.isdir(artifact_dir):
        shutil.rmtree(artifact_dir)
    problems = assemble_fp32_variant(stage_dir, snapshot_dir, artifact_dir)
    if problems:
        for problem in problems:
            log(f"FAIL assembly: {problem}")
        return 1
    safe_yaml_check(os.path.join(artifact_dir, "config.yaml"))

    meta = {
        "checkpoint_commit": pin_asr["checkpoint_commit"],
        "export": tool_versions(),
        "export_determinism": determinism,
    }
    manifest = build_fp32_manifest(artifact_dir, meta)
    problems = verify_staged_fp32(artifact_dir, manifest)
    if problems:
        for problem in problems:
            log(f"FAIL staged fp32 verification: {problem}")
        return 1
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    total_bytes = sum(e["size_bytes"] for e in manifest["models"]["asr"]["files"])
    log(f"staged fp32 variant verified: {artifact_dir}")
    log(f"manifest written: {manifest_path} ({len(manifest['models']['asr']['files'])} files, {total_bytes / 1024 / 1024:.1f} MiB)")
    print(
        json.dumps(
            {
                "artifact_dir": artifact_dir,
                "manifest_path": manifest_path,
                "stage_dir": stage_dir,
                "total_bytes": total_bytes,
                "files": manifest["models"]["asr"]["files"],
                "export_determinism": determinism,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
