# [20260821_T11_UnloadReload] Ticket #189 (spec #177 T11): unload/reload
# protocol actions + worker-thread reload + init guards. RED first.
# Design (spec v2 F3 + T7-transferred review constraints):
#   - unload_models/reload_models are QUEUED actions (request_queue) —
#     serialized with transcribe_file for free (busy = deferred, never
#     concurrent); the main read loop only enqueues, so ping stays
#     answerable while the worker reloads
#   - reload emits progress events (renew TS-side request timeouts)
#   - _ensure_initialized guards both transcribe paths, guarded by an
#     init lock (reload-in-worker can race a mic transcribe on the main
#     loop — double model load = memory blowup)
import os
import sys
import threading
import time
import unittest

sys.path.insert(
    0,
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ),
)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

from funasr_server import FunASRServer  # noqa: E402


def make_server():
    return FunASRServer(damo_root="/tmp/test-damo")


class FakeModel:
    def generate(self, *args, **kwargs):
        return [{"text": "x", "value": []}]


class ProtocolRoutingTest(unittest.TestCase):
    """unload/reload must be QUEUED (deferred behind in-flight file work),
    never handled inline on the read loop."""

    def _server(self):
        srv = make_server()
        srv.request_queue = __import__("queue").Queue()
        return srv

    def test_unload_models_routes_to_request_queue(self):
        srv = self._server()
        result, keep = srv.handle_command(
            {"action": "unload_models", "request_id": "r1"}
        )
        self.assertIsNone(result)  # queued → read loop prints nothing
        self.assertTrue(keep)
        task = srv.request_queue.get_nowait()
        self.assertEqual(task["action"], "unload_models")
        self.assertEqual(task["request_id"], "r1")

    def test_reload_models_routes_to_request_queue(self):
        srv = self._server()
        result, keep = srv.handle_command(
            {"action": "reload_models", "request_id": "r2"}
        )
        self.assertIsNone(result)
        self.assertTrue(keep)
        task = srv.request_queue.get_nowait()
        self.assertEqual(task["action"], "reload_models")


class DoUnloadTest(unittest.TestCase):
    def test_unloads_all_models_and_resets_initialized(self):
        srv = make_server()
        srv.asr_model = FakeModel()
        srv.vad_model = FakeModel()
        srv.punc_model = FakeModel()
        srv.cam_model = FakeModel()
        srv.initialized = True
        srv.response_queue = __import__("queue").Queue()

        srv._do_unload("r1")

        self.assertIsNone(srv.asr_model)
        self.assertIsNone(srv.vad_model)
        self.assertIsNone(srv.punc_model)
        # Lazy speaker model unloads too, keeping its lazy-load semantics.
        self.assertIsNone(srv.cam_model)
        self.assertFalse(srv.initialized)
        resp = srv.response_queue.get_nowait()
        self.assertTrue(resp["success"])
        self.assertEqual(resp["request_id"], "r1")


class DoReloadTest(unittest.TestCase):
    def test_reload_runs_initialize_and_reports_generation(self):
        srv = make_server()
        srv.initialized = False
        srv.response_queue = __import__("queue").Queue()
        srv.asr_model_name = None

        calls = []

        def fake_initialize():
            calls.append(1)
            srv.initialized = True
            srv.asr_model_name = FunASRServer.ASR_MODEL_SEACO
            return {"success": True}

        srv.initialize = fake_initialize
        srv._do_reload("r2")

        self.assertEqual(calls, [1])
        # Progress events precede the result (AC: renew TS timeouts).
        events = []
        while not srv.response_queue.empty():
            events.append(srv.response_queue.get_nowait())
        progress = [e for e in events if e.get("type") == "progress"]
        self.assertGreaterEqual(len(progress), 1)
        result = [e for e in events if e.get("type") == "result"][0]
        self.assertTrue(result["success"])
        self.assertEqual(result["asr_model"], FunASRServer.ASR_MODEL_SEACO)

    def test_reload_failure_reports_error(self):
        srv = make_server()
        srv.initialized = False
        srv.response_queue = __import__("queue").Queue()

        def boom():
            return {"success": False, "error": "加载失败"}

        srv.initialize = boom
        srv._do_reload("r3")
        result = [
            srv.response_queue.get_nowait() for _ in range(1)
        ]
        # drain everything
        while not srv.response_queue.empty():
            result.append(srv.response_queue.get_nowait())
        final = [e for e in result if e.get("type") == "result"][0]
        self.assertFalse(final["success"])


class EnsureInitializedTest(unittest.TestCase):
    def test_guard_initializes_once_when_uninitialized(self):
        srv = make_server()
        srv.initialized = False
        calls = []

        def fake_init():
            calls.append(1)
            srv.initialized = True
            return {"success": True}

        srv.initialize = fake_init
        ok = srv._ensure_initialized()
        self.assertTrue(ok)
        self.assertEqual(calls, [1])
        # Second call after success does not re-initialize.
        self.assertTrue(srv._ensure_initialized())
        self.assertEqual(calls, [1])

    def test_concurrent_ensure_serializes_to_single_init(self):
        # reload-in-worker can race a mic transcribe on the main loop —
        # the init lock must collapse them into ONE initialize() call.
        srv = make_server()
        srv.initialized = False
        calls = []

        def slow_init():
            calls.append(threading.current_thread().name)
            time.sleep(0.2)
            srv.initialized = True
            return {"success": True}

        srv.initialize = slow_init
        threads = [
            threading.Thread(target=srv._ensure_initialized) for _ in range(5)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(calls), 1)
        self.assertTrue(srv.initialized)


if __name__ == "__main__":
    unittest.main()
