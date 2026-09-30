#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20260930_T413_OnnxExportPipeline] Shared contract core of the ONNX int8
self-export pipeline (ticket #413, spec #412 T1).

This module is deliberately stdlib-only (no torch/funasr/modelscope) so it
can be imported by the export pipeline, the artifact verifier, AND the
stdlib-unittest suite (tests/python/test_onnx_export_common.py).

Trust chain, in one place:

  MODEL_SPECS     the four official iic Apache-2.0 torch checkpoints we
                  export from, at pinned revisions, plus the EXACT runtime
                  file set the funasr-onnx runtime reads per model.
  build_file_manifest / check_manifest
                  per-file sha256 manifest with strict set semantics:
                  missing, tampered, and UNLISTED files all fail (spec
                  #412 decision 8 — precise file anchors, no wildcards).
  asset_name      GitHub Release asset naming (<model>__<file>); asset
                  names cannot contain "/".

funasr-onnx 0.4.3 runtime file sets are source-verified:
  - paraformer_bin.py ContextualParaformer.__init__ (quantize=True):
    model_quant.onnx, model_eb_quant.onnx, config.yaml, am.mvn,
    tokens.json. seg_dict ships alongside (marxyz parity; reserved for
    hotword segmentation — the torch repo carries it).
  - vad_bin.py Fsmn_vad.__init__: model_quant.onnx, config.yaml, am.mvn.
  - punc_bin.py CT_Transformer.__init__: model_quant.onnx, config.yaml,
    tokens.json. (jieba_usr_dict is optional upstream via os.path.exists
    and is not shipped.)
  - CAMPPlus: funasr-onnx has NO speaker loader (verified 2026-09-30,
    wheel funasr_onnx-0.4.3); the future server loads the ONNX directly,
    so the artifact is the quantized graph + config.yaml.
"""

import hashlib
import json
import os

PIN_SCHEMA_VERSION = 1
ASSET_NAME_SEPARATOR = "__"

MODEL_SPECS = {
    "asr": {
        "name": "asr-seaco-paraformer",
        "modelscope_repo": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "modelscope_repo_alias": "damo/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "model_revision": "v2.0.4",
        "runtime_files": [
            "model_quant.onnx",
            "model_eb_quant.onnx",
            "config.yaml",
            "am.mvn",
            "tokens.json",
            "seg_dict",
        ],
        "exporter": "funasr",
        "license": "Apache-2.0",
    },
    "vad": {
        "name": "vad-fsmn",
        "modelscope_repo": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        "modelscope_repo_alias": "damo/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        "model_revision": "v2.0.4",
        "runtime_files": ["model_quant.onnx", "config.yaml", "am.mvn"],
        "exporter": "funasr",
        "license": "Apache-2.0",
    },
    "punc": {
        "name": "punc-ct-transformer-272727",
        "modelscope_repo": "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        "modelscope_repo_alias": "damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        "model_revision": "v2.0.4",
        "runtime_files": ["model_quant.onnx", "config.yaml", "tokens.json"],
        "exporter": "funasr",
        "license": "Apache-2.0",
    },
    "speaker": {
        "name": "speaker-campplus",
        "modelscope_repo": "iic/speech_campplus_sv_zh-cn_16k-common",
        "modelscope_repo_alias": "damo/speech_campplus_sv_zh-cn_16k-common",
        # NOTE: this repo has NO v2.0.4 tag (only v1.0.0/v2.0.0/v2.0.2) —
        # funasr_server.py's model_revision="v2.0.4" request silently falls
        # back upstream. The pin records the newest REAL tag so the export
        # is reproducible against actual bytes.
        "model_revision": "v2.0.2",
        "runtime_files": ["model_quant.onnx", "config.yaml"],
        "exporter": "campplus-manual",
        "license": "Apache-2.0",
    },
}


def is_sha256_hex(value) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        c in "0123456789abcdef" for c in value
    )


def is_commit_sha(value) -> bool:
    return isinstance(value, str) and len(value) == 40 and all(
        c in "0123456789abcdef" for c in value
    )


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def asset_name(model_name: str, file_path: str) -> str:
    return model_name + ASSET_NAME_SEPARATOR + file_path


def iter_dir_files(root: str):
    for dirpath, _dirnames, filenames in os.walk(root):
        for filename in filenames:
            full = os.path.join(dirpath, filename)
            yield os.path.relpath(full, root).replace(os.sep, "/")


def build_file_manifest(root: str):
    """Hash EVERY file under root (recursive, sorted by path)."""
    manifest = []
    for rel in sorted(iter_dir_files(root)):
        full = os.path.join(root, rel)
        manifest.append(
            {
                "path": rel,
                "sha256": sha256_file(full),
                "size_bytes": os.path.getsize(full),
            }
        )
    return manifest


def check_manifest(root: str, manifest):
    """Verify a directory against a manifest with STRICT set semantics.

    Returns a list of human-readable problems ([] == verified). A file on
    disk that the manifest does not list is a problem: the runtime ready
    gate (spec #412 decision 8) accepts only the pinned precise file set,
    so stray temp files must surface here, not silently pass.
    """
    problems = []
    listed = {entry["path"]: entry for entry in manifest}
    on_disk = set(iter_dir_files(root))
    for rel in sorted(on_disk):
        if rel not in listed:
            problems.append(f"unexpected file not in manifest: {rel}")
            continue
        full = os.path.join(root, rel)
        actual = sha256_file(full)
        if actual != listed[rel]["sha256"]:
            problems.append(f"sha256 mismatch: {rel} (expected {listed[rel]['sha256']}, got {actual})")
        if os.path.getsize(full) != listed[rel]["size_bytes"]:
            problems.append(f"size mismatch: {rel}")
    for rel in sorted(set(listed) - on_disk):
        problems.append(f"missing file: {rel}")
    return problems


def load_pin(pin_path: str):
    with open(pin_path, encoding="utf-8") as f:
        return json.load(f)
