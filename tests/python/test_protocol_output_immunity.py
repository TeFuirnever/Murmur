# [20260905_Fix_208_ProtocolStreamImmune] Regression tests for issue #208.
#
# _output_worker printed protocol JSON with print(), which resolves
# sys.stdout DYNAMICALLY. While any loader thread sat inside a
# suppress_stdout() window, sys.stdout was the shared devnull sink — so a
# protocol message dequeued during that window (reload progress, command
# responses) was silently dropped and the host lost the event (#207 removed
# the closed-devnull crash, but the swallow path remained).
#
# Contract: the protocol channel writes to the stream captured at process
# start (_PROTOCOL_STDOUT), never to the redirectable global — so protocol
# output is immune to suppression windows.
import io
import json
import os
import sys
import tempfile
import threading
import time
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
from funasr_server import FunASRServer, suppress_stdout  # noqa: E402


def _wait_for(predicate, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


class ProtocolOutputImmunityTest(unittest.TestCase):
    def setUp(self):
        self.protocol_stream = io.StringIO()
        patcher = mock.patch.object(
            funasr_server, "_PROTOCOL_STDOUT", self.protocol_stream
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_protocol_print_writes_json_line_to_captured_stream(self):
        funasr_server._protocol_print({"type": "progress", "pct": 42})
        line = self.protocol_stream.getvalue().strip()
        self.assertEqual(json.loads(line), {"type": "progress", "pct": 42})
        # The trailing newline is load-bearing: the host frames messages by
        # splitting on "\n".
        self.assertTrue(self.protocol_stream.getvalue().endswith("\n"))

    def test_protocol_print_immune_to_suppress_window(self):
        # THE #208 BUG: a print() during a suppress window lands in devnull.
        with suppress_stdout():
            funasr_server._protocol_print({"type": "reload_progress"})
        self.assertEqual(
            json.loads(self.protocol_stream.getvalue().strip()),
            {"type": "reload_progress"},
        )

    def test_output_worker_routes_queue_messages_through_protocol_stream(self):
        with tempfile.TemporaryDirectory() as root:
            srv = FunASRServer(damo_root=root)
            srv.running = True
            srv.response_queue.put({"type": "reload_progress", "pct": 10})

            worker = threading.Thread(target=srv._output_worker, daemon=True)
            worker.start()
            try:
                self.assertTrue(
                    _wait_for(lambda: self.protocol_stream.getvalue().strip())
                )
            finally:
                srv.running = False
                worker.join(timeout=5)

            msg = json.loads(self.protocol_stream.getvalue().strip())
            self.assertEqual(msg, {"type": "reload_progress", "pct": 10})

    def test_output_worker_message_survives_concurrent_suppress_window(self):
        # End-to-end form of the bug: the output worker dequeues a message
        # while the main thread holds a suppress window — the message must
        # still reach the protocol stream.
        with tempfile.TemporaryDirectory() as root:
            srv = FunASRServer(damo_root=root)
            srv.running = True
            srv.response_queue.put({"type": "reload_progress", "pct": 55})

            worker = threading.Thread(target=srv._output_worker, daemon=True)
            worker.start()
            try:
                with suppress_stdout():
                    self.assertTrue(
                        _wait_for(
                            lambda: self.protocol_stream.getvalue().strip()
                        )
                    )
            finally:
                srv.running = False
                worker.join(timeout=5)

            msg = json.loads(self.protocol_stream.getvalue().strip())
            self.assertEqual(msg, {"type": "reload_progress", "pct": 55})


if __name__ == "__main__":
    unittest.main()
