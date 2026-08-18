#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
[20260818_T6_AudioPreprocess] Ticket #185 (spec #177 T6): audio
preprocessing for the file-import transcription path — 80Hz high-pass +
segmented RMS loudness normalization, applied BEFORE VAD/ASR so the model
sees consistent loudness with low-frequency rumble removed.

Derived from source-level research of VibeVoice (RMS normalize to -25dBFS,
docs/research/vibevoice-meetily-capability-research.md) and meetily
(80Hz HPF + loudness normalization + per-segment windows).

Numeric contract (spec v2 / adversarial review MJ-7):
  - inputs are coerced to float32 (int16 scaled by 32768)
  - non-finite samples are REJECTED (ValueError) — never fed to the model
  - near-silence windows pass through UNAMPLIFIED (lifting the noise floor
    to full scale is a hallucination trigger)
  - peak limiter: gain = min(target_gain, PEAK_CEILING / peak) — no hard
    clipping
  - normalization is per-window (NORMALIZE_WINDOW_SECONDS), never global —
    long recordings dominated by silence must not equalize noise upward
  - processing order is fixed: high-pass FIRST, then normalize (normalizing
    first would amplify the rumble we are about to remove)

numpy-only by design: the CI python provides numpy but not torch/funasr
(ticket #180 runner). soundfile is imported lazily inside the file I/O
helpers so pure-DSP unit tests stay dependency-light.
"""

import logging
import os
import tempfile

import numpy as np

logger = logging.getLogger(__name__)

# [20260818_T6_AudioPreprocess] Named constants — no magic numbers.
HPF_CUTOFF_HZ = 80.0
TARGET_RMS_DBFS = -25.0
SILENCE_RMS_THRESHOLD = 1e-4
PEAK_CEILING = 0.99
NORMALIZE_WINDOW_SECONDS = 30.0
# ponytail: non-overlapping windows can produce a gain step at boundaries;
# add crossfade windows if real speech ever lands on a boundary audibly.
RTF_BUDGET = 0.05

_INT16_SCALE = 32768.0


def to_float32(samples):
    """Coerce samples to float32; integer input is scaled to [-1, 1)."""
    arr = np.asarray(samples)
    if arr.dtype == np.int16:
        return (arr.astype(np.float32) / _INT16_SCALE).astype(np.float32)
    return arr.astype(np.float32)


def highpass_filter(samples, sr, cutoff_hz=HPF_CUTOFF_HZ):
    """FFT-domain high-pass: zero out spectrum below cutoff_hz (incl. DC).

    Vectorized O(n log n) — a per-sample IIR loop would blow the RTF budget
    on hour-long imports. Offline path only (whole array in memory, which
    the pipeline already requires for file transcription).
    """
    x = np.asarray(samples, dtype=np.float64)
    if len(x) == 0:
        # Degenerate input (0-frame file): nothing to filter (review
        # fixup — numpy's rfft would raise a bare FFT error otherwise).
        return np.asarray(samples, dtype=np.float32)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1.0 / sr)
    spec[freqs < cutoff_hz] = 0.0
    return np.fft.irfft(spec, n=len(x)).astype(np.float32)


def normalize_segment(samples):
    """Normalize one window's RMS toward TARGET_RMS_DBFS.

    Near-silence (below SILENCE_RMS_THRESHOLD) passes through untouched;
    gain is additionally capped so the output peak stays under
    PEAK_CEILING (soft ceiling, not hard clipping).
    """
    x = np.asarray(samples, dtype=np.float64)
    rms = float(np.sqrt(np.mean(x**2))) if len(x) else 0.0
    if rms < SILENCE_RMS_THRESHOLD:
        # Review fixup: uniform dtype + copy semantics on passthrough (the
        # old branch returned the caller's array reference and its dtype).
        return np.asarray(samples, dtype=np.float32)
    target = 10.0 ** (TARGET_RMS_DBFS / 20.0)
    peak = float(np.max(np.abs(x)))
    if peak <= 0.0:
        return np.asarray(samples, dtype=np.float32)
    gain = min(target / rms, PEAK_CEILING / peak)
    return (x * gain).astype(np.float32)


def normalize_loudness(samples, sr, window_seconds=NORMALIZE_WINDOW_SECONDS):
    """Segmented loudness normalization (per-window, never global)."""
    x = np.asarray(samples)
    n = len(x)
    win = max(1, int(sr * window_seconds))
    out = np.empty(n, dtype=np.float32)
    for start in range(0, n, win):
        end = min(start + win, n)
        out[start:end] = normalize_segment(x[start:end])
    return out


def preprocess_audio(samples, sr):
    """Full chain: validate → float32 → high-pass → segmented normalize."""
    x = to_float32(samples)
    if not bool(np.all(np.isfinite(x))):
        raise ValueError(
            "audio contains non-finite samples (NaN/Inf) — refusing to "
            "feed it to the model"
        )
    x = highpass_filter(x, sr)
    return normalize_loudness(x, sr)


def load_audio(path):
    """Load any soundfile-readable audio as (float32 mono-ish, sr).

    dtype='float32' makes soundfile apply the int16/24/32 → [-1,1) scaling
    itself; float files pass through.
    """
    import soundfile as sf

    data, sr = sf.read(path, dtype="float32", always_2d=False)
    return np.asarray(data, dtype=np.float32), int(sr)


def preprocess_audio_file(in_path, out_path=None):
    """File wrapper: read → preprocess → write a PCM_16 WAV.

    Returns the output path (a fresh temp file when out_path is None, so
    the caller's original file is never modified). Failures propagate —
    funasr_server._apply_preprocessing decides the fallback policy.
    """
    import soundfile as sf

    samples, sr = load_audio(in_path)
    processed = preprocess_audio(samples, sr)
    if out_path is None:
        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav",
            delete=False,
            prefix="murmur_dsp_",
            dir=tempfile.gettempdir(),
        )
        out_path = tmp.name
        tmp.close()
    # PCM_16: the limiter guarantees peak ≤ PEAK_CEILING, so the float→int
    # quantization cannot clip.
    sf.write(out_path, processed, sr, subtype="PCM_16")
    logger.info(
        "preprocessed %s -> %s (sr=%d, samples=%d)",
        in_path,
        out_path,
        sr,
        len(processed),
    )
    return out_path


if __name__ == "__main__":  # pragma: no cover - manual smoke
    import sys

    if len(sys.argv) == 3:
        print(preprocess_audio_file(sys.argv[1], sys.argv[2]))
    else:
        print("usage: audio_preprocessing.py <in.wav> <out.wav>")
