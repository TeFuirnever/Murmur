#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20261006_Diag_444_HotwordBiasProbe] Ticket #444 (spec #412 T4b): the
root-cause instrument for the hw_jedediah English-hotword zero-effect.

The T4 verdict (#416) showed the int8 ONNX hotword channel does nothing on
"Jedediah Kellerberg" while torch partially pulls the term in. This probe
decides BETWEEN the two candidate root causes by opening the engine up:

  1. Token audit      — funasr_onnx.proc_hotword maps each hotword string
                       through the char vocab; per-character OOV (<unk>
                       id 8403) counts. If "Jedediah Kellerberg" maps to
                       garbage ids, the eb embedding is garbage REGARDLESS
                       of bb precision (runtime tokenization cause).
  2. eb comparison    — hotword embeddings from the int8 arm's eb graph
                       (model_eb_quant.onnx) vs the fp32 arm's (model_eb.onnx):
                       cosine + norms. ~1.0 cosine => eb precision is not
                       the differentiator (both are fp32 numerics).
  3. bb sensitivity   — the discriminating experiment. For EACH bb graph
                       (int8 model_quant.onnx, fp32 model.onnx), decode the
                       same audio chunk with (a) an all-zero bias vector,
                       (b) the real "Jedediah Kellerberg" embedding,
                       (c) a Chinese-hotword embedding (positive control).
                       fp32 (a)!=(b) + int8 (a)==(b)  => int8 quantization
                       sensitivity. both (a)==(b) => the bias channel is
                       dead even at fp32 (export-path problem).

Audio path mirrors the A/B verdict server exactly (DSP preprocess + PCM_16
roundtrip + int8 VAD regions + buffers), so probe text must reproduce the
harness arm outputs for the same case — recorded as a self-check.

Stdlib-only at module level (funasr_onnx/numpy/soundfile import lazily).

Usage (pipeline venv — scripts/onnx-export/.venv):
  python scripts/onnx-ab/hotword_bias_probe.py --out <json>
"""

import argparse
import contextlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
EXPORT_SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts", "onnx-export")

for _path in (REPO_ROOT, EXPORT_SCRIPTS_DIR):
    if _path not in sys.path:
        sys.path.insert(0, _path)

# Reuse the verdict server's plumbing + gates (pure/pinned by tests).
import funasr_server_onnx_ab as ab  # noqa: E402
from onnx_export_common import MODEL_SPECS  # noqa: E402

DEFAULT_OUT = os.path.join(HERE, "work", "hotword-bias-probe.json")
CORPUS_DIR = os.path.join(REPO_ROOT, "scripts", "asr-corpus")
SAMPLE_RATE = ab.SAMPLE_RATE
# <unk> token id of the vocab8404 tokenizer (funasr_onnx proc_hotword uses
# this id for OOV hotword characters).
OOV_ID = 8403
# Positive-control Chinese hotword (the case torch AND int8 both repaired).
CONTROL_HOTWORD = "张晗玥"

_PROTOCOL_STDOUT = sys.stdout


def load_corpus_hotword_cases(corpus_dir):
    with open(os.path.join(corpus_dir, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    cases = manifest["cases"] if isinstance(manifest, dict) else manifest
    return [c for c in cases if c.get("hotword")]


class EngineArm:
    """One ASR precision arm: int8 (pin artifacts) or fp32 (variant dir)."""

    def __init__(self, name, asr_model):
        self.name = name
        self.asr = asr_model

    def transcript(self, chunk, hotword):
        """Single-region ASR through the raw funasr_onnx __call__ (no punc
        — raw text keeps the comparison engine-only)."""
        result = self.asr(chunk, hotword)
        return result[0].get("preds", "") if result else ""


def prepare_case_audio(vad_model, audio_path):
    """Server-parity audio prep: sf.read -> DSP -> PCM_16 roundtrip ->
    VAD regions -> buffered chunks. Returns (chunks, duration)."""
    import audio_preprocessing
    import numpy as np
    import soundfile as sf

    samples, samplerate = sf.read(audio_path, dtype="float32", always_2d=False)
    samples = np.asarray(samples, dtype=np.float32)
    if int(samplerate) != SAMPLE_RATE:
        raise ValueError(f"期望 {SAMPLE_RATE}Hz 音频, 实际 {int(samplerate)}Hz")
    duration = len(samples) / float(samplerate)
    processed = audio_preprocessing.preprocess_audio(samples, SAMPLE_RATE)
    quantized = ab.OnnxAbServer._pcm16_roundtrip(processed)
    total_ms = int(duration * 1000)
    vad_result = vad_model(quantized)
    vad_segments = vad_result[0] if vad_result else []
    chunks = []
    for region_start, region_end in ab.compute_regions(vad_segments):
        buf_start_ms, buf_end_ms = ab.buffered_bounds(
            region_start, region_end, total_ms
        )
        start_frame = int(buf_start_ms / 1000.0 * SAMPLE_RATE)
        end_frame = min(len(quantized), int(buf_end_ms / 1000.0 * SAMPLE_RATE))
        chunks.append(quantized[max(0, start_frame):end_frame])
    if not chunks:
        chunks = [quantized]
    return chunks, duration


def audit_hotword_tokens(asr, hotword_string):
    """proc_hotword vocabulary audit: per-character id or OOV, the padded
    id matrix and the lengths vector funasr_onnx feeds the eb graph."""
    import numpy as np

    vocab = asr.vocab
    words = hotword_string.split(" ")
    per_word = []
    for word in words:
        chars = []
        for char in word:
            chars.append(
                {
                    "char": char,
                    "id": vocab.get(char, OOV_ID),
                    "oov": char not in vocab,
                }
            )
        per_word.append({"word": word, "chars": chars})
    hotword_ids, lengths = asr.proc_hotword(hotword_string)
    return {
        "hotword_string": hotword_string,
        "per_word": per_word,
        "oov_chars": [
            c["char"]
            for word in per_word
            for c in word["chars"]
            if c["oov"]
        ],
        "padded_ids": np.asarray(hotword_ids).tolist(),
        "lengths": np.asarray(lengths).tolist(),
    }


def hotword_bias_vector(asr, hotword_string):
    """The exact bias vector funasr_onnx.__call__ derives from a hotword
    string (eb infer + last-char slice per hotword row)."""
    import numpy as np

    hotword_ids, lengths = asr.proc_hotword(hotword_string)
    [bias_embed] = asr.eb_infer(hotword_ids, lengths)
    bias_embed = bias_embed.transpose(1, 0, 2)
    indices = np.arange(0, len(hotword_ids)).tolist()
    sliced = bias_embed[indices, lengths.tolist()]
    return sliced


def decode_with_bias(asr, chunk, bias_rows):
    """funasr_onnx ContextualParaformer.__call__ body with an INJECTED bias
    vector (verbatim replication of load/extract/bb/decode + the
    timestamp-branch postprocess), so bias sensitivity is measured on the
    exact decode path the engine uses. Returns (texts, raw_token_texts)."""
    import copy

    import numpy as np
    from funasr_onnx.utils.postprocess_utils import sentence_postprocess
    from funasr_onnx.utils.timestamp_utils import time_stamp_lfr6_onnx

    waveform_list = asr.load_data(chunk, asr.frontend.opts.frame_opts.samp_freq)
    feats, feats_len = asr.extract_feat(waveform_list)
    bias = np.expand_dims(bias_rows, axis=0)
    bias = np.repeat(bias, feats.shape[0], axis=0)
    outputs = asr.bb_infer(feats, feats_len, bias)
    am_scores, valid_token_lens = outputs[0], outputs[1]
    us_peaks = outputs[3] if len(outputs) == 4 else None
    texts = []
    raw_token_texts = []
    raw_token_list = asr.decode(am_scores, valid_token_lens)
    for pred, us_peaks_ in zip(raw_token_list, us_peaks if us_peaks is not None else [None] * len(raw_token_list)):
        # [20261006_Diag_444_HotwordBiasProbe] Keep the pre-postprocess token
        # view too: it shows whether the audio decode itself emits <unk>
        # (id 8403) where the display text shows uppercase letters.
        raw_token_texts.append("".join(pred))
        if us_peaks_ is None:
            texts.append(sentence_postprocess(pred)[0] if isinstance(pred, list) else str(pred))
            continue
        timestamp, timestamp_raw = time_stamp_lfr6_onnx(us_peaks_, copy.copy(pred))
        text_proc, _timestamp_proc, _ = sentence_postprocess(pred, timestamp_raw)
        texts.append(text_proc)
    return texts, raw_token_texts


def cosine(a, b):
    import numpy as np

    a = np.asarray(a, dtype=np.float64).ravel()
    b = np.asarray(b, dtype=np.float64).ravel()
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denom) if denom else None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", default=ab.DEFAULT_ARTIFACTS_DIR)
    parser.add_argument("--pin", default=ab.DEFAULT_PIN_PATH)
    parser.add_argument("--fp32-artifacts", default=ab.DEFAULT_FP32_ARTIFACTS_DIR)
    parser.add_argument("--fp32-manifest", default=ab.DEFAULT_FP32_MANIFEST_PATH)
    parser.add_argument("--corpus", default=CORPUS_DIR)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    with open(args.pin, encoding="utf-8") as f:
        pin = json.load(f)

    # Trust gates identical to the verdict server's (both arms).
    int8_gate = ab.OnnxAbServer(args.artifacts, pin)
    problems = int8_gate.verify_pin()
    if problems:
        print(json.dumps({"success": False, "error": problems}), file=_PROTOCOL_STDOUT)
        return 1
    fp32_gate = ab.OnnxAbServer(
        args.artifacts,
        pin,
        asr_variant="fp32",
        fp32_artifacts_dir=args.fp32_artifacts,
        fp32_manifest_path=args.fp32_manifest,
    )
    problems = fp32_gate.verify_pin()
    if problems:
        print(json.dumps({"success": False, "error": problems}), file=_PROTOCOL_STDOUT)
        return 1

    # Chatty third-party banners must never corrupt the JSON output.
    devnull = open(os.devnull, "w")
    try:
        with contextlib.redirect_stdout(devnull):
            import numpy as np
            from funasr_onnx import CT_Transformer, Fsmn_vad, SeacoParaformer

            vad = Fsmn_vad(
                os.path.join(args.artifacts, MODEL_SPECS["vad"]["name"]),
                quantize=True,
            )
            asr_int8 = SeacoParaformer(
                os.path.join(args.artifacts, MODEL_SPECS["asr"]["name"]),
                quantize=True,
            )
            asr_fp32 = SeacoParaformer(
                os.path.join(args.fp32_artifacts, MODEL_SPECS["asr"]["name"]),
                quantize=False,
            )
            punc = CT_Transformer(
                os.path.join(args.artifacts, MODEL_SPECS["punc"]["name"]),
                quantize=True,
            )
    finally:
        devnull.close()

    arms = {"int8": EngineArm("int8", asr_int8), "fp32": EngineArm("fp32", asr_fp32)}
    cases = load_corpus_hotword_cases(args.corpus)

    # ------------------------------------------------------------------
    # 1. End-to-end matrix self-check (raw text, no punc) + punc'd text
    # ------------------------------------------------------------------
    matrix = []
    for case in cases:
        chunks, duration = prepare_case_audio(vad, os.path.join(args.corpus, case["audio"]))
        hotword = case["hotword"]["hotwordString"]
        entry = {"id": case["id"], "duration_s": round(duration, 3), "arms": {}}
        for arm_name, arm in arms.items():
            arm_result = {}
            for state, hw in (("off", ""), ("on", hotword)):
                raw = "".join(arm.transcript(chunk, hw) for chunk in chunks)
                punc_text, _ = punc(raw)
                arm_result[state] = {"raw": raw, "punctured": punc_text}
            entry["arms"][arm_name] = arm_result
        matrix.append(entry)

    # ------------------------------------------------------------------
    # 2. Token audit for every hotword string + the control
    # ------------------------------------------------------------------
    token_audit = [
        audit_hotword_tokens(asr_int8, case["hotword"]["hotwordString"])
        for case in cases
    ]
    token_audit.append(audit_hotword_tokens(asr_int8, CONTROL_HOTWORD))

    # ------------------------------------------------------------------
    # 3. eb embeddings: int8-eb vs fp32-eb per hotword string
    # ------------------------------------------------------------------
    eb_comparison = []
    for case in cases + [
        {"id": "control", "hotword": {"hotwordString": CONTROL_HOTWORD}}
    ]:
        hotword = case["hotword"]["hotwordString"]
        ids, lengths = asr_int8.proc_hotword(hotword)
        [emb_int8] = asr_int8.eb_infer(ids, lengths)
        [emb_fp32] = asr_fp32.eb_infer(ids, lengths)
        eb_comparison.append(
            {
                "hotword_string": hotword,
                "cosine_int8_eb_vs_fp32_eb": cosine(emb_int8, emb_fp32),
                "int8_eb_l2": float(np.linalg.norm(emb_int8)),
                "fp32_eb_l2": float(np.linalg.norm(emb_fp32)),
            }
        )

    # ------------------------------------------------------------------
    # 4. bb bias sensitivity on hw_jedediah (+ control case)
    # ------------------------------------------------------------------
    sensitivity = []
    probe_case_ids = ("hw_jedediah", "hw_zhanghanyue")

    for case in cases:
        if case["id"] not in probe_case_ids:
            continue
        chunks, _ = prepare_case_audio(vad, os.path.join(args.corpus, case["audio"]))
        chunk = chunks[0]
        hotword = case["hotword"]["hotwordString"]
        other_hotword = (
            CONTROL_HOTWORD if case["id"] == "hw_jedediah" else "Jedediah Kellerberg"
        )
        # [20261006_Diag_444_HotwordBiasProbe] Lowercase variant of the
        # English hotword: vocab8404 has NO uppercase letters, so the
        # runtime maps 'J'/'K' to <unk> — the lowercase form is fully
        # in-vocab. Whether THAT embedding pulls the decode separates
        # "<unk>-poisoned embedding" from "audio hypothesis too far from
        # any hotword" — the follow-up ticket's cheapest-fix candidate.
        lowercase_hotword = hotword.lower() if case["id"] == "hw_jedediah" else None
        for arm_name, arm in arms.items():
            bias_map = {
                "zeros": None,
                "own_hotword": hotword,
                "other_hotword": other_hotword,
            }
            if lowercase_hotword:
                bias_map["lowercase_hotword"] = lowercase_hotword
            computed = {}
            decodes = {}
            raw_tokens_by_bias = {}
            for bias_name, source in bias_map.items():
                if bias_name == "zeros":
                    own = hotword_bias_vector(arm.asr, hotword)
                    bias_rows = np.zeros_like(own)
                else:
                    if source not in computed:
                        computed[source] = hotword_bias_vector(arm.asr, source)
                    bias_rows = computed[source]
                texts, raw_tokens = decode_with_bias(arm.asr, chunk, bias_rows)
                decodes[bias_name] = texts
                raw_tokens_by_bias[bias_name] = raw_tokens
            sensitivity.append(
                {
                    "case_id": case["id"],
                    "bb_graph": arm_name,
                    "own_hotword": hotword,
                    "other_hotword": other_hotword,
                    "bias_decodes": decodes,
                    "raw_tokens_by_bias": raw_tokens_by_bias,
                    "bias_invariant": decodes["zeros"] == decodes["own_hotword"],
                }
            )

    report = {
        "ticket": 444,
        "artifacts_dir": args.artifacts,
        "fp32_artifacts_dir": args.fp32_artifacts,
        "matrix": matrix,
        "token_audit": token_audit,
        "eb_comparison": eb_comparison,
        "bb_bias_sensitivity": sensitivity,
        "notes": [
            "matrix raw text is engine-only (no punc); 'punctured' adds the int8 punc model",
            "bb_bias_sensitivity compares decodes of the SAME chunk under zero/own/control bias",
        ],
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps({"success": True, "out": args.out}), file=_PROTOCOL_STDOUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
