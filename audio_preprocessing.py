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

# [20261006_Fix_421_HpfBlockOla] Ticket #421 review: the high-pass used to
# run ONE global rfft over the WHOLE signal — O(audio_length) float64
# buffers (~1GB transient RSS for a 10-minute file) that stacked onto the
# models' resident footprint and blew the <=1700MB release envelope. The
# filter is now a windowed-sinc FIR (Hamming, sharp enough that the 40Hz
# test tone sits deep in the stopband) applied via block overlap-add: the
# FFT never sees more than HPF_FFT_BLOCK_SIZE samples, so the internal
# working set is O(block) regardless of file length. Signals shorter than
# one block take the identical single-block path. Numeric contract
# (80Hz cutoff incl. DC, float32 in/out, isfinite rejection upstream) is
# unchanged; the brickwall becomes a ~26Hz-transition FIR — inaudible and
# within every pinned property below.
HPF_TAPS = 4001
HPF_BLOCK_SAMPLES = 65536  # 4s @16k per overlap-add block
HPF_FFT_BLOCK_SIZE = HPF_BLOCK_SAMPLES + HPF_TAPS - 1

_INT16_SCALE = 32768.0


def to_float32(samples):
    """Coerce samples to float32; integer input is scaled to [-1, 1)."""
    arr = np.asarray(samples)
    if arr.dtype == np.int16:
        return (arr.astype(np.float32) / _INT16_SCALE).astype(np.float32)
    return arr.astype(np.float32)


def _highpass_taps(sr):
    """Hamming-windowed-sinc high-pass taps at HPF_CUTOFF_HZ (numpy-only —
    scipy is not a CI dependency of this module). Spectral-inversion form:
    delta minus the windowed low-pass, so DC is killed exactly (taps sum 0)
    and the passband gain is ~1."""
    m = HPF_TAPS - 1
    n = np.arange(HPF_TAPS, dtype=np.float64) - m / 2.0
    fc = HPF_CUTOFF_HZ / float(sr)
    lowpass = 2.0 * fc * np.sinc(2.0 * fc * n) * np.hamming(HPF_TAPS)
    delta = np.zeros(HPF_TAPS, dtype=np.float64)
    delta[m // 2] = 1.0
    return (delta - lowpass).astype(np.float32)


def highpass_filter(samples, sr, cutoff_hz=HPF_CUTOFF_HZ):
    """Block overlap-add FIR high-pass at cutoff_hz (incl. DC).

    [20261006_Fix_421_HpfBlockOla] Replaces the whole-signal rfft brickwall:
    the FIR taps carry the same 80Hz cutoff semantics at O(block) internal
    memory. Blocks are transformed independently and overlap-added; the
    linear-phase group delay ((HPF_TAPS-1)/2 samples) is trimmed by the
    "same"-mode alignment below. Degenerate inputs (0-frame) pass through.
    """
    x = np.asarray(samples, dtype=np.float32)
    if len(x) == 0:
        return np.asarray(samples, dtype=np.float32)
    taps = _highpass_taps(sr)
    fft_size = HPF_FFT_BLOCK_SIZE
    spectrum = np.fft.rfft(taps, fft_size)
    out = np.zeros(len(x) + HPF_TAPS - 1, dtype=np.float32)
    for start in range(0, len(x), HPF_BLOCK_SAMPLES):
        block = x[start : start + HPF_BLOCK_SAMPLES]
        filtered = np.fft.irfft(
            np.fft.rfft(block, fft_size) * spectrum, fft_size
        )
        out[start : start + fft_size] += filtered[: len(out) - start]
    # Linear-phase delay compensation: drop the first (HPF_TAPS-1)/2
    # samples so the output aligns with the input ("same" semantics).
    delay = (HPF_TAPS - 1) // 2
    return out[delay : delay + len(x)]


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
    # quantization cannot clip. [T7 review fixup] A failed write must not
    # leave the half-created temp behind — the callers' fallback path never
    # learns this path existed, so cleanup has to happen right here.
    try:
        sf.write(out_path, processed, sr, subtype="PCM_16")
    except Exception:
        try:
            os.unlink(out_path)
        except OSError as cleanup_error:
            # [20260913_Fix_197_UnlinkDebug] #197 #7: temp-cleanup failures
            # are best-effort, but they must not be fully silent — a debug
            # line keeps the disk-full / permission case diagnosable.
            logger.debug("temp cleanup failed for %s: %s", out_path, cleanup_error)
        raise
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
