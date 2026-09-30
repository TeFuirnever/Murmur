#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20260930_T413_OnnxExportPipeline] Ticket #413 acceptance smoke: run the
EXPORTED ONNX int8 artifacts through funasr-onnx exactly the way the future
runtime will load them, on a ~40s Chinese speech wav, and record RTF/RSS.

Checks:
  1. ASR (SeacoParaformer, quantize=True) transcribes the 40s wav to
     coherent text — quantified as char similarity vs the TTS reference
     (the wav is synthesized from a known text, so we can measure).
  2. The hotword parameter path EXECUTES: model(wav, "热词 列表") returns
     normally (positional hotwords arg — the SeACo signature).
  3. VAD + Punc chain works on the same wav (the server pipeline shape).
  4. CAMPPlus int8 vs fp32 ONNX embedding cosine similarity (quantization
     delta measurement for the speaker model).
  5. RTF (ASR inference wall time / audio duration, best of 3 warm runs)
     and peak RSS are recorded.

Usage (inside the pipeline venv):
  python scripts/onnx-export/smoke_inference.py \
      [--artifacts scripts/onnx-export/work/artifacts] [--wav PATH] \
      [--fp32-campplus scripts/onnx-export/work/stage/speaker/model.onnx] \
      [--out scripts/onnx-export/work/smoke_results.json]

If --wav is absent, a ~40s wav is synthesized with macOS `say` (Tingting)
from a fixed text — same generator as the golden set; macOS-version voice
differences are acceptable for a smoke (coherence is measured, not gated
on an absolute golden transcript).
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from onnx_export_common import MODEL_SPECS  # noqa: E402

# [20260930_T413_OnnxExportPipeline] Smoke speech: ~40s at the default zh
# speaking rate (186 chars ≈ 41s measured on Tingting/macOS 27); domain
# matches the spike corpus (ASR / end-to-end models) and contains every
# HOTWORDS term so the hotword path exercises real biasing candidates.
SMOKE_TEXT = (
    "语音识别技术把人类说话的声学信号转换成文字,是很多人日常工作中离不开的工具。"
    "端到端模型把整条链路合并成一个神经网络,直接从音频输出文字,训练更简单,识别更准确。"
    "我们的应用程序在本地完成全部识别过程,音频不会上传到任何服务器,保护用户隐私。"
    "接下来还要支持热词功能,用户可以添加人名和专业术语,提高专有名词的识别准确率。"
    "欢迎大家在设置页面体验新版本,谢谢大家。"
)
HOTWORDS = "语音识别 端到端模型 热词 隐私"

# Smoke pass threshold for char similarity vs the TTS reference. TTS
# intonation + punc insertion + tokenizer splits make 1.0 unreachable;
# the torch baseline measured CER 0.0 on clean TTS and the ONNX spike was
# "全文连贯" — 0.60 leaves room for quantization noise while still
# failing on garbled output.
MIN_TEXT_SIMILARITY = 0.60


def log(message: str) -> None:
    print(f"[smoke] {message}", flush=True)


def synth_wav(target_seconds: float) -> tuple:
    """Synthesize SMOKE_TEXT with macOS `say` + ffmpeg (16k mono s16)."""
    with tempfile.TemporaryDirectory() as tmp:
        aiff = os.path.join(tmp, "smoke.aiff")
        wav = os.path.join(HERE, "work", "smoke-40s.wav")
        os.makedirs(os.path.dirname(wav), exist_ok=True)
        subprocess.run(["say", "-v", "Tingting", SMOKE_TEXT, "-o", aiff], check=True,
                       capture_output=True)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", aiff, "-ar", "16000",
             "-ac", "1", "-sample_fmt", "s16", wav],
            check=True, capture_output=True,
        )
    import wave

    with wave.open(wav, "rb") as reader:
        frames = reader.getnframes()
        rate = reader.getframerate()
    duration = frames / float(rate)
    log(f"synthesized {duration:.1f}s wav: {wav}")
    return wav, duration


def levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (ca != cb),
            ))
        previous = current
    return previous[-1]


def char_similarity(reference: str, hypothesis: str) -> float:
    ref = "".join(reference.split())
    hyp = "".join(hypothesis.split())
    if not ref:
        return 0.0
    return 1.0 - levenshtein(ref, hyp) / max(len(ref), len(hyp))


def peak_rss_mb() -> float:
    import resource

    ru_maxrss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # darwin reports bytes, linux reports KiB
    if sys.platform == "darwin":
        return ru_maxrss / 1024 / 1024
    return ru_maxrss / 1024


def load_wav_float(path: str):
    import soundfile as sf

    data, samplerate = sf.read(path, dtype="float32")
    return data, samplerate


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", default=os.path.join(HERE, "work", "artifacts"))
    parser.add_argument("--wav", default=None)
    parser.add_argument(
        "--fp32-campplus", default=os.path.join(HERE, "work", "stage", "speaker", "model.onnx"),
        help="fp32 CAMPPlus graph from the export stage (quantization-delta check)",
    )
    parser.add_argument("--out", default=os.path.join(HERE, "work", "smoke_results.json"))
    args = parser.parse_args()

    from funasr_onnx import CT_Transformer, Fsmn_vad, SeacoParaformer

    asr_dir = os.path.join(args.artifacts, MODEL_SPECS["asr"]["name"])
    vad_dir = os.path.join(args.artifacts, MODEL_SPECS["vad"]["name"])
    punc_dir = os.path.join(args.artifacts, MODEL_SPECS["punc"]["name"])
    campplus_dir = os.path.join(args.artifacts, MODEL_SPECS["speaker"]["name"])

    wav, duration = (args.wav, None) if args.wav else synth_wav(40)
    if duration is None:
        _data, rate = load_wav_float(wav)
        duration = len(_data) / float(rate)
    audio, samplerate = load_wav_float(wav)
    assert samplerate == 16000, f"expected 16k wav, got {samplerate}"
    log(f"wav: {wav} ({duration:.1f}s)")

    t0 = time.perf_counter()
    asr = SeacoParaformer(asr_dir, quantize=True)
    log(f"ASR load {time.perf_counter() - t0:.2f}s")
    t0 = time.perf_counter()
    vad = Fsmn_vad(vad_dir, quantize=True)
    punc = CT_Transformer(punc_dir, quantize=True)
    log(f"VAD+Punc load {time.perf_counter() - t0:.2f}s")

    report = {
        "wav": os.path.abspath(wav),
        "duration_s": round(duration, 2),
        "hotwords": HOTWORDS,
        "tool": "funasr_onnx",
    }

    # --- 1/2. ASR plain + hotword path ---------------------------------
    # funasr_onnx 0.4.3 SeacoParaformer returns {"preds": space-joined
    # chars, "timestamp": [[ms, ms], ...], "raw_tokens": [...]} — there is
    # no "text" key (unlike the torch funasr AutoModel result).
    result_plain = asr(audio, "")
    preds_plain = result_plain[0].get("preds", "") if result_plain else ""
    text_plain = "".join(preds_plain.split())
    result_hot = asr(audio, HOTWORDS)
    preds_hot = result_hot[0].get("preds", "") if result_hot else ""
    text_hot = "".join(preds_hot.split())
    has_timestamp = bool(result_plain and "timestamp" in result_plain[0])
    similarity = char_similarity(SMOKE_TEXT, text_plain)
    report["asr"] = {
        "text_plain": text_plain,
        "text_with_hotwords": text_hot,
        "timestamp_present": has_timestamp,
        "char_similarity_vs_reference": round(similarity, 4),
        "coherent": similarity >= MIN_TEXT_SIMILARITY and len(text_plain) >= 30,
    }

    # --- 3. VAD + Punc chain -------------------------------------------
    t0 = time.perf_counter()
    vad_result = vad(audio)
    vad_time = time.perf_counter() - t0
    # funasr_onnx Fsmn_vad returns one [[start_ms, end_ms], ...] list per
    # input waveform — unwrap the batch layer.
    vad_segments = vad_result[0] if vad_result else []
    t0 = time.perf_counter()
    # CT_Transformer consumes the space-joined preds form.
    punc_text = punc(preds_plain)[0] if preds_plain else ""
    punc_time = time.perf_counter() - t0
    report["vad_punc"] = {
        "vad_segments": len(vad_segments),
        "vad_seconds_total": round(
            sum((seg[1] - seg[0]) / 1000.0 for seg in vad_segments), 2
        ),
        "vad_infer_s": round(vad_time, 3),
        "punc_infer_s": round(punc_time, 3),
        "punctuated_text": punc_text,
    }

    # --- 4. RTF + RSS (BEFORE the campplus check — it imports torch,
    # which would inflate the runtime-representative RSS number) --------
    rtf_runs = []
    for _ in range(3):
        t0 = time.perf_counter()
        asr(audio, "")
        rtf_runs.append((time.perf_counter() - t0) / duration)
    report["performance"] = {
        "asr_rtf_runs": [round(r, 4) for r in rtf_runs],
        "asr_rtf_best": round(min(rtf_runs), 4),
        "peak_rss_mb_asr_vad_punc": round(peak_rss_mb(), 1),
    }

    # --- 5. CAMPPlus int8 vs fp32 embedding delta ----------------------
    campplus_delta = None
    if os.path.exists(args.fp32_campplus) and os.path.exists(
        os.path.join(campplus_dir, "model_quant.onnx")
    ):
        import numpy as np
        import onnxruntime as ort
        import torch
        from funasr.models.campplus.utils import extract_feature

        # extract_feature (funasr torch-side frontend) expects tensors.
        feats, _lens, _times = extract_feature([torch.from_numpy(audio)])
        sess_int8 = ort.InferenceSession(
            os.path.join(campplus_dir, "model_quant.onnx"),
            providers=["CPUExecutionProvider"],
        )
        sess_fp32 = ort.InferenceSession(args.fp32_campplus, providers=["CPUExecutionProvider"])
        emb_int8 = sess_int8.run(None, {"feats": feats.numpy().astype("float32")})[0]
        emb_fp32 = sess_fp32.run(None, {"feats": feats.numpy().astype("float32")})[0]
        a = emb_int8[0] / (np.linalg.norm(emb_int8[0]) + 1e-9)
        b = emb_fp32[0] / (np.linalg.norm(emb_fp32[0]) + 1e-9)
        campplus_delta = float(np.dot(a, b))
    report["campplus"] = {
        "int8_fp32_cosine": None if campplus_delta is None else round(campplus_delta, 6),
        # Includes the torch import used ONLY by this delta check — the
        # production runtime never loads torch.
        "peak_rss_mb_with_torch_check": round(peak_rss_mb(), 1),
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")

    ok = report["asr"]["coherent"] and report["vad_punc"]["vad_segments"] > 0
    log(f"ASR text ({similarity:.2%} similar): {text_plain[:80]}")
    log(f"hotword-path text: {text_hot[:80]}")
    log(
        f"RTF best {report['performance']['asr_rtf_best']} | "
        f"peak RSS asr+vad+punc {report['performance']['peak_rss_mb_asr_vad_punc']}MB"
    )
    log(f"campplus int8/fp32 cosine: {report['campplus']['int8_fp32_cosine']}")
    log(f"report: {args.out}")
    print("SMOKE:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
