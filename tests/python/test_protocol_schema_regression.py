# [20261006_Test_421_ProtocolSchema] Ticket #421 (spec #412 S1 seam): the
# protocol schema REGRESSION lock. The stdin/stdout JSON contract is the
# decoupling seam of the whole ONNX migration (spec decision 1: "byte-level
# unchanged") — the TS host (src/helpers/funasrServer.ts) and every resource
# gate drive this surface, so any field-set or timestamp-structure drift must
# fail HERE, at test time, not in a released build.
#
# What is locked (field SETS, not prose — exact key sets on success payloads;
# timestamp-bearing structures pinned to {start_ms, end_ms, text} with typed,
# ordered values):
#   1. transcribe_file_audio success result: {success, text, raw_text,
#      segments, raw_segments, duration, confidence, language}
#   2. transcribe_audio (mic) success result: {success, text, raw_text,
#      confidence, duration, language, model_type} with model_type "onnx"
#   3. every segment/raw_segment item: exactly {start_ms, end_ms, text},
#      int ms timestamps, start <= end, start_ms non-decreasing
#   4. initialize() success: {success, message, punc_loaded}; the
#      models_not_downloaded startup shape: {success, error, type}
#   5. read-loop response payload shapes: ping/exit/cleanup/unknown
#   6. queued-result wrapper from _inference_worker: +request_id, type
#      "result"; progress messages: {request_id, type, phase, message,
#      progress_pct[, total_ms]}
#
# Runs on stdlib unittest + numpy + soundfile (CI supplies all three);
# funasr_onnx/onnxruntime are NEVER imported — engines are stubbed via
# sys.modules, mirroring test_asr_region_chunking.py / test_onnx_engine_switch.py.
import contextlib
import os
import queue
import shutil
import sys
import tempfile
import types
import unittest
import wave

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
sys.path.insert(0, REPO_ROOT)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

import funasr_server  # noqa: E402
from funasr_server import (  # noqa: E402
    ONNX_MODEL_DIR_NAMES,
    FunASRServer,
)

# Locked field sets (the contract the TS host parses — see
# TranscriptionFileResult / ServerCommandResult in funasrServer.ts).
FILE_RESULT_FIELDS = {
    "success",
    "text",
    "raw_text",
    "segments",
    "raw_segments",
    "duration",
    "confidence",
    "language",
}
MIC_RESULT_FIELDS = {
    "success",
    "text",
    "raw_text",
    "confidence",
    "duration",
    "language",
    "model_type",
}
SEGMENT_FIELDS = {"start_ms", "end_ms", "text"}
INIT_SUCCESS_FIELDS = {"success", "message", "punc_loaded"}
INIT_FAILURE_FIELDS = {"success", "error", "type"}
PROGRESS_BASE_FIELDS = {"request_id", "type", "phase", "message", "progress_pct"}
WORKER_RESULT_WRAPPER_FIELDS = FILE_RESULT_FIELDS | {"request_id", "type"}
WORKER_ERROR_FIELDS = {"request_id", "type", "success", "error"}
CANCELED_FIELDS = {"success", "canceled", "error", "request_id"}


def write_test_wav(path, seconds=1.0, sample_rate=16000):
    """Stdlib-only 16k mono s16 wav with a 220Hz tone (speech stand-in)."""
    import math
    import struct

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


class SequencedSeaco:
    """funasr_onnx.SeacoParaformer stand-in: one char per second with
    per-char ms timestamps relative to the chunk start (the real engine's
    contract; see test_asr_region_chunking.py)."""

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        pass

    def __call__(self, samples, hotwords="", **kwargs):
        seconds = max(1, -(-len(samples) // 16000))
        return [
            {
                "preds": "甲" * seconds,
                "timestamp": [
                    [j * 1000, j * 1000 + 500] for j in range(seconds)
                ],
            }
        ]


class FakeFsmn:
    """funasr_onnx.Fsmn_vad stand-in: one configurable segment list."""

    segments = [[0, 1000]]

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        pass

    def __call__(self, samples, **kwargs):
        return [list(FakeFsmn.segments)]


class FakeCt:
    """funasr_onnx.CT_Transformer stand-in: echoes text with a period."""

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        pass

    def __call__(self, text, split_size=20):
        return (text + "。", None)


class NeverAutoModel:
    def __init__(self, *args, **kwargs):
        raise AssertionError("torch AutoModel must not be called")


@contextlib.contextmanager
def fake_module(name, **attrs):
    module = types.ModuleType(name)
    for attr, value in attrs.items():
        setattr(module, attr, value)
    saved = sys.modules.get(name)
    sys.modules[name] = module
    try:
        yield module
    finally:
        if saved is not None:
            sys.modules[name] = saved
        else:
            sys.modules.pop(name, None)


def assert_valid_segment_list(testcase, segments, *, total_ms=None):
    """The timestamp-structure half of the lock: every segment carries
    exactly {start_ms, end_ms, text}; ms ints; start <= end; starts are
    non-decreasing and (when the audio length is known) inside the file."""
    testcase.assertGreater(len(segments), 0)
    previous_start = -1
    for seg in segments:
        testcase.assertEqual(set(seg.keys()), SEGMENT_FIELDS, seg)
        testcase.assertIsInstance(seg["start_ms"], int)
        testcase.assertIsInstance(seg["end_ms"], int)
        testcase.assertIsInstance(seg["text"], str)
        testcase.assertGreaterEqual(seg["start_ms"], 0)
        testcase.assertGreaterEqual(seg["end_ms"], seg["start_ms"], seg)
        if total_ms is not None:
            testcase.assertLessEqual(seg["end_ms"], total_ms, seg)
        testcase.assertGreaterEqual(seg["start_ms"], previous_start)
        previous_start = seg["start_ms"]


class SchemaRegressionBase(unittest.TestCase):
    """Shared env/dir scaffolding (mirrors test_asr_region_chunking.py)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_env = {
            key: os.environ.get(key)
            for key in (
                "MODELSCOPE_CACHE",
                "HOME",
                "USERPROFILE",
                "ELECTRON_USER_DATA",
            )
        }
        os.environ["HOME"] = self._tmp.name
        os.environ["USERPROFILE"] = self._tmp.name
        for key in ("MODELSCOPE_CACHE", "ELECTRON_USER_DATA"):
            os.environ.pop(key, None)
        self.damo_root = os.path.join(self._tmp.name, "damo-root")
        os.makedirs(self.damo_root, exist_ok=True)
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _make_onnx_dir(self, model_key):
        spec = funasr_server.ONNX_PIN_FILE_SPECS[model_key]
        dir_path = os.path.join(
            self.damo_root, "onnx-int8", ONNX_MODEL_DIR_NAMES[model_key]
        )
        os.makedirs(dir_path, exist_ok=True)
        self.addCleanup(shutil.rmtree, dir_path, ignore_errors=True)
        for name, size in spec.items():
            with open(os.path.join(dir_path, name), "wb") as f:
                f.truncate(size)
        return dir_path

    def _load_onnx_models(self, srv, with_punc=True):
        self._make_onnx_dir("asr")
        self._make_onnx_dir("vad")
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", SeacoParaformer=SequencedSeaco
        ):
            self.assertTrue(srv._load_asr_model())
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", Fsmn_vad=FakeFsmn
        ):
            self.assertTrue(srv._load_vad_model())
        if with_punc:
            self._make_onnx_dir("punc")
            with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
                "funasr_onnx", CT_Transformer=FakeCt
            ):
                self.assertTrue(srv._load_punc_model())
        srv.initialized = True

    def _make_server(self, with_punc=True):
        srv = FunASRServer(damo_root=self.damo_root)
        self._load_onnx_models(srv, with_punc=with_punc)
        srv.response_queue = queue.Queue()
        return srv

    def _make_wav(self, seconds=1.0):
        wav_path = os.path.join(self._tmp.name, f"in-{seconds}s.wav")
        write_test_wav(wav_path, seconds=seconds)
        self.addCleanup(
            lambda: os.path.exists(wav_path) and os.unlink(wav_path)
        )
        return wav_path


class FileTranscriptionSchemaTest(SchemaRegressionBase):
    """transcribe_file_audio success schema (the transcribe_file IPC arm)."""

    def test_success_result_field_set_and_timestamps(self):
        srv = self._make_server()
        wav_path = self._make_wav(seconds=1.0)
        FakeFsmn.segments = [[0, 1000]]

        result = srv.transcribe_file_audio(wav_path, {"request_id": "schema-1"})

        self.assertTrue(result["success"], result)
        self.assertEqual(set(result.keys()), FILE_RESULT_FIELDS, sorted(result))
        self.assertEqual(result["language"], "zh-CN")
        self.assertIsInstance(result["duration"], float)
        self.assertIsInstance(result["confidence"], (int, float))
        self.assertIsInstance(result["text"], str)
        self.assertIsInstance(result["raw_text"], str)
        # Timestamp structure on BOTH segment lists — the editor UI and the
        # resource gates consume these; extra/missing keys break them.
        for key in ("segments", "raw_segments"):
            assert_valid_segment_list(self, result[key], total_ms=1000)

    def test_worker_wrapper_adds_request_id_and_type(self):
        srv = self._make_server()
        wav_path = self._make_wav(seconds=1.0)
        FakeFsmn.segments = [[0, 1000]]
        srv.request_queue.put(
            {
                "request_id": "schema-2",
                "action": "transcribe_file",
                "audio_path": wav_path,
                "options": {},
            }
        )
        srv.request_queue.put(None)  # stop sentinel for the worker loop

        srv._inference_worker()

        messages = []
        while True:
            try:
                messages.append(srv.response_queue.get_nowait())
            except queue.Empty:
                break
        results = [m for m in messages if m.get("type") == "result"]
        self.assertEqual(len(results), 1, messages)
        final = results[0]
        self.assertTrue(final["success"], final)
        self.assertEqual(final["request_id"], "schema-2")
        # The wrapper must not disturb the locked payload field set.
        self.assertEqual(
            set(final.keys()), WORKER_RESULT_WRAPPER_FIELDS, sorted(final)
        )
        # Progress messages precede the result and carry the locked shape.
        progresses = [m for m in messages if m.get("type") == "progress"]
        self.assertGreater(len(progresses), 0)
        for progress in progresses:
            self.assertTrue(
                PROGRESS_BASE_FIELDS <= set(progress.keys()), progress
            )
            self.assertEqual(progress["request_id"], "schema-2")
            self.assertIn(progress["phase"], ("vad", "asr", "punc"))
            self.assertIsInstance(progress["progress_pct"], (int, float))
            if "total_ms" in progress:
                self.assertIsInstance(progress["total_ms"], int)

    def test_worker_error_payload_shape(self):
        srv = self._make_server()

        def boom(*_args, **_kwargs):
            raise RuntimeError("engine exploded")

        srv.transcribe_file_audio = boom
        srv.request_queue.put(
            {
                "request_id": "schema-3",
                "action": "transcribe_file",
                "audio_path": "/nonexistent.wav",
                "options": {},
            }
        )
        srv.request_queue.put(None)

        srv._inference_worker()

        final = srv.response_queue.get_nowait()
        self.assertEqual(set(final.keys()), WORKER_ERROR_FIELDS)
        self.assertFalse(final["success"])
        self.assertIn("engine exploded", final["error"])

    def test_canceled_result_shape(self):
        srv = self._make_server()
        wav_path = self._make_wav(seconds=1.0)

        # transcribe_file_audio CLEARS the cancel event on entry; the first
        # cancel check sits after convert/DSP/VAD (before the ASR loop), so
        # arm the event from inside the path-validation stub to reach it.
        def validate_and_cancel(path):
            srv.cancel_event.set()
            return True, path

        srv._validate_audio_path = validate_and_cancel
        srv._apply_preprocessing = lambda path: path

        result = srv.transcribe_file_audio(
            wav_path, {"request_id": "schema-4"}
        )
        self.assertEqual(set(result.keys()), CANCELED_FIELDS)
        self.assertTrue(result["canceled"])


class MicTranscriptionSchemaTest(SchemaRegressionBase):
    def test_success_result_field_set(self):
        srv = self._make_server()
        wav_path = self._make_wav(seconds=1.0)

        result = srv.transcribe_audio(wav_path, {})

        self.assertTrue(result["success"], result)
        self.assertEqual(set(result.keys()), MIC_RESULT_FIELDS, sorted(result))
        self.assertEqual(result["model_type"], "onnx")
        self.assertEqual(result["language"], "zh-CN")
        self.assertIsInstance(result["duration"], float)
        self.assertIsInstance(result["confidence"], (int, float))

    def test_missing_file_error_shape(self):
        srv = self._make_server()
        result = srv.transcribe_audio("/nonexistent.wav", {})
        self.assertEqual(set(result.keys()), {"success", "error"})
        self.assertFalse(result["success"])


class InitializeSchemaTest(SchemaRegressionBase):
    def test_success_payload_fields(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._make_onnx_dir("asr")
        self._make_onnx_dir("vad")
        self._make_onnx_dir("punc")
        srv.response_queue = queue.Queue()
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx",
            SeacoParaformer=SequencedSeaco,
            Fsmn_vad=FakeFsmn,
            CT_Transformer=FakeCt,
        ):
            result = srv.initialize()
        self.assertTrue(result["success"], result)
        self.assertEqual(
            set(result.keys()), INIT_SUCCESS_FIELDS, sorted(result)
        )
        self.assertTrue(result["punc_loaded"])

    def test_models_missing_payload_fields(self):
        # Startup gate arm: nothing downloaded -> run() prints exactly this
        # shape before any worker exists. [20261006_Fix_421_SchemaLockAnchors]
        # Review fix: the payload is asserted from its REAL construction
        # point (funasr_server.models_not_downloaded_result, consumed by
        # run()), not from a dictionary literal — a drift in either field
        # set or values now fails here.
        srv = FunASRServer(damo_root=self.damo_root)
        missing = srv._find_missing_required_models()
        self.assertTrue(missing)
        payload = funasr_server.models_not_downloaded_result()
        self.assertEqual(set(payload.keys()), INIT_FAILURE_FIELDS)
        self.assertFalse(payload["success"])
        self.assertTrue(payload["error"])
        self.assertEqual(payload["type"], "models_not_downloaded")


class ReadLoopResponseSchemaTest(unittest.TestCase):
    """handle_command payload shapes (read-loop arms; request_id attachment
    is run()'s loop job and already locked in test_funasr_server_protocol)."""

    def setUp(self):
        self.server = FunASRServer(damo_root="/tmp/test-damo")

    def test_ping_shape(self):
        result, keep = self.server.handle_command({"action": "ping"})
        self.assertEqual(set(result.keys()), {"success", "action"})
        self.assertTrue(keep)

    def test_exit_shape(self):
        result, keep = self.server.handle_command({"action": "exit"})
        self.assertEqual(set(result.keys()), {"success", "message"})
        self.assertFalse(keep)

    def test_cleanup_shape(self):
        self.server._cleanup_memory = lambda: None
        result, keep = self.server.handle_command({"action": "cleanup"})
        self.assertEqual(set(result.keys()), {"success", "message"})
        self.assertTrue(keep)

    def test_unknown_shape(self):
        result, keep = self.server.handle_command({"action": "nope"})
        self.assertEqual(set(result.keys()), {"success", "error"})
        self.assertTrue(keep)

    def test_invalid_json_shape(self):
        # [20261006_Fix_421_SchemaLockAnchors] Review fix: run()'s read loop
        # builds the invalid-JSON response via
        # funasr_server.invalid_json_result — assert the REAL construction
        # point (field set + failure flag), no longer a dictionary literal.
        payload = funasr_server.invalid_json_result()
        self.assertEqual(set(payload.keys()), {"success", "error"})
        self.assertFalse(payload["success"])
        self.assertTrue(payload["error"])


class RunLoopPayloadTest(SchemaRegressionBase):
    """[20261006_Fix_421_SchemaLockAnchors] Drives the REAL run() loop with
    a stubbed stdin so the two payloads the review called out — the
    models_not_downloaded startup line and the invalid-JSON response — are
    locked at their actual print site, not at construction-time only.
    Inherits the env isolation: with the real modelscope cache visible,
    _find_missing_required_models would resolve and run() would boot the
    actual model load instead of the missing-models arm."""

    def test_run_prints_locked_payloads_for_missing_models_and_bad_json(self):
        server = FunASRServer(damo_root=self.damo_root)
        lines = iter(['{"action": broken json', ""])  # bad line, then EOF

        class StubStdin:
            def readline(self):
                return next(lines)

        captured = []
        real_print = funasr_server._protocol_print
        real_stdin = sys.stdin
        funasr_server._protocol_print = captured.append
        sys.stdin = StubStdin()
        try:
            server.run()
        finally:
            funasr_server._protocol_print = real_print
            sys.stdin = real_stdin

        # Startup arm: damo root has no models -> run() prints the locked
        # models_not_downloaded payload, then the invalid-JSON payload for
        # the malformed line, then exits on EOF.
        self.assertEqual(
            captured[0], funasr_server.models_not_downloaded_result()
        )
        self.assertEqual(captured[1], funasr_server.invalid_json_result())
        self.assertEqual(len(captured), 2)


if __name__ == "__main__":
    unittest.main()
