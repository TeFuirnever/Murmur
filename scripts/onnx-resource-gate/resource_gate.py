#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20261006_Feat_421_ResourceGateRunner] Ticket #421 (spec #412 T7 / S1
seam): the resource acceptance gates as a repeatable runner.

Drives the PRODUCTION server (funasr_server.py) over its stdin/stdout JSON
protocol — the same seam the TS host uses — and measures, per spec #412
acceptance:

  1. long audio    a >=10 minute wav (tiled from the committed 40s fixture)
                   through transcribe_file; peak child RSS sampled during
                   inference must stay <= MAX_PEAK_RSS_MB and the ASR-phase
                   wall-clock RTF must stay <= MAX_RTF.
  2. concurrency   a transcribe_file task (inference worker thread) and a
                   transcribe task (read loop) sent together; both results
                   must arrive within deadline and the server must still
                   answer ping (deadlock detector), with bounded RSS.
  3. cold start    N fresh server processes, each spawn -> init -> first
                   transcription; p95 (nearest-rank) must stay below the TS
                   host's startup-watchdog outer cap (WATCHDOG_MAX_WAIT_S,
                   parity-locked with funasrServer.ts by
                   tests/python/test_resource_gates.py).
  4. protocol      schema regression lives in
                   tests/python/test_protocol_schema_regression.py and runs
                   on every suite run (CI included).

Stdlib-only at import time — heavy deps (onnxruntime/funasr_onnx) load ONLY
inside the spawned server children, so the stdlib unittest suite
(tests/python/test_resource_gates.py) can import this module anywhere.

Usage (evidence run; needs the ONNX asr+vad models):
  python scripts/onnx-resource-gate/resource_gate.py run \
      --damo-root <dir containing onnx-int8/> \
      --wav scripts/onnx-spike/fixtures/onnx-spike-40s.wav \
      --samples 5 --out-json work/resource_gate_results.json \
      --out-md work/resource_gate_report.md

The same measurements run through the python test entry with
MURMUR_RESOURCE_GATES=1 (arms self-skip otherwise — CI stays green).
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import uuid
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
FUNASR_SERVER_PATH = os.path.join(REPO_ROOT, "funasr_server.py")
TS_SERVER_PATH = os.path.join(REPO_ROOT, "src", "helpers", "funasrServer.ts")
DEFAULT_FIXTURE_WAV = os.path.join(
    REPO_ROOT, "scripts", "onnx-spike", "fixtures", "onnx-spike-40s.wav"
)

# --- Acceptance gates (pinned by tests/python/test_resource_gates.py) ------
GATE_SCHEMA_VERSION = 1
GATE_REQUIRED_KEYS = [
    "schema_version",
    "environment",
    "long_audio",
    "concurrency",
    "cold_start",
    "acceptance",
]
LONG_AUDIO_MIN_DURATION_S = 600  # spec: ">=10 分钟长音频"
MAX_PEAK_RSS_MB = 1700.0  # spec user story 6: 常驻 + 10min 峰值 <=1.7GB
MAX_RTF = 0.1  # spec user story 10: RTF <= 0.1
COLD_START_DEFAULT_SAMPLES = 5  # N startup samples for the p95
# TS host startup-watchdog outer cap (src/helpers/funasrServer.ts
# STARTUP_MAX_WAIT_MS = 600_000, heartbeat-based since #419). Parity is
# locked by test_watchdog_threshold_mirrors_ts_host — never edit one side
# alone.
WATCHDOG_MAX_WAIT_S = 600.0

# --- Measurement shape ------------------------------------------------------
RSS_POLL_INTERVAL_S = 0.25
# Deadlock detectors, not perf gates: a task that blows these failed the
# no-deadlock acceptance regardless of its RTF.
CONCURRENCY_DEADLINE_S = 300.0
PING_DEADLINE_S = 30.0
LONG_AUDIO_DEADLINE_S = 900.0
INIT_DEADLINE_S = WATCHDOG_MAX_WAIT_S + 60.0
COLD_START_TASK_DEADLINE_S = WATCHDOG_MAX_WAIT_S + 60.0


class DeadlineExceeded(TimeoutError):
    """A protocol wait blew its deadline — the no-deadlock gate's signal."""


def log(message: str) -> None:
    print(f"[resource-gate] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested in tests/python/test_resource_gates.py)
# ---------------------------------------------------------------------------


def watchdog_max_wait_s_from_ts(ts_source: str) -> float:
    """Parse STARTUP_MAX_WAIT_MS out of the TS host source (ms -> s)."""
    match = re.search(r"STARTUP_MAX_WAIT_MS\s*=\s*([0-9_]+)", ts_source)
    if not match:
        raise ValueError(
            "STARTUP_MAX_WAIT_MS not found in funasrServer.ts — the parity "
            "lock must be updated with the TS watchdog constant"
        )
    return int(match.group(1).replace("_", "")) / 1000.0


def percentile_nearest_rank(values, pct: float) -> float:
    """Nearest-rank percentile: ceil(pct * n)-th of the sorted values."""
    if not values:
        raise ValueError("percentile_nearest_rank needs at least one sample")
    ordered = sorted(float(v) for v in values)
    rank = max(1, math.ceil(pct * len(ordered)))
    return ordered[rank - 1]


def asr_phase_window_s(progress_events):
    """Wall seconds from the FIRST asr progress to the FIRST punc progress —
    the protocol-observable ASR phase window (convert/DSP/VAD and punc are
    excluded, so this is the ASR-inference window the RTF gate is about).
    None when either phase marker is missing."""
    asr_t = next(
        (e["t"] for e in progress_events if e.get("phase") == "asr"), None
    )
    punc_t = next(
        (e["t"] for e in progress_events if e.get("phase") == "punc"), None
    )
    if asr_t is None or punc_t is None:
        return None
    return punc_t - asr_t


def rtf_asr_phase(duration_s: float, window_s: float) -> float:
    """Real-time factor: inference wall seconds per audio second."""
    return window_s / duration_s


def wav_duration_s(path: str) -> float:
    with wave.open(path, "rb") as reader:
        return reader.getnframes() / float(reader.getframerate())


def build_long_wav(fixture_wav: str, out_path: str, min_duration_s: float):
    """Tile the committed fixture wav (real speech) into a >=min_duration_s
    wav; returns the produced duration. Stdlib wave only."""
    with wave.open(fixture_wav, "rb") as reader:
        params = reader.getparams()
        frames = reader.readframes(reader.getnframes())
    one_s = params.nframes / float(params.framerate)
    copies = max(1, math.ceil(min_duration_s / one_s))
    with wave.open(out_path, "wb") as writer:
        writer.setparams(params)
        for _ in range(copies):
            writer.writeframes(frames)
    return copies * one_s


def _sample_rss_bytes_posix(pid: int):
    try:
        completed = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    try:
        return int(completed.stdout.strip().splitlines()[-1]) * 1024
    except (ValueError, IndexError):
        return None


def _sample_rss_bytes_windows(pid: int):
    """Working-set size via ctypes psapi (measurement-only; no psutil dep
    in the embedded runtime)."""
    import ctypes
    from ctypes import wintypes

    PROCESS_QUERY_INFORMATION = 0x0400

    class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    kernel32 = ctypes.windll.kernel32
    psapi = ctypes.windll.psapi
    handle = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        if not psapi.GetProcessMemoryInfo(
            handle, ctypes.byref(counters), counters.cb
        ):
            return None
        return int(counters.WorkingSetSize)
    finally:
        kernel32.CloseHandle(handle)


def sample_rss_bytes(pid: int):
    """Child-process RSS bytes at this instant, or None when unqueryable
    (process gone / sampler unavailable)."""
    if pid is None or pid < 0:
        return None
    if os.name == "nt":
        return _sample_rss_bytes_windows(pid)
    return _sample_rss_bytes_posix(pid)


class RssMonitor:
    """Poll a child pid's RSS on a background thread; peak_mb() is the
    sampled high-water mark (ORT's arena never returns pages to the OS, so
    the PEAK is the number spec #412's RSS acceptance is about)."""

    def __init__(self, pid: int):
        self._pid = pid
        self._peak = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def _loop(self):
        while not self._stop.wait(RSS_POLL_INTERVAL_S):
            rss = sample_rss_bytes(self._pid)
            if rss is not None and rss > self._peak:
                self._peak = rss

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._thread.join(timeout=2.0)

    def peak_mb(self):
        return round(self._peak / 1024 / 1024, 1)


# ---------------------------------------------------------------------------
# Model resolution (which damo root carries the ONNX generation)
# ---------------------------------------------------------------------------


def resolve_damo_root(explicit=None):
    """First existing candidate carrying (or destined for) onnx-int8
    models: explicit arg > MURMUR_GATE_DAMO_ROOT > the platform's Electron
    userData/models (production layout) > the modelscope hub cache."""
    candidates = []
    if explicit:
        candidates.append(explicit)
    env_root = os.environ.get("MURMUR_GATE_DAMO_ROOT")
    if env_root:
        candidates.append(env_root)
    home = os.path.expanduser("~")
    if os.name == "nt":
        appdata = os.environ.get("APPDATA") or os.path.join(home, "AppData", "Roaming")
        candidates.append(os.path.join(appdata, "Murmur", "models"))
    else:
        candidates.append(
            os.path.join(home, "Library", "Application Support", "Murmur", "models")
        )
    candidates.append(os.path.join(home, ".cache", "modelscope", "hub", "models", "damo"))
    for candidate in candidates:
        if candidate and os.path.isdir(candidate):
            return candidate
    return None


def models_available(damo_root):
    """True when the asr AND vad ONNX pin-ready dirs exist under the T5
    layout (production readiness anchors, via funasr_server itself)."""
    if not damo_root:
        return False
    sys.path.insert(0, REPO_ROOT)
    try:
        import funasr_server
    except Exception as error:  # noqa: BLE001 - any import failure = unavailable
        log(f"funasr_server import failed during model probe: {error}")
        return False
    return all(
        funasr_server.FunASRServer._repo_ready(
            os.path.join(
                damo_root,
                funasr_server.ONNX_MODELS_SUBDIR,
                funasr_server.ONNX_MODEL_DIR_NAMES[key],
            )
        )
        for key in ("asr", "vad")
    )


def real_run_enabled(damo_root=None):
    """Resource arms run only when explicitly requested AND the models are
    present — keeps the default suite (and CI) green and fast."""
    return models_available(resolve_damo_root(damo_root))


# ---------------------------------------------------------------------------
# Protocol client (S1 seam: the production server driven over stdin/stdout)
# ---------------------------------------------------------------------------


class ServerProcess:
    """Spawn funasr_server.py (or a stub speaking its protocol), parse every
    stdout line as a protocol message, and correlate responses by
    request_id with deadlines. A background thread drains stderr (the
    server logs there) so a full stderr pipe can never wedge the child."""

    def __init__(self, python_exe, server_path, damo_root=None):
        command = [python_exe, server_path]
        if damo_root:
            command += ["--damo-root", damo_root]
        # UTF-8 pipes regardless of the Windows console codepage (same
        # discipline as win_spike children).
        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
        self._proc = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env=env,
            bufsize=1,
        )
        self._cond = threading.Condition()
        self._messages = []
        self._message_times = []
        self.progress_events = []
        self.noise = []
        self.stderr_tail = []
        self._sequence = 0
        self._closed = False
        self._reader = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader.start()
        self._stderr_drain = threading.Thread(
            target=self._drain_stderr, daemon=True
        )
        self._stderr_drain.start()

    @property
    def pid(self):
        return self._proc.pid

    @property
    def messages(self):
        with self._cond:
            return list(self._messages)

    def _read_stdout(self):
        for line in self._proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                # The server's stdout must be protocol-only; a stray line is
                # a contract violation — keep it visible, never fatal here.
                with self._cond:
                    self.noise.append(line[:200])
                    self._cond.notify_all()
                continue
            with self._cond:
                self._messages.append(message)
                self._message_times.append(time.monotonic())
                if isinstance(message, dict) and message.get("type") == "progress":
                    self.progress_events.append(
                        {
                            "phase": message.get("phase"),
                            "t": self._message_times[-1],
                        }
                    )
                self._cond.notify_all()
        with self._cond:
            self._cond.notify_all()

    def _drain_stderr(self):
        for line in self._proc.stderr:
            self.stderr_tail.append(line.rstrip())
            del self.stderr_tail[:-50]

    def _wait_for(self, predicate, timeout, what):
        deadline = time.monotonic() + timeout
        with self._cond:
            while True:
                for index, message in enumerate(self._messages):
                    if predicate(message):
                        return message, self._message_times[index]
                if self._proc.poll() is not None:
                    raise DeadlineExceeded(
                        f"{what}: server exited before answering "
                        f"(stderr tail: {self.stderr_tail[-5:]})"
                    )
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise DeadlineExceeded(
                        f"{what}: no matching protocol message within "
                        f"{timeout:.1f}s (deadlock suspected)"
                    )
                self._cond.wait(min(remaining, 0.5))

    def wait_for_init(self, timeout=INIT_DEADLINE_S):
        """The startup init line: has success, neither request_id nor type
        (those arms only appear on command responses / queued output)."""
        init, _t = self._wait_for(
            lambda m: isinstance(m, dict)
            and "success" in m
            and "request_id" not in m
            and "type" not in m,
            timeout,
            "init",
        )
        return init

    def _send(self, command):
        self._sequence += 1
        if not command.get("request_id"):
            command["request_id"] = f"gate-{self._sequence}-{uuid.uuid4().hex[:8]}"
        line = json.dumps(command, ensure_ascii=False) + "\n"
        self._proc.stdin.write(line)
        self._proc.stdin.flush()
        return command["request_id"]

    def request(self, command, timeout):
        """Send and wait for the final (non-progress) response carrying the
        command's request_id."""
        request_id = self._send(command)
        result, _t = self._wait_for(
            lambda m: isinstance(m, dict)
            and m.get("request_id") == request_id
            and m.get("type") != "progress",
            timeout,
            f"request {command.get('action')} ({request_id})",
        )
        return result

    def send(self, command):
        """Fire-and-forget send (concurrency overlap needs both commands in
        flight before waiting on either)."""
        return self._send(command)

    def wait_for_result(self, request_id, timeout):
        result, _t = self._wait_for(
            lambda m: isinstance(m, dict)
            and m.get("request_id") == request_id
            and m.get("type") != "progress",
            timeout,
            f"result for {request_id}",
        )
        return result

    def close(self):
        if self._closed:
            return
        self._closed = True
        try:
            self._proc.stdin.write(json.dumps({"action": "exit"}) + "\n")
            self._proc.stdin.flush()
        except (OSError, ValueError):
            pass  # stdin already gone — the kill path below settles it
        try:
            self._proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        # Release the pipe fds (otherwise the interpreter flags the unused
        # wrappers with ResourceWarning after each child).
        for stream in (self._proc.stdin, self._proc.stdout, self._proc.stderr):
            try:
                stream.close()
            except (OSError, ValueError):
                pass


# ---------------------------------------------------------------------------
# Measurements
# ---------------------------------------------------------------------------


def _init_server(damo_root):
    server = ServerProcess(sys.executable, FUNASR_SERVER_PATH, damo_root=damo_root)
    t0 = time.monotonic()
    init = server.wait_for_init()
    return server, init, time.monotonic() - t0


def measure_long_audio(wav_path, damo_root=None):
    """Gate 1: >=10min transcribe_file — peak RSS and ASR-phase RTF."""
    root = resolve_damo_root(damo_root)
    duration_s = wav_duration_s(wav_path)
    measurement = {
        "wav": os.path.basename(wav_path),
        "duration_s": round(duration_s, 2),
        "ok": False,
        "problems": [],
    }
    if duration_s < LONG_AUDIO_MIN_DURATION_S:
        measurement["problems"].append(
            f"wav is {duration_s:.1f}s, below the {LONG_AUDIO_MIN_DURATION_S}s minimum"
        )
        return measurement
    server = None
    try:
        server, init, _init_s = _init_server(root)
        if not init.get("success"):
            measurement["problems"].append(
                f"server init failed: {init.get('error')}"
            )
            return measurement
        monitor = RssMonitor(server.pid)
        monitor.start()
        try:
            t_send = time.monotonic()
            result = server.request(
                {
                    "action": "transcribe_file",
                    "audio_path": wav_path,
                    "options": {"use_vad": True},
                },
                timeout=LONG_AUDIO_DEADLINE_S,
            )
            t_result = time.monotonic()
        finally:
            monitor.stop()
        elapsed_s = t_result - t_send
        window_s = asr_phase_window_s(server.progress_events)
        text = result.get("text") or result.get("raw_text") or ""
        segments = result.get("segments") or []
        measurement.update(
            {
                "result_ok": bool(result.get("success")),
                "elapsed_s": round(elapsed_s, 2),
                "asr_window_s": round(window_s, 2) if window_s is not None else None,
                "rtf_asr_phase": (
                    round(rtf_asr_phase(duration_s, window_s), 4)
                    if window_s is not None
                    else None
                ),
                "rtf_e2e": round(rtf_asr_phase(duration_s, elapsed_s), 4),
                "peak_rss_mb": monitor.peak_mb(),
                "text_chars": len(text),
                "segment_count": len(segments),
            }
        )
        if not result.get("success"):
            measurement["problems"].append(
                f"transcribe_file failed: {result.get('error')}"
            )
    except DeadlineExceeded as error:
        measurement["problems"].append(str(error))
    finally:
        if server is not None:
            server.close()
    measurement["ok"] = not measurement["problems"]
    return measurement


def measure_concurrency(fixture_wav, damo_root=None):
    """Gate 2: transcribe_file (worker thread) + transcribe (read loop) in
    flight together — both results within deadline, ping answered after,
    RSS bounded."""
    root = resolve_damo_root(damo_root)
    measurement = {
        "wav": os.path.basename(fixture_wav),
        "ok": False,
        "problems": [],
    }
    server = None
    try:
        server, init, _t_init = _init_server(root)
        if not init.get("success"):
            measurement["problems"].append(
                f"server init failed: {init.get('error')}"
            )
            return measurement
        monitor = RssMonitor(server.pid)
        monitor.start()
        try:
            # Overlap: enqueue the file task, THEN hand the mic task to the
            # read loop — worker and read loop run the two inferences in
            # parallel (production dispatch semantics).
            file_rid = server.send(
                {
                    "action": "transcribe_file",
                    "audio_path": fixture_wav,
                    "options": {"use_vad": True},
                }
            )
            t_overlap = time.monotonic()
            mic_rid = server.send(
                {"action": "transcribe", "audio_path": fixture_wav, "options": {}}
            )
            file_result = server.wait_for_result(
                file_rid, timeout=CONCURRENCY_DEADLINE_S
            )
            t_file = time.monotonic()
            mic_result = server.wait_for_result(
                mic_rid, timeout=CONCURRENCY_DEADLINE_S
            )
            t_mic = time.monotonic()
            pong = server.request({"action": "ping"}, timeout=PING_DEADLINE_S)
        finally:
            monitor.stop()
        measurement.update(
            {
                "file_result_ok": bool(file_result.get("success")),
                "mic_result_ok": bool(mic_result.get("success")),
                "ping_ok": bool(pong.get("action") == "pong"),
                "file_elapsed_s": round(t_file - t_overlap, 2),
                "mic_elapsed_s": round(t_mic - t_overlap, 2),
                "peak_rss_mb": monitor.peak_mb(),
            }
        )
        if not file_result.get("success"):
            measurement["problems"].append(
                f"file task failed: {file_result.get('error')}"
            )
        if not mic_result.get("success"):
            measurement["problems"].append(
                f"mic task failed: {mic_result.get('error')}"
            )
        if not measurement["ping_ok"]:
            measurement["problems"].append(
                "server did not answer ping after both tasks (deadlock suspected)"
            )
    except DeadlineExceeded as error:
        measurement["problems"].append(
            f"deadlock suspected: {error}"
        )
    finally:
        if server is not None:
            server.close()
    measurement["ok"] = not measurement["problems"]
    return measurement


def measure_cold_start(fixture_wav, samples=COLD_START_DEFAULT_SAMPLES, damo_root=None):
    """Gate 3: N fresh processes, each spawn -> init -> first transcription;
    p95 (nearest-rank) vs the TS watchdog outer cap."""
    root = resolve_damo_root(damo_root)
    measurement = {
        "samples_requested": samples,
        "samples_s": [],
        "init_s": [],
        "first_infer_s": [],
        "ok": False,
        "problems": [],
    }
    for index in range(samples):
        server = None
        try:
            t0 = time.monotonic()
            server = ServerProcess(
                sys.executable, FUNASR_SERVER_PATH, damo_root=root
            )
            server.wait_for_init()
            t_init = time.monotonic()
            server.request(
                {"action": "transcribe", "audio_path": fixture_wav, "options": {}},
                timeout=COLD_START_TASK_DEADLINE_S,
            )
            t_infer = time.monotonic()
            measurement["init_s"].append(round(t_init - t0, 2))
            measurement["first_infer_s"].append(round(t_infer - t_init, 2))
            measurement["samples_s"].append(round(t_infer - t0, 2))
            log(
                f"cold sample {index + 1}/{samples}: "
                f"{measurement['samples_s'][-1]}s"
            )
        except DeadlineExceeded as error:
            measurement["problems"].append(f"sample {index + 1}: {error}")
        finally:
            if server is not None:
                server.close()
    landed = measurement["samples_s"]
    if landed:
        measurement["p95_s"] = round(
            percentile_nearest_rank(landed, 0.95), 2
        )
        measurement["max_s"] = max(landed)
        measurement["median_s"] = round(
            percentile_nearest_rank(landed, 0.5), 2
        )
    else:
        measurement["p95_s"] = None
    measurement["ok"] = not measurement["problems"] and bool(landed)
    return measurement


# ---------------------------------------------------------------------------
# Gate verdicts
# ---------------------------------------------------------------------------


def evaluate_long_audio(measurement):
    problems = list(measurement.get("problems", []))
    duration_s = measurement.get("duration_s", 0)
    peak_rss_mb = measurement.get("peak_rss_mb")
    rtf = measurement.get("rtf_asr_phase")
    if duration_s < LONG_AUDIO_MIN_DURATION_S:
        problems.append(
            f"audio duration {duration_s}s is below the required "
            f"{LONG_AUDIO_MIN_DURATION_S}s minimum"
        )
    if peak_rss_mb is None or peak_rss_mb > MAX_PEAK_RSS_MB:
        problems.append(
            f"peak RSS {peak_rss_mb}MB exceeds the {MAX_PEAK_RSS_MB}MB gate"
        )
    if rtf is None:
        problems.append("RTF window unavailable (no asr/punc progress pair)")
    elif rtf > MAX_RTF:
        problems.append(f"ASR-phase RTF {rtf} exceeds the {MAX_RTF} gate")
    if not measurement.get("text_chars"):
        problems.append(
            "transcription text is empty — output contract violated"
        )
    return problems


def evaluate_concurrency(measurement):
    problems = list(measurement.get("problems", []))
    if not measurement.get("file_result_ok"):
        problems.append(
            "deadlock suspected: file task did not complete within deadline"
        )
    if not measurement.get("mic_result_ok"):
        problems.append(
            "deadlock suspected: mic task did not complete within deadline"
        )
    if not measurement.get("ping_ok"):
        problems.append("deadlock suspected: ping after both tasks failed")
    peak_rss_mb = measurement.get("peak_rss_mb")
    if peak_rss_mb is None or peak_rss_mb > MAX_PEAK_RSS_MB:
        problems.append(
            f"concurrent peak RSS {peak_rss_mb}MB exceeds the "
            f"{MAX_PEAK_RSS_MB}MB gate"
        )
    return problems


def evaluate_cold_start(measurement):
    problems = list(measurement.get("problems", []))
    p95_s = measurement.get("p95_s")
    if not measurement.get("samples_s"):
        problems.append("no cold-start samples landed")
    elif p95_s is None or p95_s >= WATCHDOG_MAX_WAIT_S:
        problems.append(
            f"cold-start p95 {p95_s}s is at/over the TS watchdog threshold "
            f"({WATCHDOG_MAX_WAIT_S}s)"
        )
    return problems


def evaluate_resource_gates(report):
    """Aggregate verdict over whichever families the report carries."""
    problems = []
    if "long_audio" in report:
        problems.extend(evaluate_long_audio(report["long_audio"]))
    if "concurrency" in report:
        problems.extend(evaluate_concurrency(report["concurrency"]))
    if "cold_start" in report:
        problems.extend(evaluate_cold_start(report["cold_start"]))
    return (not problems), problems


# ---------------------------------------------------------------------------
# Evidence rendering
# ---------------------------------------------------------------------------


def collect_environment(damo_root):
    import platform

    return {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "damo_root": damo_root,
        "models_available": models_available(damo_root),
        "watchdog_threshold_s": WATCHDOG_MAX_WAIT_S,
        "gates": {
            "max_peak_rss_mb": MAX_PEAK_RSS_MB,
            "max_rtf": MAX_RTF,
            "min_long_audio_s": LONG_AUDIO_MIN_DURATION_S,
        },
    }


def render_markdown(report: dict) -> str:
    lines = [
        "# ONNX resource gates — release evidence (ticket #421, spec #412 T7)",
        "",
        "## Environment",
        "",
    ]
    env = report["environment"]
    lines.append(f"- platform: `{env['platform']}` ({env['machine']}), cpus: {env['cpu_count']}")
    lines.append(f"- python: {env['python']} · damo root: `{env['damo_root']}`")
    lines.append(
        f"- gates: RSS<={env['gates']['max_peak_rss_mb']}MB · "
        f"RTF<={env['gates']['max_rtf']} · audio>={env['gates']['min_long_audio_s']}s · "
        f"cold p95<{env['watchdog_threshold_s']}s"
    )
    lines += ["", "## Long audio (>=10 min)", ""]
    long = report["long_audio"]
    lines.append(f"- duration: {long['duration_s']}s · elapsed: {long.get('elapsed_s')}s")
    lines.append(f"- peak RSS: **{long.get('peak_rss_mb')} MB** (gate {MAX_PEAK_RSS_MB}MB)")
    lines.append(f"- ASR-phase RTF: **{long.get('rtf_asr_phase')}** (gate {MAX_RTF}) · e2e RTF {long.get('rtf_e2e')}")
    lines.append(f"- text chars: {long.get('text_chars')} · segments: {long.get('segment_count')}")
    lines += ["", "## Concurrency (mic + file)", ""]
    conc = report["concurrency"]
    lines.append(
        f"- file ok: {conc.get('file_result_ok')} · mic ok: {conc.get('mic_result_ok')} · "
        f"ping ok: {conc.get('ping_ok')}"
    )
    lines.append(f"- peak RSS: **{conc.get('peak_rss_mb')} MB** · file {conc.get('file_elapsed_s')}s · mic {conc.get('mic_elapsed_s')}s")
    lines += ["", "## Cold start", ""]
    cold = report["cold_start"]
    lines.append(f"- samples ({len(cold.get('samples_s', []))}): {cold.get('samples_s')}")
    lines.append(f"- p95: **{cold.get('p95_s')}s** (watchdog {WATCHDOG_MAX_WAIT_S}s)")
    lines += ["", "## Acceptance", ""]
    verdict = "PASS" if report["acceptance"]["passed"] else "FAIL"
    lines.append(f"- verdict: **{verdict}**")
    for problem in report["acceptance"]["problems"]:
        lines.append(f"- problem: {problem}")
    lines.append("")
    return "\n".join(lines)


def _cmd_run(args) -> int:
    damo_root = resolve_damo_root(args.damo_root)
    if not models_available(damo_root):
        log(f"no pin-ready ONNX asr+vad models under {damo_root} — cannot run")
        print("RESOURCE-GATE: FAIL (models unavailable)")
        return 1
    log(f"damo root: {damo_root}")

    work_dir = os.path.dirname(os.path.abspath(args.out_json))
    os.makedirs(work_dir, exist_ok=True)
    long_wav = os.path.join(work_dir, "resource-gate-10min.wav")
    duration_s = build_long_wav(args.wav, long_wav, LONG_AUDIO_MIN_DURATION_S)
    log(f"long wav: {long_wav} ({duration_s:.1f}s)")

    log("measure: long audio…")
    long_audio = measure_long_audio(long_wav, damo_root=damo_root)
    log(f"long audio: peak RSS {long_audio.get('peak_rss_mb')}MB, "
        f"RTF {long_audio.get('rtf_asr_phase')}, problems {long_audio['problems']}")

    log("measure: concurrency…")
    concurrency = measure_concurrency(args.wav, damo_root=damo_root)
    log(f"concurrency: peak RSS {concurrency.get('peak_rss_mb')}MB, "
        f"problems {concurrency['problems']}")

    log(f"measure: cold start x{args.samples}…")
    cold_start = measure_cold_start(args.wav, samples=args.samples, damo_root=damo_root)
    log(f"cold start: p95 {cold_start.get('p95_s')}s")

    passed, problems = evaluate_resource_gates(
        {
            "long_audio": long_audio,
            "concurrency": concurrency,
            "cold_start": cold_start,
        }
    )
    report = {
        "schema_version": GATE_SCHEMA_VERSION,
        "environment": collect_environment(damo_root),
        "long_audio": long_audio,
        "concurrency": concurrency,
        "cold_start": cold_start,
        "acceptance": {"passed": passed, "problems": problems},
    }
    for out_path, payload in (
        (args.out_json, json.dumps(report, ensure_ascii=False, indent=2) + "\n"),
        (args.out_md, render_markdown(report)),
    ):
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(payload)
        log(f"wrote {out_path}")

    print("RESOURCE-GATE:", "PASS" if passed else "FAIL")
    for problem in problems:
        print(f"RESOURCE-GATE problem: {problem}")
    return 0 if passed else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    run_parser = sub.add_parser("run", help="parent orchestrator (evidence run)")
    run_parser.add_argument("--damo-root", default=None)
    run_parser.add_argument("--wav", default=DEFAULT_FIXTURE_WAV)
    run_parser.add_argument("--samples", type=int, default=COLD_START_DEFAULT_SAMPLES)
    run_parser.add_argument(
        "--out-json",
        default=os.path.join(HERE, "work", "resource_gate_results.json"),
    )
    run_parser.add_argument(
        "--out-md",
        default=os.path.join(HERE, "work", "resource_gate_report.md"),
    )
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.mode == "run":
        return _cmd_run(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
