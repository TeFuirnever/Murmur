# [20261006_Test_421_ResourceGates] Ticket #421 (spec #412 S1 seam / T7):
# the resource acceptance family as repeatable tests. Two layers:
#
# ALWAYS-ON (CI green, no models needed):
#   - gate CONSTANTS pinned (RSS 1700MB / RTF 0.1 / >=600s audio / watchdog
#     parity with src/helpers/funasrServer.ts STARTUP_MAX_WAIT_MS)
#   - pure gate math (p95 nearest-rank, ASR-phase RTF window, long-wav
#     tiler) and verdict logic (each failure mode flips the verdict)
#   - the protocol client ServerProcess driven against a STUB server
#     process (init/result/progress correlation, ping, deadlock-detection
#     deadline), and the cross-platform child-RSS sampler (self-sample)
#
# RESOURCE ARMS (env-gated: MURMUR_RESOURCE_GATES=1 AND asr+vad ONNX models
# present — CI runs the suite WITHOUT the flag/models so the arms self-skip;
# locally run e.g.:
#   MURMUR_RESOURCE_GATES=1 MURMUR_GATE_DAMO_ROOT="$HOME/Library/Application Support/Murmur/models" \
#     pnpm run test:python:unit
# ) to produce the real release-evidence numbers:
#   - >=10min audio: peak RSS <= 1700MB and ASR-phase RTF <= 0.1
#   - mic + file concurrent dual task: no deadlock (both results within
#     deadline, ping still answered), peak RSS bounded
#   - cold start p95 over N fresh-process samples < watchdog threshold
#
# Heavy deps (onnxruntime/funasr_onnx) load ONLY inside the real arms' child
# processes — the production funasr_server.py is spawned unmodified, so the
# numbers measure the exact runtime users get (S1 protocol seam, spec #412
# testing decision 1).
import json
import os
import sys
import tempfile
import unittest
import wave

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
sys.path.insert(0, REPO_ROOT)
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts", "onnx-resource-gate"))

os.environ.setdefault("MURMUR_DEVICE", "cpu")

import resource_gate  # noqa: E402

FIXTURE_40S_WAV = os.path.join(
    REPO_ROOT, "scripts", "onnx-spike", "fixtures", "onnx-spike-40s.wav"
)
TS_SERVER_PATH = os.path.join(REPO_ROOT, "src", "helpers", "funasrServer.ts")


class GateConstantsTest(unittest.TestCase):
    """The acceptance numbers ARE the contract — pinned so they cannot
    silently loosen (mirrors the win_spike threshold-pinning pattern)."""

    def test_long_audio_minimum_duration_is_ten_minutes(self):
        self.assertEqual(resource_gate.LONG_AUDIO_MIN_DURATION_S, 600)

    def test_peak_rss_gate_is_1700mb(self):
        self.assertEqual(resource_gate.MAX_PEAK_RSS_MB, 1700.0)

    def test_rtf_gate_is_point_one(self):
        self.assertEqual(resource_gate.MAX_RTF, 0.1)

    def test_cold_start_default_samples(self):
        self.assertEqual(resource_gate.COLD_START_DEFAULT_SAMPLES, 5)

    def test_watchdog_threshold_mirrors_ts_host(self):
        # The cold-start gate threshold must be the STARTUP watchdog outer
        # cap the TS host actually enforces (heartbeat-based since #419);
        # parse the constant out of funasrServer.ts so the two cannot drift.
        self.assertTrue(os.path.exists(TS_SERVER_PATH))
        with open(TS_SERVER_PATH, encoding="utf-8") as f:
            ts_source = f.read()
        self.assertEqual(
            resource_gate.watchdog_max_wait_s_from_ts(ts_source),
            resource_gate.WATCHDOG_MAX_WAIT_S,
        )

    def test_report_schema_version_and_keys(self):
        self.assertEqual(resource_gate.GATE_SCHEMA_VERSION, 1)
        self.assertEqual(
            sorted(resource_gate.GATE_REQUIRED_KEYS),
            sorted(
                [
                    "schema_version",
                    "environment",
                    "long_audio",
                    "concurrency",
                    "cold_start",
                    "acceptance",
                ]
            ),
        )


class PercentileNearestRankTest(unittest.TestCase):
    def test_p95_of_five_is_the_max(self):
        self.assertEqual(
            resource_gate.percentile_nearest_rank([3.0, 1.0, 5.0, 2.0, 4.0], 0.95),
            5.0,
        )

    def test_p95_of_twenty_is_the_nineteenth(self):
        values = [float(i) for i in range(1, 21)]
        self.assertEqual(
            resource_gate.percentile_nearest_rank(values, 0.95), 19.0
        )

    def test_p100_is_max_and_single_sample(self):
        self.assertEqual(
            resource_gate.percentile_nearest_rank([7.5], 0.95), 7.5
        )
        self.assertEqual(
            resource_gate.percentile_nearest_rank([1.0, 2.0], 1.0), 2.0
        )

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            resource_gate.percentile_nearest_rank([], 0.95)


class AsrPhaseWindowTest(unittest.TestCase):
    def test_window_spans_first_asr_to_first_punc_progress(self):
        events = [
            {"phase": "vad", "t": 10.0},
            {"phase": "asr", "t": 12.0},
            {"phase": "asr", "t": 30.0},
            {"phase": "punc", "t": 42.0},
        ]
        self.assertEqual(resource_gate.asr_phase_window_s(events), 30.0)

    def test_missing_asr_or_punc_yields_none(self):
        self.assertIsNone(resource_gate.asr_phase_window_s([]))
        self.assertIsNone(
            resource_gate.asr_phase_window_s([{"phase": "vad", "t": 1.0}])
        )
        self.assertIsNone(
            resource_gate.asr_phase_window_s(
                [{"phase": "asr", "t": 1.0}, {"phase": "asr", "t": 2.0}]
            )
        )

    def test_rtf_ratio(self):
        # 30s window over 600s audio -> RTF 0.05
        self.assertEqual(resource_gate.rtf_asr_phase(600.0, 30.0), 0.05)


class BuildLongWavTest(unittest.TestCase):
    def test_tiled_wav_meets_minimum_duration(self):
        self.assertTrue(os.path.exists(FIXTURE_40S_WAV))
        with tempfile.TemporaryDirectory() as tmp:
            out_path = os.path.join(tmp, "long.wav")
            duration_s = resource_gate.build_long_wav(
                FIXTURE_40S_WAV, out_path, min_duration_s=120
            )
            self.assertGreaterEqual(duration_s, 120)
            with wave.open(out_path, "rb") as reader:
                self.assertEqual(reader.getframerate(), 16000)
                self.assertEqual(reader.getnchannels(), 1)
                actual = reader.getnframes() / reader.getframerate()
            self.assertAlmostEqual(actual, duration_s, places=2)

    def test_tiling_count_is_ceil_of_ratio(self):
        # 40s fixture x4 must give >=120s (ceil(120/40.83) = 3 copies —
        # verify no off-by-one: duration must exceed the minimum, not equal
        # a multiple below it).
        with tempfile.TemporaryDirectory() as tmp:
            out_path = os.path.join(tmp, "long.wav")
            duration_s = resource_gate.build_long_wav(
                FIXTURE_40S_WAV, out_path, min_duration_s=121
            )
            self.assertGreaterEqual(duration_s, 121)


class RssSamplerTest(unittest.TestCase):
    def test_self_sample_returns_positive_bytes(self):
        rss = resource_gate.sample_rss_bytes(os.getpid())
        self.assertIsNotNone(rss)
        self.assertGreater(rss, 0)

    def test_dead_process_returns_none(self):
        self.assertIsNone(resource_gate.sample_rss_bytes(-1))


class GateVerdictTest(unittest.TestCase):
    """Each acceptance failure mode must flip the verdict; the clean report
    must pass."""

    @staticmethod
    def _clean_report():
        return {
            "long_audio": {
                "ok": True,
                "duration_s": 612.4,
                "peak_rss_mb": 1200.0,
                "rtf_asr_phase": 0.02,
                "text_chars": 500,
                "problems": [],
            },
            "concurrency": {
                "ok": True,
                "file_result_ok": True,
                "mic_result_ok": True,
                "ping_ok": True,
                "peak_rss_mb": 1300.0,
                "problems": [],
            },
            "cold_start": {
                "ok": True,
                "samples_s": [18.0, 19.0, 20.0, 21.0, 22.0],
                "p95_s": 22.0,
                "problems": [],
            },
        }

    def test_clean_report_passes(self):
        passed, problems = resource_gate.evaluate_resource_gates(
            self._clean_report()
        )
        self.assertTrue(passed, problems)
        self.assertEqual(problems, [])

    def test_long_audio_rss_over_gate_fails(self):
        report = self._clean_report()
        report["long_audio"]["peak_rss_mb"] = 1700.5
        passed, problems = resource_gate.evaluate_resource_gates(report)
        self.assertFalse(passed)
        self.assertTrue(any("RSS" in p for p in problems), problems)

    def test_long_audio_rtf_over_gate_fails(self):
        report = self._clean_report()
        report["long_audio"]["rtf_asr_phase"] = 0.11
        passed, problems = resource_gate.evaluate_resource_gates(report)
        self.assertFalse(passed)
        self.assertTrue(any("RTF" in p for p in problems), problems)

    def test_long_audio_too_short_fails(self):
        report = self._clean_report()
        report["long_audio"]["duration_s"] = 599.0
        passed, problems = resource_gate.evaluate_resource_gates(report)
        self.assertFalse(passed)
        self.assertTrue(any("600" in p for p in problems), problems)

    def test_concurrency_deadlock_fails(self):
        report = self._clean_report()
        report["concurrency"]["file_result_ok"] = False
        passed, problems = resource_gate.evaluate_resource_gates(report)
        self.assertFalse(passed)
        self.assertTrue(
            any("deadlock" in p or "file" in p.lower() for p in problems),
            problems,
        )

    def test_concurrency_unbounded_rss_fails(self):
        report = self._clean_report()
        report["concurrency"]["peak_rss_mb"] = 2000.0
        passed, problems = resource_gate.evaluate_resource_gates(report)
        self.assertFalse(passed)

    def test_cold_start_p95_at_or_over_watchdog_fails(self):
        report = self._clean_report()
        report["cold_start"]["p95_s"] = resource_gate.WATCHDOG_MAX_WAIT_S
        passed, problems = resource_gate.evaluate_resource_gates(report)
        self.assertFalse(passed)
        self.assertTrue(any("watchdog" in p for p in problems), problems)

    def test_empty_text_fails_long_audio(self):
        report = self._clean_report()
        report["long_audio"]["text_chars"] = 0
        passed, problems = resource_gate.evaluate_resource_gates(report)
        self.assertFalse(passed)
        self.assertTrue(any("empty" in p for p in problems), problems)


# --- Stub-server plumbing for the protocol-client tests ---------------------


class StubServer:
    """A minimal process speaking the production server's protocol shapes,
    spawned as a real child so ServerProcess's pipe handling is exercised
    for real."""

    SCRIPT = r'''
import json, sys, time
# init line first (production shape)
print(json.dumps({"success": True, "message": "stub init", "punc_loaded": True}), flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    cmd = json.loads(line)
    action = cmd.get("action")
    rid = cmd.get("request_id", "")
    if action == "exit":
        print(json.dumps({"success": True, "message": "stub exit", "request_id": rid}), flush=True)
        break
    if action == "ping":
        print(json.dumps({"success": True, "action": "pong", "request_id": rid}), flush=True)
    elif action == "transcribe_file":
        for pct in (10, 50, 96):
            print(json.dumps({"request_id": rid, "type": "progress", "phase": "asr",
                              "message": "stub", "progress_pct": pct}), flush=True)
            time.sleep(0.01)
        print(json.dumps({"success": True, "text": "stub text", "request_id": rid,
                          "type": "result"}), flush=True)
    elif action == "never_answer":
        time.sleep(5)
    else:
        print(json.dumps({"success": False, "error": "unknown", "request_id": rid}), flush=True)
'''

    def __enter__(self):
        self._tmp = tempfile.TemporaryDirectory()
        path = os.path.join(self._tmp.name, "stub_server.py")
        with open(path, "w", encoding="utf-8") as f:
            f.write(self.SCRIPT)
        self.proc = resource_gate.ServerProcess(
            sys.executable, path, damo_root=None
        )
        return self.proc

    def __exit__(self, *_exc):
        self.proc.close()
        self._tmp.cleanup()
        return False


class ServerProcessClientTest(unittest.TestCase):
    def test_init_line_and_ping_roundtrip(self):
        with StubServer() as proc:
            init = proc.wait_for_init(timeout=10)
            self.assertTrue(init["success"])
            pong = proc.request({"action": "ping", "request_id": "p1"}, timeout=10)
            self.assertEqual(pong["action"], "pong")
            self.assertEqual(pong["request_id"], "p1")

    def test_progress_and_result_correlation(self):
        with StubServer() as proc:
            proc.wait_for_init(timeout=10)
            result = proc.request(
                {"action": "transcribe_file", "request_id": "r1"}, timeout=10
            )
            self.assertEqual(result["type"], "result")
            self.assertEqual(result["request_id"], "r1")
            self.assertTrue(result["success"])
            progresses = [
                m
                for m in proc.messages
                if m.get("type") == "progress" and m.get("request_id") == "r1"
            ]
            self.assertEqual(len(progresses), 3)

    def test_deadline_exceeded_on_silent_server(self):
        with StubServer() as proc:
            proc.wait_for_init(timeout=10)
            with self.assertRaises(resource_gate.DeadlineExceeded):
                proc.request(
                    {"action": "never_answer", "request_id": "r2"}, timeout=0.5
                )
            # The client must survive a timed-out request and keep working
            # (the deadlock-detection primitive must not wedge the harness).
            pong = proc.request(
                {"action": "ping", "request_id": "p2"}, timeout=10
            )
            self.assertEqual(pong["action"], "pong")

    def test_close_is_idempotent(self):
        with StubServer() as proc:
            proc.wait_for_init(timeout=10)
            proc.close()
            proc.close()


# --- Resource arms (env-gated; see the module docstring for the run cmd) ----


def _resource_arms_enabled():
    if os.environ.get("MURMUR_RESOURCE_GATES") != "1":
        return False
    return resource_gate.real_run_enabled()


@unittest.skipUnless(
    _resource_arms_enabled(),
    "resource arms need MURMUR_RESOURCE_GATES=1 and the ONNX asr+vad models "
    "(see module docstring); CI runs without them",
)
class LongAudioResourceGateTest(unittest.TestCase):
    """Acceptance: >=10min audio, peak RSS <=1700MB, RTF <=0.1."""

    def test_ten_minute_audio_rss_and_rtf_within_gates(self):
        with tempfile.TemporaryDirectory() as tmp:
            long_wav = os.path.join(tmp, "long-10min.wav")
            duration_s = resource_gate.build_long_wav(
                FIXTURE_40S_WAV, long_wav, resource_gate.LONG_AUDIO_MIN_DURATION_S
            )
            self.assertGreaterEqual(
                duration_s, resource_gate.LONG_AUDIO_MIN_DURATION_S
            )
            measurement = resource_gate.measure_long_audio(long_wav)
        self.assertTrue(
            measurement["ok"], measurement.get("problems", measurement)
        )
        passed, problems = resource_gate.evaluate_resource_gates(
            {"long_audio": measurement}
        )
        self.assertTrue(passed, problems)


@unittest.skipUnless(
    _resource_arms_enabled(),
    "resource arms need MURMUR_RESOURCE_GATES=1 and the ONNX asr+vad models; "
    "CI runs without them",
)
class ConcurrencyDualTaskGateTest(unittest.TestCase):
    """Acceptance: mic + file concurrent — no deadlock, RSS bounded."""

    def test_mic_plus_file_concurrent_completes_and_stays_responsive(self):
        measurement = resource_gate.measure_concurrency(FIXTURE_40S_WAV)
        self.assertTrue(
            measurement["ok"], measurement.get("problems", measurement)
        )
        passed, problems = resource_gate.evaluate_resource_gates(
            {"concurrency": measurement}
        )
        self.assertTrue(passed, problems)


@unittest.skipUnless(
    _resource_arms_enabled(),
    "resource arms need MURMUR_RESOURCE_GATES=1 and the ONNX asr+vad models; "
    "CI runs without them",
)
class ColdStartP95GateTest(unittest.TestCase):
    """Acceptance: cold-start p95 over N fresh-process samples below the
    watchdog threshold."""

    def test_cold_start_p95_below_watchdog_threshold(self):
        measurement = resource_gate.measure_cold_start(
            FIXTURE_40S_WAV, samples=resource_gate.COLD_START_DEFAULT_SAMPLES
        )
        self.assertTrue(
            measurement["ok"], measurement.get("problems", measurement)
        )
        self.assertLess(measurement["p95_s"], resource_gate.WATCHDOG_MAX_WAIT_S)
        passed, problems = resource_gate.evaluate_resource_gates(
            {"cold_start": measurement}
        )
        self.assertTrue(passed, problems)


if __name__ == "__main__":
    unittest.main()
