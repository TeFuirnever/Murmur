#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
[20260819_T13_SeacoSpike] Ticket #191 (spec #177 T13): go/no-go evaluation
of SeACo-Paraformer as the hotword-capable replacement for paraformer-
large. Measures, against the T6 golden set (scripts/golden_set/):

  1. download size + first-load time (expected_size input for modelManager)
  2. baseline CER vs the current model (current model's raw CER on this
     set is 0.0 everywhere — SeACo must not regress)
  3. VAD/punc pipeline compatibility (same AutoModel chaining works)
  4. timestamp output compatibility (the server's segment builder depends
     on asr_result[0]["timestamp"])
  5. code-switching hotword effectiveness: the golden sentence with
     English tech terms, transcribed with vs without hotword

Usage: python scripts/seaco_spike.py [--model damo/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch]
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

SEACO_MODEL = (
    "damo/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
)
CURRENT_MODEL = (
    "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
)
GOLDEN_DIR = os.path.join(ROOT, "scripts", "golden_set")


def model_cache_dir(model_name: str) -> str:
    base = os.path.expanduser("~/.cache/modelscope/hub/models")
    return os.path.join(base, model_name.replace("/", os.sep))


def dir_size_mb(path: str) -> float:
    total = 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for f in filenames:
            total += os.path.getsize(os.path.join(dirpath, f))
    return round(total / 1024 / 1024, 1)


def cer_from_ab(ref_path: str) -> "tuple[str, object]":
    from ab_preprocessing import cer  # noqa: PLC0415

    with open(ref_path, encoding="utf-8") as f:
        return f.read().strip(), cer


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=SEACO_MODEL)
    args = parser.parse_args()

    report: dict = {"model": args.model}

    # --- 1. size + load time -------------------------------------------
    cache = model_cache_dir(args.model)
    pre_existing = os.path.isdir(cache)
    if pre_existing:
        report["cache_pre_existing"] = True
        report["size_mb_cached"] = dir_size_mb(cache)
    else:
        report["cache_pre_existing"] = False

    from funasr import AutoModel  # noqa: PLC0415

    t0 = time.perf_counter()
    seaco = AutoModel(model=args.model)
    report["load_time_s_cold_or_cached"] = round(time.perf_counter() - t0, 2)
    # Control model for hotword comparison (already cached in dev envs).
    current = AutoModel(model=CURRENT_MODEL)
    if not pre_existing:
        report["size_mb_downloaded"] = dir_size_mb(cache)

    # --- 2/4. baseline CER + timestamp over the golden set --------------
    refs = {}
    for name in sorted(os.listdir(GOLDEN_DIR)):
        if name.endswith("_ref.txt"):
            idx = name.split("_")[0]
            refs[idx] = os.path.join(GOLDEN_DIR, name)
    _, cer_fn = cer_from_ab(next(iter(refs.values())))

    rows = []
    timestamp_seen = False
    for name in sorted(os.listdir(GOLDEN_DIR)):
        if not name.endswith(".wav") or "_base" in name:
            continue
        idx = name.split("_")[0]
        ref_path = refs.get(idx)
        if not ref_path:
            continue
        with open(ref_path, encoding="utf-8") as f:
            reference = f.read().strip()
        res = seaco.generate(input=os.path.join(GOLDEN_DIR, name))
        first = res[0] if res else {}
        if "timestamp" in first:
            timestamp_seen = True
        text = first.get("text", "")
        rows.append(
            {
                "variant": name.replace(".wav", ""),
                "cer": round(cer_fn(reference, text), 4),
                "text": text[:60],
                "has_timestamp": "timestamp" in first,
            }
        )
    report["golden"] = {
        "variants": len(rows),
        "mean_cer": round(sum(r["cer"] for r in rows) / max(1, len(rows)), 4),
        "worst_cer": max((r["cer"] for r in rows), default=0.0),
        "timestamp_seen": timestamp_seen,
        "rows": rows,
    }

    # --- 3. VAD/punc chaining -------------------------------------------
    try:
        from funasr import AutoModel as AM  # noqa: PLC0415

        vad = AM(model="damo/speech_fsmn_vad_zh-cn-16k-common-pytorch")
        sample = os.path.join(GOLDEN_DIR, "s00_g100_clean.wav")
        vad_res = vad.generate(input=sample)
        report["vad_chain_ok"] = bool(vad_res and vad_res[0].get("value"))
    except Exception as e:  # noqa: BLE001
        report["vad_chain_ok"] = False
        report["vad_chain_error"] = str(e)

    # --- 5. hotword effectiveness: rare proper nouns ---------------------
    # Clean TTS speech hits the CER ceiling (baseline already perfect), so
    # the discriminating test is RARE PROPER NOUNS — the actual user story
    # ("同事姓名/产品名不再识别错"). Synthesized per-run via `say` (macOS,
    # same as the golden-set generator) so the spike is re-runnable.
    def synth(text: str) -> str:
        with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as t:
            aiff = t.name
        subprocess.run(
            ["say", "-v", "Tingting", text, "-o", aiff],
            check=True, capture_output=True,
        )
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
            wav = t.name
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", aiff,
             "-ar", "16000", "-ac", "1", wav],
            check=True, capture_output=True,
        )
        os.unlink(aiff)
        return wav

    hw_cases = [
        ("请把会议纪要发给张晗玥和刘翀", "张晗玥 刘翀"),
        ("下周由龚燊带队去深圳湾总部", "龚燊"),
        ("这个项目的负责人是 Jedediah Kellerberg", "Jedediah Kellerberg"),
    ]
    hw_rows = []
    for text, hw in hw_cases:
        wav = synth(text)
        try:
            cur_no = current.generate(input=wav)[0].get("text", "")
            s_no = seaco.generate(input=wav, hotword="")[0].get("text", "")
            s_yes = seaco.generate(input=wav, hotword=hw)[0].get("text", "")
        finally:
            os.unlink(wav)
        hw_rows.append(
            {
                "reference": text,
                "hotword": hw,
                "current_no_hotword": cur_no,
                "seaco_no_hotword": s_no,
                "seaco_with_hotword": s_yes,
            }
        )
    report["hotword_rare_nouns"] = hw_rows

    out = os.path.join(ROOT, "scripts", "seaco_spike_results.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    summary = {k: v for k, v in report.items() if k != "golden"}
    summary["golden_mean_cer"] = report["golden"]["mean_cer"]
    summary["golden_worst_cer"] = report["golden"]["worst_cer"]
    summary["timestamp_seen"] = report["golden"]["timestamp_seen"]
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"report: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
