#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
[20260818_T6_AudioPreprocess] Ticket #185 AC3: golden-set A/B for the DSP
preprocessing module (80Hz HPF + segmented RMS normalization).

Pipeline (macOS only — uses `say` for labeled speech synthesis):
  1. Synthesize N Chinese sentences with a zh voice (reference transcript
     is known by construction).
  2. Derive 3 loudness x 2 noise variants per sentence:
       loudness gains: 0.10 (very quiet) / 0.40 (moderate) / 1.0 (normal)
       noise: clean    / +45Hz hum & low-frequency rumble at -20 dBFS
  3. Transcribe each variant twice with the SAME Paraformer-large model:
       raw          — exactly what the file-import path used to feed it
       preprocessed — audio_preprocessing.preprocess_audio output
  4. Compute per-variant character error rate (CER, punctuation-stripped)
     vs the reference, aggregate, and write a JSON report.

Usage:
  python scripts/ab_preprocessing.py [--voice Tingting] [--skip-generate]
Requires: funasr + cached paraformer model, numpy, soundfile, ffmpeg.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import audio_preprocessing as ap  # noqa: E402

SR = 16000
# [20260818_T6_AudioPreprocess] Round-2 hardening: the first round (gains
# 0.10/0.40/1.00, rumble -20dBFS) scored CER 0.0 on BOTH arms — too easy
# for paraformer-large to discriminate. Round 2 pushes to whisper-level
# gain and rumble LOUDER than the quietest speech.
LOUDNESS_GAINS = [0.02, 0.10, 1.00]
NOISE_PROFILES = ["clean", "rumble"]
RUMBLE_FREQ_HZ = 45.0
RUMBLE_LEVEL = 10 ** (-12 / 20)  # -12 dBFS

SENTENCES = [
    "今天我们讨论第三季度的产品路线图",
    "会议纪要需要在周五之前发给所有参会人员",
    "这个方案的预算超出了原定计划的百分之十五",
    "客户端支持视窗和苹果双平台运行",
    "语音识别的准确率直接影响用户体验",
    "下周一上午十点在三号会议室进行评审",
]


def cer(reference: str, hypothesis: str) -> float:
    """Character-level edit distance / len(reference), punctuation-stripped."""

    def clean(text: str) -> str:
        out = []
        for ch in unicodedata.normalize("NFKC", text):
            if unicodedata.category(ch).startswith(("L", "N")):
                out.append(ch.lower())
        return "".join(out)

    r, h = clean(reference), clean(hypothesis)
    if not r:
        return 0.0
    prev = list(range(len(h) + 1))
    for i, rc in enumerate(r, 1):
        cur = [i]
        for j, hc in enumerate(h, 1):
            cur.append(
                min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rc != hc))
            )
        prev = cur
    return prev[-1] / len(r)


def synthesize_sentence(text: str, voice: str, out_wav: str) -> None:
    with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as tmp:
        aiff = tmp.name
    try:
        subprocess.run(
            ["say", "-v", voice, text, "-o", aiff], check=True, capture_output=True
        )
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", aiff,
                "-ar", str(SR), "-ac", "1", out_wav,
            ],
            check=True,
            capture_output=True,
        )
    finally:
        os.unlink(aiff)


def make_variant(samples: np.ndarray, gain: float, noise: str) -> np.ndarray:
    rng = np.random.default_rng(42)
    x = samples * gain
    if noise == "rumble":
        t = np.arange(len(x), dtype=np.float64) / SR
        hum = RUMBLE_LEVEL * np.sin(2 * np.pi * RUMBLE_FREQ_HZ * t)
        # Slow low-frequency rumble drift on top of the pure tone.
        drift = (
            0.5
            * RUMBLE_LEVEL
            * np.sin(2 * np.pi * 7.0 * t + rng.uniform(0, 6.28))
        )
        x = x + (hum + drift).astype(np.float32)
    # Keep the variant itself finite & in range before writing.
    return np.clip(x, -0.99, 0.99).astype(np.float32)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default=None, help="macOS zh voice name")
    parser.add_argument("--skip-generate", action="store_true",
                        help="reuse existing golden_set/ dir if present")
    args = parser.parse_args()

    voice = args.voice
    if voice is None:
        listing = subprocess.run(
            ["say", "-v", "?"], check=True, capture_output=True, text=True
        ).stdout
        zh = [ln.split()[0] for ln in listing.splitlines() if "zh_CN" in ln]
        if not zh:
            print("no zh_CN voice available", file=sys.stderr)
            return 1
        voice = "Tingting" if "Tingting" in zh else zh[0]
    print(f"voice: {voice}")

    golden_dir = os.path.join(ROOT, "scripts", "golden_set")
    os.makedirs(golden_dir, exist_ok=True)
    if not args.skip_generate or not os.listdir(golden_dir):
        for name in os.listdir(golden_dir):
            os.unlink(os.path.join(golden_dir, name))
        for i, sentence in enumerate(SENTENCES):
            base = os.path.join(golden_dir, f"s{i:02d}_base.wav")
            synthesize_sentence(sentence, voice, base)
            samples, sr = sf.read(base, dtype="float32")
            assert sr == SR
            for gain in LOUDNESS_GAINS:
                for noise in NOISE_PROFILES:
                    variant = make_variant(samples, gain, noise)
                    tag = f"g{int(gain*100):03d}_{noise}"
                    sf.write(
                        os.path.join(golden_dir, f"s{i:02d}_{tag}.wav"),
                        variant,
                        SR,
                        subtype="PCM_16",
                    )
            with open(
                os.path.join(golden_dir, f"s{i:02d}_ref.txt"), "w", encoding="utf-8"
            ) as f:
                f.write(sentence)
        print(f"golden set generated: {len(SENTENCES)} sentences x "
              f"{len(LOUDNESS_GAINS) * len(NOISE_PROFILES)} variants")

    print("loading paraformer-large ...")
    from funasr import AutoModel

    model = AutoModel(
        model="damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
    )

    results = []
    for i in range(len(SENTENCES)):
        with open(
            os.path.join(golden_dir, f"s{i:02d}_ref.txt"), encoding="utf-8"
        ) as f:
            reference = f.read().strip()
        for gain in LOUDNESS_GAINS:
            for noise in NOISE_PROFILES:
                tag = f"g{int(gain*100):03d}_{noise}"
                path = os.path.join(golden_dir, f"s{i:02d}_{tag}.wav")

                raw_res = model.generate(input=path)
                raw_text = raw_res[0].get("text", "") if raw_res else ""

                samples, sr = sf.read(path, dtype="float32")
                processed = ap.preprocess_audio(samples, sr)
                with tempfile.NamedTemporaryFile(
                    suffix=".wav", delete=False
                ) as tmp:
                    sf.write(tmp.name, processed, sr, subtype="PCM_16")
                    proc_path = tmp.name
                try:
                    proc_res = model.generate(input=proc_path)
                finally:
                    os.unlink(proc_path)
                proc_text = proc_res[0].get("text", "") if proc_res else ""

                row = {
                    "sentence": i,
                    "variant": tag,
                    "reference": reference,
                    "raw_text": raw_text,
                    "raw_cer": round(cer(reference, raw_text), 4),
                    "preprocessed_text": proc_text,
                    "preprocessed_cer": round(cer(reference, proc_text), 4),
                }
                results.append(row)
                print(
                    f"s{i:02d} {tag}: raw_cer={row['raw_cer']:.3f} "
                    f"pre_cer={row['preprocessed_cer']:.3f}"
                )

    def agg(key):
        return round(sum(r[key] for r in results) / len(results), 4)

    report = {
        "voice": voice,
        "model": "paraformer-large",
        "variants": len(results),
        "mean_raw_cer": agg("raw_cer"),
        "mean_preprocessed_cer": agg("preprocessed_cer"),
        "quiet_mean_raw_cer": round(
            sum(r["raw_cer"] for r in results if "g002" in r["variant"])
            / max(1, sum(1 for r in results if "g002" in r["variant"])),
            4,
        ),
        "quiet_mean_preprocessed_cer": round(
            sum(
                r["preprocessed_cer"]
                for r in results
                if "g002" in r["variant"]
            )
            / max(1, sum(1 for r in results if "g002" in r["variant"])),
            4,
        ),
        "rows": results,
    }
    out = os.path.join(ROOT, "scripts", "ab_preprocessing_results.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k != "rows"},
                     ensure_ascii=False, indent=2))
    print(f"report: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
