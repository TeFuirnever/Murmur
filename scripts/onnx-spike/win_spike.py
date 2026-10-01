#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[20261001_T415_OnnxWinSpike] Ticket #415 (spec #412 T2): Windows x64
ONNX spike — the first link of the pre-tag release evidence chain.

Runs ON THE CI WINDOWS RUNNER (locally on any platform for debugging) against
the T1 SELF-EXPORTED model bytes (scripts/onnx-export/model-pin.json → our own
GitHub Release mirror; community repos are never a download source):

  1. install-size   size of the pip environment that carries the ONNX
                    runtime stack (funasr-onnx + onnxruntime, NO torch) —
                    the win x64 data point for the spec's installer-size
                    goal.
  2. cold start     N fresh subprocesses, each: spawn → import → load the
                    FOUR models → first ASR transcription of the 40s wav.
                    Reported per-sample + min/median/max (spec decision 18:
                    首次转写冷启动 p95 有上界 → needs repeated sampling).
  3. inference+RSS  the 40s wav through ASR (plain + hotword path), VAD,
                    Punc, and the CAMPPlus speaker graph; RSS sampled after
                    each model load and polled during inference (ORT's
                    arena never returns memory to the OS, so peak RSS is
                    the number that matters — spec #412 residual risks).
  4. acceptance     ticket gate: transcribed text NON-EMPTY, plus the
                    documented structural sanity thresholds below.

Stdlib-only at import time — the heavy deps (funasr_onnx / onnxruntime /
psutil / soundfile) load lazily inside the measurement phases so the
stdlib unittest suite (tests/python/test_onnx_win_spike.py) and any future
pre-flight check can import this module on machines without them.

Usage:
  # fetch + verify the pinned self-exported bytes (T1 trust chain):
  python scripts/onnx-export/verify_artifacts.py --from-release \
      --download-dir <models-dir>

  # then run the spike:
  python scripts/onnx-spike/win_spike.py run \
      --models-dir <models-dir> \
      --wav scripts/onnx-spike/fixtures/onnx-spike-40s.wav \
      --samples 5 --out-json results.json --out-md report.md

Child modes (cold-child / measure-child) are internal: the parent spawns
them as fresh processes so cold-start numbers are true cold starts. They
print exactly one JSON line on stdout; logs go to stderr.
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
ONNX_EXPORT_DIR = os.path.join(REPO_ROOT, "scripts", "onnx-export")
DEFAULT_PIN = os.path.join(ONNX_EXPORT_DIR, "model-pin.json")
DEFAULT_WAV = os.path.join(HERE, "fixtures", "onnx-spike-40s.wav")

# The four models of spec #412 (mirrors the pin's top-level keys; the pin
# is the source of truth for names/repos/hashes — this is only the key set
# the spike must cover).
MODEL_KEYS = ("asr", "vad", "punc", "speaker")

# Acceptance thresholds. The ticket gate itself is "text non-empty"; the
# other two are structural sanity pinned as constants so CI evidence cannot
# silently loosen: a 40s wav transcribing to <30 chars or drifting below
# the T1-verified 0.92 similarity baseline (mac) at 0.60 is a broken model,
# not a pass.
MIN_TEXT_CHARS = 30
MIN_SIMILARITY = 0.60
MIN_VAD_SEGMENTS = 1

# Measurement shape: cold-start sample count is a CLI flag (--samples,
# default 5); RTF uses 3 warm runs (same as the T1 smoke so numbers stay
# comparable); RSS polling interval during inference.
RTF_WARM_RUNS = 3
RSS_POLL_INTERVAL_S = 0.05

RESULTS_SCHEMA_VERSION = 1
RESULTS_REQUIRED_KEYS = [
    "schema_version",
    "environment",
    "install_size",
    "cold_start",
    "measure",
    "acceptance",
]

# [20261001_T415_OnnxWinSpike] Spike speech: byte-identical twin of the T1
# smoke (scripts/onnx-export/smoke_inference.py SMOKE_TEXT/HOTWORDS). The
# committed fixtures/onnx-spike-40s.wav is the Tingting render of this text
# produced during T1 (macOS 27, 16k mono s16, 40.83s) — committing the wav
# makes every CI run (win x64 now, mac later) measure THE SAME bytes, so
# cross-platform numbers are comparable. Similarity thresholds inherit the
# T1 rationale (TTS intonation + punc insertion make 1.0 unreachable).
REFERENCE_TEXT = (
    "语音识别技术把人类说话的声学信号转换成文字,是很多人日常工作中离不开的工具。"
    "端到端模型把整条链路合并成一个神经网络,直接从音频输出文字,训练更简单,识别更准确。"
    "我们的应用程序在本地完成全部识别过程,音频不会上传到任何服务器,保护用户隐私。"
    "接下来还要支持热词功能,用户可以添加人名和专业术语,提高专有名词的识别准确率。"
    "欢迎大家在设置页面体验新版本,谢谢大家。"
)
HOTWORDS = "语音识别 端到端模型 热词 隐私"


def log(message: str) -> None:
    # Logs go to stderr: stdout carries the child JSON contract.
    print(f"[win-spike] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested in tests/python/test_onnx_win_spike.py)
# ---------------------------------------------------------------------------


def levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (ca != cb),
            ))
        previous = current
    return previous[-1]


def char_similarity(reference: str, hypothesis: str) -> float:
    """Same algorithm as the T1 smoke (kept identical so the win numbers are
    comparable with the mac baseline in scripts/onnx-export/smoke_results.json)."""
    ref = "".join(reference.split())
    hyp = "".join(hypothesis.split())
    if not ref:
        return 0.0
    return 1.0 - levenshtein(ref, hyp) / max(len(ref), len(hyp))


def evaluate_acceptance(text_plain: str, similarity: float, vad_segments: int):
    """Ticket #415 gate: 40s-wav transcription must be non-empty. Structural
    sanity (min chars / similarity floor / VAD presence) rides along, pinned
    as module constants. Returns (passed, problems)."""
    stripped = text_plain.strip()
    problems = []
    if not stripped:
        problems.append("ASR text must be non-empty — ticket gate (文本非空) failed")
    if len(stripped) < MIN_TEXT_CHARS:
        problems.append(
            f"ASR text too short ({len(stripped)} < {MIN_TEXT_CHARS} chars)"
        )
    if similarity < MIN_SIMILARITY:
        problems.append(
            f"char similarity {similarity:.4f} < {MIN_SIMILARITY} "
            "(garbled output suspicion)"
        )
    if vad_segments < MIN_VAD_SEGMENTS:
        problems.append(
            f"VAD found {vad_segments} segments (< {MIN_VAD_SEGMENTS})"
        )
    return (not problems), problems


def cold_start_stats(samples_s):
    """Aggregate N cold-start samples: count + min/median/max (median of an
    even sample count is the mean of the middle pair)."""
    values = sorted(float(s) for s in samples_s)
    if not values:
        raise ValueError("cold_start_stats needs at least one sample")
    count = len(values)
    mid = count // 2
    median = values[mid] if count % 2 else (values[mid - 1] + values[mid]) / 2.0
    return {
        "count": count,
        "min_s": values[0],
        "median_s": median,
        "max_s": values[-1],
    }


def dir_size_bytes(root: str) -> int:
    if not os.path.isdir(root):
        return 0
    total = 0
    for dirpath, _dirnames, filenames in os.walk(root):
        for filename in filenames:
            full = os.path.join(dirpath, filename)
            try:
                total += os.path.getsize(full)
            except OSError:
                # A vanishing temp file must not kill the measurement.
                pass
    return total


def largest_site_packages(site_dir: str, top_n: int = 10):
    """Per-package size breakdown of a site-packages dir: one entry per
    top-level directory (stray root files are skipped, not crashed on)."""
    entries = []
    if os.path.isdir(site_dir):
        for name in sorted(os.listdir(site_dir)):
            full = os.path.join(site_dir, name)
            if os.path.isdir(full):
                entries.append({"name": name, "size_bytes": dir_size_bytes(full)})
    entries.sort(key=lambda entry: entry["size_bytes"], reverse=True)
    return entries[:top_n]


def verify_models_dir(models_dir: str, pin: dict):
    """Re-verify the downloaded model bytes against the committed pin before
    ANY inference: strict set semantics via onnx_export_common.check_manifest
    (missing / tampered / unlisted-extra file all fail). The spike must run
    on the SELF-EXPORTED pinned bytes — this is the in-spike enforcement."""
    sys.path.insert(0, ONNX_EXPORT_DIR)
    from onnx_export_common import check_manifest  # noqa: E402

    problems = []
    for key in MODEL_KEYS:
        entry = pin["models"][key]
        root = os.path.join(models_dir, entry["name"])
        for problem in check_manifest(root, entry["files"]):
            problems.append(f"{key}: {problem}")
    return problems


def resolve_model_dirs(models_dir: str, pin: dict):
    return {
        key: os.path.join(models_dir, pin["models"][key]["name"])
        for key in MODEL_KEYS
    }


def load_pin(pin_path: str) -> dict:
    with open(pin_path, encoding="utf-8") as f:
        return json.load(f)


def wav_duration_s(path: str) -> float:
    import wave

    with wave.open(path, "rb") as reader:
        return reader.getnframes() / float(reader.getframerate())


def render_markdown(report: dict) -> str:
    env = report["environment"]
    install = report["install_size"]
    cold = report["cold_start"]
    measure = report["measure"]
    acceptance = report["acceptance"]
    verdict = "PASS" if acceptance["passed"] else "FAIL"

    lines = []
    lines.append("# ONNX win x64 spike — CI evidence (ticket #415, spec #412 T2)")
    lines.append("")
    lines.append("## Environment")
    lines.append("")
    lines.append(f"- platform: `{env['platform']}` ({env['machine']}), cpus: {env['cpu_count']}")
    lines.append(f"- python: {env['python']} · onnxruntime: {env['onnxruntime']} · funasr-onnx: {env['funasr_onnx']}")
    lines.append(f"- models: self-exported bytes from `{env['pin_release_tag']}` (model-pin.json, sha256 strict-set verified before inference)")
    lines.append("")
    lines.append("## Install size (ONNX runtime pip env, no torch)")
    lines.append("")
    lines.append(f"- site-packages total: **{install['site_packages_mb']} MB**")
    lines.append("- largest packages:")
    for entry in install.get("largest_packages", []):
        lines.append(
            f"  - {entry['name']}: {entry['size_bytes'] / 1024 / 1024:.1f} MB"
        )
    lines.append("")
    lines.append("## Cold start (fresh process → 4 models loaded → first 40s transcript)")
    lines.append("")
    stats = cold["stats"]
    lines.append(f"- samples ({stats['count']}): {cold['samples_s']}")
    lines.append(f"- min / median / max: **{stats['min_s']:.2f} / {stats['median_s']:.2f} / {stats['max_s']:.2f} s**")
    lines.append("")
    lines.append("## RSS")
    lines.append("")
    rss = measure["rss_mb"]
    for label, value in rss.items():
        lines.append(f"- {label}: {value} MB")
    lines.append("")
    lines.append("## 40s wav inference")
    lines.append("")
    asr = measure["asr"]
    lines.append(f"- text ({len(asr['text_plain'])} chars): {asr['text_plain'][:120]}…")
    lines.append(f"- char similarity vs reference: {asr['char_similarity_vs_reference']}")
    lines.append(f"- timestamps present: {asr['timestamp_present']}")
    lines.append(f"- ASR RTF best of {len(measure['performance']['asr_rtf_runs'])}: {measure['performance']['asr_rtf_best']}")
    lines.append("")
    lines.append("## Acceptance")
    lines.append("")
    lines.append(f"- verdict: **{verdict}**")
    for problem in acceptance["problems"]:
        lines.append(f"- problem: {problem}")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Measurement children (fresh processes; one JSON line on stdout)
# ---------------------------------------------------------------------------


class PeakRssMonitor:
    """Poll this process's RSS while inference runs (Windows has no
    getrusage ru_maxrss; psutil polling at a fixed interval is the honest
    sampled-peak)."""

    def __init__(self):
        import psutil

        self._process = psutil.Process()
        self._peak = self._process.memory_info().rss
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def _loop(self):
        while not self._stop.wait(RSS_POLL_INTERVAL_S):
            try:
                rss = self._process.memory_info().rss
                if rss > self._peak:
                    self._peak = rss
            except Exception:  # psutil race at shutdown — keep last peak
                break

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_exc):
        self._stop.set()
        self._thread.join(timeout=1.0)
        return False

    def peak_mb(self) -> float:
        return round(self._peak / 1024 / 1024, 1)


def _rss_mb() -> float:
    import psutil

    return round(psutil.Process().memory_info().rss / 1024 / 1024, 1)


def _load_audio(wav_path: str):
    import soundfile as sf

    data, samplerate = sf.read(wav_path, dtype="float32")
    assert samplerate == 16000, f"expected 16k wav, got {samplerate}"
    return data


def _load_four_models(model_dirs: dict):
    """Load exactly the four pinned models the way the production runtime
    will: funasr-onnx loaders for asr/vad/punc; CAMPPlus directly through
    onnxruntime (funasr-onnx 0.4.3 has no speaker loader — verified in T1)."""
    from funasr_onnx import CT_Transformer, Fsmn_vad, SeacoParaformer
    import onnxruntime as ort
    import yaml

    timings = {}
    models = {}

    start = time.perf_counter()
    models["asr"] = SeacoParaformer(model_dirs["asr"], quantize=True)
    timings["asr"] = round(time.perf_counter() - start, 3)

    start = time.perf_counter()
    models["vad"] = Fsmn_vad(model_dirs["vad"], quantize=True)
    timings["vad"] = round(time.perf_counter() - start, 3)

    start = time.perf_counter()
    models["punc"] = CT_Transformer(model_dirs["punc"], quantize=True)
    timings["punc"] = round(time.perf_counter() - start, 3)

    # CAMPPlus: safe_load the config (spec decision 7 — upstream read_yaml
    # uses the unsafe Loader; the spike only ever safe_loads) to derive the
    # feature dimension, then create the int8 session.
    start = time.perf_counter()
    with open(os.path.join(model_dirs["speaker"], "config.yaml"), encoding="utf-8") as f:
        speaker_config = yaml.safe_load(f)
    feat_dim = int(speaker_config["model_conf"]["feat_dim"])
    models["speaker"] = ort.InferenceSession(
        os.path.join(model_dirs["speaker"], "model_quant.onnx"),
        providers=["CPUExecutionProvider"],
    )
    models["speaker_feat_dim"] = feat_dim
    timings["speaker"] = round(time.perf_counter() - start, 3)
    return models, timings


def _child_common_setup(args):
    # UTF-8 everywhere: the CI Windows console default codepage must never
    # mangle the transcript before it reaches the parent.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:  # non-TextIO in exotic embedders — CI has it
            pass
    pin = load_pin(args.pin)
    model_dirs = resolve_model_dirs(args.models_dir, pin)
    audio = _load_audio(args.wav)
    duration = len(audio) / 16000.0
    return pin, model_dirs, audio, duration


def cmd_cold_child(args) -> int:
    cold_start_t0 = time.perf_counter()
    pin, model_dirs, audio, duration = _child_common_setup(args)

    import_start = time.perf_counter()
    import onnxruntime  # noqa: F401  (import cost IS part of cold start)
    from funasr_onnx import CT_Transformer, Fsmn_vad, SeacoParaformer  # noqa: F401
    import_s = round(time.perf_counter() - import_start, 3)

    load_start = time.perf_counter()
    models, load_timings = _load_four_models(model_dirs)
    load_total_s = round(time.perf_counter() - load_start, 3)

    rss_after_load_mb = _rss_mb()

    infer_start = time.perf_counter()
    result = models["asr"](audio, "")
    first_infer_s = round(time.perf_counter() - infer_start, 3)
    preds = result[0].get("preds", "") if result else ""
    text_plain = "".join(preds.split())

    payload = {
        "phase": "cold-child",
        "import_s": import_s,
        "load_timings_s": load_timings,
        "load_total_s": load_total_s,
        "first_infer_s": first_infer_s,
        "cold_start_total_s": round(time.perf_counter() - cold_start_t0, 3),
        "wav_duration_s": round(duration, 2),
        "rss_after_load_mb": rss_after_load_mb,
        "rss_after_infer_mb": _rss_mb(),
        "text_chars": len(text_plain),
    }
    print(json.dumps(payload))
    return 0


def cmd_measure_child(args) -> int:
    pin, model_dirs, audio, duration = _child_common_setup(args)
    report = {"phase": "measure-child", "wav_duration_s": round(duration, 2)}

    rss_before_load_mb = _rss_mb()
    models, load_timings = _load_four_models(model_dirs)
    rss_after_loads_mb = _rss_mb()

    # --- ASR plain + hotword path, with peak-RSS polling ------------------
    with PeakRssMonitor() as monitor:
        result_plain = models["asr"](audio, "")
        result_hot = models["asr"](audio, HOTWORDS)
        peak_inference_rss_mb = monitor.peak_mb()
    preds_plain = result_plain[0].get("preds", "") if result_plain else ""
    preds_hot = result_hot[0].get("preds", "") if result_hot else ""
    text_plain = "".join(preds_plain.split())
    text_hot = "".join(preds_hot.split())
    similarity = char_similarity(REFERENCE_TEXT, text_plain)

    # --- VAD + Punc chain (server pipeline shape) -------------------------
    vad_result = models["vad"](audio)
    vad_segments = vad_result[0] if vad_result else []
    punc_text = models["punc"](preds_plain)[0] if preds_plain else ""

    # --- CAMPPlus speaker graph execution ----------------------------------
    # Synthetic fbank of the pinned feat_dim: proves the int8 graph loads
    # and RUNS on this platform's onnxruntime. Feature extraction (the
    # funasr torch frontend) is the runtime-server ticket's concern; this
    # spike has no torch by design.
    import numpy as np

    feats = np.random.default_rng(415).random(
        (1, 200, models["speaker_feat_dim"]), dtype=np.float32
    )
    embedding = models["speaker"].run(None, {"feats": feats})[0]
    speaker_embedding_ok = bool(
        np.asarray(embedding).size > 0 and np.isfinite(embedding).all()
    )

    # --- RTF (warm, same 3-run shape as the T1 smoke) ---------------------
    rtf_runs = []
    for _ in range(RTF_WARM_RUNS):
        t0 = time.perf_counter()
        models["asr"](audio, "")
        rtf_runs.append((time.perf_counter() - t0) / duration)

    report.update(
        {
            "load_timings_s": load_timings,
            "rss_mb": {
                "before_load": rss_before_load_mb,
                "after_model_loads": rss_after_loads_mb,
                # Peak sampled across the plain + hotword ASR inference window
                # only (the ORT arena never returns pages to the OS, so this
                # is the number the spec's RSS acceptance is about).
                "peak_asr_inference": peak_inference_rss_mb,
                "final": _rss_mb(),
            },
            "asr": {
                "text_plain": text_plain,
                "text_with_hotwords": text_hot,
                "timestamp_present": bool(
                    result_plain and "timestamp" in result_plain[0]
                ),
                "char_similarity_vs_reference": round(similarity, 4),
            },
            "vad_punc": {
                "vad_segments": len(vad_segments),
                "vad_seconds_total": round(
                    sum((seg[1] - seg[0]) / 1000.0 for seg in vad_segments), 2
                ),
                "punctuated_text": punc_text,
            },
            "speaker": {
                "graph_executed": speaker_embedding_ok,
                "embedding_dim": int(np.asarray(embedding).shape[-1]),
                "feat_dim": models["speaker_feat_dim"],
            },
            "performance": {
                "asr_rtf_runs": [round(r, 4) for r in rtf_runs],
                "asr_rtf_best": round(min(rtf_runs), 4),
            },
        }
    )
    print(json.dumps(report))
    return 0


# ---------------------------------------------------------------------------
# Parent orchestration
# ---------------------------------------------------------------------------


def _pip_freeze():
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "pip", "freeze", "--local"],
            capture_output=True,
            text=True,
            timeout=120,
            check=True,
        )
        return completed.stdout.splitlines()
    except (subprocess.SubprocessError, OSError) as error:
        return [f"<pip freeze unavailable: {error}>"]


def _collect_environment(pin: dict) -> dict:
    import platform
    from importlib.metadata import PackageNotFoundError, version

    import onnxruntime as ort

    try:
        funasr_onnx_version = version("funasr-onnx")
    except PackageNotFoundError:
        funasr_onnx_version = "not-installed"
    environment = {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "cpu_count": os.cpu_count(),
        "python": platform.python_version(),
        "onnxruntime": ort.__version__,
        "onnxruntime_providers": ort.get_available_providers(),
        "funasr_onnx": funasr_onnx_version,
        "pin_release_tag": pin["release"]["tag"],
        "pin_generated_utc": pin.get("generated_utc"),
        "pip_freeze": _pip_freeze(),
    }
    return environment


def _spawn_child(mode: str, args) -> dict:
    command = [
        sys.executable,
        os.path.abspath(__file__),
        mode,
        "--models-dir", args.models_dir,
        "--wav", args.wav,
        "--pin", args.pin,
    ]
    # UTF-8 children regardless of the Windows console codepage.
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    completed = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", env=env
    )
    if completed.returncode != 0:
        log(f"{mode} stderr:\n{completed.stderr}")
        raise RuntimeError(f"{mode} exited with {completed.returncode}")
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"{mode} produced no JSON on stdout")
    return json.loads(lines[-1])


def cmd_run(args) -> int:
    pin = load_pin(args.pin)

    problems = verify_models_dir(args.models_dir, pin)
    if problems:
        for problem in problems:
            log(f"FAIL model bytes: {problem}")
        print("WIN-SPIKE: FAIL (model bytes did not verify against the pin)")
        return 1
    log(f"model bytes verified against pin {pin['release']['tag']}")

    environment = _collect_environment(pin)

    import sysconfig

    site_dir = sysconfig.get_paths()["purelib"]
    install_size = {
        "site_packages_path": site_dir,
        "site_packages_bytes": dir_size_bytes(site_dir),
        "site_packages_mb": round(dir_size_bytes(site_dir) / 1024 / 1024, 1),
        "largest_packages": largest_site_packages(site_dir, top_n=10),
    }
    log(f"site-packages {install_size['site_packages_mb']} MB")

    duration = wav_duration_s(args.wav)
    log(f"wav {args.wav} ({duration:.1f}s) — cold-start samples: {args.samples}")

    cold_samples = []
    cold_details = []
    for index in range(args.samples):
        sample = _spawn_child("cold-child", args)
        cold_samples.append(sample["cold_start_total_s"])
        cold_details.append(sample)
        log(
            f"cold sample {index + 1}/{args.samples}: "
            f"{sample['cold_start_total_s']:.2f}s "
            f"(load {sample['load_total_s']}s + first infer {sample['first_infer_s']}s, "
            f"rss after load {sample['rss_after_load_mb']}MB)"
        )
    cold_stats = cold_start_stats(cold_samples)

    measure = _spawn_child("measure-child", args)
    log(f"measure: similarity {measure['asr']['char_similarity_vs_reference']}, "
        f"peak RSS {measure['rss_mb']['peak_asr_inference']}MB, "
        f"RTF best {measure['performance']['asr_rtf_best']}")

    passed, gate_problems = evaluate_acceptance(
        measure["asr"]["text_plain"],
        measure["asr"]["char_similarity_vs_reference"],
        measure["vad_punc"]["vad_segments"],
    )
    # The speaker graph must also have executed (four-model load contract).
    if not measure["speaker"]["graph_executed"]:
        passed = False
        gate_problems.append("CAMPPlus speaker graph did not execute")

    report = {
        "schema_version": RESULTS_SCHEMA_VERSION,
        "environment": environment,
        "install_size": install_size,
        "cold_start": {
            "samples": args.samples,
            "samples_s": [round(s, 3) for s in cold_samples],
            "stats": {key: round(value, 3) for key, value in cold_stats.items()},
            "details": cold_details,
        },
        "measure": measure,
        "acceptance": {"passed": passed, "problems": gate_problems},
    }

    for out_path, payload in (
        (args.out_json, json.dumps(report, ensure_ascii=False, indent=2) + "\n"),
        (args.out_md, render_markdown(report)),
    ):
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(payload)
        log(f"wrote {out_path}")

    print("WIN-SPIKE:", "PASS" if passed else "FAIL")
    for problem in gate_problems:
        print(f"WIN-SPIKE problem: {problem}")
    return 0 if passed else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)

    def add_common(sub_parser):
        sub_parser.add_argument("--models-dir", required=True)
        sub_parser.add_argument("--wav", default=DEFAULT_WAV)
        sub_parser.add_argument("--pin", default=DEFAULT_PIN)

    run_parser = sub.add_parser("run", help="parent orchestrator (evidence run)")
    add_common(run_parser)
    run_parser.add_argument("--samples", type=int, default=5)
    run_parser.add_argument("--out-json", default=os.path.join(HERE, "work", "win_spike_results.json"))
    run_parser.add_argument("--out-md", default=os.path.join(HERE, "work", "win_spike_report.md"))

    cold_parser = sub.add_parser("cold-child", help="internal: one cold-start sample")
    add_common(cold_parser)

    measure_parser = sub.add_parser("measure-child", help="internal: full measurement run")
    add_common(measure_parser)
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.mode == "run":
        return cmd_run(args)
    if args.mode == "cold-child":
        return cmd_cold_child(args)
    return cmd_measure_child(args)


if __name__ == "__main__":
    sys.exit(main())
