#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20260930_T413_OnnxExportPipeline] Ticket #413 (spec #412 T1): one-shot,
re-runnable export of the four ONNX int8 models from OFFICIAL iic
Apache-2.0 torch checkpoints.

  ASR      iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch
           -> model_quant.onnx + model_eb_quant.onnx (hotword SeACo path)
  VAD      iic/speech_fsmn_vad_zh-cn-16k-common-pytorch             -> model_quant.onnx
  Punc     iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch -> model_quant.onnx
  Speaker  iic/speech_campplus_sv_zh-cn_16k-common (CAM++)           -> model_quant.onnx

funasr AutoModel.export(type="onnx", quantize=True) handles the first
three. CAMPPlus has no funasr export_meta (verified funasr 1.2.7 and
1.3.1), so it is exported manually here from the same official checkpoint
using the funasr CAMPPlus module definition + the identical quantization
recipe (quantize_dynamic, MatMul, per-channel, QUInt8 — mirrors funasr
utils/export_utils._onnx).

Everything lands in a work dir (default scripts/onnx-export/work,
gitignored):

  work/snapshots/...      official checkpoints as materialized by modelscope
                          snapshot_download (pinned revision; HEAD commit of
                          the revision recorded as checkpoint_commit)
  work/stage/<key>/       raw export output (fp32 + int8 onnx)
  work/artifacts/<name>/  SHIPPING dir per model: exact runtime file set
  work/artifacts/manifest.json  per-file sha256 manifest of all artifacts
  scripts/onnx-export/model-pin.json  the in-repo trust-chain pin (committed)

Usage (inside the pipeline venv — see requirements-export.txt and
bootstrap_env.sh, documented in README.md):
  python scripts/onnx-export/export_onnx_models.py [--work-dir DIR]
"""

import argparse
import datetime
import json
import os
import shutil
import sys
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from onnx_export_common import (  # noqa: E402
    MODEL_SPECS,
    PIN_SCHEMA_VERSION,
    asset_name,
    build_file_manifest,
    check_manifest,
    is_commit_sha,
)

# [20260930_T413_OnnxExportPipeline] Release identity of our own mirror.
# Deliberately NOT a v* tag: build.yml installers are tag-triggered on v*
# only — a model-assets release must never kick off installer builds.
RELEASE_TAG = "models-onnx-int8-1"
RELEASE_REPO = "TeFuirnever/Murmur"
RELEASE_URL = f"https://github.com/{RELEASE_REPO}/releases/tags/{RELEASE_TAG}"
ASSET_BASE_URL = f"https://github.com/{RELEASE_REPO}/releases/download/{RELEASE_TAG}/"

# Apache-2.0 §4 attribution carried by the pin and the release.
ATTRIBUTION = (
    "Models exported from official ModelScope iic Apache-2.0 checkpoints "
    "(FunASR / Alibaba DAMO Speech Lab, modelscope.cn). Exported with the "
    "FunASR export pipeline and quantized to ONNX int8 by the Murmur "
    "project; the upstream Apache-2.0 license ships alongside this "
    "distribution (LICENSE.upstream asset in the release)."
)

# Quantization recipe constants (identical to funasr export_utils._onnx so
# the manual CAMPPlus export follows the same discipline).
QUANT_OP_TYPES = ["MatMul"]
QUANT_PER_CHANNEL = True
QUANT_REDUCE_RANGE = False
ONNX_OPSET = 14

MODELSCOPE_ENDPOINT = "https://modelscope.cn"


def log(message: str) -> None:
    print(f"[export] {message}", flush=True)


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
        "opset": ONNX_OPSET,
    }


def revision_head_commit(repo_id: str, revision: str) -> str:
    """HEAD commit id a ModelScope revision points at
    (GET /api/v1/models/<id>/commits?Ref=<rev>, first entry)."""
    resp = requests.get(
        f"{MODELSCOPE_ENDPOINT}/api/v1/models/{repo_id}/commits",
        params={"Ref": revision, "PageSize": 1},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    commit = payload["Data"]["Commit"][0]["Id"]
    if not is_commit_sha(commit):
        raise RuntimeError(f"{repo_id}@{revision}: non-sha commit id {commit!r}")
    return commit


def hub_file_hashes(repo_id: str, revision: str) -> dict:
    """Per-file sha256 as reported by the hub (independent of our own
    hashing — catches corrupted/mis-materialized downloads)."""
    resp = requests.get(
        f"{MODELSCOPE_ENDPOINT}/api/v1/models/{repo_id}/repo/files",
        params={"Revision": revision},
        timeout=30,
    )
    resp.raise_for_status()
    files = resp.json()["Data"]["Files"]
    return {f["Path"]: f["Sha256"] for f in files if f.get("Sha256")}


def resolve_snapshot(repo_id: str, revision: str, cache_dir: str) -> tuple:
    """Download (or reuse) the official checkpoint snapshot; return
    (snapshot_dir, checkpoint_commit)."""
    from modelscope import snapshot_download

    path = snapshot_download(repo_id, revision=revision, cache_dir=cache_dir)
    return path, revision_head_commit(repo_id, revision)


def verify_snapshot_files(repo_id: str, revision: str, snapshot_dir: str, keys: list) -> None:
    """Cross-check the bytes snapshot_download materialized against the
    hub's own sha256 listing for every file we consume."""
    expected = hub_file_hashes(repo_id, revision)
    import hashlib

    for rel in keys:
        hub_sha = expected.get(rel)
        if not hub_sha:
            continue  # hub does not publish a hash for this path
        local = os.path.join(snapshot_dir, rel)
        if not os.path.exists(local):
            raise RuntimeError(f"{repo_id}: snapshot missing {rel}")
        digest = hashlib.sha256()
        with open(local, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != hub_sha:
            raise RuntimeError(
                f"{repo_id}/{rel}: snapshot bytes do not match hub sha256 "
                f"(local {digest.hexdigest()} vs hub {hub_sha})"
            )
    log(f"{repo_id}: snapshot files match hub sha256 listing")


def safe_yaml_check(path: str) -> None:
    """config.yaml must parse with safe_load before it enters the artifact
    (upstream funasr_onnx read_yaml uses unsafe yaml.Loader — spec #412
    decision 7; the server-side RCE guard lands in the runtime ticket)."""
    import yaml

    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise RuntimeError(f"{path}: safe_load produced a non-dict config")


def assemble_artifact(key: str, spec: dict, stage: str, snapshot_dir: str, work: str) -> str:
    """Build the shipping dir: quantized onnx from the export stage, every
    other runtime file copied byte-exact from the official checkpoint."""
    artifact = os.path.join(work, "artifacts", spec["name"])
    os.makedirs(artifact, exist_ok=True)
    for rel in spec["runtime_files"]:
        source = (
            os.path.join(stage, rel) if rel.endswith(".onnx") else os.path.join(snapshot_dir, rel)
        )
        if not os.path.exists(source):
            raise RuntimeError(f"{key}: runtime file missing: {source}")
        shutil.copyfile(source, os.path.join(artifact, rel))
    if "config.yaml" in spec["runtime_files"]:
        safe_yaml_check(os.path.join(artifact, "config.yaml"))
    return artifact


def export_funasr_model(key: str, spec: dict, work: str) -> dict:
    """funasr AutoModel export path (ASR / VAD / Punc)."""
    from funasr import AutoModel

    snapshot_dir, commit = resolve_snapshot(
        spec["modelscope_repo"], spec["model_revision"], os.path.join(work, "snapshots")
    )
    verify_snapshot_files(spec["modelscope_repo"], spec["model_revision"], snapshot_dir,
                          [rel for rel in spec["runtime_files"] if not rel.endswith(".onnx")])
    stage = os.path.join(work, "stage", key)
    os.makedirs(stage, exist_ok=True)

    log(f"{key}: loading torch checkpoint from {snapshot_dir} (commit {commit[:12]})")
    model = AutoModel(
        model=snapshot_dir,
        disable_update=True,
        disable_pbar=True,
        log_level="ERROR",
    )
    t0 = time.perf_counter()
    model.export(type="onnx", quantize=True, output_dir=stage)
    log(f"{key}: funasr export done in {time.perf_counter() - t0:.1f}s -> {stage}")

    artifact = assemble_artifact(key, spec, stage, snapshot_dir, work)
    return {"artifact_dir": artifact, "checkpoint_commit": commit}


def _seg_pooling_onnx_exportable(self, x, seg_len=100, stype="avg"):
    """ONNX-exportable equivalent of funasr CAMLayer.seg_pooling.

    Upstream uses F.avg_pool1d(..., ceil_mode=True), whose ceil-padding
    (torch get_pool_ceil_padding) cannot be symbolically exported with a
    dynamic time axis (torch 2.0.1 SymbolicValueError), and its
    expand().reshape() bakes the trace-time length into the graph.

    Equivalent traceable formulation, no dynamic padding and no value
    branches (verified against upstream at torch level AND through an
    exported ONNX session across lengths 1..513, max diff < 1e-7):
      - append a STATIC seg_len-1 zero tail, making the ceil_mode=False
        window count exactly ceil(T/seg_len);
      - pool the signal AND a ones-mask (zeros over the static tail),
        then divide window sums by VALID counts — this reproduces
        ceil_mode's trailing-window average-over-valid-elements;
      - broadcast each segment average back per frame via expand +
        ONNX Flatten(axis=-1 of the window dim), then narrow to T.
    """
    import torch
    import torch.nn.functional as F

    if stype != "avg":
        raise RuntimeError(f"seg_pooling export shim only supports avg, got {stype}")
    time_dim = x.size(-1)
    static_pad = seg_len - 1
    padded = F.pad(x, (0, static_pad))
    mask = F.pad(torch.ones_like(x), (0, static_pad))
    window_sums = F.avg_pool1d(padded, kernel_size=seg_len, stride=seg_len) * seg_len
    valid_counts = F.avg_pool1d(mask, kernel_size=seg_len, stride=seg_len) * seg_len
    seg = window_sums / valid_counts
    seg = torch.flatten(seg.unsqueeze(-1).expand(-1, -1, -1, seg_len), 2)
    return torch.narrow(seg, -1, 0, time_dim)


def apply_campplus_export_shims(net, feat_dim: int) -> None:
    """Swap in the ONNX-exportable seg_pooling and VERIFY numerics are
    unchanged on random input before the caller may export."""
    import torch

    from funasr.models.campplus.components import CAMLayer

    probe = torch.randn(2, 237, feat_dim)
    with torch.no_grad():
        before = net(probe)
        original = CAMLayer.seg_pooling
        CAMLayer.seg_pooling = _seg_pooling_onnx_exportable
        after = net(probe)
        if not torch.allclose(before, after, atol=1e-5, rtol=1e-4):
            CAMLayer.seg_pooling = original
            raise RuntimeError(
                "CAMPPlus seg_pooling export shim changed numerics — refusing to export"
            )
    log("campplus seg_pooling shim applied (numerics verified identical)")


def export_campplus(key: str, spec: dict, work: str) -> dict:
    """Manual CAMPPlus (CAM++) export: funasr has no export_meta for it
    (verified 1.2.7/1.3.1) — build the module from the official config,
    load the official weights, export fp32 ONNX, quantize with the same
    recipe funasr uses for the other three models."""
    import torch
    import yaml
    from funasr.models.campplus.model import CAMPPlus
    from onnxruntime.quantization import QuantType, quantize_dynamic

    snapshot_dir, commit = resolve_snapshot(
        spec["modelscope_repo"], spec["model_revision"], os.path.join(work, "snapshots")
    )
    verify_snapshot_files(
        spec["modelscope_repo"], spec["model_revision"], snapshot_dir, ["config.yaml", "campplus_cn_common.bin"]
    )
    stage = os.path.join(work, "stage", key)
    os.makedirs(stage, exist_ok=True)

    with open(os.path.join(snapshot_dir, "config.yaml"), encoding="utf-8") as f:
        config = yaml.safe_load(f)
    net = CAMPPlus(**config["model_conf"])
    state = torch.load(os.path.join(snapshot_dir, "campplus_cn_common.bin"), map_location="cpu")
    if isinstance(state, dict) and "state_dict" in state:
        state = state["state_dict"]
    # Accept checkpoints saved with a wrapper prefix.
    if any(k.startswith("model.") for k in state):
        state = {k[len("model."):]: v for k, v in state.items() if k.startswith("model.")}
    net.load_state_dict(state)
    net.eval()
    log(f"{key}: CAMPPlus module built ({sum(p.numel() for p in net.parameters())} params)")

    feat_dim = int(config["model_conf"]["feat_dim"])
    apply_campplus_export_shims(net, feat_dim)
    dummy = torch.randn(1, 200, feat_dim, dtype=torch.float32)
    fp32_path = os.path.join(stage, "model.onnx")
    torch.onnx.export(
        net,
        dummy,
        fp32_path,
        do_constant_folding=True,
        opset_version=ONNX_OPSET,
        input_names=["feats"],
        output_names=["embedding"],
        dynamic_axes={
            "feats": {0: "batch_size", 1: "feats_length"},
            "embedding": {0: "batch_size"},
        },
    )

    quant_path = os.path.join(stage, "model_quant.onnx")
    quantize_dynamic(
        model_input=fp32_path,
        model_output=quant_path,
        op_types_to_quantize=list(QUANT_OP_TYPES),
        per_channel=QUANT_PER_CHANNEL,
        reduce_range=QUANT_REDUCE_RANGE,
        weight_type=QuantType.QUInt8,
    )
    log(f"{key}: int8 graph {os.path.getsize(quant_path)} bytes (fp32 stage kept at {fp32_path})")

    # Export-fidelity check: fp32 ONNX graph must reproduce the torch
    # module's embedding on a longer-than-dummy input (catches shim/export
    # regressions before the artifact ships).
    import numpy as np
    import onnxruntime as ort

    with torch.no_grad():
        probe = torch.randn(1, 431, feat_dim, dtype=torch.float32)
        torch_emb = net(probe).numpy()
    sess = ort.InferenceSession(fp32_path, providers=["CPUExecutionProvider"])
    onnx_emb = sess.run(None, {"feats": probe.numpy()})[0]
    cos = float(
        np.dot(torch_emb[0], onnx_emb[0])
        / (np.linalg.norm(torch_emb[0]) * np.linalg.norm(onnx_emb[0]))
    )
    if cos < 0.99999:
        raise RuntimeError(f"CAMPPlus fp32 ONNX export fidelity too low: cosine {cos}")
    log(f"{key}: fp32 ONNX vs torch embedding cosine {cos:.8f}")

    artifact = assemble_artifact(key, spec, stage, snapshot_dir, work)
    return {"artifact_dir": artifact, "checkpoint_commit": commit, "fp32_stage": fp32_path}


def build_pin(export_results: dict, manifest_by_model: dict, versions: dict) -> dict:
    pin = {
        "schema_version": PIN_SCHEMA_VERSION,
        "generated_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "license": "Apache-2.0",
        "attribution": ATTRIBUTION,
        "release": {
            "tag": RELEASE_TAG,
            "url": RELEASE_URL,
            "asset_base_url": ASSET_BASE_URL,
        },
        "models": {},
    }
    for key, spec in MODEL_SPECS.items():
        files = [
            {
                "path": entry["path"],
                "sha256": entry["sha256"],
                "size_bytes": entry["size_bytes"],
                "asset": asset_name(spec["name"], entry["path"]),
            }
            for entry in manifest_by_model[key]
        ]
        pin["models"][key] = {
            "name": spec["name"],
            "modelscope_repo": spec["modelscope_repo"],
            "modelscope_repo_alias": spec.get("modelscope_repo_alias"),
            "model_revision": spec["model_revision"],
            "checkpoint_commit": export_results[key]["checkpoint_commit"],
            "export": versions,
            "files": files,
        }
    return pin


def verify_and_manifest(key: str, spec: dict, artifact_dir: str) -> list:
    """Strict verification of the shipping dir BEFORE it leaves the
    pipeline: exact file set + per-file hashes."""
    manifest = build_file_manifest(artifact_dir)
    problems = check_manifest(artifact_dir, manifest)
    if problems:
        raise RuntimeError(f"{key}: artifact verification failed: {problems}")
    actual = sorted(entry["path"] for entry in manifest)
    expected = sorted(spec["runtime_files"])
    if actual != expected:
        raise RuntimeError(f"{key}: artifact set drift {actual} != {expected}")
    for entry in manifest:
        log(f"{key}: {entry['path']} sha256={entry['sha256']} size={entry['size_bytes']}")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--work-dir",
        default=os.path.join(HERE, "work"),
        help="working directory (default: scripts/onnx-export/work)",
    )
    parser.add_argument(
        "--only",
        choices=list(MODEL_SPECS.keys()),
        help="export a single model (default: all four; the pin and the "
        "combined manifest are only rewritten on full runs)",
    )
    args = parser.parse_args()

    work = os.path.abspath(args.work_dir)
    os.makedirs(work, exist_ok=True)
    versions = tool_versions()
    log(f"toolchain: {versions}")

    export_results = {}
    manifest_by_model = {}
    keys = [args.only] if args.only else list(MODEL_SPECS.keys())
    for key in keys:
        spec = MODEL_SPECS[key]
        if spec["exporter"] == "funasr":
            result = export_funasr_model(key, spec, work)
        else:
            result = export_campplus(key, spec, work)
        export_results[key] = result
        manifest_by_model[key] = verify_and_manifest(key, spec, result["artifact_dir"])

    if args.only:
        log("--only given: full pin/manifest rewrite skipped (needs all four models)")
        return 0

    combined = {
        "schema_version": PIN_SCHEMA_VERSION,
        "generated_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "release": {"tag": RELEASE_TAG, "url": RELEASE_URL},
        "license": "Apache-2.0",
        "attribution": ATTRIBUTION,
        "models": {
            key: {
                "name": MODEL_SPECS[key]["name"],
                "modelscope_repo": MODEL_SPECS[key]["modelscope_repo"],
                "checkpoint_commit": export_results[key]["checkpoint_commit"],
                "files": manifest_by_model[key],
            }
            for key in MODEL_SPECS
        },
    }
    manifest_path = os.path.join(work, "artifacts", "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)
        f.write("\n")
    log(f"combined manifest written: {manifest_path}")

    pin_path = os.path.join(HERE, "model-pin.json")
    with open(pin_path, "w", encoding="utf-8") as f:
        json.dump(build_pin(export_results, manifest_by_model, versions), f,
                  ensure_ascii=False, indent=2)
        f.write("\n")
    log(f"pin written: {pin_path}")
    log("all four models exported, verified, pinned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
