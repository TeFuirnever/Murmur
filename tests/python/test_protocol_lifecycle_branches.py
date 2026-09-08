# [20260907_Fix_317_PythonBranchFill] Ticket #317: behavior tests for the
# protocol/lifecycle branches of funasr_server.py that the delegation-level
# suites stub away (the coverage audit found funasr_server at 34%). Every
# test here drives the REAL method body — no stubbing of the unit under
# test. Real AutoModel-loading bodies stay exempt (they require the heavy
# funasr stack; loading arms are covered by test_seaco_fallback /
# test_unload_reload fake-module injection where reachable).
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(
    0,
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ),
)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

import funasr_server  # noqa: E402
from funasr_server import FunASRServer  # noqa: E402


def make_server(**attrs):
    srv = FunASRServer(damo_root="/tmp/test-damo")
    for key, value in attrs.items():
        setattr(srv, key, value)
    return srv


class ValidateAudioPathTest(unittest.TestCase):
    def setUp(self):
        self.srv = make_server()
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(
            lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True)
        )

    def _wav(self, name="a.wav"):
        path = os.path.join(self.tmp, name)
        with open(path, "w") as f:
            f.write("x")
        return path

    def test_rejects_empty_path(self):
        ok, err = self.srv._validate_audio_path("")
        self.assertFalse(ok)
        self.assertIn("无效", err)

    def test_rejects_non_string_path(self):
        ok, err = self.srv._validate_audio_path(123)
        self.assertFalse(ok)
        self.assertIn("无效", err)

    def test_rejects_unsupported_extension(self):
        path = os.path.join(self.tmp, "notes.txt")
        with open(path, "w") as f:
            f.write("x")
        ok, err = self.srv._validate_audio_path(path)
        self.assertFalse(ok)
        self.assertIn("不支持的音频格式", err)

    def test_rejects_missing_file(self):
        ok, err = self.srv._validate_audio_path(
            os.path.join(self.tmp, "gone.wav")
        )
        self.assertFalse(ok)
        self.assertIn("文件不存在", err)

    def test_rejects_unreadable_file(self):
        path = self._wav()
        with mock.patch("os.access", return_value=False):
            ok, err = self.srv._validate_audio_path(path)
        self.assertFalse(ok)
        self.assertIn("文件不可读", err)

    def test_accepts_a_readable_wav(self):
        path = self._wav()
        ok, real = self.srv._validate_audio_path(path)
        self.assertTrue(ok)
        self.assertTrue(os.path.isabs(real))


class MergeSegmentsTest(unittest.TestCase):
    def setUp(self):
        self.srv = make_server()

    def test_empty_input_returns_empty_list(self):
        self.assertEqual(self.srv._merge_segments([]), [])
        self.assertEqual(self.srv._merge_segments(None), [])

    def test_single_segment_passes_through(self):
        seg = {"start_ms": 0, "end_ms": 1000, "text": "你好。"}
        self.assertEqual(self.srv._merge_segments([seg]), [seg])

    def test_sentence_final_punctuation_starts_a_new_segment(self):
        segs = [
            {"start_ms": 0, "end_ms": 800, "text": "第一句。"},
            {"start_ms": 900, "end_ms": 1600, "text": "第二句。"},
        ]
        merged = self.srv._merge_segments(segs)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["text"], "第一句。")

    def test_long_segment_starts_a_new_segment(self):
        segs = [
            {"start_ms": 0, "end_ms": 6000, "text": "长句无标点"},
            {"start_ms": 6100, "end_ms": 6800, "text": "短句"},
        ]
        merged = self.srv._merge_segments(segs)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["text"], "长句无标点")

    def test_short_unpunctuated_segments_merge_forward(self):
        segs = [
            {"start_ms": 0, "end_ms": 500, "text": "还"},
            {"start_ms": 600, "end_ms": 900, "text": "没"},
            {"start_ms": 1000, "end_ms": 1200, "text": "说完"},
        ]
        merged = self.srv._merge_segments(segs)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["text"], "还没说完")
        self.assertEqual(merged[0]["end_ms"], 1200)


class LifecycleGuardsTest(unittest.TestCase):
    def test_signal_handler_stops_the_server(self):
        srv = make_server(running=True)
        srv._signal_handler(15, None)
        self.assertFalse(srv.running)

    def test_cleanup_memory_collects_gc(self):
        srv = make_server()
        with mock.patch("gc.collect") as collect:
            srv._cleanup_memory()
        collect.assert_called_once()

    def test_cleanup_memory_swallows_gc_failure(self):
        srv = make_server()
        with mock.patch("gc.collect", side_effect=RuntimeError("gc")):
            srv._cleanup_memory()  # must not raise

    def test_get_performance_stats_divides_by_max_one(self):
        srv = make_server(
            transcription_count=0,
            total_audio_duration=0.0,
            initialized=False,
        )
        stats = srv.get_performance_stats()
        self.assertEqual(stats["average_duration"], 0)
        self.assertFalse(stats["initialized"])

    def test_get_performance_stats_reports_models_and_generation(self):
        srv = make_server(
            transcription_count=2,
            total_audio_duration=5.0,
            initialized=True,
            asr_model=object(),
            vad_model=None,
            punc_model=object(),
            asr_model_name="damo/speech_seaco",
        )
        stats = srv.get_performance_stats()
        self.assertEqual(stats["transcription_count"], 2)
        self.assertEqual(stats["average_duration"], 2.5)
        self.assertTrue(stats["models_loaded"]["asr"])
        self.assertFalse(stats["models_loaded"]["vad"])
        self.assertEqual(stats["models_loaded"]["asr_model"], "damo/speech_seaco")


class CheckStatusTest(unittest.TestCase):
    def setUp(self):
        self.real_funasr = sys.modules.get("funasr")

    def tearDown(self):
        if self.real_funasr is not None:
            sys.modules["funasr"] = self.real_funasr
        else:
            sys.modules.pop("funasr", None)

    def test_reports_installed_with_version_and_models(self):
        import types

        fake = types.ModuleType("funasr")
        fake.__version__ = "9.9.9"
        sys.modules["funasr"] = fake
        srv = make_server(
            initialized=True,
            asr_model=object(),
            asr_model_name="damo/x",
        )
        status = srv.check_status()
        self.assertTrue(status["success"])
        self.assertTrue(status["installed"])
        self.assertEqual(status["version"], "9.9.9")
        self.assertTrue(status["models"]["asr"])

    def test_reports_not_installed_when_funasr_import_fails(self):
        sys.modules["funasr"] = None  # forces ImportError on `import funasr`
        srv = make_server()
        status = srv.check_status()
        self.assertFalse(status["success"])
        self.assertFalse(status["installed"])
        self.assertIn("error", status)


class EnsureInitializedTest(unittest.TestCase):
    def test_short_circuits_when_already_initialized(self):
        srv = make_server(initialized=True)
        calls = []
        srv.initialize = lambda: calls.append(1) or {"success": True}
        self.assertTrue(srv._ensure_initialized())
        self.assertEqual(calls, [])

    def test_initializes_once_when_not_initialized(self):
        srv = make_server(initialized=False)
        calls = []
        srv.initialize = lambda: calls.append(1) or {"success": True}
        self.assertTrue(srv._ensure_initialized())
        self.assertEqual(calls, [1])

    def test_returns_false_when_initialize_reports_failure(self):
        srv = make_server(initialized=False)
        srv.initialize = lambda: {"success": False, "error": "模型未下载"}
        self.assertFalse(srv._ensure_initialized())


class GetLogPathTest(unittest.TestCase):
    def test_env_var_routes_the_log_dir(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(
            lambda: __import__("shutil").rmtree(tmp, ignore_errors=True)
        )
        old = os.environ.get("ELECTRON_USER_DATA")
        os.environ["ELECTRON_USER_DATA"] = tmp
        try:
            path = funasr_server.get_log_path()
        finally:
            if old is None:
                os.environ.pop("ELECTRON_USER_DATA", None)
            else:
                os.environ["ELECTRON_USER_DATA"] = old
        self.assertTrue(path.startswith(os.path.join(tmp, "logs")))
        self.assertTrue(path.endswith("funasr_server.log"))


if __name__ == "__main__":
    unittest.main()
