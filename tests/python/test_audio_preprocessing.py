# [20260818_T6_AudioPreprocess] Ticket #185 (spec #177 T6): the DSP
# preprocessing module (80Hz high-pass + segmented RMS loudness
# normalization) for the file-import path. Full numeric contract from the
# spec/review: int16→float32 conversion, isfinite rejection, near-silence
# passthrough, peak limiter, HPF-before-normalize order, per-window (NOT
# global) normalization, and an RTF budget. numpy-only — must run under the
# CI python (numpy only, no torch/funasr/librosa imports in the module).
import os
import sys
import time
import unittest

import numpy as np

sys.path.insert(
    0,
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ),
)

import audio_preprocessing as ap  # noqa: E402

SR = 16000


def sine(freq, seconds, sr=SR, amp=0.5):
    t = np.arange(int(sr * seconds), dtype=np.float64) / sr
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def band_rms(samples, sr, lo, hi):
    """RMS of the spectral content between lo..hi Hz (analysis helper)."""
    spec = np.abs(np.fft.rfft(samples.astype(np.float64)))
    freqs = np.fft.rfftfreq(len(samples), 1 / sr)
    mask = (freqs >= lo) & (freqs <= hi)
    return float(np.sqrt(np.mean(spec[mask] ** 2)))


class ToFloat32Test(unittest.TestCase):
    def test_int16_scaled_by_32768(self):
        out = ap.to_float32(np.array([16384, -16384, 0], dtype=np.int16))
        self.assertEqual(out.dtype, np.float32)
        np.testing.assert_allclose(out, [0.5, -0.5, 0.0], atol=1e-6)

    def test_float_passthrough_to_float32(self):
        out = ap.to_float32(np.array([0.25], dtype=np.float64))
        self.assertEqual(out.dtype, np.float32)


class HighpassTest(unittest.TestCase):
    def test_attenuates_40hz(self):
        x = sine(40, 1.0, amp=0.5)
        y = ap.highpass_filter(x, SR)
        self.assertLess(float(np.sqrt(np.mean(y**2))), 0.05)

    def test_preserves_1khz(self):
        x = sine(1000, 1.0, amp=0.5)
        y = ap.highpass_filter(x, SR)
        # rms of a 0.5-amp sine is 0.5/√2 ≈ 0.3536 — the filter must keep
        # at least 90% of it.
        self.assertGreater(float(np.sqrt(np.mean(y**2))), 0.32)

    def test_removes_dc_offset(self):
        # [20261006_Fix_421_HpfBlockOla] The filter must keep killing DC
        # (the old docstring contract: "incl. DC") — a constant offset on a
        # passband sine must not survive.
        x = sine(1000, 1.0, amp=0.3) + 0.2
        y = ap.highpass_filter(x, SR)
        self.assertLess(abs(float(np.mean(y.astype(np.float64)))), 1e-3)


class HighpassMemoryBoundTest(unittest.TestCase):
    """[20261006_Fix_421_HpfBlockOla] Ticket #421 review: the HPF used to
    run ONE global rfft over the whole signal — O(audio_length) float64
    buffers (~1GB transient for 10 minutes), stacking onto the models'
    resident footprint and blowing the <=1700MB release envelope. The block
    overlap-add implementation must never transform more than the pinned
    FFT block size, whatever the input length."""

    def test_transform_size_bounded_regardless_of_input_length(self):
        recorded = []
        real_rfft = np.fft.rfft

        def counting_rfft(a, n=None, axis=-1, norm=None):
            recorded.append(n if n is not None else len(a))
            return real_rfft(a, n=n, axis=axis, norm=norm)

        np.fft.rfft = counting_rfft
        try:
            long_signal = sine(500, 60.0, amp=0.3)  # 960k samples
            y = ap.highpass_filter(long_signal, SR)
        finally:
            np.fft.rfft = real_rfft
        self.assertEqual(len(y), len(long_signal))
        self.assertTrue(recorded, "HPF must run its FFT blocks")
        self.assertLessEqual(
            max(recorded), ap.HPF_FFT_BLOCK_SIZE, sorted(set(recorded))[-3:]
        )

    def test_block_constant_is_bounded(self):
        # The block size IS the memory contract — pin it well under any
        # plausible audio length (a 4s FFT window ≈ 0.7MB float64).
        self.assertLessEqual(ap.HPF_FFT_BLOCK_SIZE, 131072)


class ValidationTest(unittest.TestCase):
    def test_rejects_nan_input(self):
        x = sine(1000, 0.1)
        x[100] = np.nan
        with self.assertRaises(ValueError):
            ap.preprocess_audio(x, SR)

    def test_rejects_inf_input(self):
        x = sine(1000, 0.1)
        x[100] = np.inf
        with self.assertRaises(ValueError):
            ap.preprocess_audio(x, SR)


class NormalizeSegmentTest(unittest.TestCase):
    def test_silence_passthrough_no_nan_no_amplification(self):
        x = np.zeros(SR, dtype=np.float32)
        y = ap.normalize_segment(x)
        np.testing.assert_array_equal(y, x)

    def test_near_silence_not_amplified(self):
        # Dither-level noise far below the silence threshold must pass
        # through untouched — amplifying it to the target would lift the
        # noise floor to full scale and feed the model pure noise.
        x = (np.random.default_rng(42).standard_normal(SR) * 1e-6).astype(
            np.float32
        )
        y = ap.normalize_segment(x)
        self.assertLessEqual(float(np.max(np.abs(y))), 1e-5)

    def test_bringrms_up_to_target(self):
        x = sine(1000, 1.0, amp=0.01)
        y = ap.normalize_segment(x)
        target = 10 ** (ap.TARGET_RMS_DBFS / 20)
        self.assertAlmostEqual(
            float(np.sqrt(np.mean(y.astype(np.float64) ** 2))),
            target,
            delta=target * 0.05,
        )

    def test_peak_limiter_prevents_clipping(self):
        # High crest factor: quiet body + one loud spike. The limiter must
        # cap the gain so the output peak stays under the ceiling even
        # though the RMS target alone would demand more gain.
        x = sine(1000, 1.0, amp=0.01)
        x[500] = 0.9
        y = ap.normalize_segment(x)
        self.assertLessEqual(float(np.max(np.abs(y))), ap.PEAK_CEILING + 1e-6)


class NormalizeLoudnessTest(unittest.TestCase):
    def test_segmented_not_global(self):
        # Window 1 loud, window 2 quiet (30x RMS gap). Segmented
        # normalization lifts BOTH to ~target; global normalization would
        # leave window 2 relatively quiet.
        window_s = ap.NORMALIZE_WINDOW_SECONDS
        n = int(SR * window_s)
        loud = sine(1000, window_s, amp=0.3)
        quiet = sine(1000, window_s, amp=0.01)
        y = ap.normalize_loudness(
            np.concatenate([loud, quiet]).astype(np.float32), SR
        )
        rms1 = float(np.sqrt(np.mean(y[:n].astype(np.float64) ** 2)))
        rms2 = float(
            np.sqrt(np.mean(y[n:].astype(np.float64) ** 2))
        )
        target = 10 ** (ap.TARGET_RMS_DBFS / 20)
        self.assertAlmostEqual(rms2, target, delta=target * 0.1)
        # Quiet window ends up comparable to (not 30x below) the loud one.
        self.assertGreater(rms2 / max(rms1, 1e-9), 0.8)


class OrderTest(unittest.TestCase):
    def test_hpf_before_normalize(self):
        # Quiet mix of rumble + speech-band. After preprocessing the speech
        # band must reach ~target while the rumble stays far below it. If
        # normalization ran FIRST, the rumble would be amplified before
        # filtering — observable as high residual energy below 80Hz.
        # [20261006_Fix_421_HpfBlockOla] The residual-rumble arm is now
        # RELATIVE to the speech band: under the old whole-signal brickwall
        # it was vacuously green (the exact spectral zeroing left ~1e-13),
        # so the absolute floor pinned an implementation artifact, not the
        # order semantics. The block-OLA FIR leaves a real ~-60dB stopband,
        # and the invariant the pipeline needs is rumble << speech.
        x = sine(40, 1.0, amp=0.02) + sine(1000, 1.0, amp=0.02)
        y = ap.preprocess_audio(x.astype(np.float32), SR)
        speech = band_rms(y, SR, 300, 3000)
        rumble = band_rms(y, SR, 1, 60)
        target = 10 ** (ap.TARGET_RMS_DBFS / 20)
        # Speech band lifted toward target; rumble far below it.
        self.assertGreater(speech, target * 0.5)
        self.assertLess(rumble, speech * 0.05)


class LoadAndFileTest(unittest.TestCase):
    def test_load_int16_wav_as_float32(self):
        import soundfile as sf
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            path = tmp.name
        try:
            sf.write(path, np.array([16384, -16384], dtype=np.int16), SR)
            samples, sr = ap.load_audio(path)
            self.assertEqual(samples.dtype, np.float32)
            self.assertEqual(sr, SR)
            self.assertLessEqual(float(np.max(np.abs(samples))), 1.0)
        finally:
            os.unlink(path)

    def test_preprocess_audio_file_writes_loadable_pcm16(self):
        import soundfile as sf
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            src = tmp.name
        try:
            sf.write(src, sine(1000, 0.5, amp=0.02), SR, subtype="PCM_16")
            out = ap.preprocess_audio_file(src)
            self.assertNotEqual(out, src)
            self.assertTrue(os.path.exists(out))
            samples, sr = ap.load_audio(out)
            self.assertEqual(sr, SR)
            self.assertTrue(np.all(np.isfinite(samples)))
            target = 10 ** (ap.TARGET_RMS_DBFS / 20)
            self.assertAlmostEqual(
                float(np.sqrt(np.mean(samples.astype(np.float64) ** 2))),
                target,
                delta=target * 0.15,
            )
        finally:
            os.unlink(src)
            if os.path.exists(out):
                os.unlink(out)


class RtfBudgetTest(unittest.TestCase):
    def test_60s_audio_rtf_under_budget(self):
        # 60s of mixed content; budget RTF < 0.05 via the module constant
        # (no duplicated magic number in the test).
        n = SR * 60
        rng = np.random.default_rng(7)
        x = (
            0.02 * rng.standard_normal(n)
            + 0.02 * np.sin(
                2 * np.pi * 500 * np.arange(n) / SR
            )
        ).astype(np.float32)
        start = time.perf_counter()
        ap.preprocess_audio(x, SR)
        elapsed = time.perf_counter() - start
        self.assertLess(elapsed, 60 * ap.RTF_BUDGET)


if __name__ == "__main__":
    unittest.main()
