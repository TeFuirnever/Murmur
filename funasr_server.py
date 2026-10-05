#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FunASR模型服务器
保持模型在内存中，通过stdin/stdout进行通信
"""

import sys
import json
import os
import re
import logging
import traceback
import signal
import contextlib
import io
import argparse
import unicodedata
import glob
import threading
import queue
from pathlib import Path

# 设置日志
import tempfile


# 获取日志文件路径
def get_log_path():
    # 尝试从环境变量获取用户数据目录
    if "ELECTRON_USER_DATA" in os.environ:
        log_dir = os.path.join(os.environ["ELECTRON_USER_DATA"], "logs")
    else:
        # 回退到临时目录
        log_dir = os.path.join(tempfile.gettempdir(), "murmur_logs")

    # 确保日志目录存在
    os.makedirs(log_dir, exist_ok=True)
    return os.path.join(log_dir, "funasr_server.log")


log_file_path = get_log_path()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(log_file_path, encoding="utf-8"),
        logging.StreamHandler(),  # 同时输出到控制台
    ],
)
logger = logging.getLogger(__name__)

# 记录日志文件位置
logger.info(f"FunASR服务器日志文件: {log_file_path}")


# [20260913_Fix_256_AnchorParity] The AUTHORITATIVE model-readiness anchors,
# hoisted from _repo_ready()'s inline list so the cross-language contract
# test (tests/unit/modelManager-anchor-parity.test.ts) has a stable parse
# target: Node's _verifyModel must accept exactly this name set, otherwise a
# repo reads "ready" to Python and "missing" to Node (the #256/#336 flap
# class). Exact names match literally; "*.onnx"/"vocab*" are fnmatch globs.
# Behavior is identical to the former inline list — hoist only.
_READY_PATTERNS = [
    "model.pt", "pytorch_model.bin", "*.onnx",
    "config.json", "configuration.json", "model.yaml", "vocab*"
]


# [20261001_T5_OnnxGate] Ticket #417 (spec #412 decision 8): the ONNX
# generation's readiness anchor is the PINNED EXACT FILE SET (names AND
# sizes) from scripts/onnx-export/model-pin.json — never a wildcard. An
# ".onnx"-bearing dir is ONNX-generation and is ready only when one pin
# model's complete set is present. This closes the hole where the legacy
# "*.onnx" torch anchor read a repo holding only the 34,028,131-byte eb
# graph (model_eb_quant.onnx) as ready. The numbers are parity-locked with
# the committed pin by tests/unit/onnx-pin-anchor-parity.test.ts — do not
# hand-edit without regenerating from the pin.
ONNX_PIN_FILE_SPECS = {
    "asr": {
        "am.mvn": 11203,
        "config.yaml": 3420,
        "model_eb_quant.onnx": 34028131,
        "model_quant.onnx": 345131848,
        "seg_dict": 8287834,
        "tokens.json": 93676,
    },
    "vad": {
        "am.mvn": 8040,
        "config.yaml": 1215,
        "model_quant.onnx": 512425,
    },
    "punc": {
        "config.yaml": 810,
        "model_quant.onnx": 282752986,
        "tokens.json": 4207480,
    },
    "speaker": {
        "config.yaml": 537,
        "model_quant.onnx": 28979049,
    },
}
_ONNX_MARKER_SUFFIX = ".onnx"
# In-flight temp download names that must NEVER satisfy a readiness anchor
# (spec decision 8: excluded on both sides of the name): the v2 downloader's
# partial suffix (modelDownloader.ts PARTIAL_SUFFIX), GitHub split-part
# chunks (<asset>.partNN), and modelscope's byte-range shard names
# (vocab.txt_0_167772159 — the #255 class).
_PARTIAL_TMP_SUFFIXES = (".murmur-partial",)
_PART_TMP_SUFFIX_RE = re.compile(r"\.part\d+$")
_TEMP_SHARD_SUFFIX_RE = re.compile(r"_\d+_\d+$")


def _is_temp_download_name(name):
    """True for in-flight download artifacts; never an anchor candidate."""
    return (
        name.endswith(_PARTIAL_TMP_SUFFIXES)
        or _PART_TMP_SUFFIX_RE.search(name) is not None
        or _TEMP_SHARD_SUFFIX_RE.search(name) is not None
    )


def _onnx_pin_set_ready(repo_dir, plain_entries):
    """True when one pin model's COMPLETE exact file set (with pinned sizes)
    is present in repo_dir. No wildcards, no partial sets."""
    for specs in ONNX_PIN_FILE_SPECS.values():
        if all(
            name in plain_entries
            and os.path.getsize(os.path.join(repo_dir, name)) == expected
            for name, expected in specs.items()
        ):
            return True
    return False
# [20261001_T5_OnnxGate] END


# [20261001_T6a_OnnxEngine] Ticket #418 (spec #412 T6a): the funasr-onnx
# engine. The production server loads the T1 self-exported ONNX int8 models
# (scripts/onnx-export/model-pin.json) from the T5 downloader v2 layout
# FIRST and keeps the torch AutoModel path as the rollback generation
# (user story #412-5). Audio reaches funasr-onnx ONLY as an ndarray:
# funasr_onnx's load_data() calls librosa.load for str/path inputs (which
# lazily pulls numba — spec #412 decision 3), while an ndarray input is
# passed straight through, so the adapters below read files with soundfile
# (pure C) and feed samples. The adapters expose the torch AutoModel
# .generate() contract and normalize the funasr-onnx result shapes
# (preds / bare segment list / (text, ids) tuple) back to the torch shapes
# ({"text"}/[{"value": ...}]/[{"text"}]) the transcription code consumes —
# the stdin/stdout protocol is unchanged.
# Subdir mirrors modelDownloader.ONNX_MODELS_DIRNAME (TS side); the model
# dir names mirror the pin's models[*].name — parity is locked by
# tests/python/test_onnx_engine_switch.py (dir names ↔ model-pin.json) and
# tests/unit/onnx-pin-anchor-parity.test.ts (subdir ↔ TS constant).
ONNX_MODELS_SUBDIR = "onnx-int8"
ONNX_MODEL_DIR_NAMES = {
    "asr": "asr-seaco-paraformer",
    "vad": "vad-fsmn",
    "punc": "punc-ct-transformer-272727",
    # [20261002_T6b_SpeakerOnnx] Ticket #419: the CAM++ speaker model joins
    # the ONNX generation (dir name mirrors the pin's models.speaker.name —
    # parity locked by tests/python/test_speaker_onnx.py).
    "speaker": "speaker-campplus",
}
# Generation label reported via check_status / stats / reload results
# (the torch generation reports its repo id; nothing downstream parses it).
ONNX_MODEL_GENERATION_NAMES = {
    "asr": "onnx:asr-seaco-paraformer",
    "vad": "onnx:vad-fsmn",
    "punc": "onnx:punc-ct-transformer-272727",
}
ONNX_TARGET_SAMPLE_RATE = 16000

# [20261001_T6a_OnnxEngine] One-shot INFO proof that the ndarray doorway is
# the one actually used at runtime (grep-friendly acceptance evidence).
_ONNX_NDARRAY_INPUT_LOGGED = False


def _log_ndarray_input_once(sample_count):
    global _ONNX_NDARRAY_INPUT_LOGGED
    if not _ONNX_NDARRAY_INPUT_LOGGED:
        _ONNX_NDARRAY_INPUT_LOGGED = True
        logger.info(
            "ONNX引擎音频输入通道: ndarray（样本数=%d）——"
            "funasr-onnx 全程收 ndarray，内部 librosa.load 路径不可达",
            sample_count,
        )


def _resample_to_16k(samples, samplerate):
    """Resample to 16 kHz for the ONNX engines (polyphase, pure C scipy —
    never librosa). No-op when already at the target rate."""
    if int(samplerate) == ONNX_TARGET_SAMPLE_RATE:
        return samples
    from math import gcd

    import scipy.signal

    g = gcd(int(samplerate), ONNX_TARGET_SAMPLE_RATE)
    return scipy.signal.resample_poly(
        samples, ONNX_TARGET_SAMPLE_RATE // g, int(samplerate) // g
    )


def _load_audio_ndarray(source):
    """Deliver audio to the funasr-onnx engines as a float32 mono ndarray.

    str/bytes input is a file path — read with soundfile (libsndfile, pure
    C), mean-stacked to mono (librosa.load's mono semantics), resampled to
    16 kHz when needed. An ndarray input passes through untouched. This is
    the ONLY doorway to the engines: librosa.load can never fire.
    """
    import numpy as np
    import soundfile as sf

    if isinstance(source, np.ndarray):
        return np.ascontiguousarray(source, dtype=np.float32)
    samples, samplerate = sf.read(source, dtype="float32", always_2d=True)
    if samples.shape[1] > 1:
        samples = samples.mean(axis=1)
    else:
        samples = samples[:, 0]
    samples = _resample_to_16k(samples, samplerate)
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    _log_ndarray_input_once(len(samples))
    return samples


# [20261002_T6b_SubChunk] Ticket #419 (spec #412 decision 2): the ONNX path
# has NO torch-style batch_size_s time batching — every generate() feeds the
# WHOLE input through the encoder in one shot and self-attention activation
# memory grows quadratically, so a 300s region spiked to GB-level transient
# memory on long meetings. ASR regions are therefore capped at 60s: gaps
# < 300ms merge into speech regions (unchanged), over-long regions
# re-accumulate at VAD boundaries (unchanged), and a region that STILL
# exceeds the cap (one continuous-speech VAD segment) is hard-split into
# fixed <=60s windows. The per-chunk read buffer (REGION_BUFFER_MS) gives
# the engine recognition context at window edges, and because adjacent
# hard-split windows then share 2×REGION_BUFFER_MS of identical audio, each
# chunk's output is midpoint-filtered to the region interior
# (_filter_chunk_to_region) — the buffered overlap is transcribed exactly
# once instead of being concatenated twice.
VAD_MERGE_GAP_MS = 300
MAX_REGION_MS = 60_000
REGION_BUFFER_MS = 200
# [20261006_Fix_421_VadWindowing] VAD passes run on windows of this size
# (see OnnxVadAdapter._vad_segments) — same 60s cap the ASR regions use.
VAD_STREAM_WINDOW_MS = 60_000


def _filter_chunk_to_region(text, timestamps, time_offset_ms,
                            region_start_ms, region_end_ms):
    """Assign a chunk's ASR output to the region that OWNS it (midpoint rule).

    [20261002_T6b_SubChunk review fix] Adjacent chunks share the
    ±REGION_BUFFER_MS read buffer — 400ms of identical (voiced) audio
    between two hard-split windows — so the engine emits the boundary words
    in BOTH chunks and naive concatenation duplicated them. Ownership is
    decided per character from its word timestamp: the character belongs to
    the region containing its midpoint. Midpoints partition the timeline
    across the tiling hard-split windows, so every character is emitted
    exactly once while the buffer still improves recognition. Characters
    without a timestamp (mismatched engine output) are dropped — timestamps
    are the same authority _build_segments_from_timestamps pairs against.
    Returns (kept_text, kept_timestamps).
    """
    chars = list(text.replace(" ", ""))
    kept_chars = []
    kept_timestamps = []
    for idx, ts in enumerate(timestamps or []):
        if idx >= len(chars):
            break
        midpoint_ms = (ts[0] + ts[1]) / 2.0 + time_offset_ms
        if region_start_ms <= midpoint_ms < region_end_ms:
            kept_chars.append(chars[idx])
            kept_timestamps.append(ts)
    return "".join(kept_chars), kept_timestamps


def _merge_vad_regions(vad_segments, merge_gap_ms):
    """Merge adjacent/overlapping VAD segments separated by < merge_gap_ms
    into contiguous speech regions."""
    regions = []
    cur_start = vad_segments[0][0]
    cur_end = vad_segments[0][1]
    for vs, ve in vad_segments[1:]:
        if vs - cur_end < merge_gap_ms:
            cur_end = max(cur_end, ve)
        else:
            regions.append([cur_start, cur_end])
            cur_start = vs
            cur_end = ve
    regions.append([cur_start, cur_end])
    return regions


def _hard_split_region(start_ms, end_ms, max_region_ms):
    """Fixed-window split for a region with no usable VAD boundary (one
    continuous-speech VAD segment longer than the cap): consecutive windows
    of max_region_ms, the last one carrying the remainder."""
    windows = []
    cursor = start_ms
    while end_ms - cursor > max_region_ms:
        windows.append([cursor, cursor + max_region_ms])
        cursor += max_region_ms
    windows.append([cursor, end_ms])
    return windows


def build_asr_regions(vad_segments, merge_gap_ms=VAD_MERGE_GAP_MS,
                      max_region_ms=MAX_REGION_MS):
    """VAD segments → ASR inference regions, every region <= max_region_ms.

    Three passes over the VAD output (all previously inline in
    transcribe_file_audio, extracted here so the sub-chunking contract is
    directly testable):
      1. merge segments separated by < merge_gap_ms of silence;
      2. split over-long regions at VAD boundaries (re-accumulate whole
         segments up to the cap);
      3. hard-split any region that still exceeds the cap (a single VAD
         segment of continuous speech has no boundary to split at).
    """
    if not vad_segments:
        return []
    regions = _merge_vad_regions(vad_segments, merge_gap_ms)
    split_regions = []
    for rs, re_ in regions:
        if re_ - rs <= max_region_ms:
            split_regions.append([rs, re_])
            continue
        # 从原始 vad_segments 中找到属于该区域的子段，累加合并直到超过上限
        sub_segs = [
            [vs, ve] for vs, ve in vad_segments if vs >= rs and ve <= re_
        ]
        chunk_start = sub_segs[0][0]
        chunk_end = sub_segs[0][1]
        for ss, se in sub_segs[1:]:
            if se - chunk_start > max_region_ms:
                split_regions.append([chunk_start, chunk_end])
                chunk_start = ss
            chunk_end = se
        split_regions.append([chunk_start, chunk_end])
    final_regions = []
    for rs, re_ in split_regions:
        final_regions.extend(_hard_split_region(rs, re_, max_region_ms))
    return final_regions
# [20261002_T6b_SubChunk] END


class OnnxAsrAdapter:
    """funasr_onnx.SeacoParaformer speaking the torch AutoModel.generate
    contract: generate(input=<path or ndarray>, hotword=...) →
    [{"text": ..., "timestamp": ...}] (funasr-onnx returns "preds")."""

    engine_name = "onnx"

    def __init__(self, engine):
        self._engine = engine

    def generate(self, input=None, hotword="", batch_size_s=None, cache=None, **_):
        samples = _load_audio_ndarray(input)
        result = self._engine(samples, hotword)
        normalized = []
        for item in result or []:
            if isinstance(item, dict):
                item = dict(item)
                if "preds" in item:
                    item["text"] = item.pop("preds")
            normalized.append(item)
        return normalized


class OnnxVadAdapter:
    """funasr_onnx.Fsmn_vad → torch VAD shape: generate(input=...) →
    [{"value": [[start_ms, end_ms], ...]}]."""

    engine_name = "onnx"

    def __init__(self, engine):
        self._engine = engine

    def generate(self, input=None, batch_size_s=None, **_):
        samples = _load_audio_ndarray(input)
        return [{"value": self._vad_segments(samples)}]

    def _vad_segments(self, samples):
        # [20261006_Fix_421_VadWindowing] Ticket #421 review: the whole file
        # went to funasr_onnx in ONE call — the online frontend + scorer
        # materialized O(audio_length) buffers (~1GB transient RSS on a
        # 10-minute file). Instead: an INDEPENDENT whole-style VAD pass per
        # <=VAD_STREAM_WINDOW_MS window (each pass sees exactly the old
        # whole-file semantics, so memory is O(window)), with each pass's
        # segments offset by the window start. The only downstream consumer
        # (build_asr_regions) re-merges boundary-adjacent segments via the
        # <300ms gap rule — verified identical regions vs the whole-file
        # pass on a 612s real-model fixture.
        window_samples = int(
            VAD_STREAM_WINDOW_MS / 1000.0 * ONNX_TARGET_SAMPLE_RATE
        )
        value = []
        for window_index, start in enumerate(
            range(0, len(samples), window_samples)
        ):
            out = self._engine(samples[start : start + window_samples])
            if out and len(out) > 0:
                offset_ms = window_index * VAD_STREAM_WINDOW_MS
                for seg in out[0]:
                    value.append([seg[0] + offset_ms, seg[1] + offset_ms])
        return value


class OnnxPuncAdapter:
    """funasr_onnx.CT_Transformer (returns (text, punc_ids)) → torch shape:
    generate(input=text) → [{"text": ...}]."""

    engine_name = "onnx"

    def __init__(self, engine):
        self._engine = engine

    def generate(self, input=None, **_):
        result = self._engine(input)
        if isinstance(result, (tuple, list)) and result:
            text = result[0]
        else:
            text = result
        return [{"text": text or ""}]
# [20261001_T6a_OnnxEngine] END


# [20261002_T6b_SpeakerOnnx] Ticket #419: the CAM++ speaker model is driven
# STRAIGHT through onnxruntime — funasr-onnx ships NO speaker loader
# (onnx_export_common.py records that verification). The int8 graph takes
# Kaldi-compatible 80-bin fbank features ("feats": [batch, T, 80]) and emits
# a 192-dim "embedding". kaldi_native_fbank (pure C, already in the embedded
# runtime) reproduces the torchaudio.compliance.kaldi features the export
# smoke test verified with: max abs diff 1.1e-4, embedding-path cosine 1.0.
ONNX_SPEAKER_MODEL_FILE = "model_quant.onnx"
SPEAKER_FEAT_DIM = 80


def _fbank_module():
    """Import kaldi_native_fbank (single point, so load-time fail-fast has
    one hook and the torch fallback policy applies on ImportError)."""
    import kaldi_native_fbank as knf

    return knf


def _extract_fbank(samples, knf=None):
    """CAM++ frontend: Kaldi fbank (povey window, 25ms/10ms, dither off),
    80 bins, per-bin mean-normalized over the utterance — the exact feature
    contract of funasr's torch-side campplus extract_feature."""
    import numpy as np

    if knf is None:
        knf = _fbank_module()
    opts = knf.FbankOptions()
    opts.frame_opts.samp_freq = ONNX_TARGET_SAMPLE_RATE
    opts.frame_opts.dither = 0.0
    opts.mel_opts.num_bins = SPEAKER_FEAT_DIM
    fbank = knf.OnlineFbank(opts)
    fbank.accept_waveform(ONNX_TARGET_SAMPLE_RATE, samples.tolist())
    frame_count = fbank.num_frames_ready
    if frame_count <= 0:
        return np.zeros((0, SPEAKER_FEAT_DIM), dtype=np.float32)
    feats = np.stack(
        [
            np.asarray(fbank.get_frame(i), dtype=np.float32)
            for i in range(frame_count)
        ]
    )
    feats = feats - feats.mean(axis=0, keepdims=True)
    return feats.astype(np.float32, copy=False)


class OnnxSpeakerAdapter:
    """CAM++ int8 ONNX session speaking the torch AutoModel call contract
    the diarize path already uses: adapter(samples, output_dir=None) →
    [{"spk_embedding": [float, ...]}] (192-dim)."""

    engine_name = "onnx"

    def __init__(self, model_dir, intra_op_num_threads=1):
        import onnxruntime as ort

        # Fail fast at LOAD time (the caller falls back to torch there);
        # a missing fbank runtime must not surface mid-diarize.
        self._knf = _fbank_module()
        options = ort.SessionOptions()
        # [20261002_T6b_OrtThreads] Thread count from the one derivation
        # function (compute_inference_threads), same as the three
        # funasr_onnx sessions — the library default was a hard-coded 4.
        options.intra_op_num_threads = intra_op_num_threads
        self._session = ort.InferenceSession(
            os.path.join(model_dir, ONNX_SPEAKER_MODEL_FILE),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self._input_name = self._session.get_inputs()[0].name

    def __call__(self, samples, output_dir=None, **_):
        import numpy as np

        samples = _load_audio_ndarray(samples)
        feats = _extract_fbank(samples, knf=self._knf)
        if feats.shape[0] == 0:
            return []
        embedding = self._session.run(
            None, {self._input_name: feats[np.newaxis, ...]}
        )[0]
        # Plain list — the diarize consumer does
        # `emb = r.get("spk_embedding") or r.get("embedding")`, and a numpy
        # array there would raise on the truthiness check (the torch path
        # handed back a list-like, so the contract stays list-like).
        return [{"spk_embedding": np.asarray(embedding[0]).flatten().tolist()}]
# [20261002_T6b_SpeakerOnnx] END


# [20260820_Fix_SuppressStdoutRace] The model loaders run in parallel
# threads and each wraps its AutoModel call in suppress_stdout(). The
# previous per-thread save/restore of the PROCESS-GLOBAL sys.stdout raced:
# with N threads inside at once, each thread's "old" stdout was the previous
# thread's devnull, and after interleaved restores sys.stdout could point at
# a devnull already closed by another thread's exit — the next protocol
# print then raised "ValueError: I/O operation on closed file" and killed
# the server AFTER models loaded successfully. Fix: serialize the
# save/restore with a lock and reference-count concurrent users so the sink
# is installed once (first entrant) and removed once (last exits). The lock
# covers only the bookkeeping, never the suppressed body, so model loads
# still run in parallel.
_SUPPRESS_STDOUT_LOCK = threading.Lock()
_SUPPRESS_STDOUT_DEPTH = 0
_SUPPRESS_STDOUT_SAVED = None
_SUPPRESS_STDOUT_SINK = None


@contextlib.contextmanager
def suppress_stdout():
    """上下文管理器：临时重定向stdout到devnull，避免FunASR库的非JSON输出干扰IPC通信

    Thread-safe: multiple threads may be inside at once; only the first
    entrant saves the original stdout and installs the shared sink, and the
    last exiter restores it (lock + reference counting).
    """
    global _SUPPRESS_STDOUT_DEPTH, _SUPPRESS_STDOUT_SAVED, _SUPPRESS_STDOUT_SINK
    with _SUPPRESS_STDOUT_LOCK:
        if _SUPPRESS_STDOUT_DEPTH == 0:
            _SUPPRESS_STDOUT_SAVED = sys.stdout
            _SUPPRESS_STDOUT_SINK = open(os.devnull, "w")
            sys.stdout = _SUPPRESS_STDOUT_SINK
        _SUPPRESS_STDOUT_DEPTH += 1
    try:
        yield
    finally:
        with _SUPPRESS_STDOUT_LOCK:
            _SUPPRESS_STDOUT_DEPTH -= 1
            if _SUPPRESS_STDOUT_DEPTH == 0:
                sys.stdout = _SUPPRESS_STDOUT_SAVED
                _SUPPRESS_STDOUT_SAVED = None
                if _SUPPRESS_STDOUT_SINK is not None:
                    _SUPPRESS_STDOUT_SINK.close()
                    _SUPPRESS_STDOUT_SINK = None
# [20260820_Fix_SuppressStdoutRace] END


# [20260905_Fix_208_ProtocolStreamImmune] Issue #208: protocol output must be
# immune to suppress_stdout() windows. print() resolves sys.stdout
# dynamically, so a protocol line emitted while any loader thread is inside a
# suppression window (reload progress dequeued by _output_worker, command
# responses on the main thread) landed in the shared devnull sink and was
# silently dropped — #207 removed the closed-devnull crash, but the swallow
# path remained. The protocol channel therefore writes to the stream captured
# at process start (the original host pipe), never to the redirectable
# global. Captured at import time, before any suppression can run.
_PROTOCOL_STDOUT = sys.stdout


def _protocol_print(payload):
    """Write a protocol JSON line to the host pipe via the startup stream."""
    _PROTOCOL_STDOUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _PROTOCOL_STDOUT.flush()
# [20260905_Fix_208_ProtocolStreamImmune] END


# [20260819_T8_ThreadAdapt] Ticket #187 (spec #177 T8): inference thread
# auto-adaptation. Formula over LOGICAL cores leaves UI headroom on small
# machines and caps fan/heat on big ones; the old code hard-coded
# OMP_NUM_THREADS=4 (no headroom on 4-core, over-subscription on 2-core).
THREAD_UI_HEADROOM = 2
THREAD_CAP = 8

# [20260820_T14_Hotwords] Ticket #183: Python-side defense-in-depth cap
# for the hotword option (TS boundary validation is the primary gate; this
# catches corrupted-DB / renderer-bug payloads that reach the protocol).
HOTWORD_MAX_CHARS = 4096

# [T11 review NIT] Shared error message for failed (re)initialization.
INIT_FAILED_MESSAGE = "模型初始化失败"


# [20261006_Fix_421_SchemaLockAnchors] Ticket #421 review: the
# models_not_downloaded startup payload (run()'s missing-models arm) and the
# invalid-JSON payload (run()'s read loop) were both built inline, so the
# schema regression suite could only pin dictionary LITERALS — a shape drift
# in either payload shipped unnoticed. Hoisted here as the single
# construction point: run() and tests/python/test_protocol_schema_regression.py
# both consume these functions, so the lock is on the real source.
def models_not_downloaded_result():
    return {
        "success": False,
        "error": "模型文件未下载，请先下载模型",
        "type": "models_not_downloaded",
    }


def invalid_json_result():
    return {"success": False, "error": "无效的JSON命令"}


def sanitize_hotword(value):
    """Coerce a protocol hotword to a safe string ('' on non-string).

    [T14 review MINOR] Logs degradation/truncation (defense must be
    observable) and strips Cc control characters so caller-supplied
    garbage cannot reach generate() unfiltered.
    """
    if not isinstance(value, str):
        if value:
            logger.warning(f"热词类型非法({type(value).__name__})，降级为空串")
        return ""
    cleaned = "".join(
        ch for ch in value if unicodedata.category(ch) != "Cc"
    )[:HOTWORD_MAX_CHARS]
    if len(cleaned) != len(value):
        logger.warning("热词含控制字符或超长，已清洗/截断")
    return cleaned


def compute_inference_threads(cores, override=None):
    """min(max(1, cores - THREAD_UI_HEADROOM), THREAD_CAP) over logical cores.

    override comes from MURMUR_NUM_THREADS (mirrors the MURMUR_DEVICE
    pattern from ADR-006): must parse as an INTEGER, clamped to
    [1, cores]; anything else (non-integer like "2.5", < 1, None) falls
    back to the computed value.
    """
    auto = min(max(1, cores - THREAD_UI_HEADROOM), THREAD_CAP)
    if override is None:
        return auto
    try:
        requested = int(str(override).strip())
    except (TypeError, ValueError):
        return auto
    if requested < 1:
        return auto
    return max(1, min(requested, cores))


class FunASRServer:
    def __init__(self, damo_root=None):
        self.asr_model = None
        # [20260820_T15_SeacoSwap] Which ASR generation actually loaded
        # (exposed via check_status so the UI can flag degraded hotwords).
        self.asr_model_name = None
        self.vad_model = None
        self.punc_model = None
        self.cam_model = None
        self.initialized = False
        self.running = True
        self.transcription_count = 0
        self.total_audio_duration = 0.0

        self.request_queue = queue.Queue()
        self.response_queue = queue.Queue()
        self.cancel_event = threading.Event()
        # [20260821_T11_UnloadReload] Serializes initialize() across the
        # main read loop (mic lazy-init) and the inference worker
        # (reload_models) — concurrent double model load = memory blowup.
        self._init_lock = threading.RLock()
        self._inference_thread = None
        self._output_thread = None

        # 外部传入的 damo 根目录（例如 /Volumes/APFS/AI/models/damo）
        self.damo_root = damo_root or os.environ.get("DAMO_ROOT")

        # [20260819_T8_ThreadAdapt] Thread env FIRST: _detect_device imports
        # torch when MURMUR_DEVICE is unset, and OMP/MKL env vars only take
        # effect if written BEFORE torch's first import. The old order set
        # them after detection, which silently voided them.
        self.inference_threads = 1
        self._setup_runtime_environment()

        self.device = os.environ.get("MURMUR_DEVICE") or self._detect_device()
        logger.info(f"推理设备: {self.device}")

        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

    def _setup_runtime_environment(self):
        """设置推理线程环境变量（必须在 torch 首次导入之前调用）

        [20260819_T8_ThreadAdapt] Replaces the OMP_NUM_THREADS="4" hardcode
        with the computed value. OMP covers gcc/openmp builds, MKL covers
        Windows torch's MKL backend; macOS Accelerate ignores both env vars,
        which is why torch.set_num_threads (applied at model load) is the
        authoritative convergence point on every platform. Under a CUDA
        device the limit still constrains CPU-side preprocessing (DSP /
        feature extraction) — GPU kernels are unaffected.
        """
        try:
            cores = os.cpu_count() or 1
            override = os.environ.get("MURMUR_NUM_THREADS")
            self.inference_threads = compute_inference_threads(cores, override)
            os.environ["OMP_NUM_THREADS"] = str(self.inference_threads)
            os.environ["MKL_NUM_THREADS"] = str(self.inference_threads)
            source = "MURMUR_NUM_THREADS" if override else "auto"
            logger.info(
                f"推理线程数: {self.inference_threads} (逻辑核={cores}, 来源={source}, "
                f"公式=min(max(1,核-{THREAD_UI_HEADROOM}),{THREAD_CAP}), 覆盖钳制[1,核])"
            )
        except Exception as e:
            logger.warning(f"线程环境设置失败: {str(e)}")

    # [20260819_T8_ThreadAdapt] Authoritative torch-side limit; applied at
    # model load (after torch import) — see _setup_runtime_environment.
    def _apply_torch_thread_limit(self):
        try:
            import torch

            torch.set_num_threads(self.inference_threads)
            logger.info(f"torch.set_num_threads({self.inference_threads})")
        except ImportError:
            logger.warning("torch 不可用，跳过 torch 线程上限设置")

    @staticmethod
    def _detect_device():
        """Auto-detect best available compute device: CUDA > CPU

        MPS (Apple GPU) is intentionally skipped because FunASR uses float64
        in cif_predictor.py and complex_utils.py, which MPS does not support.
        M-series CPU performance is sufficient for Paraformer-large inference.
        """
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
            # MPS skipped: FunASR uses torch.float64 in CIF predictor and
            # complex_utils, which triggers:
            #   TypeError: Cannot convert a MPS Tensor to float64 dtype
            # as the MPS framework doesn't support float64
        except ImportError:
            pass
        return "cpu"

    ALLOWED_EXTENSIONS = {'.wav', '.mp3', '.m4a', '.flac', '.ogg', '.wma', '.aac'}

    def _validate_audio_path(self, audio_path):
        """验证音频文件路径安全性"""
        if not audio_path or not isinstance(audio_path, str):
            return False, "无效的音频路径"

        # 解析符号链接
        real_path = os.path.realpath(audio_path)

        # 检查扩展名
        ext = os.path.splitext(real_path)[1].lower()
        if ext not in self.ALLOWED_EXTENSIONS:
            return False, f"不支持的音频格式: {ext}"

        # 检查文件存在且可读
        if not os.path.isfile(real_path):
            return False, f"文件不存在: {audio_path}"

        if not os.access(real_path, os.R_OK):
            return False, f"文件不可读: {audio_path}"

        return True, real_path

    def _merge_segments(self, raw_segments):
        """基于标点合并短segments为完整句子"""
        if not raw_segments:
            return []

        merged = []
        current = None

        for seg in raw_segments:
            if current is None:
                current = {"start_ms": seg["start_ms"], "end_ms": seg["end_ms"], "text": seg["text"]}
            else:
                text = current["text"]
                # 如果当前文本以句末标点结尾，或者是长segment，开始新的
                if (text and text[-1] in '。！？；\n') or (current["end_ms"] - current["start_ms"]) >= 5000:
                    merged.append(current)
                    current = {"start_ms": seg["start_ms"], "end_ms": seg["end_ms"], "text": seg["text"]}
                else:
                    # 合并
                    current["text"] = text + seg["text"]
                    current["end_ms"] = seg["end_ms"]

        if current:
            merged.append(current)

        return merged

    def _signal_handler(self, signum, frame):
        """处理退出信号"""
        logger.info(f"收到信号 {signum}，准备退出...")
        self.running = False

    # [20260820_T15_SeacoSwap] Ticket #192: primary = hotword-capable
    # SeACo (T13 spike: zero CER regression, timestamps intact); the old
    # paraformer stays as the ROLLBACK when SeACo fails to load (missing
    # files mid-upgrade, corrupt download) — the app stays usable.
    ASR_MODEL_SEACO = "damo/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
    ASR_MODEL_FALLBACK = "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"

    # [20260820_T15_SeacoSwap] Promoted from a nested run() helper: the
    # ASR loader's disk-presence gate needs the same resolution.
    @staticmethod
    def _default_damo_root():
        """解析默认模型根目录（MODELSCOPE_CACHE + 新旧两种 modelscope 布局）

        [20260905_Fix_216_DamoRootLayout] modelscope >= 1.19 downloads into
        a NEW layout with an extra `models` layer — verified against 1.37:
            <cache>/models/damo/<repo>
        while older caches use <cache>/damo/<repo>. The old resolver only
        knew the legacy shapes, so a machine whose models live in the new
        layout failed the disk-presence gate forever with
        models_not_downloaded (issue #216). Candidates are probed in order
        (new layout first — fresh downloads land there) and the no-cache
        default is the new-layout path so a fresh download is found on the
        next gate run.
        """
        new_layers = ("models/damo", "hub/models/damo")
        legacy_layers = ("damo", "hub/damo")
        root = os.environ.get("MODELSCOPE_CACHE")
        if root:
            for layer in new_layers + legacy_layers:
                candidate = os.path.join(root, *layer.split("/"))
                if os.path.isdir(candidate):
                    return candidate
            # [20260905_Fix_Review_EnvCacheDefault] An explicitly configured
            # cache must not fall through to the home directory when it has
            # no models yet — modelscope will download INTO it, so the gate
            # has to look there too.
            return os.path.join(root, "models", "damo")
        home_dir = os.path.expanduser("~")
        base = os.path.join(home_dir, ".cache", "modelscope", "hub")
        for layer in new_layers + legacy_layers:
            candidate = os.path.join(base, *layer.split("/"))
            if os.path.isdir(candidate):
                return candidate
        return os.path.join(base, "models", "damo")

    # [20260905_Fix_255_RepoReadyShardGlob] Promoted from a nested run()
    # helper so the readiness gate is directly testable, and hardened for
    # issue #255: ModelScope's downloader leaves SHARD part-files in the
    # repo dir mid-download (e.g. vocab.txt_0_167772159 — a byte-range temp
    # name). The "vocab*" glob matched them, so a server (re)start during a
    # download misread the repo as ready and AutoModel died with a confusing
    # error instead of the clean models_not_downloaded path. Matching files
    # whose name ends in a _<start>_<end> byte-range suffix never satisfy
    # the gate; real anchors (config/weights/complete vocab) still do.
    _SHARD_SUFFIX_RE = _TEMP_SHARD_SUFFIX_RE

    @staticmethod
    def _repo_ready(repo_dir):
        """目录存在且包含非分片的常见权重/配置文件即认为已就绪

        [20261001_T5_OnnxGate] Ticket #417: an ONNX-generation dir (any
        non-temp plain *.onnx entry) is gated on the pinned EXACT file set
        (ONNX_PIN_FILE_SPECS) — the legacy wildcards can never satisfy it,
        so a 34MB single-file repo is NOT ready. Torch-era dirs keep the
        legacy anchors below (rollback era, user story #412-5).
        """
        if not os.path.isdir(repo_dir):
            return False
        plain_entries = [
            name
            for name in os.listdir(repo_dir)
            if not _is_temp_download_name(name)
        ]
        if any(name.endswith(_ONNX_MARKER_SUFFIX) for name in plain_entries):
            return _onnx_pin_set_ready(repo_dir, set(plain_entries))
        # [20260913_Fix_256_AnchorParity] Same-site usage of the hoisted
        # module-level _READY_PATTERNS (list contents unchanged).
        for pat in _READY_PATTERNS:
            matches = [
                m for m in glob.glob(os.path.join(repo_dir, pat))
                if not FunASRServer._SHARD_SUFFIX_RE.search(os.path.basename(m))
            ]
            if matches:
                return True
        return False

    # [20260911_Fix_336_HubLayout] Issue #336: modelscope 1.39's real
    # on-disk layout matches NONE of the shapes _default_damo_root() knows:
    #
    #     <cache>/models/damo--<repo>/snapshots/<rev>/model.pt
    #
    # (NO `hub` layer, repo dirs renamed `damo--<name>`, an extra
    # `snapshots/<revision>` level). Worse, the app always spawns the server
    # with an EXPLICIT --damo-root (<userData>/models, which stays empty
    # because download_models.py calls snapshot_download without cache_dir),
    # so `_default_damo_root()` never ran and the gate reported
    # models_not_downloaded forever while the UI flapped. The resolver chain
    # below probes the explicit root FIRST (it wins when populated — the
    # user's symlink workaround and upgrading users rely on that), then the
    # modelscope default caches in both legacy and hub shapes.
    _MODEL_REVISION = "v2.0.4"

    @staticmethod
    def _resolve_hub_repo(hub_root, repo_dir_name):
        """Return the first READY hub-style snapshot dir for a repo, else None.

        Hub layout (modelscope >= 1.39):
            <hub_root>/damo--<repo>/snapshots/<rev>/<files>
        The pinned revision is preferred (it is what AutoModel loads via
        model_revision); any other READY snapshot is accepted so caches
        populated with a different revision still pass the gate.
        """
        snapshots_dir = os.path.join(
            hub_root, f"damo--{repo_dir_name}", "snapshots"
        )
        if not os.path.isdir(snapshots_dir):
            return None
        revisions = sorted(os.listdir(snapshots_dir), reverse=True)
        revisions.sort(key=lambda rev: rev != FunASRServer._MODEL_REVISION)
        for rev in revisions:
            candidate = os.path.join(snapshots_dir, rev)
            if FunASRServer._repo_ready(candidate):
                return candidate
        return None

    @staticmethod
    def _hub_models_roots():
        """Directories that may hold damo--<repo> hub-style repos.

        Covers $MODELSCOPE_CACHE (with and without the legacy `hub` layer)
        and the default ~/.cache/modelscope — 1.39 drops the `hub` layer.
        """
        roots = []
        env_root = os.environ.get("MODELSCOPE_CACHE")
        if env_root:
            roots.append(os.path.join(env_root, "models"))
            roots.append(os.path.join(env_root, "hub", "models"))
        home_dir = os.path.expanduser("~")
        default_cache = os.path.join(home_dir, ".cache", "modelscope")
        roots.append(os.path.join(default_cache, "models"))
        roots.append(os.path.join(default_cache, "hub", "models"))
        return roots

    def _resolve_repo_dir(self, repo_dir_name):
        """First READY on-disk directory for a repo across every known layout.

        Order (explicit damo_root WINS when populated):
          1. <damo_root>/<repo>                    — explicit, legacy shape
          2. <damo_root>/damo--<repo>/snapshots/*  — explicit, hub shape
             (covers --damo-root pointing AT the resolved modelscope root)
          3. <default damo root>/<repo>            — modelscope cache, legacy
          4. _hub_models_roots() hub shapes        — modelscope cache, 1.39
        Returns None when the repo is ready nowhere (→ models_not_downloaded).
        """
        roots = []
        if self.damo_root:
            roots.append(self.damo_root)
        default_root = self._default_damo_root()
        if default_root not in roots:
            roots.append(default_root)
        for root in roots:
            direct = os.path.join(root, repo_dir_name)
            if self._repo_ready(direct):
                return direct
            found = self._resolve_hub_repo(root, repo_dir_name)
            if found:
                return found
        for hub_root in self._hub_models_roots():
            found = self._resolve_hub_repo(hub_root, repo_dir_name)
            if found:
                return found
        return None

    # [20261001_T6a_OnnxEngine] Ticket #418: T5 downloader v2 layout
    # (<models root>/onnx-int8/<pin name>/). The explicit --damo-root wins
    # when it carries the generation root (prod fresh installs pass
    # <userData>/models); ELECTRON_USER_DATA (set by main.ts for the spawned
    # server, funasr_server.get_log_path precedent) is the canonical
    # <userData> fallback for roots resolved elsewhere (modelscope caches,
    # dev repo models). Readiness reuses _repo_ready, whose ONNX-generation
    # branch enforces the pinned exact file set (no wildcard, #417).
    def _onnx_roots(self):
        roots = []
        if self.damo_root:
            roots.append(os.path.join(self.damo_root, ONNX_MODELS_SUBDIR))
        user_data = os.environ.get("ELECTRON_USER_DATA")
        if user_data:
            candidate = os.path.join(user_data, "models", ONNX_MODELS_SUBDIR)
            if candidate not in roots:
                roots.append(candidate)
        return roots

    def _resolve_onnx_model_dir(self, model_key):
        """First pin-ready dir for a T5-layout ONNX model, else None."""
        for root in self._onnx_roots():
            candidate = os.path.join(root, ONNX_MODEL_DIR_NAMES[model_key])
            if self._repo_ready(candidate):
                return candidate
        return None
    # [20261001_T6a_OnnxEngine] END

    def _find_missing_required_models(self):
        """必需模型中就绪检查未通过的 repo 列表（run() 的启动门禁用）

        [20260911_Fix_336_HubLayout] Promoted from run() so the startup gate
        is unit-testable, and switched from a single cache_path join to
        _resolve_repo_dir so the hub layout and the empty-explicit-root
        fallback are covered. ASR accepts either generation (SeACo primary,
        old paraformer rollback — [20260820_T15_SeacoSwap]); punc optional.
        """
        vad_repo = "speech_fsmn_vad_zh-cn-16k-common-pytorch"
        asr_repos = [
            "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
            "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        ]
        # [20261001_T6a_OnnxEngine] The ONNX generation satisfies the gate
        # first (T5 layout, pin-exact readiness); the torch check below
        # remains for the rollback era. Missing-when-nothing-exists semantics
        # and the [asr, vad] report order are unchanged.
        missing = []
        if not (
            self._resolve_onnx_model_dir("asr")
            or any(self._resolve_repo_dir(r) for r in asr_repos)
        ):
            missing.append(asr_repos[0])
        if not (
            self._resolve_onnx_model_dir("vad")
            or self._resolve_repo_dir(vad_repo)
        ):
            missing.append(vad_repo)
        return missing
    # [20260911_Fix_336_HubLayout] END

    def _load_asr_model(self):
        """加载ASR模型（ONNX 引擎优先，torch 生成回退）"""
        # [20261001_T6a_OnnxEngine] Ticket #418: ONNX generation first — the
        # pin-ready T5-layout dir is loaded through funasr-onnx and wrapped
        # in the .generate()-contract adapter. Load failure (corrupt bytes,
        # missing runtime) falls through to the torch rollback below.
        onnx_dir = self._resolve_onnx_model_dir("asr")
        if onnx_dir is not None:
            try:
                with suppress_stdout():
                    from funasr_onnx import SeacoParaformer

                    # [20261002_T6b_OrtThreads] Threads from the one
                    # derivation function (the library default was a
                    # hard-coded 4 — spec #412 decision 4).
                    self.asr_model = OnnxAsrAdapter(
                        SeacoParaformer(
                            onnx_dir,
                            quantize=True,
                            intra_op_num_threads=self.inference_threads,
                        )
                    )
                self.asr_model_name = ONNX_MODEL_GENERATION_NAMES["asr"]
                logger.info(f"ASR模型加载完成（ONNX引擎）: {onnx_dir}")
                return True
            except Exception as e:
                logger.error(f"ONNX ASR模型加载失败，回退 torch 生成: {str(e)}")
        from funasr import AutoModel

        # [T15 review BLOCKER] Disk-presence gate: a repo id that is NOT
        # on local disk must be skipped WITHOUT calling AutoModel — funasr
        # auto-downloads ~1GB from modelscope on cache miss, silently
        # defeating the rollback (or blowing the 300s init timeout).
        # [20260905_Fix_255_ReviewFixup] The readiness gate (not just
        # isdir) applies here too: this path also serves reload/lazy-init,
        # which bypasses run()'s startup gate — an isdir-only check let a
        # mid-download dir holding only shard part-files through to
        # AutoModel (the confusing failure #255 fixed on the startup path).
        # [20260911_Fix_336_HubLayout] The single-cache-path join was
        # replaced by _resolve_repo_dir: the explicit --damo-root is usually
        # an empty <userData>/models while the models live in modelscope
        # 1.39's hub layout (issue #336).
        # [20261001_T5_SealImplicitPull] Ticket #417 (spec #412 decision 8):
        # AutoModel now receives the RESOLVED LOCAL DIRECTORY, never the
        # repo id. funasr only auto-downloads for non-existent local paths,
        # so a resolved dir makes the implicit network pull impossible; an
        # unresolvable repo is skipped with an actionable log line and no
        # AutoModel call at all.
        candidates = []
        for repo_id in (self.ASR_MODEL_SEACO, self.ASR_MODEL_FALLBACK):
            local_dir = self._resolve_repo_dir(repo_id.split("/", 1)[1])
            if local_dir is None:
                logger.warning(
                    f"模型目录未就绪（缺失或残缺），跳过且不联网拉取: {repo_id}。"
                    "请在应用内重新下载模型"
                )
                continue
            candidates.append((repo_id, local_dir))
        for model_name, local_dir in candidates:
            try:
                logger.info(f"开始加载ASR模型: {model_name}（本地目录: {local_dir}）")
                with suppress_stdout():
                    self.asr_model = AutoModel(
                        model=local_dir,
                        disable_update=True,
                        device=self.device,
                    )
                logger.info(f"ASR模型加载完成: {model_name}")
                self.asr_model_name = model_name
                return True
            except Exception as e:
                logger.error(f"ASR模型加载失败({model_name}): {str(e)}")
        return False

    def _load_vad_model(self):
        """加载VAD模型"""
        # [20261001_T6a_OnnxEngine] ONNX generation first (torch fallback
        # below mirrors the ASR loader policy).
        onnx_dir = self._resolve_onnx_model_dir("vad")
        if onnx_dir is not None:
            try:
                with suppress_stdout():
                    from funasr_onnx import Fsmn_vad

                    # [20261002_T6b_OrtThreads] Same derivation as ASR.
                    self.vad_model = OnnxVadAdapter(
                        Fsmn_vad(
                            onnx_dir,
                            quantize=True,
                            intra_op_num_threads=self.inference_threads,
                        )
                    )
                logger.info(f"VAD模型加载完成（ONNX引擎）: {onnx_dir}")
                return True
            except Exception as e:
                logger.error(f"ONNX VAD模型加载失败，回退 torch 生成: {str(e)}")
        try:
            # [20261001_T5_SealImplicitPull] Resolve locally FIRST: the old
            # unconditional repo-id call let funasr silently snapshot_download
            # when the repo was missing/partial (implicit network pull).
            # Missing = explicit failure, no network.
            local_dir = self._resolve_repo_dir(
                "speech_fsmn_vad_zh-cn-16k-common-pytorch"
            )
            if local_dir is None:
                logger.error(
                    "VAD模型目录未就绪（缺失或残缺），不联网回退。"
                    "请在应用内重新下载模型"
                )
                return False
            logger.info(f"开始加载VAD模型...（本地目录: {local_dir}）")
            with suppress_stdout():
                from funasr import AutoModel

                self.vad_model = AutoModel(
                    model=local_dir,
                    disable_update=True,
                    device=self.device,
                )
            logger.info("VAD模型加载完成")
            return True
        except Exception as e:
            logger.error(f"VAD模型加载失败: {str(e)}")
            return False

    def _load_punc_model(self):
        """加载标点恢复模型"""
        # [20261001_T6a_OnnxEngine] ONNX generation first (torch fallback
        # below mirrors the ASR loader policy; punc stays optional).
        onnx_dir = self._resolve_onnx_model_dir("punc")
        if onnx_dir is not None:
            try:
                with suppress_stdout():
                    from funasr_onnx import CT_Transformer

                    # [20261002_T6b_OrtThreads] Same derivation as ASR.
                    self.punc_model = OnnxPuncAdapter(
                        CT_Transformer(
                            onnx_dir,
                            quantize=True,
                            intra_op_num_threads=self.inference_threads,
                        )
                    )
                logger.info(f"标点恢复模型加载完成（ONNX引擎）: {onnx_dir}")
                return True
            except Exception as e:
                logger.error(f"ONNX 标点模型加载失败，回退 torch 生成: {str(e)}")
        try:
            import time

            start_time = time.time()
            logger.info("开始加载标点恢复模型...")

            # [20261001_T5_SealImplicitPull] Same seal as the VAD loader:
            # repo id → resolved local dir; unresolvable = explicit failure.
            local_dir = self._resolve_repo_dir(
                "punc_ct-transformer_zh-cn-common-vocab272727-pytorch"
            )
            if local_dir is None:
                logger.error(
                    "标点模型目录未就绪（缺失或残缺），不联网回退。"
                    "请在应用内重新下载模型"
                )
                return False

            # 记录导入时间
            import_start = time.time()
            with suppress_stdout():
                from funasr import AutoModel
            import_time = time.time() - import_start
            logger.info(f"FunASR导入耗时: {import_time:.2f}秒")

            # 记录模型创建时间
            model_start = time.time()
            with suppress_stdout():
                self.punc_model = AutoModel(
                    model=local_dir,
                    disable_update=True,
                    device=self.device,
                )
            model_time = time.time() - model_start
            total_time = time.time() - start_time

            logger.info(
                f"标点恢复模型加载完成 - 模型创建耗时: {model_time:.2f}秒, 总耗时: {total_time:.2f}秒"
            )
            return True
        except Exception as e:
            logger.error(f"标点恢复模型加载失败: {str(e)}")
            return False

    def initialize(self):
        """并行初始化FunASR模型（标点模型为可选）"""
        if self.initialized:
            return {"success": True, "message": "模型已初始化"}

        try:
            import threading
            import time

            logger.info("正在并行初始化FunASR模型...")
            start_time = time.time()

            # [20260819_T8_ThreadAdapt] torch is imported by the model
            # loaders below — apply the authoritative thread limit first.
            self._apply_torch_thread_limit()

            # 创建加载结果存储
            results = {}

            def load_model_thread(model_name, load_func):
                """模型加载线程包装函数"""
                thread_start = time.time()
                results[model_name] = load_func()
                thread_time = time.time() - thread_start
                logger.info(f"{model_name}模型加载线程耗时: {thread_time:.2f}秒")

            # 创建并启动三个并行线程
            threads = [
                threading.Thread(
                    target=load_model_thread, args=("asr", self._load_asr_model)
                ),
                threading.Thread(
                    target=load_model_thread, args=("vad", self._load_vad_model)
                ),
                threading.Thread(
                    target=load_model_thread, args=("punc", self._load_punc_model)
                ),
            ]

            # 启动所有线程
            for thread in threads:
                thread.start()

            # 等待所有线程完成，设置超时
            for thread in threads:
                thread.join(timeout=300)  # 5分钟超时
                if thread.is_alive():
                    logger.error(f"模型加载线程超时")
                    return {
                        "success": False,
                        "error": "模型加载超时",
                        "type": "timeout_error",
                    }

            # ASR和VAD是必需的，标点模型可选
            required_models = ["asr", "vad"]
            failed_required = [name for name in required_models if not results.get(name)]
            punc_ok = results.get("punc", False)

            if failed_required:
                error_msg = f"以下必需模型加载失败: {', '.join(failed_required)}"
                logger.error(error_msg)
                return {"success": False, "error": error_msg, "type": "init_error"}

            total_time = time.time() - start_time
            self.initialized = True
            status = "所有" if punc_ok else "核心（标点模型未加载）"
            logger.info(
                f"FunASR{status}模型初始化完成，总耗时: {total_time:.2f}秒"
            )
            return {
                "success": True,
                "message": f"FunASR{status}模型初始化成功，耗时: {total_time:.2f}秒",
                "punc_loaded": punc_ok,
            }

        except ImportError as e:
            error_msg = "FunASR未安装，请先安装FunASR: pip install funasr"
            logger.error(error_msg)
            return {"success": False, "error": error_msg, "type": "import_error"}

        except Exception as e:
            error_msg = f"FunASR模型初始化失败: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return {"success": False, "error": error_msg, "type": "init_error"}

    def transcribe_audio(self, audio_path, options=None):
        """转录音频文件"""
        # [20260819_T7_MicPreprocess] Default = original path: overwritten
        # by the DSP output inside the try; a raise BEFORE that point (e.g.
        # non-finite input rejection) must not hit an unbound name in the
        # finally cleanup.
        infer_path = audio_path
        # [T11 review MAJOR] Hold the models lock across the whole
        # inference section: a worker unload/reload defers instead of
        # freeing models mid-generate (busy = deferred, never
        # concurrent — now true in BOTH directions). RLock because
        # _ensure_initialized re-acquires inside.
        with self._init_lock:
            # [20260821_T11_UnloadReload] Lock-guarded lazy init (worker
            # reload can race this main-loop path).
            if not self._ensure_initialized():
                return {"success": False, "error": INIT_FAILED_MESSAGE, "type": "init_error"}

            try:
                # 检查音频文件是否存在
                if not os.path.exists(audio_path):
                    return {"success": False, "error": f"音频文件不存在: {audio_path}"}

                logger.info(f"开始转录音频文件: {audio_path}")

                # 设置默认选项
                default_options = {
                    "batch_size_s": 60,
                    "hotword": "",
                    "use_vad": True,
                    "use_punc": True,  # 使用FunASR自带的标点恢复
                    "language": "zh",
                }

                if options:
                    default_options.update(options)

                # [20260820_T14_Hotwords] Defense-in-depth: coerce the hotword
                # option to a safe string before it reaches generate().
                default_options["hotword"] = sanitize_hotword(
                    default_options.get("hotword", "")
                )

                # [20260819_T7_MicPreprocess] Ticket #186 (spec #177 T7): run the
                # DSP module on the push-to-talk path too. The renderer delivers
                # a 16k mono WAV temp (created/cleaned by the TS side); the DSP
                # output below is OUR temp and is unlinked in the finally block.
                # Fallback policy mirrors the file path (see _apply_preprocessing).
                infer_path = self._apply_preprocessing(audio_path)

                # 执行语音识别
                if default_options["use_vad"]:
                    vad_result = self.vad_model.generate(
                        input=infer_path, batch_size_s=default_options["batch_size_s"]
                    )
                    logger.info("VAD处理完成")

                # 执行ASR识别
                asr_result = self.asr_model.generate(
                    input=infer_path,
                    batch_size_s=default_options["batch_size_s"],
                    hotword=default_options["hotword"],
                    cache={},
                )

                # 提取识别文本
                if isinstance(asr_result, list) and len(asr_result) > 0:
                    if isinstance(asr_result[0], dict) and "text" in asr_result[0]:
                        raw_text = asr_result[0]["text"]
                    else:
                        raw_text = str(asr_result[0])
                else:
                    raw_text = str(asr_result)

                logger.info(f"ASR识别完成，原始文本: {raw_text[:100]}...")

                # 使用FunASR进行标点恢复
                final_text = raw_text
                if default_options["use_punc"] and self.punc_model and raw_text.strip():
                    try:
                        punc_result = self.punc_model.generate(input=raw_text)
                        if isinstance(punc_result, list) and len(punc_result) > 0:
                            if (
                                isinstance(punc_result[0], dict)
                                and "text" in punc_result[0]
                            ):
                                final_text = punc_result[0]["text"]
                            else:
                                final_text = str(punc_result[0])
                        logger.info("FunASR标点恢复完成")
                    except Exception as e:
                        logger.warning(f"FunASR标点恢复失败，使用原始文本: {str(e)}")

                duration = self._get_audio_duration(infer_path)
                self.transcription_count += 1

                result = {
                    "success": True,
                    "text": final_text,
                    "raw_text": raw_text,
                    "confidence": (
                        getattr(asr_result[0], "confidence", 0.0)
                        if isinstance(asr_result, list)
                        else 0.0
                    ),
                    "duration": duration,
                    "language": "zh-CN",
                    # [20261001_T6a_OnnxEngine] Report the loaded generation:
                    # "onnx" for the funasr-onnx adapters, "pytorch" for the
                    # torch rollback (protocol schema unchanged).
                    "model_type": getattr(
                        self.asr_model, "engine_name", "pytorch"
                    ),
                }

                # 生产环境：每10次转录后进行内存清理
                if self.transcription_count % 10 == 0:
                    self._cleanup_memory()
                    logger.info(f"已完成 {self.transcription_count} 次转录，执行内存清理")

                logger.info(f"转录完成，最终文本: {final_text[:100]}...")
                return result

            except Exception as e:
                error_msg = f"音频转录失败: {str(e)}"
                logger.error(error_msg)
                logger.error(traceback.format_exc())
                return {"success": False, "error": error_msg, "type": "transcription_error"}
            finally:
                # [20260819_T7_MicPreprocess] Clean OUR temp only — the original
                # mic temp belongs to the TS side (close-then-unlink discipline
                # lives in audioFileHelpers); fallback returns the original path,
                # which the != audio_path guard leaves untouched.
                if infer_path != audio_path:
                    try:
                        os.unlink(infer_path)
                    except Exception as unlink_error:
                        # [20260913_Fix_197_UnlinkDebug] #197 #7: best-effort
                        # cleanup stays non-fatal but diagnosable.
                        logger.debug(
                            "temp cleanup failed for %s: %s",
                            infer_path,
                            unlink_error,
                        )

    def transcribe_file_audio(self, audio_path, options=None):
        """带时间戳的文件转录，用于 transcribe_file 命令"""
        if options is None:
            options = {}

        request_id = options.get("request_id", "")
        # [20260820_T14_Hotwords] Defense-in-depth (file path).
        hotword = sanitize_hotword(options.get("hotword", ""))
        # [20260821_T11_UnloadReload] File path ran WITHOUT an init guard
        # (review finding): after an unload it crashed on None models.
        # Runs on the inference worker thread — reload stays off the read
        # loop naturally.
        if not self._ensure_initialized():
            return {
                "success": False,
                "error": INIT_FAILED_MESSAGE,
                "type": "init_error",
                "request_id": request_id,
            }
        self.cancel_event.clear()
        import time
        _t0 = time.time()
        logger.info(f"transcribe_file_audio START request_id={request_id} path={audio_path}")

        wav_path = audio_path
        was_converted = False
        # [20260818_T6_AudioPreprocess] Temp files to clean in finally:
        # converted_path = format-conversion temp (None on wav/flac
        # passthrough); dsp_path = preprocessing output (may equal the
        # input when preprocessing fell back).
        converted_path = None
        dsp_path = None

        try:
            # 路径验证
            valid, result = self._validate_audio_path(audio_path)
            if not valid:
                return {"success": False, "error": result}
            audio_path = result

            # 使用 soundfile 将非 WAV 转为 16kHz 单声道 WAV
            # 注意：格式列表需与 _convert_to_wav() 保持同步
            ext = os.path.splitext(audio_path)[1].lower()
            needs_convert = ext not in ('.wav', '.flac')
            if needs_convert:
                logger.info(f"convert phase START request_id={request_id} ext={ext}")
                self.response_queue.put({
                    "request_id": request_id,
                    "type": "progress",
                    "phase": "convert",
                    "message": f"正在转换 {ext} 音频...",
                    "progress_pct": 0,
                })
            wav_path, was_converted = self._convert_to_wav(audio_path)
            if was_converted:
                logger.info(f"convert phase END request_id={request_id} elapsed={time.time()-_t0:.2f}s")

            # [20260818_T6_AudioPreprocess] DSP runs AFTER conversion, so it
            # covers BOTH branches: converted temp wavs AND the native
            # wav/flac passthrough (which previously reached the model raw).
            converted_path = wav_path if was_converted else None
            dsp_path = self._apply_preprocessing(wav_path)
            if dsp_path != wav_path:
                wav_path = dsp_path

            # 获取音频时长（从转换后的 WAV 获取更准确）
            duration = self._get_audio_duration(wav_path)

            # 发送进度：VAD阶段
            _t_vad = time.time()
            logger.info(f"VAD phase START request_id={request_id} duration={duration:.2f}s")
            self.response_queue.put({
                "request_id": request_id,
                "type": "progress",
                "phase": "vad",
                "message": "语音检测中...",
                "progress_pct": 5,
            })

            # VAD 处理
            use_vad = options.get("use_vad", True)
            raw_text = ""
            raw_segments = []

            vad_segments = []
            if use_vad and self.vad_model:
                vad_result = self.vad_model.generate(input=wav_path)
                if vad_result and len(vad_result) > 0:
                    vad_segments = vad_result[0].get("value", [])
            logger.info(f"VAD phase END request_id={request_id} elapsed={time.time()-_t_vad:.2f}s segments={len(vad_segments)}")

            # ASR 阶段 — VAD 分段推理（回退：全文件单次推理）
            _t_asr = time.time()
            total_ms = int(duration * 1000) if duration else 0
            rtf_estimate = 0.08 if self.device == "cuda" else 0.5

            self.response_queue.put({
                "request_id": request_id,
                "type": "progress",
                "phase": "asr",
                "message": "语音识别中...",
                "total_ms": total_ms,
                "progress_pct": 10,
            })

            if self.cancel_event.is_set():
                return {"success": False, "canceled": True, "error": "转录已取消", "request_id": request_id}

            # --- Helper: 从 ASR 时间戳构建 segments ---
            def _build_segments_from_timestamps(asr_text, asr_timestamps, time_offset_ms=0):
                """将 ASR 返回的字级时间戳切分为 segments"""
                segs = []
                if not asr_timestamps or not asr_text:
                    return segs
                chars = list(asr_text.replace(" ", ""))
                seg_text = ""
                seg_start = asr_timestamps[0][0] + time_offset_ms
                seg_end = asr_timestamps[0][1] + time_offset_ms
                char_idx = 0

                for ts in asr_timestamps:
                    seg_end = ts[1] + time_offset_ms
                    if char_idx < len(chars):
                        seg_text += chars[char_idx]
                        char_idx += 1
                    if seg_text and (seg_text[-1] in "。！？；\n" or len(seg_text) >= 20):
                        segs.append({
                            "start_ms": seg_start,
                            "end_ms": seg_end,
                            "text": seg_text
                        })
                        seg_text = ""
                        seg_start = ts[1] + time_offset_ms if char_idx < len(asr_timestamps) else seg_end
                if seg_text:
                    segs.append({
                        "start_ms": seg_start,
                        "end_ms": seg_end,
                        "text": seg_text
                    })
                return segs

            # --- VAD 分段推理（无可用 VAD 输出时回退：全文件仍按 ≤60s 硬分块） ---
            # [20261002_T6b_SubChunk] Region selection for BOTH branches:
            # VAD segments when we have them, otherwise the whole file
            # duration hard-split — a full-file one-shot is exactly the
            # GB-level transient memory the ≤60s cap exists to prevent.
            if vad_segments:
                regions = build_asr_regions(vad_segments)
            else:
                regions = (
                    build_asr_regions([[0, total_ms]]) if total_ms > 0 else []
                )

            if regions:
                logger.info(f"ASR phase START (chunked) request_id={request_id} regions={len(regions)} vad_segments={len(vad_segments)}")

                total_chunks = len(regions)
                chunk_temp_files = []

                try:
                    import soundfile as sf

                    # 获取 WAV 信息用于帧级读取
                    wav_info = sf.info(wav_path)
                    wav_sr = wav_info.samplerate
                    wav_frames = wav_info.frames

                    for chunk_idx, (region_start, region_end) in enumerate(regions):
                        if self.cancel_event.is_set():
                            logger.info(f"ASR phase CANCELLED request_id={request_id} chunk={chunk_idx}/{total_chunks}")
                            break

                        # 添加缓冲，但不超出音频边界
                        buf_start_ms = max(0, region_start - REGION_BUFFER_MS)
                        buf_end_ms = min(total_ms, region_end + REGION_BUFFER_MS)

                        # 帧级读取
                        start_frame = int(buf_start_ms / 1000.0 * wav_sr)
                        end_frame = int(buf_end_ms / 1000.0 * wav_sr)
                        start_frame = max(0, start_frame)
                        end_frame = min(wav_frames, end_frame)

                        # 读取该区域音频
                        audio_chunk, _ = sf.read(wav_path, start=start_frame, stop=end_frame)

                        # 写入临时 WAV
                        chunk_tmp = tempfile.NamedTemporaryFile(
                            suffix='.wav', delete=False,
                            prefix='murmur_chunk_', dir=tempfile.gettempdir()
                        )
                        sf.write(chunk_tmp.name, audio_chunk, wav_sr)
                        chunk_tmp.close()
                        chunk_temp_files.append(chunk_tmp.name)

                        # ASR 推理
                        asr_result = self.asr_model.generate(
                            input=chunk_tmp.name,
                            batch_size_s=60,
                            hotword=hotword,
                        )

                        if asr_result and len(asr_result) > 0:
                            chunk_text = asr_result[0].get("text", "")
                            timestamps = asr_result[0].get("timestamp")
                            if chunk_text and timestamps:
                                # [20261002_T6b_SubChunk review fix] 相邻
                                # 分块共享 ±REGION_BUFFER_MS 的缓冲音频，
                                # 引擎会在两个 chunk 里都输出边界词——按
                                # 字级时间戳中点把输出归属到唯一所属
                                # 区域后再拼接，重叠区文本只保留一份。
                                chunk_text, timestamps = _filter_chunk_to_region(
                                    chunk_text, timestamps, buf_start_ms,
                                    region_start, region_end,
                                )
                            if chunk_text:
                                raw_text += chunk_text

                            if timestamps and chunk_text:
                                # 时间戳偏移：chunk 内偏移 + 缓冲区域起始
                                offset_ms = buf_start_ms
                                chunk_segs = _build_segments_from_timestamps(
                                    chunk_text, timestamps, time_offset_ms=offset_ms
                                )
                                raw_segments.extend(chunk_segs)
                            elif chunk_text:
                                # 无时间戳，用区域范围
                                raw_segments.append({
                                    "start_ms": region_start,
                                    "end_ms": region_end,
                                    "text": chunk_text
                                })

                        # 报告进度
                        pct = 10 + (chunk_idx + 1) / total_chunks * 85
                        self.response_queue.put({
                            "request_id": request_id,
                            "type": "progress",
                            "phase": "asr",
                            "message": f"语音识别中... {int(pct)}%",
                            "total_ms": total_ms,
                            "progress_pct": round(min(pct, 95), 1),
                        })
                        logger.debug(f"ASR chunk {chunk_idx+1}/{total_chunks} done "
                                     f"region=[{region_start},{region_end}] text_len={len(asr_result[0].get('text','')) if asr_result else 0}")
                finally:
                    for f in chunk_temp_files:
                        try:
                            os.unlink(f)
                        except Exception as unlink_error:
                            # [20260913_Fix_197_UnlinkDebug] #197 #7: same
                            # best-effort-but-diagnosable contract.
                            logger.debug(
                                "chunk temp cleanup failed for %s: %s",
                                f,
                                unlink_error,
                            )

                logger.info(f"ASR phase END (chunked) request_id={request_id} "
                            f"elapsed={time.time()-_t_asr:.2f}s chunks={total_chunks} text_len={len(raw_text)}")

            # --- 回退：短音频全文件单次推理（仅 ≤60s 时） ---
            else:
                logger.info(f"ASR phase START (fallback full-file) request_id={request_id} total_ms={total_ms}")
                estimated_time_s = max(total_ms * rtf_estimate / 1000, 2)

                # 后台线程定时报告 RTF 估算进度
                timer_stop = threading.Event()

                def asr_progress_timer():
                    start = time.time()
                    while not timer_stop.is_set() and not self.cancel_event.is_set():
                        elapsed = time.time() - start
                        pct = min(10 + elapsed / estimated_time_s * 85, 95)
                        self.response_queue.put({
                            "request_id": request_id,
                            "type": "progress",
                            "phase": "asr",
                            "message": f"语音识别中... {int(pct)}%",
                            "total_ms": total_ms,
                            "progress_pct": round(pct, 1),
                        })
                        timer_stop.wait(0.5)

                timer_thread = threading.Thread(target=asr_progress_timer, daemon=True)
                timer_thread.start()

                try:
                    asr_result = self.asr_model.generate(
                        input=wav_path,
                        batch_size_s=60,
                        hotword=hotword,
                    )
                finally:
                    timer_stop.set()
                    timer_thread.join(timeout=1)

                if asr_result and len(asr_result) > 0:
                    raw_text = asr_result[0].get("text", "")
                    timestamps = asr_result[0].get("timestamp")
                    if timestamps and raw_text:
                        raw_segments = _build_segments_from_timestamps(raw_text, timestamps)
                    elif vad_segments:
                        total_vad_ms = sum(e - s for s, e in vad_segments)
                        per_ms_text = len(raw_text) / total_vad_ms if total_vad_ms > 0 else 0
                        offset = 0
                        for start_ms, end_ms in vad_segments:
                            seg_len = max(1, int((end_ms - start_ms) * per_ms_text))
                            seg_text = raw_text[offset:offset + seg_len]
                            if seg_text:
                                raw_segments.append({
                                    "start_ms": start_ms,
                                    "end_ms": end_ms,
                                    "text": seg_text
                                })
                            offset += seg_len

                logger.info(f"ASR phase END (fallback) request_id={request_id} "
                            f"elapsed={time.time()-_t_asr:.2f}s text_len={len(raw_text)}")

            # 标点恢复
            _t_punc = time.time()
            if self.cancel_event.is_set():
                logger.info(f"PUNC phase SKIPPED (cancelled) request_id={request_id}")
                return {"success": False, "canceled": True, "error": "转录已取消", "request_id": request_id}

            self.response_queue.put({
                "request_id": request_id,
                "type": "progress",
                "phase": "punc",
                "message": "标点恢复中...",
                "progress_pct": 96,
            })

            text = raw_text
            if self.punc_model and text:
                logger.info(f"PUNC phase START request_id={request_id} text_len={len(text)}")
                punc_result = self.punc_model.generate(input=text)
                logger.info(f"PUNC phase END request_id={request_id} elapsed={time.time()-_t_punc:.2f}s")
                if punc_result and len(punc_result) > 0:
                    text = punc_result[0].get("text", raw_text)
            else:
                logger.info(f"PUNC phase SKIP (no model or empty text) request_id={request_id}")

            # 智能合并 segments
            segments = self._merge_segments(raw_segments) if raw_segments else []

            # GC
            self.transcription_count += 1
            if self.transcription_count % 5 == 0:
                self._cleanup_memory()

            result = {
                "success": True,
                "text": text,
                "raw_text": raw_text,
                "segments": segments,
                "raw_segments": raw_segments,
                "duration": duration,
                "confidence": 0.9,
                "language": "zh-CN"
            }
            logger.info(f"transcribe_file_audio COMPLETE request_id={request_id} total_elapsed={time.time()-_t0:.2f}s")
        except Exception as e:
            logger.error(f"文件转录异常: {str(e)}\n{traceback.format_exc()}")
            result = {
                "success": False,
                "error": str(e),
                "request_id": request_id
            }
        finally:
            # [20260818_T6_AudioPreprocess] Unlink BOTH temps (the
            # format-converted file and the DSP output); never the user's
            # original, never twice.
            if dsp_path and dsp_path != audio_path:
                try:
                    os.unlink(dsp_path)
                except Exception as unlink_error:
                    # [20260913_Fix_197_UnlinkDebug] #197 #7: DSP temp cleanup
                    # failure is best-effort but diagnosable.
                    logger.debug(
                        "DSP temp cleanup failed for %s: %s",
                        dsp_path,
                        unlink_error,
                    )
            if (
                converted_path
                and converted_path != audio_path
                and converted_path != dsp_path
            ):
                try:
                    os.unlink(converted_path)
                except Exception:
                    pass
        return result

    # [20260818_T6_AudioPreprocess] Ticket #185 (spec #177 T6): run the DSP
    # module (80Hz HPF + segmented RMS normalization) on the transcribe-file
    # path. Fallback policy (review fixup): a DSP *bug* (any non-ValueError)
    # warns and returns the original path — preprocessing must never block
    # transcription. ValueError means the INPUT is illegal (non-finite
    # samples); it propagates so transcription FAILS with a clear message
    # instead of feeding known-bad audio to the model.
    def _apply_preprocessing(self, wav_path):
        try:
            import audio_preprocessing
            return audio_preprocessing.preprocess_audio_file(wav_path)
        except ValueError:
            raise
        except Exception as e:
            logger.warning(f"音频预处理失败，使用原始音频: {e}")
            return wav_path

    def _convert_to_wav(self, audio_path):
        """使用 soundfile 将非 WAV 音频转为 16kHz 单声道 WAV 临时文件

        [20261002_T6b_NoLibrosa] Ticket #419 (spec #412 decision 3): decode
        runs on soundfile (libsndfile, pure C) through the shared ndarray
        doorway — read + mono-mean + scipy resample — instead of
        librosa.load, so packaging can trim the numba/llvmlite tree.
        FLAC 直接返回，依赖引擎原生支持；WAV 以外的格式解码失败时抛出
        RuntimeError（m4a/aac/wma 等需要系统解码器的格式会在此显式失败）。
        """
        ext = os.path.splitext(audio_path)[1].lower()
        if ext in ('.wav', '.flac'):
            return audio_path, False

        try:
            import soundfile as sf

            samples = _load_audio_ndarray(audio_path)
            tmp = tempfile.NamedTemporaryFile(
                suffix='.wav', delete=False,
                prefix='murmur_conv_', dir=tempfile.gettempdir()
            )
            sf.write(tmp.name, samples, ONNX_TARGET_SAMPLE_RATE)
            tmp.close()
            logger.info(f"音频转换完成: {audio_path} -> {tmp.name}")
            return tmp.name, True
        except Exception as e:
            logger.warning(f"音频转换失败: {e}")
            raise RuntimeError(
                f"音频格式转换失败（{ext}）: {e}。请确认音频文件未损坏"
            ) from e

    def _get_audio_duration(self, audio_path):
        """获取音频时长（soundfile 元信息，纯 C 读取）

        [20261002_T6b_NoLibrosa] Replaces librosa.get_duration. A probe
        failure now RAISES instead of silently returning 0: a file whose
        duration cannot be read is broken, and the silent 0 corrupted
        progress reporting (total_ms) and the usage stats downstream.
        """
        import soundfile as sf

        try:
            info = sf.info(audio_path)
            duration = info.frames / float(info.samplerate)
        except Exception as e:
            logger.error(f"获取音频时长失败: {e}")
            raise RuntimeError(f"音频时长探测失败: {audio_path}（{e}）") from e
        self.total_audio_duration += duration  # 累计音频时长
        return duration

    def _cleanup_memory(self):
        """生产环境内存清理"""
        try:
            import gc

            gc.collect()
            logger.info("内存清理完成")
        except Exception as e:
            logger.warning(f"内存清理失败: {str(e)}")

    def get_performance_stats(self):
        """获取性能统计信息"""
        return {
            "transcription_count": self.transcription_count,
            "total_audio_duration": round(self.total_audio_duration, 2),
            "average_duration": round(
                self.total_audio_duration / max(1, self.transcription_count), 2
            ),
            "initialized": self.initialized,
            "models_loaded": {
                "asr": self.asr_model is not None,
                "vad": self.vad_model is not None,
            # [T15 review MINOR] Surface the loaded generation so the UI
            # can flag silent hotword degradation on the old model.
            "asr_model": self.asr_model_name,
                "punc": self.punc_model is not None,
            },
        }

    def check_status(self):
        """检查FunASR状态"""
        try:
            import funasr

            return {
                "success": True,
                "installed": True,
                "initialized": self.initialized,
                "version": getattr(funasr, "__version__", "unknown"),
                "models": {
                    "asr": self.asr_model is not None,
                    "vad": self.vad_model is not None,
            # [T15 review MINOR] Surface the loaded generation so the UI
            # can flag silent hotword degradation on the old model.
            "asr_model": self.asr_model_name,
                    "punc": self.punc_model is not None,  # FunASR标点恢复模型状态
                },
            }
        except ImportError:
            return {
                "success": False,
                "installed": False,
                "initialized": False,
                "error": "FunASR未安装",
            }

    # [20260821_T11_UnloadReload] Ticket #189 (spec #177 T11): init guard
    # shared by both transcribe paths; double-checked under the init lock
    # so a worker-thread reload and a main-loop mic transcribe collapse
    # into a single initialize().
    def _ensure_initialized(self):
        if self.initialized:
            return True
        with self._init_lock:
            if self.initialized:
                return True
            result = self.initialize()
            return bool(result and result.get("success"))

    # [20260821_T11_UnloadReload] Worker-thread handlers. Called ONLY from
    # _inference_worker (queued via request_queue) — serialization with
    # transcribe_file is structural; the main loop just enqueues, so ping
    # stays answerable throughout.
    def _do_unload(self, request_id):
        """Free all models (incl. the lazy speaker model), reset state."""
        # [T11 review MAJOR] Under the models lock: if a mic transcribe /
        # diarize holds it on the read loop, unload WAITS (busy = deferred)
        # instead of freeing models mid-generate.
        with self._init_lock:
            self.asr_model = None
            self.vad_model = None
            self.punc_model = None
            # Lazy speaker model unloads too and stays lazy on reload.
            self.cam_model = None
            self.initialized = False
        logger.info(f"模型已卸载 request_id={request_id}")
        self.response_queue.put({
            "request_id": request_id,
            "type": "result",
            "success": True,
            "message": "模型已卸载",
        })

    def _do_reload(self, request_id):
        """Reload models on the worker thread; progress renews TS timeouts."""
        self.response_queue.put({
            "request_id": request_id,
            "type": "progress",
            "phase": "reload",
            "message": "模型重载中...",
            "progress_pct": 0,
        })
        # [T11] Under the init lock (via _ensure_initialized): a mic
        # transcribe on the main loop can lazy-init concurrently.
        ok = self._ensure_initialized()
        self.response_queue.put({
            "request_id": request_id,
            "type": "result",
            "success": ok,
            "error": None if ok else INIT_FAILED_MESSAGE,
            "asr_model": self.asr_model_name,
        })

    def _inference_worker(self):
        """推理线程：从 request_queue 取任务，执行推理"""
        while self.running:
            try:
                task = self.request_queue.get(timeout=1.0)
                if task is None:
                    break

                request_id = task.get("request_id", "")
                action = task.get("action")

                try:
                    if action == "unload_models":
                        self._do_unload(request_id)
                        continue
                    elif action == "reload_models":
                        self._do_reload(request_id)
                        continue
                    elif action == "transcribe_file":
                        opts = task.get("options", {})
                        opts["request_id"] = request_id
                        result = self.transcribe_file_audio(
                            task.get("audio_path"),
                            opts,
                        )
                    else:
                        result = {"success": False, "error": f"推理线程不支持的动作: {action}"}

                    result["request_id"] = request_id
                    result["type"] = "result"
                    self.response_queue.put(result)
                except Exception as e:
                    self.response_queue.put({
                        "request_id": request_id,
                        "type": "result",
                        "success": False,
                        "error": str(e)
                    })
            except queue.Empty:
                continue

        logger.info("推理线程退出")

    def _output_worker(self):
        """输出线程：从 response_queue 取结果，写入 stdout"""
        while self.running:
            try:
                msg = self.response_queue.get(timeout=0.5)
                # [20260905_Fix_208_ProtocolStreamImmune] Startup stream, not
                # print(): a dequeue during a suppress_stdout() window must
                # still reach the host (#208).
                _protocol_print(msg)
            except queue.Empty:
                continue

        logger.info("输出线程退出")

    def _load_cam_model(self):
        """懒加载CAM++声纹模型（仅在首次diarize调用时加载）"""
        if self.cam_model is not None:
            return

        # [20261002_T6b_SpeakerOnnx] The old psutil-based <2GB memory
        # precheck is gone: psutil was NEVER in the embedded runtime, so
        # the import failed before the check ever ran — diarize shipped
        # broken because of it. The int8 ONNX speaker session adds only
        # ~tens of MB on top of the already-resident ASR stack, so a
        # per-load memory gate has nothing left to protect here.
        # ONNX generation first: the pin-ready T5-layout speaker-campplus
        # dir is driven straight through onnxruntime (funasr-onnx has no
        # speaker loader). Load failure (missing fbank runtime, corrupt
        # bytes) falls through to the torch rollback below — same policy
        # as the other loaders.
        onnx_dir = self._resolve_onnx_model_dir("speaker")
        if onnx_dir is not None:
            try:
                self.cam_model = OnnxSpeakerAdapter(
                    onnx_dir, intra_op_num_threads=self.inference_threads
                )
                logger.info(f"CAM++声纹模型加载完成（ONNX引擎）: {onnx_dir}")
                return
            except Exception as e:
                logger.error(f"ONNX 说话人模型加载失败，回退 torch 生成: {str(e)}")

        # [20261001_T5_SealImplicitPull] Same seal as the other loaders: the
        # old repo-id call silently snapshot_downloaded on cache miss (and
        # upstream has no v2.0.4 tag for campplus, so modelscope fell back
        # to latest — an unpinned implicit pull). Missing = explicit,
        # actionable error surfaced through diarize_audio's response.
        local_dir = self._resolve_repo_dir("speech_campplus_sv_zh-cn_16k-common")
        if local_dir is None:
            raise RuntimeError(
                "说话人模型未就绪（缺失或残缺），不联网回退。请重新下载模型后重试"
            )

        import time

        from funasr import AutoModel

        logger.info("正在加载CAM++声纹模型...")
        start = time.time()
        self.cam_model = AutoModel(model=local_dir)
        elapsed = time.time() - start
        logger.info(f"CAM++模型加载完成，耗时: {elapsed:.2f}秒")

    def diarize_audio(self, audio_path, segments):
        """
        对已有segments进行说话人识别。
        参数:
            audio_path: 音频文件路径
            segments: [{start_ms, end_ms, text}, ...]
        返回:
            segments列表，每个元素增加speaker字段
        """
        # [T11 review MAJOR] Same models lock as transcribe_audio —
        # diarize runs on the read loop too, unload must defer.
        with self._init_lock:

            import numpy as np

            if not segments or len(segments) == 0:
                return {"success": False, "error": "无分段数据"}

            try:
                self._load_cam_model()
            except RuntimeError as e:
                return {"success": False, "error": str(e)}

            # [20261002_T6b_SpeakerOnnx] Whole-file load through the shared
            # soundfile→ndarray doorway (soundfile pure C read + scipy
            # resample to 16k mono) — the librosa.load call is gone
            # (spec #412 decision 3). Samples are float32 mono at 16 kHz.
            audio = _load_audio_ndarray(audio_path)
            sr = ONNX_TARGET_SAMPLE_RATE

            embeddings = []
            valid_indices = []
            for i, seg in enumerate(segments):
                start_sample = int(seg["start_ms"] / 1000.0 * sr)
                end_sample = int(seg["end_ms"] / 1000.0 * sr)
                start_sample = max(0, start_sample)
                end_sample = min(len(audio), end_sample)

                if end_sample - start_sample < sr * 0.1:
                    continue  # 跳过大短的片段（<100ms）

                chunk = audio[start_sample:end_sample]
                # 使用CAM++提取声纹嵌入
                result = self.cam_model(chunk, output_dir=None)
                if result and len(result) > 0:
                    emb = result[0].get("spk_embedding") or result[0].get("embedding")
                    if emb is not None:
                        embeddings.append(np.array(emb).flatten())
                        valid_indices.append(i)

            if len(embeddings) == 0:
                for seg in segments:
                    seg["speaker"] = "Speaker"
                return {"success": True, "segments": segments}

            # 余弦相似度聚类
            embeddings = np.stack(embeddings)  # (N, D)
            N = len(embeddings)
            threshold = 0.7
            labels = list(range(N))  # 初始每个embedding一个cluster

            for i in range(N):
                for j in range(i + 1, N):
                    sim = np.dot(embeddings[i], embeddings[j]) / (
                        np.linalg.norm(embeddings[i]) * np.linalg.norm(embeddings[j]) + 1e-8
                    )
                    if sim > threshold:
                        # 合并cluster
                        root_i = labels[i]
                        root_j = labels[j]
                        new_label = min(root_i, root_j)
                        for k in range(N):
                            if labels[k] == root_i or labels[k] == root_j:
                                labels[k] = new_label

            # 重映射label到连续编号
            unique_labels = sorted(set(labels))
            label_map = {old: f"Speaker {chr(65 + idx)}" for idx, old in enumerate(unique_labels)}
            if len(unique_labels) == 1:
                label_map[unique_labels[0]] = "Speaker"

            speaker_for_index = {}
            for vi, label_id in zip(valid_indices, labels):
                speaker_for_index[vi] = label_map[label_id]

            for i, seg in enumerate(segments):
                seg["speaker"] = speaker_for_index.get(i, "Speaker")

            return {"success": True, "segments": segments}

        # [20260817_T5_HandleCommand] Ticket #181 (spec #177 T5): the stdin
        # command dispatch, extracted verbatim from run()'s read loop so it is
        # unit-testable without spawning the process (protocol extensions for
        # idle-unload/hotwords must extend tests/python accordingly).
        # Returns (result, keep_running):
        #   result is None     -> action was queued (transcribe_file); the read
        #                         loop must NOT print anything for it
        #   keep_running False -> stop the read loop after printing (exit)

    def handle_command(self, command):
        if command.get("action") == "transcribe":
            audio_path = command.get("audio_path")
            options = command.get("options", {})
            return self.transcribe_audio(audio_path, options), True
        elif command.get("action") == "status":
            return self.check_status(), True
        elif command.get("action") == "stats":
            return {"success": True, "stats": self.get_performance_stats()}, True
        elif command.get("action") == "cleanup":
            self._cleanup_memory()
            return {"success": True, "message": "内存清理完成"}, True
        elif command.get("action") in ("unload_models", "reload_models"):
            # [20260821_T11_UnloadReload] Queued like transcribe_file:
            # serialization with in-flight file work is structural (busy =
            # deferred, never concurrent); the read loop only enqueues.
            self.request_queue.put({
                "request_id": command.get("request_id", ""),
                "action": command.get("action"),
            })
            return None, True
        elif command.get("action") == "transcribe_file":
            # 放入推理队列，不立即返回确认
            # 推理结果和进度通过 response_queue → output_worker → stdout 发送
            self.request_queue.put({
                "request_id": command.get("request_id", ""),
                "action": "transcribe_file",
                "audio_path": command.get("audio_path"),
                "options": command.get("options", {})
            })
            return None, True
        elif command.get("action") == "cancel_transcription":
            self.cancel_event.set()
            return {"success": True, "message": "取消信号已发送"}, True
        elif command.get("action") == "diarize":
            audio_path = command.get("audio_path")
            segments = command.get("segments", [])
            return self.diarize_audio(audio_path, segments), True
        elif command.get("action") == "ping":
            return {"success": True, "action": "pong"}, True
        elif command.get("action") == "exit":
            return {"success": True, "message": "服务器退出"}, False
        else:
            return {
                "success": False,
                "error": f"未知命令: {command.get('action')}",
            }, True

    def run(self):
        """运行服务器主循环"""
        logger.info("FunASR服务器启动")

        # 解析 damo 根目录
        cache_path = self.damo_root if self.damo_root else self._default_damo_root()
        logger.info(f"使用的模型根目录(damo root): {cache_path}")

        # [20260820_T15_SeacoSwap] Either ASR generation satisfies the
        # required-ASR check (SeACo for fresh installs / upgraded users,
        # old paraformer for mid-upgrade rollback states).
        # ASR (either generation) + VAD are required; punc is optional.

        # [20260905_Fix_255_RepoReadyShardGlob] Readiness gate promoted to
        # FunASRServer._repo_ready (staticmethod, shard-aware, testable).
        # [20260911_Fix_336_HubLayout] The gate itself was promoted to
        # _find_missing_required_models() so the explicit-empty-damo_root
        # fallback and the modelscope 1.39 hub layout resolve identically
        # here, in _load_asr_model, and in the unit tests (issue #336).
        missing_required = self._find_missing_required_models()

        if not missing_required:
            logger.info("模型文件存在，开始初始化")
            init_result = self.initialize()
        else:
            logger.info(f"必需模型文件不存在或不完整：{', '.join(missing_required)}，跳过初始化")
            # [20261006_Fix_421_SchemaLockAnchors] payload construction via
            # the module function the schema regression suite locks.
            init_result = models_not_downloaded_result()
        # [20260905_Fix_208_ProtocolStreamImmune] Startup stream: reload
        # re-initialization can be in flight while this init result prints.
        _protocol_print(init_result)

        # 启动推理线程和输出线程
        self._inference_thread = threading.Thread(target=self._inference_worker, daemon=True)
        self._output_thread = threading.Thread(target=self._output_worker, daemon=True)
        self._inference_thread.start()
        self._output_thread.start()

        while self.running:
            try:
                # 读取命令
                line = sys.stdin.readline()
                if not line:
                    break

                line = line.strip()
                if not line:
                    continue

                try:
                    command = json.loads(line)
                except json.JSONDecodeError:
                    # [20261006_Fix_421_SchemaLockAnchors] payload via the
                    # module function the schema regression suite locks.
                    result = invalid_json_result()
                    # [20260905_Fix_208_ProtocolStreamImmune]
                    _protocol_print(result)
                    continue

                # 提取 request_id 用于响应关联
                request_id = command.get("request_id", "")

                # Dispatch the command. [20260817_T5_HandleCommand] The
                # dispatch logic now lives in handle_command (unit-testable);
                # this loop keeps only the read/print cycle.
                result, keep_running = self.handle_command(command)

                # Print the result with request_id attached. result=None
                # means the action was queued — output_worker prints it
                # asynchronously, so the read loop must not print here.
                if result is not None:
                    if request_id:
                        result["request_id"] = request_id
                    # [20260905_Fix_208_ProtocolStreamImmune]
                    _protocol_print(result)

                if not keep_running:
                    break

            except KeyboardInterrupt:
                break
            except Exception as e:
                error_result = {
                    "success": False,
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                }
                # [20260905_Fix_208_ProtocolStreamImmune]
                _protocol_print(error_result)

        logger.info("FunASR服务器退出")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--damo-root", type=str, default=None,
                        help="damo 模型根目录，例如 /Volumes/APFS/AI/models/damo")
    args = parser.parse_args()

    server = FunASRServer(damo_root=args.damo_root)
    server.run()