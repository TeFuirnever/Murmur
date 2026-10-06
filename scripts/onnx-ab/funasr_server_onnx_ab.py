#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20261001_Feat_416_OnnxAbVerdictServer] Ticket #416 (spec #412 T4): the
ONNX A/B verdict server.

Purpose: drive the T1 self-exported ONNX int8 artifacts
(scripts/onnx-export/work/artifacts, sha256-pinned by
scripts/onnx-export/model-pin.json) through funasr-onnx over the SAME
stdin/stdout JSON-lines protocol the torch production server speaks
(funasr_server.py), so scripts/asr-ab-harness.js scores both engines with
zero harness changes:

    node scripts/asr-ab-harness.js \\
        --engine onnx \\
        --server-script scripts/onnx-ab/funasr_server_onnx_ab.py \\
        --interpreter scripts/onnx-export/.venv/bin/python \\
        --report onnx.json --markdown onnx.md

This is the T4 VERDICT INSTRUMENT, not the production T5 server: no mic
streaming, no diarize, no unload/reload, no progress messages (the harness
ignores lines without a `success` boolean). What it MUST do is be fair:

  - pin gate: initialize() only runs when the artifacts hash-match the
    committed pin (strict set semantics via onnx_export_common.check_manifest
    — missing, tampered, or unlisted files all fail, spec #412 decision 8);
  - pipeline parity: DSP preprocessing, VAD-region merge/split/buffer
    constants, char-timestamp segment construction, punc application, and
    the display merge all mirror funasr_server.transcribe_file_audio
    verbatim, so the measured A/B delta is the ENGINE, not the plumbing;
  - quantization parity: the torch models read a PCM_16 temp wav (the DSP
    hop), so the ONNX engines are fed the same PCM_16-quantized samples
    instead of raw floats.

Stdlib-only at module level (funasr_onnx/numpy/soundfile import lazily) so
tests/python/test_funasr_server_onnx_ab.py can exercise it without the
ONNX stack.
"""

import argparse
import contextlib
import json
import logging
import os
import sys
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
EXPORT_SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts", "onnx-export")

for _path in (REPO_ROOT, EXPORT_SCRIPTS_DIR):
    if _path not in sys.path:
        sys.path.insert(0, _path)

# Reuse the production hotword sanitizer (tested contract in
# tests/python/test_funasr_server_protocol.py) — zero drift by construction.
from funasr_server import sanitize_hotword  # noqa: E402
from onnx_export_common import (  # noqa: E402
    FP32_ASR_RUNTIME_FILES,
    MODEL_SPECS,
    check_manifest,
)

DEFAULT_ARTIFACTS_DIR = os.path.join(EXPORT_SCRIPTS_DIR, "work", "artifacts")
DEFAULT_PIN_PATH = os.path.join(EXPORT_SCRIPTS_DIR, "model-pin.json")

# [20261006_Diag_444_Fp32AsrVariant] Ticket #444 (spec #412 T4b): the T4b
# root-cause diagnosis drives the SAME verdict instrument against an
# UNQUANTIZED ASR main graph (fp32 bb) to separate int8 quantization
# sensitivity from an export-path problem on hw_jedediah. VAD/punc stay
# int8 in both arms so the only variable is the ASR graph's precision.
# The fp32 variant dir + its standalone strict manifest are produced by
# scripts/onnx-export/stage_fp32_asr.py (work/ is gitignored). The harness
# cannot forward extra argv to the server (spawn shape is fixed), so the
# variant is ALSO selectable via env vars — env is the fallback, argv wins.
# The fp32 runtime file set (FP32_ASR_RUNTIME_FILES) lives in
# onnx_export_common, shared with the staging script.
DEFAULT_FP32_ARTIFACTS_DIR = os.path.join(EXPORT_SCRIPTS_DIR, "work", "artifacts-fp32")
DEFAULT_FP32_MANIFEST_PATH = os.path.join(DEFAULT_FP32_ARTIFACTS_DIR, "manifest.json")
ENV_ASR_VARIANT = "MURMUR_ONNX_ASR_VARIANT"
ENV_FP32_ARTIFACTS = "MURMUR_ONNX_FP32_ARTIFACTS"
ENV_FP32_MANIFEST = "MURMUR_ONNX_FP32_MANIFEST"

# The models this server loads. The speaker (campplus) model is NOT loaded:
# diarization is out of scope for the four-dimension A/B verdict (CER / punc
# / hotword / timestamp), and loading it would only inflate RSS.
AB_MODEL_KEYS = ("asr", "vad", "punc")

# [20261001_Feat_416_OnnxAbVerdictServer] Pipeline constants — copied
# verbatim from funasr_server.transcribe_file_audio / _merge_segments so
# both engines run the identical plumbing policy.
MERGE_GAP_MS = 300       # adjacent VAD segments closer than this merge
MAX_REGION_MS = 300_000  # regions longer than this split at VAD sub-bounds
BUFFER_MS = 200          # context added to each side of an ASR region
SAMPLE_RATE = 16000
SEGMENT_SENTENCE_END_CHARS = "。！？；\n"
SEGMENT_MAX_CHARS = 20   # raw segment split length (timestamp policy)
DISPLAY_MERGE_MAX_MS = 5000  # display-block split length

# Protocol output must be immune to any stdout redirection the engine libs
# perform: capture the host pipe once, at process start (mirrors
# funasr_server._PROTOCOL_STDOUT, issue #208).
_PROTOCOL_STDOUT = sys.stdout

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("onnx_ab_server")


def protocol_line(payload):
    """Serialize one protocol JSON line (shape mirrors _protocol_print)."""
    return json.dumps(payload, ensure_ascii=False) + "\n"


# [20261006_Diag_444_Fp32AsrVariant] Variant resolution: argv wins over env,
# env falls back to the staging defaults. Kept pure and injectable so the
# unittest suite can pin the precedence without touching os.environ.
def resolve_asr_variant(
    argv_variant=None,
    argv_fp32_artifacts=None,
    argv_fp32_manifest=None,
    env=None,
):
    if env is None:
        env = os.environ
    variant = argv_variant if argv_variant is not None else env.get(
        ENV_ASR_VARIANT, "int8"
    )
    if variant not in ("int8", "fp32"):
        raise ValueError(
            f"unknown ASR variant {variant!r}: expected int8 or fp32"
        )
    fp32_artifacts_dir = (
        argv_fp32_artifacts
        if argv_fp32_artifacts is not None
        else env.get(ENV_FP32_ARTIFACTS, DEFAULT_FP32_ARTIFACTS_DIR)
    )
    fp32_manifest_path = (
        argv_fp32_manifest
        if argv_fp32_manifest is not None
        else env.get(ENV_FP32_MANIFEST, DEFAULT_FP32_MANIFEST_PATH)
    )
    return {
        "variant": variant,
        "fp32_artifacts_dir": fp32_artifacts_dir,
        "fp32_manifest_path": fp32_manifest_path,
    }


def build_segments_from_timestamps(asr_text, asr_timestamps, time_offset_ms=0):
    """Split char-level timestamps into segments — verbatim policy of
    funasr_server._build_segments_from_timestamps (sentence-end char or
    SEGMENT_MAX_CHARS chars per segment), spaces stripped from the text."""
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
        if seg_text and (
            seg_text[-1] in SEGMENT_SENTENCE_END_CHARS
            or len(seg_text) >= SEGMENT_MAX_CHARS
        ):
            segs.append(
                {"start_ms": seg_start, "end_ms": seg_end, "text": seg_text}
            )
            seg_text = ""
            seg_start = (
                ts[1] + time_offset_ms
                if char_idx < len(asr_timestamps)
                else seg_end
            )
    if seg_text:
        segs.append({"start_ms": seg_start, "end_ms": seg_end, "text": seg_text})
    return segs


def compute_regions(vad_segments):
    """Merge adjacent/overlapping VAD segments into continuous speech
    regions, then split overlong regions at VAD sub-segment bounds —
    verbatim policy of funasr_server.transcribe_file_audio."""
    if not vad_segments:
        return []
    regions = []
    cur_start = vad_segments[0][0]
    cur_end = vad_segments[0][1]
    for vs, ve in vad_segments[1:]:
        if vs - cur_end < MERGE_GAP_MS:
            cur_end = max(cur_end, ve)
        else:
            regions.append([cur_start, cur_end])
            cur_start = vs
            cur_end = ve
    regions.append([cur_start, cur_end])

    split_regions = []
    for rs, re_ in regions:
        if re_ - rs <= MAX_REGION_MS:
            split_regions.append([rs, re_])
            continue
        sub_segs = [
            [vs, ve] for vs, ve in vad_segments if vs >= rs and ve <= re_
        ]
        chunk_start = sub_segs[0][0]
        chunk_end = sub_segs[0][1]
        for ss, se in sub_segs[1:]:
            if se - chunk_start > MAX_REGION_MS:
                split_regions.append([chunk_start, chunk_end])
                chunk_start = ss
                chunk_end = se
            else:
                chunk_end = se
        split_regions.append([chunk_start, chunk_end])
    return split_regions


def buffered_bounds(region_start_ms, region_end_ms, total_ms):
    """ASR region bounds with context buffers, clamped to the audio."""
    buf_start_ms = max(0, region_start_ms - BUFFER_MS)
    buf_end_ms = min(total_ms, region_end_ms + BUFFER_MS)
    return buf_start_ms, buf_end_ms


def merge_segments(raw_segments):
    """Display-policy merge — verbatim policy of funasr_server
    ._merge_segments (block ends at sentence punct or 5000ms)."""
    if not raw_segments:
        return []
    merged = []
    current = None
    for seg in raw_segments:
        if current is None:
            current = {
                "start_ms": seg["start_ms"],
                "end_ms": seg["end_ms"],
                "text": seg["text"],
            }
            continue
        text = current["text"]
        if (text and text[-1] in SEGMENT_SENTENCE_END_CHARS) or (
            current["end_ms"] - current["start_ms"]
        ) >= DISPLAY_MERGE_MAX_MS:
            merged.append(current)
            current = {
                "start_ms": seg["start_ms"],
                "end_ms": seg["end_ms"],
                "text": seg["text"],
            }
        else:
            current["text"] = text + seg["text"]
            current["end_ms"] = seg["end_ms"]
    if current:
        merged.append(current)
    return merged


class OnnxAbServer:
    """funasr-onnx engine speaking the production stdin/stdout protocol."""

    def __init__(
        self,
        artifacts_dir,
        pin,
        asr_variant="int8",
        fp32_artifacts_dir=None,
        fp32_manifest_path=None,
    ):
        self.artifacts_dir = artifacts_dir
        self.pin = pin
        # [20261006_Diag_444_Fp32AsrVariant] fp32 arm state (unused by the
        # default int8 arm — T4 behavior is byte-identical when untouched).
        self.asr_variant = asr_variant
        self.fp32_artifacts_dir = fp32_artifacts_dir
        self.fp32_manifest_path = fp32_manifest_path
        self.initialized = False
        self.asr_model = None
        self.vad_model = None
        self.punc_model = None

    # ------------------------------------------------------------------
    # Pin gate (trust chain: only the pinned exact file set may run)
    # ------------------------------------------------------------------
    def verify_pin(self):
        """Check asr/vad/punc artifact dirs against the pin's per-file
        sha256 manifests. In fp32 mode the ASR dir is instead checked
        against the fp32 variant's standalone strict manifest (the int8
        pin does not describe those bytes); VAD/punc remain pin-gated.
        Returns a list of problems ([] == verified)."""
        problems = []
        models = self.pin.get("models", {}) if isinstance(self.pin, dict) else {}
        for key in AB_MODEL_KEYS:
            if key == "asr" and self.asr_variant == "fp32":
                problems.extend(self.verify_fp32_asr())
                continue
            model = models.get(key)
            if not model or not isinstance(model.get("files"), list):
                problems.append(f"pin entry missing for model {key}")
                continue
            model_dir = os.path.join(self.artifacts_dir, model.get("name", ""))
            problems.extend(check_manifest(model_dir, model["files"]))
        return problems

    def verify_fp32_asr(self):
        """[20261006_Diag_444_Fp32AsrVariant] Strict verification of the
        fp32 ASR variant dir against its standalone manifest: exact file
        set (drift vs the quantize=False runtime set fails even when disk
        matches the manifest) + per-file sha256 + strict on-disk set."""
        problems = []
        manifest_path = self.fp32_manifest_path
        if not manifest_path or not os.path.isfile(manifest_path):
            return [
                f"fp32 manifest not found: {manifest_path} "
                "(run scripts/onnx-export/stage_fp32_asr.py first)"
            ]
        try:
            with open(manifest_path, encoding="utf-8") as f:
                manifest = json.load(f)
        except (OSError, ValueError) as e:
            return [f"fp32 manifest unreadable: {manifest_path}: {e}"]
        entries = manifest.get("models", {}).get("asr", {}).get("files")
        if not isinstance(entries, list):
            return [f"fp32 manifest has no asr files list: {manifest_path}"]
        model_dir = os.path.join(
            self.fp32_artifacts_dir, MODEL_SPECS["asr"]["name"]
        )
        problems.extend(check_manifest(model_dir, entries))
        listed = {entry.get("path") for entry in entries}
        expected = set(FP32_ASR_RUNTIME_FILES)
        if listed != expected:
            problems.append(
                f"fp32 manifest set drift: {sorted(listed)} != {sorted(expected)}"
            )
        return problems

    def asr_model_spec(self):
        """[20261006_Diag_444_Fp32AsrVariant] (dir, quantize) the ASR model
        must be constructed with for the active variant. Kept separate from
        initialize() so the wiring is unit-testable without funasr_onnx."""
        if self.asr_variant == "fp32":
            return (
                os.path.join(
                    self.fp32_artifacts_dir, MODEL_SPECS["asr"]["name"]
                ),
                False,
            )
        return (
            os.path.join(self.artifacts_dir, MODEL_SPECS["asr"]["name"]),
            True,
        )

    def initialize(self):
        if self.initialized:
            return {"success": True, "message": "模型已初始化"}
        problems = self.verify_pin()
        if problems:
            return {
                "success": False,
                "error": (
                    "ONNX 产物与 model-pin.json 不符（"
                    + "; ".join(problems[:5])
                    + "）"
                ),
                "type": "pin_verification_failed",
            }
        try:
            # Chatty third-party banners must never reach the protocol pipe.
            devnull = open(os.devnull, "w")
            try:
                with contextlib.redirect_stdout(devnull):
                    from funasr_onnx import CT_Transformer, Fsmn_vad, SeacoParaformer

                    # [20261006_Diag_444_Fp32AsrVariant] The variant only
                    # changes WHERE the ASR graph loads from and its
                    # quantize flag (fp32 reads model.onnx/model_eb.onnx,
                    # int8 reads model_quant.onnx/model_eb_quant.onnx —
                    # funasr_onnx paraformer_bin.ContextualParaformer).
                    asr_dir, asr_quantize = self.asr_model_spec()
                    self.asr_model = SeacoParaformer(
                        asr_dir,
                        quantize=asr_quantize,
                    )
                    self.vad_model = Fsmn_vad(
                        os.path.join(
                            self.artifacts_dir, MODEL_SPECS["vad"]["name"]
                        ),
                        quantize=True,
                    )
                    self.punc_model = CT_Transformer(
                        os.path.join(
                            self.artifacts_dir, MODEL_SPECS["punc"]["name"]
                        ),
                        quantize=True,
                    )
            finally:
                devnull.close()
        except ImportError as e:
            return {
                "success": False,
                "error": f"funasr_onnx 未安装: {e}",
                "type": "import_error",
            }
        except Exception as e:
            logger.error("ONNX 模型初始化失败: %s\n%s", e, traceback.format_exc())
            return {
                "success": False,
                "error": f"ONNX 模型初始化失败: {e}",
                "type": "init_error",
            }
        self.initialized = True
        return {
            "success": True,
            "message": (
                "ONNX A/B 服务器模型初始化成功 "
                f"(asr={self.asr_variant})"
            ),
            "punc_loaded": self.punc_model is not None,
        }

    # ------------------------------------------------------------------
    # transcribe_file — mirrors funasr_server.transcribe_file_audio
    # ------------------------------------------------------------------
    def transcribe_file(self, audio_path, options=None):
        if options is None:
            options = {}
        request_id = options.get("request_id", "")
        hotword = sanitize_hotword(options.get("hotword", ""))
        if not self.initialized:
            return {
                "success": False,
                "error": "模型未初始化",
                "type": "init_error",
                "request_id": request_id,
            }
        try:
            if not os.path.isfile(audio_path):
                return {
                    "success": False,
                    "error": f"文件不存在: {audio_path}",
                    "request_id": request_id,
                }

            import numpy as np
            import soundfile as sf

            samples, samplerate = sf.read(
                audio_path, dtype="float32", always_2d=False
            )
            samples = np.asarray(samples, dtype=np.float32)
            if int(samplerate) != SAMPLE_RATE:
                raise ValueError(
                    f"期望 {SAMPLE_RATE}Hz 音频, 实际 {int(samplerate)}Hz"
                )
            if samples.ndim != 1:
                raise ValueError("期望单声道音频, 实际多声道")
            duration = len(samples) / float(samplerate)

            # DSP parity: same preprocessing module the torch server applies
            # (80Hz HPF + segmented RMS normalization); ValueError (illegal
            # non-finite input) propagates to the error result, same policy.
            import audio_preprocessing

            processed = audio_preprocessing.preprocess_audio(samples, SAMPLE_RATE)

            # Quantization parity: the torch engines read the DSP output as a
            # PCM_16 temp wav, so feed the ONNX engines the same quantized
            # samples rather than raw floats.
            quantized = self._pcm16_roundtrip(processed)
            total_ms = int(duration * 1000)

            vad_result = self.vad_model(quantized)
            vad_segments = vad_result[0] if vad_result else []
            logger.info(
                "VAD done: %d segments, %.2fs audio", len(vad_segments), duration
            )

            raw_text = ""
            raw_segments = []
            regions = compute_regions(vad_segments)
            if regions:
                for region_start, region_end in regions:
                    buf_start_ms, buf_end_ms = buffered_bounds(
                        region_start, region_end, total_ms
                    )
                    start_frame = int(buf_start_ms / 1000.0 * SAMPLE_RATE)
                    end_frame = min(
                        len(quantized), int(buf_end_ms / 1000.0 * SAMPLE_RATE)
                    )
                    chunk = quantized[max(0, start_frame):end_frame]
                    asr_result = self.asr_model(chunk, hotword)
                    if not asr_result:
                        continue
                    preds = asr_result[0].get("preds", "")
                    if preds:
                        raw_text += preds
                    timestamps = asr_result[0].get("timestamp")
                    if timestamps and preds:
                        raw_segments.extend(
                            build_segments_from_timestamps(
                                preds, timestamps, time_offset_ms=buf_start_ms
                            )
                        )
                    elif preds:
                        raw_segments.append(
                            {
                                "start_ms": region_start,
                                "end_ms": region_end,
                                "text": preds,
                            }
                        )
            else:
                asr_result = self.asr_model(quantized, hotword)
                if asr_result:
                    raw_text = asr_result[0].get("preds", "")
                    timestamps = asr_result[0].get("timestamp")
                    if timestamps and raw_text:
                        raw_segments = build_segments_from_timestamps(
                            raw_text, timestamps
                        )

            text = raw_text
            if self.punc_model and text:
                # funasr_onnx CT_Transformer returns (text, punc_ids).
                punc_text, _ = self.punc_model(text)
                if punc_text:
                    text = punc_text

            # Success payload mirrors the torch server's key set exactly
            # (request_id is attached by the read loop / error paths only).
            return {
                "success": True,
                "text": text,
                "raw_text": raw_text,
                "segments": merge_segments(raw_segments),
                "raw_segments": raw_segments,
                "duration": duration,
                "confidence": 0.9,
                "language": "zh-CN",
            }
        except Exception as e:
            logger.error("transcribe_file 异常: %s\n%s", e, traceback.format_exc())
            return {
                "success": False,
                "error": str(e),
                "request_id": request_id,
            }

    @staticmethod
    def _pcm16_roundtrip(samples):
        """float32 -> PCM_16 wav -> float32 (the torch server's temp-wav hop;
        soundfile applies the identical int16 <-> [-1,1) scaling both ways)."""
        import soundfile as sf

        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, prefix="murmur_onnx_ab_", dir=tempfile.gettempdir()
        )
        tmp_path = tmp.name
        tmp.close()
        try:
            sf.write(tmp_path, samples, SAMPLE_RATE, subtype="PCM_16")
            quantized, _ = sf.read(tmp_path, dtype="float32", always_2d=False)
            return quantized
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # Protocol dispatch + read loop
    # ------------------------------------------------------------------
    def handle_command(self, command):
        """-> (result, keep_running); mirrors funasr_server.handle_command
        for the subset the A/B harness drives (synchronous: no queue)."""
        action = command.get("action")
        if action == "transcribe_file":
            return (
                self.transcribe_file(
                    command.get("audio_path"), command.get("options", {})
                ),
                True,
            )
        if action == "ping":
            return {"success": True, "action": "pong"}, True
        if action == "exit":
            return {"success": True, "message": "服务器退出"}, False
        return {"success": False, "error": f"未知命令: {action}"}, True

    def run(self):
        init_result = self.initialize()
        _PROTOCOL_STDOUT.write(protocol_line(init_result))
        _PROTOCOL_STDOUT.flush()
        if not init_result["success"]:
            return 1
        while True:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                command = json.loads(line)
                request_id = command.get("request_id", "")
                result, keep_running = self.handle_command(command)
                if result is not None:
                    if request_id:
                        result["request_id"] = request_id
                    _PROTOCOL_STDOUT.write(protocol_line(result))
                    _PROTOCOL_STDOUT.flush()
                if not keep_running:
                    break
            except KeyboardInterrupt:
                break
            except Exception as e:
                _PROTOCOL_STDOUT.write(
                    protocol_line(
                        {
                            "success": False,
                            "error": str(e),
                            "traceback": traceback.format_exc(),
                        }
                    )
                )
                _PROTOCOL_STDOUT.flush()
        return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", default=DEFAULT_ARTIFACTS_DIR)
    parser.add_argument("--pin", default=DEFAULT_PIN_PATH)
    # [20261006_Diag_444_Fp32AsrVariant] fp32 ASR variant (ticket #444):
    # defaults come from env when the flag is absent — the A/B harness
    # spawns the server with a fixed argv and can only pass env through.
    parser.add_argument(
        "--asr-variant",
        default=None,
        choices=("int8", "fp32"),
        help="ASR graph precision arm (default: MURMUR_ONNX_ASR_VARIANT or int8)",
    )
    parser.add_argument(
        "--fp32-artifacts",
        default=None,
        help="fp32 variant artifact root "
        f"(default: {ENV_FP32_ARTIFACTS} or {DEFAULT_FP32_ARTIFACTS_DIR})",
    )
    parser.add_argument(
        "--fp32-manifest",
        default=None,
        help="fp32 variant strict manifest "
        f"(default: {ENV_FP32_MANIFEST} or {DEFAULT_FP32_MANIFEST_PATH})",
    )
    # Accepted for argv compatibility with the harness (it forwards
    # --damo-root when DAMO_ROOT is set); the ONNX stack ignores it —
    # artifacts come exclusively from the pin at --artifacts.
    parser.add_argument("--damo-root", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    resolved = resolve_asr_variant(
        argv_variant=args.asr_variant,
        argv_fp32_artifacts=args.fp32_artifacts,
        argv_fp32_manifest=args.fp32_manifest,
    )

    with open(args.pin, encoding="utf-8") as f:
        pin = json.load(f)
    server = OnnxAbServer(
        args.artifacts,
        pin,
        asr_variant=resolved["variant"],
        fp32_artifacts_dir=resolved["fp32_artifacts_dir"],
        fp32_manifest_path=resolved["fp32_manifest_path"],
    )
    return server.run()


if __name__ == "__main__":
    sys.exit(main())
