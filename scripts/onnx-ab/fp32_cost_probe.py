#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20261006_Diag_444_Fp32CostProbe] Ticket #444 (spec #412 T4b): fp32 vs
int8 ASR main-graph cost numbers (size / memory / speed).

T4b acceptance: IF the fp32 main graph makes the English hotword work, the
fp32 size/memory/speed cost must be recorded (evidence for the T10 ADR —
this probe RECORDS numbers, it makes no route recommendation).

Parent mode (default) spawns itself once per arm in a SEPARATE process so
each arm's peak RSS high-water mark is uncontaminated by the other:

  python scripts/onnx-ab/fp32_cost_probe.py            # both arms, JSON out
  python scripts/onnx-ab/fp32_cost_probe.py --variant fp32 --out child.json

Each child loads exactly what the A/B verdict server loads (int8 VAD +
int8 punc + the arm's ASR graph), then runs the six hotword corpus wavs
once each (hotword on) through the server-parity pipeline, timing each
transcription. Peak RSS is resource.getrusage(RUSAGE_SELF).ru_maxrss
(macOS: bytes; Linux: KiB — normalized to MB here).

Stdlib-only at module level; heavy imports lazy; the child prints exactly
one JSON line to the real stdout (engine banners are swallowed like the
verdict server does).
"""

import argparse
import contextlib
import json
import os
import resource
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
EXPORT_SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts", "onnx-export")

for _path in (REPO_ROOT, EXPORT_SCRIPTS_DIR):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import funasr_server_onnx_ab as ab  # noqa: E402
from onnx_export_common import MODEL_SPECS  # noqa: E402

DEFAULT_OUT = os.path.join(HERE, "work", "fp32-cost-probe.json")
CORPUS_DIR = os.path.join(REPO_ROOT, "scripts", "asr-corpus")
BYTES_PER_MB = 1024 * 1024
KIB_PER_MB = 1024

_PROTOCOL_STDOUT = sys.stdout


def peak_rss_mb():
    """ru_maxrss is bytes on macOS, KiB on Linux — normalize to MB."""
    raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    divisor = BYTES_PER_MB if sys.platform == "darwin" else KIB_PER_MB
    return round(raw / divisor, 1)


def load_corpus_hotword_cases(corpus_dir):
    with open(os.path.join(corpus_dir, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    cases = manifest["cases"] if isinstance(manifest, dict) else manifest
    return [c for c in cases if c.get("hotword")]


def dir_total_bytes(path):
    total = 0
    for _dirpath, _dirnames, filenames in os.walk(path):
        for filename in filenames:
            total += os.path.getsize(os.path.join(_dirpath, filename))
    return total


def run_child(variant, artifacts_dir, fp32_artifacts_dir, corpus_dir):
    """One arm in THIS process: load models, transcribe the hotword corpus,
    return the arm's cost record."""
    import time

    with open(os.path.join(corpus_dir, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    cases = [
        c
        for c in (manifest["cases"] if isinstance(manifest, dict) else manifest)
        if c.get("hotword")
    ]

    devnull = open(os.devnull, "w")
    timings = {}
    try:
        with contextlib.redirect_stdout(devnull):
            from funasr_onnx import CT_Transformer, Fsmn_vad, SeacoParaformer

            t0 = time.perf_counter()
            asr_dir = (
                os.path.join(fp32_artifacts_dir, MODEL_SPECS["asr"]["name"])
                if variant == "fp32"
                else os.path.join(artifacts_dir, MODEL_SPECS["asr"]["name"])
            )
            asr = SeacoParaformer(asr_dir, quantize=(variant != "fp32"))
            timings["load_asr_s"] = round(time.perf_counter() - t0, 2)
            t0 = time.perf_counter()
            vad = Fsmn_vad(
                os.path.join(artifacts_dir, MODEL_SPECS["vad"]["name"]),
                quantize=True,
            )
            punc = CT_Transformer(
                os.path.join(artifacts_dir, MODEL_SPECS["punc"]["name"]),
                quantize=True,
            )
            timings["load_vad_punc_s"] = round(time.perf_counter() - t0, 2)
    finally:
        devnull.close()
    rss_after_load_mb = peak_rss_mb()

    # Server-parity audio prep + transcription, hotword on, wall-timed.
    import audio_preprocessing
    import numpy as np
    import soundfile as sf

    sample_rate = ab.SAMPLE_RATE
    per_case = []
    inference_total = 0.0
    for case in cases:
        audio_path = os.path.join(corpus_dir, case["audio"])
        samples, samplerate = sf.read(audio_path, dtype="float32", always_2d=False)
        samples = np.asarray(samples, dtype=np.float32)
        duration = len(samples) / float(samplerate)
        processed = audio_preprocessing.preprocess_audio(samples, sample_rate)
        quantized = ab.OnnxAbServer._pcm16_roundtrip(processed)
        vad_result = vad(quantized)
        vad_segments = vad_result[0] if vad_result else []
        total_ms = int(duration * 1000)
        regions = ab.compute_regions(vad_segments) or [[0, total_ms]]

        t0 = time.perf_counter()
        raw = ""
        for region_start, region_end in regions:
            buf_start_ms, buf_end_ms = ab.buffered_bounds(
                region_start, region_end, total_ms
            )
            start_frame = int(buf_start_ms / 1000.0 * sample_rate)
            end_frame = min(
                len(quantized), int(buf_end_ms / 1000.0 * sample_rate)
            )
            chunk = quantized[max(0, start_frame):end_frame]
            result = asr(chunk, case["hotword"]["hotwordString"])
            if result:
                raw += result[0].get("preds", "")
        wall = time.perf_counter() - t0
        inference_total += wall
        per_case.append(
            {
                "id": case["id"],
                "duration_s": round(duration, 3),
                "asr_wall_s": round(wall, 3),
                "rtf": round(wall / duration, 4) if duration else None,
            }
        )

    return {
        "variant": variant,
        "asr_dir": asr_dir,
        "asr_dir_bytes": dir_total_bytes(asr_dir),
        "load_timings": timings,
        "rss_peak_after_load_mb": rss_after_load_mb,
        "rss_peak_after_inference_mb": peak_rss_mb(),
        "inference_wall_total_s": round(inference_total, 3),
        "per_case": per_case,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=("int8", "fp32"), default=None,
                        help="child mode: run one arm in this process")
    parser.add_argument("--artifacts", default=ab.DEFAULT_ARTIFACTS_DIR)
    parser.add_argument("--fp32-artifacts", default=ab.DEFAULT_FP32_ARTIFACTS_DIR)
    parser.add_argument("--corpus", default=CORPUS_DIR)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    if args.variant:
        report = run_child(
            args.variant, args.artifacts, args.fp32_artifacts, args.corpus
        )
        print(json.dumps(report, ensure_ascii=False), file=_PROTOCOL_STDOUT)
        return 0

    # Parent mode: one fresh process per arm (clean ru_maxrss high-water),
    # trust gates verified here first so children never run unverified bytes.
    with open(ab.DEFAULT_PIN_PATH, encoding="utf-8") as f:
        pin = json.load(f)
    problems = ab.OnnxAbServer(args.artifacts, pin).verify_pin()
    problems += ab.OnnxAbServer(
        args.artifacts,
        pin,
        asr_variant="fp32",
        fp32_artifacts_dir=args.fp32_artifacts,
        fp32_manifest_path=ab.DEFAULT_FP32_MANIFEST_PATH,
    ).verify_pin()
    if problems:
        print(
            json.dumps({"success": False, "error": problems[:5]}),
            file=_PROTOCOL_STDOUT,
        )
        return 1

    arms = {}
    for variant in ("int8", "fp32"):
        proc = subprocess.run(
            [sys.executable, os.path.abspath(__file__),
             "--variant", variant,
             "--artifacts", args.artifacts,
             "--fp32-artifacts", args.fp32_artifacts,
             "--corpus", args.corpus],
            capture_output=True,
            text=True,
            timeout=30 * 60,
        )
        if proc.returncode != 0:
            print(
                json.dumps(
                    {
                        "success": False,
                        "error": f"{variant} child failed rc={proc.returncode}",
                        "stderr_tail": proc.stderr[-2000:],
                    }
                ),
                file=_PROTOCOL_STDOUT,
            )
            return 1
        # The child's one JSON line is the LAST stdout line (engine banners
        # are swallowed by the child itself).
        arms[variant] = json.loads(proc.stdout.strip().splitlines()[-1])

    report = {
        "ticket": 444,
        "arms": arms,
        "size_delta": {
            "fp32_minus_int8_bytes": arms["fp32"]["asr_dir_bytes"]
            - arms["int8"]["asr_dir_bytes"],
        },
    }
    report["success"] = True
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps({"success": True, "out": args.out}), file=_PROTOCOL_STDOUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
