# [20260817_T5_HandleCommand] Ticket #181 (spec #177 T5): characterization
# suite for the stdin command dispatch. The semantics below are transcribed
# 1:1 from the previous inline dispatch inside FunASRServer.run(), so this
# suite locks CURRENT behavior: the extraction into handle_command() must
# keep every assertion green (zero behavior change) and future protocol
# extensions (unload/hotword, tickets #189/#183) will extend this suite.
#
# Runs on stdlib unittest only — funasr_server.py has stdlib-only module
# imports; MURMUR_DEVICE is pinned so __init__ never imports torch.
import json
import os
import queue
import sys
import unittest

sys.path.insert(
    0,
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ),
)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

from funasr_server import FunASRServer  # noqa: E402
import funasr_server  # noqa: E402


class FunASRServerProtocolTest(unittest.TestCase):
    """handle_command(command) -> (result, keep_running) dispatch contract."""

    def setUp(self):
        self.server = FunASRServer(damo_root="/tmp/test-damo")
        # Stub every heavy method the dispatch delegates to; each test
        # asserts the exact delegation + passthrough result.
        self.delegations = []

    def _stub(self, name, retval=None):
        def recorder(*args, **kwargs):
            self.delegations.append((name, args, kwargs))
            return retval

        setattr(self.server, name, recorder)
        return retval

    def test_transcribe_delegates_with_default_options(self):
        sentinel = {"success": True, "text": "hi"}
        self._stub("transcribe_audio", sentinel)
        result, keep = self.server.handle_command(
            {"action": "transcribe", "audio_path": "/a.wav"}
        )
        self.assertEqual(result, sentinel)
        self.assertTrue(keep)
        self.assertEqual(
            self.delegations, [("transcribe_audio", ("/a.wav", {}), {})]
        )

    def test_transcribe_forwards_options(self):
        self._stub("transcribe_audio", {"success": True})
        self.server.handle_command(
            {"action": "transcribe", "audio_path": "/a.wav", "options": {"x": 1}}
        )
        self.assertEqual(
            self.delegations,
            [("transcribe_audio", ("/a.wav", {"x": 1}), {})],
        )

    def test_status_delegates(self):
        sentinel = {"success": True, "status": "ok"}
        self._stub("check_status", sentinel)
        result, keep = self.server.handle_command({"action": "status"})
        self.assertEqual(result, sentinel)
        self.assertTrue(keep)

    def test_stats_returns_performance_stats(self):
        stats = {"count": 1}
        self._stub("get_performance_stats", stats)
        result, keep = self.server.handle_command({"action": "stats"})
        self.assertEqual(result, {"success": True, "stats": stats})
        self.assertTrue(keep)

    def test_cleanup_runs_and_confirms(self):
        self._stub("_cleanup_memory")
        result, keep = self.server.handle_command({"action": "cleanup"})
        self.assertEqual(result, {"success": True, "message": "内存清理完成"})
        self.assertTrue(keep)
        self.assertEqual(self.delegations, [("_cleanup_memory", (), {})])

    def test_transcribe_file_queues_payload_and_returns_none(self):
        stub_queue = queue.Queue()
        self.server.request_queue = stub_queue
        result, keep = self.server.handle_command(
            {
                "action": "transcribe_file",
                "request_id": "req-1",
                "audio_path": "/a.wav",
                "options": {"lang": "zh"},
            }
        )
        # None result: the read loop must NOT print anything for this action
        # (progress/results flow via response_queue -> output_worker).
        self.assertIsNone(result)
        self.assertTrue(keep)
        self.assertEqual(
            stub_queue.get_nowait(),
            {
                "request_id": "req-1",
                "action": "transcribe_file",
                "audio_path": "/a.wav",
                "options": {"lang": "zh"},
            },
        )

    def test_cancel_sets_cancel_event(self):
        result, keep = self.server.handle_command({"action": "cancel_transcription"})
        self.assertEqual(result, {"success": True, "message": "取消信号已发送"})
        self.assertTrue(keep)
        self.assertTrue(self.server.cancel_event.is_set())

    def test_diarize_delegates_with_segments(self):
        sentinel = {"success": True, "speakers": []}
        self._stub("diarize_audio", sentinel)
        result, keep = self.server.handle_command(
            {"action": "diarize", "audio_path": "/a.wav", "segments": [{"s": 1}]}
        )
        self.assertEqual(result, sentinel)
        self.assertTrue(keep)
        self.assertEqual(
            self.delegations,
            [("diarize_audio", ("/a.wav", [{"s": 1}]), {})],
        )

    def test_ping_answers_pong_without_request_id(self):
        result, keep = self.server.handle_command({"action": "ping"})
        self.assertEqual(result, {"success": True, "action": "pong"})
        self.assertTrue(keep)
        # request_id attach is the read loop's job, not the dispatcher's.
        self.assertNotIn("request_id", result)

    def test_exit_stops_the_loop(self):
        result, keep = self.server.handle_command({"action": "exit"})
        self.assertEqual(result, {"success": True, "message": "服务器退出"})
        self.assertFalse(keep)

    def test_unknown_action_is_rejected_not_raised(self):
        result, keep = self.server.handle_command({"action": "nope"})
        self.assertFalse(result["success"])
        self.assertIn("未知命令", result["error"])
        self.assertTrue(keep)


class HotwordDefenseTest(unittest.TestCase):
    """[20260820_T14_Hotwords] Ticket #183: Python-side defense-in-depth —
    a non-string or oversized hotword arriving over the protocol (corrupted
    DB, renderer bug) must degrade to a safe value, never crash generate().
    """

    def test_valid_string_passes_through(self):
        self.assertEqual(
            funasr_server.sanitize_hotword("张晗玥 刘翀"), "张晗玥 刘翀"
        )

    def test_non_string_degrades_to_empty(self):
        self.assertEqual(funasr_server.sanitize_hotword(None), "")
        self.assertEqual(funasr_server.sanitize_hotword(["a", "b"]), "")
        self.assertEqual(funasr_server.sanitize_hotword(12345), "")

    def test_oversized_value_is_truncated(self):
        huge = "词" * 10000
        out = funasr_server.sanitize_hotword(huge)
        self.assertLessEqual(len(out), funasr_server.HOTWORD_MAX_CHARS)
        self.assertGreater(len(out), 0)


if __name__ == "__main__":
    unittest.main()
