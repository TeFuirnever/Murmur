# [20260818_T6_AudioPreprocess] Ticket #185: funasr_server wiring for the
# DSP module. Behavioral tests for _apply_preprocessing (success + fallback
# policy) plus a source-contract guard that the transcribe_file flow calls
# it AFTER format conversion (so the wav/flac passthrough branch is covered
# too) and unlinks BOTH temp files in finally.
import os
import sys
import unittest

sys.path.insert(
    0,
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ),
)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

import audio_preprocessing  # noqa: E402
from funasr_server import FunASRServer  # noqa: E402


class ApplyPreprocessingTest(unittest.TestCase):
    def setUp(self):
        self.server = FunASRServer(damo_root="/tmp/test-damo")

    def test_returns_processed_path_on_success(self):
        original = audio_preprocessing.preprocess_audio_file
        audio_preprocessing.preprocess_audio_file = (
            lambda p: "/tmp/dsp-out.wav"
        )
        try:
            self.assertEqual(
                self.server._apply_preprocessing("/tmp/in.wav"),
                "/tmp/dsp-out.wav",
            )
        finally:
            audio_preprocessing.preprocess_audio_file = original

    def test_falls_back_to_original_when_module_raises(self):
        # Enhancement-only semantics: a DSP BUG must never block
        # transcription of the original file.
        original = audio_preprocessing.preprocess_audio_file

        def boom(_p):
            raise RuntimeError("dsp exploded")

        audio_preprocessing.preprocess_audio_file = boom
        try:
            self.assertEqual(
                self.server._apply_preprocessing("/tmp/in.wav"), "/tmp/in.wav"
            )
        finally:
            audio_preprocessing.preprocess_audio_file = original

    def test_invalid_input_valueerror_propagates(self):
        # [Review MAJOR fixup] ValueError = the INPUT is illegal (non-finite
        # samples). Feeding the model known-bad audio and returning a
        # garbage success is worse than failing the transcription with a
        # clear message — only DSP *bugs* fall back, invalid input does not.
        original = audio_preprocessing.preprocess_audio_file

        def reject(_p):
            raise ValueError(
                "audio contains non-finite samples (NaN/Inf) — refusing "
                "to feed it to the model"
            )

        audio_preprocessing.preprocess_audio_file = reject
        try:
            with self.assertRaises(ValueError):
                self.server._apply_preprocessing("/tmp/in.wav")
        finally:
            audio_preprocessing.preprocess_audio_file = original


class MicPathPreprocessTest(unittest.TestCase):
    """[20260819_T7_MicPreprocess] Ticket #186: the push-to-talk path must
    feed the models the DSP-preprocessed audio, and must clean up its temp
    file. Behavioral: real tiny wav + fake models recording their input."""

    def setUp(self):
        self.server = FunASRServer(damo_root="/tmp/test-damo")
        self.server.initialized = True
        self.server.punc_model = None

        import numpy as np
        import soundfile as sf
        import tempfile

        t = np.arange(16000, dtype=np.float64) / 16000.0
        speech = (0.05 * np.sin(2 * np.pi * 500.0 * t)).astype(np.float32)
        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, dir=tempfile.gettempdir()
        )
        sf.write(tmp.name, speech, 16000, subtype="PCM_16")
        tmp.close()
        self.mic_wav = tmp.name
        # [T7 review fixup] tearDown never runs when setUp fails partway;
        # addCleanup registers the moment the temp exists.
        self.addCleanup(
            lambda: os.path.exists(self.mic_wav) and os.unlink(self.mic_wav)
        )

        class FakeModel:
            def __init__(self, text):
                self.inputs = []
                self.text = text

            def generate(self, input=None, **kwargs):
                self.inputs.append(input)
                return [{"text": self.text, "value": []}]

        self.fake_vad = FakeModel("")
        self.fake_asr = FakeModel("识别结果")
        self.server.vad_model = self.fake_vad
        self.server.asr_model = self.fake_asr

    def tearDown(self):
        pass  # cleanup registered via addCleanup in setUp

    def test_missing_file_returns_clean_error_no_unbound(self):
        # [T7 review fixup] Early-exit regression: the finally cleanup must
        # never hit an unbound infer_path (the exact bug class the red run
        # found during implementation).
        result = self.server.transcribe_audio("/nonexistent-mic.wav")
        self.assertFalse(result["success"])
        self.assertIn("音频文件不存在", result["error"])

    def test_models_receive_dsp_temp_and_temp_is_cleaned(self):
        result = self.server.transcribe_audio(self.mic_wav)
        self.assertTrue(result["success"], result)
        self.assertEqual(self.fake_vad.inputs, [self.fake_asr.inputs[0]])
        dsp_path = self.fake_asr.inputs[0]
        self.assertNotEqual(
            dsp_path, self.mic_wav, "models must receive preprocessed audio"
        )
        self.assertFalse(
            os.path.exists(dsp_path), "DSP temp must be deleted after use"
        )
        self.assertTrue(
            os.path.exists(self.mic_wav), "original mic temp must survive"
        )

    def test_dsp_bug_falls_back_to_original_path(self):
        original = audio_preprocessing.preprocess_audio_file

        def boom(_p):
            raise RuntimeError("dsp exploded")

        audio_preprocessing.preprocess_audio_file = boom
        try:
            result = self.server.transcribe_audio(self.mic_wav)
            self.assertTrue(result["success"], result)
            self.assertEqual(self.fake_asr.inputs, [self.mic_wav])
        finally:
            audio_preprocessing.preprocess_audio_file = original

    def test_non_finite_input_fails_transcription_cleanly(self):
        original = audio_preprocessing.preprocess_audio_file

        def reject(_p):
            raise ValueError("audio contains non-finite samples")

        audio_preprocessing.preprocess_audio_file = reject
        try:
            result = self.server.transcribe_audio(self.mic_wav)
            self.assertFalse(result["success"])
            # Assert the server's stable wrapper fields, not the module's
            # (fake-mirrored) message wording. [T7 review fixup]
            self.assertEqual(result["type"], "transcription_error")
            self.assertIn("音频转录失败", result["error"])
        finally:
            audio_preprocessing.preprocess_audio_file = original


class WiringContractTest(unittest.TestCase):
    """Source-contract: the call site + temp cleanup stay wired (repo
    convention for load-bearing glue that cannot be driven without real
    models — same style as tests/unit/windows-compat.test.ts)."""

    ROOT = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )

    @classmethod
    def source(cls):
        with open(
            os.path.join(cls.ROOT, "funasr_server.py"), encoding="utf-8"
        ) as f:
            return f.read()

    def test_transcribe_file_calls_preprocessing_after_conversion(self):
        src = self.source()
        body = src[src.index("def transcribe_file_audio") : src.index(
            "def _convert_to_wav"
        )]
        convert_idx = body.index("_convert_to_wav(audio_path)")
        dsp_idx = body.index("_apply_preprocessing(")
        self.assertLess(
            convert_idx,
            dsp_idx,
            "DSP must run AFTER format conversion (covers the wav/flac "
            "passthrough branch)",
        )

    def test_finally_unlinks_both_temp_files(self):
        src = self.source()
        body = src[src.index("def transcribe_file_audio") : src.index(
            "def _convert_to_wav"
        )]
        finally_idx = body.index("finally:")
        self.assertIn("dsp_path", body[finally_idx:])
        self.assertIn("converted_path", body[finally_idx:])
        self.assertIn("os.unlink", body[finally_idx:])


if __name__ == "__main__":
    unittest.main()
