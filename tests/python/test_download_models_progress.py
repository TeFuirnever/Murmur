# [20260905_Fix_212_DownloadProgress] Regression tests for download_models.py
# (issue #212: "点击下载后一直未见有进度，超时后结束下载，若干秒后又提示模型下载").
#
# The old script called AutoModel() per model, which blocks for the entire
# multi-GB download emitting NOTHING until completion — the UI sat at 0%.
# The rewritten script uses modelscope's snapshot_download with per-file
# ProgressCallback hooks and must:
#   1. emit a downloading progress line per model BEFORE the download
#      finishes (real 0→100 stream, not a single jump)
#   2. emit overall_progress that actually advances (the Node host maps it
#      to the UI bar)
#   3. mark the model completed at 100
#   4. include the resolved modelscope cache root in the final JSON
#   5. report failed models with success=false on download errors
#
# modelscope is faked via sys.modules injection — no network, no heavy deps.
import io
import json
import sys
import threading
import types
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, ".")
import download_models  # noqa: E402


class FakeProgressCallback:
    """Stands in for modelscope.hub.callback.ProgressCallback."""

    received_hooks = []

    def __init__(self, filename, file_size):
        self.filename = filename
        self.file_size = file_size

    def update(self, size):
        pass

    def end(self):
        pass


def install_fake_modelscope(capture, fail_for=None):
    """Build a fake modelscope package exposing snapshot_download + callback."""

    def fake_snapshot_download(model_id, revision=None, progress_callbacks=None):
        hook_cls = progress_callbacks[0] if progress_callbacks else FakeProgressCallback
        hook = hook_cls("model.pt", 1000)
        capture["hooks"].append(hook)
        FakeProgressCallback.received_hooks.append(hook)
        if fail_for and any(f in model_id for f in fail_for):
            raise RuntimeError("network unreachable")
        # Simulate a 4-chunk download driving the callback.
        for _ in range(4):
            hook.update(200)
        hook.end()
        return "/fake/cache/models/damo/x"

    ms_hub_snapshot = types.ModuleType("modelscope.hub.snapshot_download")
    ms_hub_snapshot.snapshot_download = fake_snapshot_download
    ms_hub_callback = types.ModuleType("modelscope.hub.callback")
    ms_hub_callback.ProgressCallback = FakeProgressCallback
    ms_utils_fu = types.ModuleType("modelscope.utils.file_utils")
    ms_utils_fu.get_model_cache_root = lambda: "/fake/cache/models"

    fake = types.ModuleType("modelscope")
    fake_hub = types.ModuleType("modelscope.hub")
    fake_utils = types.ModuleType("modelscope.utils")
    fake.hub = fake_hub
    fake.utils = fake_utils
    fake_hub.snapshot_download = ms_hub_snapshot
    fake_hub.callback = ms_hub_callback
    fake_utils.file_utils = ms_utils_fu
    sys.modules["modelscope"] = fake
    sys.modules["modelscope.hub"] = fake_hub
    sys.modules["modelscope.hub.snapshot_download"] = ms_hub_snapshot
    sys.modules["modelscope.hub.callback"] = ms_hub_callback
    sys.modules["modelscope.utils"] = fake_utils
    sys.modules["modelscope.utils.file_utils"] = ms_utils_fu


class TestDownloadModelsProgress(unittest.TestCase):
    def setUp(self):
        MODEL_TYPES = ("asr", "vad", "punc")
        for t in MODEL_TYPES:
            download_models.MODEL_STATES.pop(t, None)
        FakeProgressCallback.received_hooks = []

    def _run_main(self, fail_for=None):
        capture = {"hooks": []}
        install_fake_modelscope(capture, fail_for=fail_for)
        buf = io.StringIO()
        with redirect_stdout(buf), mock.patch.dict(
            "sys.modules", {"modelscope": sys.modules["modelscope"]}
        ):
            download_models.main()
        lines = [l for l in buf.getvalue().splitlines() if l.strip()]
        events = [json.loads(l) for l in lines]
        final = events[-1]
        progress_events = [e for e in events if e.get("stage") == "downloading"]
        completed = [e for e in events if e.get("stage") == "completed"]
        return progress_events, completed, final

    def test_emits_intermediate_downloading_events(self):
        progress_events, _, final = self._run_main()
        # 3 models × (initial 0% + ≥1 incremental) — the old script emitted
        # exactly one downloading line per model, all at 0%.
        self.assertGreaterEqual(len(progress_events), 6)
        self.assertTrue(final["success"])

    def test_overall_progress_advances_above_zero(self):
        progress_events, _, _ = self._run_main()
        # At least one event must show real mid-download overall progress —
        # the old output could never exceed 0 until the model finished.
        self.assertTrue(
            any(e["overall_progress"] > 0 and e["progress"] < 100 for e in progress_events),
            f"no advancing progress event in {progress_events}",
        )

    def test_per_model_mid_download_percent_is_real(self):
        # [20260905_Fix_Review_TotalBytes] Review MAJOR: total_bytes was
        # never populated, so per-model percent pinned at the indeterminate
        # 1.0 for the whole multi-GB fetch. The fake wires file_size=1000
        # and streams 800 bytes before end — a mid-download event must show
        # a real fraction (0 < p < 100), not the 1.0 placeholder.
        progress_events, _, _ = self._run_main()
        asr_events = [e for e in progress_events if e["model"] == "asr"]
        self.assertTrue(
            any(0 < e["progress"] < 100 for e in asr_events),
            f"per-model progress never left the placeholder: {asr_events}",
        )

    def test_completed_events_reach_100(self):
        _, completed, final = self._run_main()
        self.assertEqual(len(completed), 3)
        for e in completed:
            self.assertEqual(e["progress"], 100)
        self.assertTrue(final["success"])

    def test_final_json_includes_cache_root(self):
        _, _, final = self._run_main()
        self.assertEqual(final.get("cache_root"), "/fake/cache/models")

    def test_percent_is_monotonic_when_late_files_register(self):
        # [20260905_Fix_249_ReviewMinor] total_bytes grows as later file
        # callbacks register, so the same downloaded byte count yields a
        # LOWER percent after a sibling joins. The host watchdog re-arms only
        # on STRICT growth, so a dip would delay re-crossing the old peak and
        # could kill a live download ("dip-then-recover"). Contract: emitted
        # per-model percent never decreases.
        state = {
            "downloaded": 0,
            "total_bytes": 0,
            "last_percent": 0.0,
            "last_emit": 0.0,
        }
        captured = []
        from download_models import ProtocolProgressCallback, PROGRESS_EMIT_INTERVAL

        def emit_override(model, stage, percent, error=None):
            captured.append(percent)

        with mock.patch("download_models.emit_progress", side_effect=emit_override):
            cb1 = ProtocolProgressCallback("a.pt", 1000, state, "asr")
            cb1.update(800)  # 80.0%
            # Backdate the throttle clock so the dip passes the 1s gate and
            # is actually emitted (a slow network is exactly this case).
            state["last_emit"] -= PROGRESS_EMIT_INTERVAL + 1
            cb2 = ProtocolProgressCallback("b.pt", 1000, state, "asr")
            cb2.update(100)  # total now 2000, downloaded 900 → 45.0% raw
            cb1.update(0)

        self.assertGreaterEqual(len(captured), 1)
        prev = 0.0
        for p in captured:
            self.assertGreaterEqual(p, prev, f"percent dipped: {captured}")
            prev = p

    def test_failure_reports_failed_models(self):
        progress_events, completed, final = self._run_main(fail_for={"vad"})
        self.assertFalse(final["success"])
        self.assertIn("vad", final["failed_models"])
        self.assertEqual(len(completed), 2)


if __name__ == "__main__":
    unittest.main()
