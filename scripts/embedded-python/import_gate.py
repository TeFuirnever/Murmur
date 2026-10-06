#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20261006_T8_PackagingSlimdown] Ticket #422 (spec #412 decisions 3/5):
packaging import gate + real-inference gate for the slimmed embedded
Python env (funasr-onnx stack, numba/llvmlite pruned).

Two modes:

  --check-only   Model-free, runs on EVERY packaging build (fresh or
                 cache-hit env): import the full runtime stack and verify
                 the packaging-state marker against the filesystem — a
                 "pruned" marker must mean numba/llvmlite are really gone,
                 a "degraded"/skipped marker must still import cleanly.
                 This is build.yml's "Verify embedded Python deps" gate.

  full (default) Everything --check-only does, PLUS a REAL transcription of
                 a NON-WAV fixture through the production doorway
                 (funasr_server._load_audio_ndarray → soundfile decode →
                 the same adapters the server drives): ASR + VAD + Punc on
                 real self-exported model bytes. The numba/llvmlite prune
                 is only kept when THIS passes; any failure makes the
                 prepare script restore the packages (降级不裁).

The fixture is the committed 40s speech wav converted to FLAC at run time:
a non-wav input proves the pure-C soundfile decode path (the de-librosa
doorway) still feeds the engines after the prune.

Exit codes: 0 = gate passed; 1 = gate failed (JSON verdict on stdout,
details on stderr).
"""

import argparse
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
DEFAULT_FIXTURE = os.path.join(
    REPO_ROOT, "scripts", "onnx-spike", "fixtures", "onnx-spike-40s.wav"
)
# Mirrors scripts/onnx-spike/win_spike.py MIN_TEXT_CHARS for the same
# fixture: below this the model is broken, not merely imperfect.
MIN_TEXT_CHARS = 30

# The runtime stack the slimmed env must import (build.yml's former inline
# `import numpy, soundfile, funasr` lived here now — one source of truth).
RUNTIME_IMPORTS = (
    "numpy",
    "soundfile",
    "scipy.signal",
    "yaml",
    "onnxruntime",
    "funasr_onnx",
)

# Packages the prune removes; a "pruned" marker must match reality.
PRUNE_PACKAGES = ("numba", "llvmlite")


def check_runtime_imports():
    """Import every runtime module; returns an error string or None."""
    for module_name in RUNTIME_IMPORTS:
        try:
            __import__(module_name)
        except Exception as error:  # noqa: BLE001 - gate must report any
            return f"import {module_name} failed: {error}"
    return None


def check_prune_consistency(state_path):
    """Verify the packaging-state marker matches the filesystem.

    Returns (ok, detail). A missing marker fails: the env must come from
    the gated pipeline (prepare-embedded-python.js), not an older build.
    """
    if not os.path.isfile(state_path):
        return (
            False,
            f"packaging state marker missing: {state_path} — the env was "
            "not produced by the gated packaging pipeline; re-run "
            "scripts/prepare-embedded-python.js",
        )
    try:
        with open(state_path, "r", encoding="utf-8") as handle:
            state = json.load(handle)
    except (OSError, ValueError) as error:
        return False, f"packaging state marker unreadable: {error}"

    pruned = bool(state.get("pruned"))
    for package in PRUNE_PACKAGES:
        present = importlib.util.find_spec(package) is not None
        if pruned and present:
            return (
                False,
                f"marker says pruned but `{package}` is importable — the "
                "env and its marker disagree",
            )
        if not pruned and not present:
            # The lock always installs the prune packages, so a not-pruned
            # env must still have them; anything else means a corrupted env.
            return (
                False,
                f"marker says not pruned but `{package}` is missing — "
                "rebuild the env via scripts/prepare-embedded-python.js",
            )
    return True, f"marker consistent (pruned={pruned}, reason={state.get('reason')})"


def convert_fixture_to_flac(fixture_path, out_dir):
    """Decode the committed wav and re-encode as FLAC (non-wav fixture)."""
    import soundfile as sf

    samples, samplerate = sf.read(fixture_path, dtype="float32", always_2d=True)
    out_path = os.path.join(out_dir, "gate-fixture.flac")
    sf.write(out_path, samples, samplerate, format="FLAC")
    return out_path


def run_real_inference(models_dir, fixture_path):
    """Real transcription through the production adapters.

    Loads the three engines exactly as funasr_server's loaders do, feeds
    the FLAC fixture through _load_audio_ndarray, asserts non-empty ASR
    text, VAD regions, and punc output. Returns the JSON verdict dict.
    """
    sys.path.insert(0, REPO_ROOT)
    import funasr_server as server

    role_dirs = {}
    for role, dir_name in server.ONNX_MODEL_DIR_NAMES.items():
        role_dir = os.path.join(models_dir, dir_name)
        if not os.path.isdir(role_dir):
            return {
                "passed": False,
                "error": (
                    f"model dir missing for role '{role}': {role_dir} — "
                    "fetch via scripts/onnx-export/verify_artifacts.py "
                    "--from-release"
                ),
            }
        role_dirs[role] = role_dir

    from funasr_onnx import CT_Transformer, Fsmn_vad, SeacoParaformer

    asr = server.OnnxAsrAdapter(SeacoParaformer(role_dirs["asr"], quantize=True))
    vad = server.OnnxVadAdapter(Fsmn_vad(role_dirs["vad"], quantize=True))
    punc = server.OnnxPuncAdapter(
        CT_Transformer(role_dirs["punc"], quantize=True)
    )

    with tempfile.TemporaryDirectory(prefix="murmur-gate-") as tmp_dir:
        flac_path = convert_fixture_to_flac(fixture_path, tmp_dir)

        # VAD: non-wav decode + region output.
        vad_result = vad.generate(input=flac_path)
        regions = vad_result[0]["value"] if vad_result else []
        if not regions:
            return {"passed": False, "error": "VAD produced no regions"}

        # ASR: the transcription itself, through the ndarray doorway.
        asr_result = asr.generate(input=flac_path)
        text = (asr_result[0].get("text") if asr_result else "") or ""
        if len(text) < MIN_TEXT_CHARS:
            return {
                "passed": False,
                "error": (
                    f"ASR text too short ({len(text)} < {MIN_TEXT_CHARS})"
                ),
                "text": text,
            }

        # Punc: consumes the ASR text.
        punc_result = punc.generate(input=text)
        punctuated = (punc_result[0].get("text") if punc_result else "") or ""
        if not punctuated.strip():
            return {"passed": False, "error": "punc produced empty text"}

        return {
            "passed": True,
            "fixture": os.path.basename(fixture_path),
            "flac_bytes": os.path.getsize(flac_path),
            "vad_regions": len(regions),
            "text_chars": len(text),
            "punctuated_chars": len(punctuated),
            "text": text,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="imports + marker consistency only (no models, no inference)",
    )
    parser.add_argument("--models-dir", default=None, help="pin layout root")
    parser.add_argument("--fixture-wav", default=DEFAULT_FIXTURE)
    parser.add_argument(
        "--state-file",
        default=os.path.join(
            os.environ.get("MURMUR_EMBEDDED_PYTHON_DIR", ""),
            ".murmur-packaging-state.json",
        )
        if os.environ.get("MURMUR_EMBEDDED_PYTHON_DIR")
        else None,
        help="packaging-state marker path (default: <pythonDir> marker "
        "passed by the caller via MURMUR_EMBEDDED_PYTHON_DIR)",
    )
    parser.add_argument(
        "--assert-numba-absent",
        action="store_true",
        help="full mode: the prune must already be applied (dirs moved)",
    )
    args = parser.parse_args()

    verdict = {"mode": "check-only" if args.check_only else "full"}

    import_error = check_runtime_imports()
    if import_error:
        verdict.update({"passed": False, "error": import_error})
        print(json.dumps(verdict, ensure_ascii=False))
        return 1
    verdict["imports"] = "ok"

    if args.assert_numba_absent:
        for package in PRUNE_PACKAGES:
            if importlib.util.find_spec(package) is not None:
                verdict.update({
                    "passed": False,
                    "error": f"`{package}` still importable during prune gate",
                })
                print(json.dumps(verdict, ensure_ascii=False))
                return 1
        verdict["prune_applied"] = True

    if not args.check_only:
        if not args.models_dir:
            verdict.update({
                "passed": False,
                "error": "full gate needs --models-dir (pin layout root)",
            })
            print(json.dumps(verdict, ensure_ascii=False))
            return 1
        if not os.path.isfile(args.fixture_wav):
            verdict.update({
                "passed": False,
                "error": f"fixture wav missing: {args.fixture_wav}",
            })
            print(json.dumps(verdict, ensure_ascii=False))
            return 1
        inference = run_real_inference(args.models_dir, args.fixture_wav)
        verdict["inference"] = inference
        if not inference.get("passed"):
            verdict["passed"] = False
            print(json.dumps(verdict, ensure_ascii=False))
            return 1

    if args.state_file:
        ok, detail = check_prune_consistency(args.state_file)
        verdict["marker"] = detail
        if not ok:
            verdict["passed"] = False
            print(json.dumps(verdict, ensure_ascii=False))
            return 1

    verdict["passed"] = True
    print(json.dumps(verdict, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
