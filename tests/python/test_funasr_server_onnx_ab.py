# [20261001_Feat_416_OnnxAbVerdictServer] Ticket #416 (spec #412 T4): unit
# tests for the ONNX A/B verdict server (scripts/onnx-ab/
# funasr_server_onnx_ab.py). The server exists ONLY to run the T4 verdict:
# it drives the T1 self-exported ONNX int8 artifacts through funasr-onnx
# over the SAME stdin/stdout JSON-lines protocol as the torch production
# server (funasr_server.py), so scripts/asr-ab-harness.js scores both
# engines identically.
#
# What these tests pin (the A/B fairness contract):
#   1. pin verification — the server only initializes against the exact
#      pinned file set (sha256, strict set semantics via
#      onnx_export_common.check_manifest);
#   2. pipeline-policy parity — segment construction, VAD-region merge /
#      split / buffer, and display-merge constants mirror
#      funasr_server.transcribe_file_audio verbatim, so the measured delta
#      is the ENGINE, not the plumbing;
#   3. protocol parity — response schema (text/raw_text/segments/
#      raw_segments), request_id echo, hotword forwarding (through the
#      production sanitize_hotword), and PCM_16 quantization parity with
#      the torch server's temp-wav hop;
#   4. dispatch parity for the actions the harness exercises.
#
# Runs on stdlib unittest + numpy + soundfile (all present in the embedded
# python and the CI runner) — funasr_onnx/onnxruntime are NEVER imported
# here: engines are stubbed.
import importlib.util
import json
import math
import os
import struct
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
SERVER_PATH = os.path.join(
    REPO_ROOT, "scripts", "onnx-ab", "funasr_server_onnx_ab.py"
)
EXPORT_SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts", "onnx-export")

sys.path.insert(0, REPO_ROOT)
sys.path.insert(0, EXPORT_SCRIPTS_DIR)
os.environ.setdefault("MURMUR_DEVICE", "cpu")

import onnx_export_common  # noqa: E402


def load_server_module():
    spec = importlib.util.spec_from_file_location(
        "funasr_server_onnx_ab", SERVER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_test_wav(path, seconds=1.0, sample_rate=16000):
    """Stdlib-only 16k mono s16 wav with a 220Hz tone (speech stand-in)."""
    import wave

    frames = int(seconds * sample_rate)
    with wave.open(path, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        payload = bytearray()
        for i in range(frames):
            value = int(0.5 * 32767 * math.sin(2 * math.pi * 220 * i / sample_rate))
            payload += struct.pack("<h", value)
        writer.writeframes(bytes(payload))


class StubAsr:
    """funasr_onnx SeacoParaformer stand-in: __call__(ndarray, hotwords)."""

    def __init__(self, preds, timestamps=None):
        self.preds = preds
        self.timestamps = timestamps
        self.calls = []

    def __call__(self, audio, hotwords):
        self.calls.append({"samples": len(audio), "hotword": hotwords})
        result = {"preds": self.preds}
        if self.timestamps is not None:
            result["timestamp"] = self.timestamps
        return [result]


class StubVad:
    """funasr_onnx Fsmn_vad stand-in: __call__(ndarray) -> [[start,end]...]."""

    def __init__(self, segments):
        self.segments = segments
        self.calls = 0

    def __call__(self, audio):
        self.calls += 1
        return [self.segments]


class StubPunc:
    """funasr_onnx CT_Transformer stand-in: __call__(text) -> (text, ids)."""

    def __init__(self, output):
        self.output = output
        self.calls = []

    def __call__(self, text):
        self.calls.append(text)
        return self.output, []


def make_server_with_stubs(module, tmpdir, asr, vad, punc):
    """OnnxAbServer with pin verification satisfied and stub engines set.

    The pin tree is fabricated from the REAL file set (MODEL_SPECS), so
    verify_pin() passes without the 640MB artifacts.
    """
    artifacts_dir = os.path.join(tmpdir, "artifacts")
    pin = {"schema_version": 1, "models": {}}
    for key in ("asr", "vad", "punc"):
        spec = onnx_export_common.MODEL_SPECS[key]
        model_dir = os.path.join(artifacts_dir, spec["name"])
        os.makedirs(model_dir, exist_ok=True)
        files = []
        for rel in spec["runtime_files"]:
            full = os.path.join(model_dir, rel)
            with open(full, "wb") as f:
                f.write(b"stub-bytes-" + rel.encode("utf-8"))
            files.append(
                {
                    "path": rel,
                    "sha256": onnx_export_common.sha256_file(full),
                    "size_bytes": os.path.getsize(full),
                }
            )
        pin["models"][key] = {"name": spec["name"], "files": files}
    server = module.OnnxAbServer(artifacts_dir, pin)
    server.initialized = True  # bypass initialize() (would import funasr_onnx)
    server.asr_model = asr
    server.vad_model = vad
    server.punc_model = punc
    return server


class PinVerificationTest(unittest.TestCase):
    """The ready gate only accepts the pinned precise file set."""

    def setUp(self):
        self.module = load_server_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_exact_pin_verifies_clean(self):
        server = make_server_with_stubs(
            self.module, self.tmp.name, StubAsr("你 好"), StubVad([]), StubPunc("x")
        )
        self.assertEqual(server.verify_pin(), [])

    def test_tampered_file_fails_with_sha256_mismatch(self):
        server = make_server_with_stubs(
            self.module, self.tmp.name, StubAsr("你 好"), StubVad([]), StubPunc("x")
        )
        spec = onnx_export_common.MODEL_SPECS["asr"]
        target = os.path.join(
            server.artifacts_dir, spec["name"], "config.yaml"
        )
        with open(target, "ab") as f:
            f.write(b"tampered")
        problems = server.verify_pin()
        self.assertTrue(any("sha256 mismatch" in p for p in problems))

    def test_missing_file_fails(self):
        server = make_server_with_stubs(
            self.module, self.tmp.name, StubAsr("你 好"), StubVad([]), StubPunc("x")
        )
        spec = onnx_export_common.MODEL_SPECS["vad"]
        os.unlink(
            os.path.join(server.artifacts_dir, spec["name"], "am.mvn")
        )
        problems = server.verify_pin()
        self.assertTrue(any("missing file" in p for p in problems))

    def test_unlisted_extra_file_fails(self):
        server = make_server_with_stubs(
            self.module, self.tmp.name, StubAsr("你 好"), StubVad([]), StubPunc("x")
        )
        spec = onnx_export_common.MODEL_SPECS["punc"]
        stray = os.path.join(
            server.artifacts_dir, spec["name"], "model.onnx.tmp-download"
        )
        with open(stray, "wb") as f:
            f.write(b"stray")
        problems = server.verify_pin()
        self.assertTrue(any("not in manifest" in p for p in problems))

    def test_initialize_reports_pin_failure_without_loading(self):
        server = make_server_with_stubs(
            self.module, self.tmp.name, StubAsr("你 好"), StubVad([]), StubPunc("x")
        )
        server.initialized = False
        spec = onnx_export_common.MODEL_SPECS["asr"]
        os.unlink(
            os.path.join(server.artifacts_dir, spec["name"], "tokens.json")
        )
        result = server.initialize()
        self.assertFalse(result["success"])
        self.assertEqual(result["type"], "pin_verification_failed")
        self.assertIn("missing file", result["error"])


class TorchPolicyParityTest(unittest.TestCase):
    """Segment/region policies mirror funasr_server.py verbatim."""

    def setUp(self):
        self.module = load_server_module()

    def test_short_text_single_segment_with_offset(self):
        text = "今 天 我 们 讨 论 路 线 图"  # token-space form, 9 tokens
        stamps = [[100 * (i + 1), 100 * (i + 1) + 90] for i in range(9)]
        segs = self.module.build_segments_from_timestamps(
            text, stamps, time_offset_ms=5000
        )
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0]["text"], "今天我们讨论路线图")
        self.assertEqual(segs[0]["start_ms"], 100 + 5000)
        self.assertEqual(segs[0]["end_ms"], stamps[-1][1] + 5000)

    def test_twenty_char_split_policy(self):
        text = "".join(f"字{i:02d} " for i in range(25))  # 25 tokens w/ spaces
        stamps = [[10 * (i + 1), 10 * (i + 1) + 9] for i in range(25)]
        segs = self.module.build_segments_from_timestamps(text, stamps)
        # torch policy: split when len(seg_text) >= 20 -> 20 + 5
        self.assertEqual([len(s["text"]) for s in segs], [20, 5])
        self.assertEqual(segs[1]["start_ms"], segs[0]["end_ms"])

    def test_vad_region_merge_gap_boundaries(self):
        # gap 299ms (< MERGE_GAP_MS) merges
        self.assertEqual(
            self.module.compute_regions([[0, 1000], [1299, 2000]]),
            [[0, 2000]],
        )
        # gap 300ms does NOT merge (torch: vs - cur_end < 300)
        self.assertEqual(
            self.module.compute_regions([[0, 1000], [1300, 2000]]),
            [[0, 1000], [1300, 2000]],
        )

    def test_overlong_region_splits_at_vad_subsegments(self):
        vad = [[0, 200000], [200000, 400000]]
        regions = self.module.compute_regions(vad)
        self.assertEqual(regions, [[0, 200000], [200000, 400000]])

    def test_buffer_clamps_to_audio_bounds(self):
        self.assertEqual(
            self.module.buffered_bounds(100, 3000, 5000), (0, 3200)
        )
        self.assertEqual(
            self.module.buffered_bounds(4800, 5600, 5000), (4600, 5000)
        )

    def test_display_merge_policy(self):
        raw = [
            {"start_ms": 0, "end_ms": 900, "text": "第一句"},
            {"start_ms": 1000, "end_ms": 1900, "text": "第二句"},
            {"start_ms": 2000, "end_ms": 2900, "text": "第三句"},
        ]
        merged = self.module.merge_segments(raw)
        # none ends with sentence punct, all < 5000ms -> single block
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["text"], "第一句第二句第三句")
        self.assertEqual(merged[0]["start_ms"], 0)
        self.assertEqual(merged[0]["end_ms"], 2900)

    def test_display_merge_breaks_after_sentence_punct(self):
        raw = [
            {"start_ms": 0, "end_ms": 900, "text": "第一句。"},
            {"start_ms": 1000, "end_ms": 1900, "text": "第二句"},
        ]
        merged = self.module.merge_segments(raw)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[1]["text"], "第二句")


class TranscribeFileContractTest(unittest.TestCase):
    """Protocol + pipeline behavior over a real wav with stub engines."""

    def setUp(self):
        self.module = load_server_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.wav = os.path.join(self.tmp.name, "probe.wav")
        write_test_wav(self.wav, seconds=1.0)

    def _server(self, asr, vad, punc):
        return make_server_with_stubs(self.module, self.tmp.name, asr, vad, punc)

    def test_response_schema_and_punc_application(self):
        stamps = [[100 * (i + 1), 100 * (i + 1) + 90] for i in range(4)]
        asr = StubAsr("你 好 世 界", stamps)
        vad = StubVad([[100, 3000]])
        punc = StubPunc("你好，世界。")
        server = self._server(asr, vad, punc)
        result = server.transcribe_file(
            self.wav,
            {"request_id": "req-1", "hotword": "张晗玥"},
        )
        self.assertTrue(result["success"])
        # Torch-parity: the success payload carries no request_id (the read
        # loop attaches command-level ids; the harness falls back to plan
        # order when absent — same as the torch baseline runs).
        self.assertNotIn("request_id", result)
        self.assertEqual(result["text"], "你好，世界。")
        self.assertEqual(result["raw_text"], "你 好 世 界")
        self.assertEqual(result["language"], "zh-CN")
        self.assertIsInstance(result["duration"], float)
        # raw_segments built from timestamps with the buffered offset
        # (region start 100 - BUFFER_MS 200 -> clamped to 0)
        self.assertEqual(len(result["raw_segments"]), 1)
        self.assertEqual(result["raw_segments"][0]["text"], "你好世界")
        self.assertEqual(result["raw_segments"][0]["start_ms"], 100)
        # punc consumed the raw (token-space) form, torch-side parity
        self.assertEqual(punc.calls, ["你 好 世 界"])
        # hotword forwarded to the engine
        self.assertEqual(asr.calls[0]["hotword"], "张晗玥")
        # VAD ran once on the full (DSP'd, quantized) waveform: 1s @16k
        self.assertEqual(asr.calls[0]["samples"], 16000)

    def test_pcm16_quantization_parity(self):
        """The torch server's models read a PCM_16 temp wav; ours must feed
        the same quantized samples, so the engine delta is not polluted by
        float-vs-int16 loudness differences."""

        class QuantizationProbe(StubAsr):
            def __init__(self):
                super().__init__("")
                self.max_residual = None

            def __call__(self, audio, hotwords):
                import numpy as np

                scaled = np.asarray(audio, dtype=np.float64) * 32768.0
                residual = np.abs(scaled - np.round(scaled))
                self.max_residual = float(residual.max()) if len(residual) else 0.0
                return super().__call__(audio, hotwords)

        probe = QuantizationProbe()
        server = self._server(probe, StubVad([[0, 1000]]), None)
        server.transcribe_file(self.wav, {})
        self.assertIsNotNone(probe.max_residual)
        self.assertLess(probe.max_residual, 0.01)

    def test_empty_vad_falls_back_to_full_file_inference(self):
        asr = StubAsr("静 音")
        server = self._server(asr, StubVad([]), None)
        result = server.transcribe_file(self.wav, {"request_id": "r2"})
        self.assertTrue(result["success"])
        self.assertEqual(result["text"], "静 音")  # no punc model -> raw passthrough
        self.assertEqual(len(asr.calls), 1)
        self.assertEqual(asr.calls[0]["samples"], 16000)

    def test_hotword_sanitized_through_production_helper(self):
        asr = StubAsr("无 关")
        server = self._server(asr, StubVad([[0, 1000]]), None)
        server.transcribe_file(self.wav, {"hotword": 12345})
        self.assertEqual(asr.calls[0]["hotword"], "")

    def test_missing_file_is_a_protocol_error_not_a_crash(self):
        server = self._server(StubAsr("x"), StubVad([[0, 1000]]), None)
        result = server.transcribe_file(
            os.path.join(self.tmp.name, "nope.wav"), {"request_id": "r3"}
        )
        self.assertFalse(result["success"])
        self.assertEqual(result["request_id"], "r3")
        self.assertIn("文件不存在", result["error"])

    def test_wrong_sample_rate_is_rejected_explicitly(self):
        odd = os.path.join(self.tmp.name, "8k.wav")
        write_test_wav(odd, seconds=0.5, sample_rate=8000)
        server = self._server(StubAsr("x"), StubVad([[0, 500]]), None)
        result = server.transcribe_file(odd, {})
        self.assertFalse(result["success"])
        self.assertIn("16000", result["error"])


class DispatchTest(unittest.TestCase):
    """handle_command parity for the actions the harness drives."""

    def setUp(self):
        self.module = load_server_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.server = make_server_with_stubs(
            self.module,
            self.tmp.name,
            StubAsr("你 好"),
            StubVad([[0, 1000]]),
            None,
        )
        self.wav = os.path.join(self.tmp.name, "probe.wav")
        write_test_wav(self.wav, seconds=0.2)

    def test_transcribe_file_dispatches_synchronously(self):
        result, keep = self.server.handle_command(
            {
                "action": "transcribe_file",
                "request_id": "req-9",
                "audio_path": self.wav,
                "options": {"hotword": "龚燊"},
            }
        )
        self.assertTrue(keep)
        self.assertTrue(result["success"])
        # Torch contract (tests/python/test_funasr_server_protocol.py):
        # request_id attach is the READ LOOP's job, not the dispatcher's —
        # the harness sends request_id at command level and matches on it.
        self.assertNotIn("request_id", result)

    def test_read_loop_attaches_command_level_request_id(self):
        import io

        original_stdin = sys.stdin
        original_protocol_stdout = self.module._PROTOCOL_STDOUT
        captured = io.StringIO()
        self.module._PROTOCOL_STDOUT = captured
        command = json.dumps(
            {
                "action": "transcribe_file",
                "request_id": "hw_zhanghanyue#hotword",
                "audio_path": self.wav,
                "options": {"hotword": "张晗玥"},
            }
        )
        sys.stdin = io.StringIO(command + "\n" + json.dumps({"action": "exit"}) + "\n")
        try:
            self.server.run()
        finally:
            sys.stdin = original_stdin
            self.module._PROTOCOL_STDOUT = original_protocol_stdout
        lines = [
            json.loads(line)
            for line in captured.getvalue().splitlines()
            if line.strip()
        ]
        # init handshake -> transcribe result (request_id attached by the
        # read loop) -> exit ack, one JSON line each.
        self.assertEqual(len(lines), 3)
        self.assertTrue(lines[0]["success"])
        self.assertNotIn("request_id", lines[0])
        self.assertTrue(lines[1]["success"])
        self.assertEqual(lines[1]["request_id"], "hw_zhanghanyue#hotword")
        self.assertIn("raw_segments", lines[1])
        self.assertTrue(lines[2]["success"])

    def test_ping_pong(self):
        result, keep = self.server.handle_command({"action": "ping"})
        self.assertTrue(keep)
        self.assertEqual(result, {"success": True, "action": "pong"})

    def test_exit_stops(self):
        result, keep = self.server.handle_command({"action": "exit"})
        self.assertFalse(keep)
        self.assertTrue(result["success"])

    def test_unknown_action_rejected(self):
        result, keep = self.server.handle_command({"action": "nope"})
        self.assertTrue(keep)
        self.assertFalse(result["success"])
        self.assertIn("未知命令", result["error"])

    def test_protocol_line_roundtrip_shape(self):
        line = self.module.protocol_line({"success": True, "text": "你好"})
        parsed = json.loads(line)
        self.assertEqual(parsed["text"], "你好")
        self.assertTrue(line.endswith("\n"))


if __name__ == "__main__":
    unittest.main()
