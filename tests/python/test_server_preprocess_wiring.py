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
        # Enhancement-only semantics: a DSP failure must never block
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
