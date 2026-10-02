# [20261002_T6b_NoLibrosa] Ticket #419 (spec #412 decision 3): the server has
# ZERO librosa call sites — the non-wav/flac decode path (_convert_to_wav)
# and duration probing (_get_audio_duration) run on soundfile (libsndfile,
# pure C), and diarize/mic audio enters through the shared ndarray doorway.
# This matters for packaging: trimming numba/llvmlite requires that nothing
# can pull librosa at runtime.
#
# The guard is behavioral: a POISONED librosa module fails the test the
# moment any server code path touches it, plus a source-level regression
# guard against `import librosa` re-entering the server.
import contextlib
import os
import queue
import shutil
import sys
import tempfile
import types
import unittest

sys.path.insert(
    0,
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

import funasr_server  # noqa: E402
from funasr_server import (  # noqa: E402
    FunASRServer,
    ONNX_MODEL_DIR_NAMES,
)


class _LibrosaPoison(types.ModuleType):
    def __getattr__(self, name):
        raise AssertionError(
            f"librosa.{name} was called — the server must be librosa-free"
        )


@contextlib.contextmanager
def poisoned_librosa():
    saved = sys.modules.get("librosa")
    sys.modules["librosa"] = _LibrosaPoison("librosa")
    try:
        yield
    finally:
        if saved is not None:
            sys.modules["librosa"] = saved
        else:
            sys.modules.pop("librosa", None)


def _scipy_available():
    # [20261002_T6b_CiScipyGuard] Resampling fixtures need scipy's polyphase
    # resampler (_resample_to_16k). CI installs numpy + soundfile only
    # (ci.yml); the embedded runtime ships scipy — same skip discipline as
    # test_onnx_engine_switch's resample test.
    import importlib.util

    return importlib.util.find_spec("scipy") is not None


class FakeSeaco:
    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        pass

    def __call__(self, samples, hotwords="", **kwargs):
        # [20261002_T6b_SubChunk review fix] 4 chars ↔ 4 timestamps (the real
        # engine's per-char contract); all midpoints inside the fixture's
        # 1s region so the full text survives the chunk midpoint filter.
        return [
            {
                "preds": "你好世界",
                "timestamp": [[0, 250], [250, 500], [500, 750], [750, 1000]],
            }
        ]


class FakeFsmn:
    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        pass

    def __call__(self, samples, **kwargs):
        return [[[0, 1000]]]


class FakeCt:
    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        pass

    def __call__(self, text, split_size=20):
        return ("你好，世界。", None)


class NeverAutoModel:
    def __init__(self, *args, **kwargs):
        raise AssertionError("torch AutoModel must not be called")


@contextlib.contextmanager
def fake_module(name, **attrs):
    module = types.ModuleType(name)
    for attr, value in attrs.items():
        setattr(module, attr, value)
    saved = sys.modules.get(name)
    sys.modules[name] = module
    try:
        yield module
    finally:
        if saved is not None:
            sys.modules[name] = saved
        else:
            sys.modules.pop(name, None)


class NoLibrosaTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_env = {
            key: os.environ.get(key)
            for key in (
                "MODELSCOPE_CACHE",
                "HOME",
                "USERPROFILE",
                "ELECTRON_USER_DATA",
            )
        }
        os.environ["HOME"] = self._tmp.name
        os.environ["USERPROFILE"] = self._tmp.name
        for key in ("MODELSCOPE_CACHE", "ELECTRON_USER_DATA"):
            os.environ.pop(key, None)
        self.damo_root = os.path.join(self._tmp.name, "damo-root")
        os.makedirs(self.damo_root, exist_ok=True)
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _make_onnx_dir(self, model_key):
        spec = funasr_server.ONNX_PIN_FILE_SPECS[model_key]
        dir_path = os.path.join(
            self.damo_root, "onnx-int8", ONNX_MODEL_DIR_NAMES[model_key]
        )
        os.makedirs(dir_path, exist_ok=True)
        self.addCleanup(shutil.rmtree, dir_path, ignore_errors=True)
        for name, size in spec.items():
            with open(os.path.join(dir_path, name), "wb") as f:
                f.truncate(size)
        return dir_path

    def _load_engines(self, srv):
        self._make_onnx_dir("asr")
        self._make_onnx_dir("vad")
        self._make_onnx_dir("punc")
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", SeacoParaformer=FakeSeaco
        ):
            self.assertTrue(srv._load_asr_model())
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", Fsmn_vad=FakeFsmn
        ):
            self.assertTrue(srv._load_vad_model())
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", CT_Transformer=FakeCt
        ):
            self.assertTrue(srv._load_punc_model())
        srv.initialized = True

    def _write_wav(self, duration_s=1.0, samplerate=16000):
        import numpy as np
        import soundfile as sf

        t = np.arange(int(samplerate * duration_s), dtype=np.float64) / samplerate
        speech = (0.05 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, dir=tempfile.gettempdir()
        )
        sf.write(tmp.name, speech, samplerate, subtype="PCM_16")
        tmp.close()
        self.addCleanup(
            lambda: os.path.exists(tmp.name) and os.unlink(tmp.name)
        )
        return tmp.name


class NoLibrosaSourceGuardTest(NoLibrosaTestBase):
    def test_server_source_has_no_librosa_import(self):
        # Regression guard: no `import librosa` may re-enter the server
        # module (comments may still mention librosa; code may not).
        with open(funasr_server.__file__, encoding="utf-8") as f:
            source = f.read()
        self.assertNotIn("import librosa", source)


class NoLibrosaTranscribeTest(NoLibrosaTestBase):
    def test_transcribe_file_without_librosa(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._load_engines(srv)
        srv.response_queue = queue.Queue()
        wav = self._write_wav()
        with poisoned_librosa():
            result = srv.transcribe_file_audio(wav, {"request_id": "r419"})
        self.assertTrue(result["success"], result)
        self.assertEqual(result["text"], "你好，世界。")
        self.assertGreater(result["duration"], 0.0)

    def test_transcribe_mic_path_without_librosa(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._load_engines(srv)
        wav = self._write_wav()
        with poisoned_librosa():
            result = srv.transcribe_audio(wav, {})
        self.assertTrue(result["success"], result)
        self.assertEqual(result["text"], "你好，世界。")


class NoLibrosaConvertTest(NoLibrosaTestBase):
    @unittest.skipUnless(_scipy_available(), "scipy required for resampling")
    def test_convert_ogg_to_16k_mono_wav(self):
        import numpy as np
        import soundfile as sf

        srv = FunASRServer(damo_root=self.damo_root)
        t = np.arange(22050, dtype=np.float64) / 22050.0
        stereo = np.stack(
            [0.05 * np.sin(2 * np.pi * 440.0 * t)] * 2, axis=1
        ).astype(np.float32)
        src = tempfile.NamedTemporaryFile(
            suffix=".ogg", delete=False, dir=tempfile.gettempdir()
        )
        sf.write(src.name, stereo, 22050, format="OGG")
        src.close()
        self.addCleanup(
            lambda: os.path.exists(src.name) and os.unlink(src.name)
        )
        with poisoned_librosa():
            converted, was_converted = srv._convert_to_wav(src.name)
        self.addCleanup(
            lambda: os.path.exists(converted) and os.unlink(converted)
        )
        self.assertTrue(was_converted)
        data, samplerate = sf.read(converted)
        self.assertEqual(samplerate, 16000)
        self.assertEqual(np.asarray(data).ndim, 1, "must be mono")

    def test_convert_mp3_to_16k_mono_wav(self):
        import numpy as np
        import soundfile as sf

        srv = FunASRServer(damo_root=self.damo_root)
        t = np.arange(16000, dtype=np.float64) / 16000.0
        audio = (0.05 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        src = tempfile.NamedTemporaryFile(
            suffix=".mp3", delete=False, dir=tempfile.gettempdir()
        )
        sf.write(src.name, audio, 16000, format="MP3")
        src.close()
        self.addCleanup(
            lambda: os.path.exists(src.name) and os.unlink(src.name)
        )
        with poisoned_librosa():
            converted, was_converted = srv._convert_to_wav(src.name)
        self.addCleanup(
            lambda: os.path.exists(converted) and os.unlink(converted)
        )
        self.assertTrue(was_converted)
        data, samplerate = sf.read(converted)
        self.assertEqual(samplerate, 16000)

    def test_wav_and_flac_passthrough_untouched(self):
        srv = FunASRServer(damo_root=self.damo_root)
        wav = self._write_wav()
        with poisoned_librosa():
            converted, was_converted = srv._convert_to_wav(wav)
        self.assertFalse(was_converted)
        self.assertEqual(converted, wav)

    def test_undecodable_format_fails_with_actionable_error(self):
        import soundfile as sf  # noqa: F401

        srv = FunASRServer(damo_root=self.damo_root)
        # A .m4a file whose bytes libsndfile cannot decode: the failure must
        # be an explicit error (never a silent zero-duration success).
        src = tempfile.NamedTemporaryFile(
            suffix=".m4a", delete=False, dir=tempfile.gettempdir()
        )
        src.write(b"this is not a real m4a stream")
        src.close()
        self.addCleanup(
            lambda: os.path.exists(src.name) and os.unlink(src.name)
        )
        with poisoned_librosa():
            with self.assertRaises(RuntimeError) as ctx:
                srv._convert_to_wav(src.name)
        self.assertIn("音频格式转换失败", str(ctx.exception))


class NoLibrosaDurationTest(NoLibrosaTestBase):
    def test_duration_from_soundfile_info(self):
        import soundfile as sf

        srv = FunASRServer(damo_root=self.damo_root)
        wav = self._write_wav(duration_s=2.5)
        with poisoned_librosa():
            duration = srv._get_audio_duration(wav)
        info = sf.info(wav)
        self.assertAlmostEqual(duration, info.frames / info.samplerate, places=3)
        self.assertAlmostEqual(duration, 2.5, places=2)
        # stats accumulation still happens (existing contract)
        self.assertAlmostEqual(srv.total_audio_duration, 2.5, places=2)

    def test_duration_failure_raises_instead_of_silent_zero(self):
        srv = FunASRServer(damo_root=self.damo_root)
        garbage = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, dir=tempfile.gettempdir()
        )
        garbage.write(b"not audio bytes at all")
        garbage.close()
        self.addCleanup(
            lambda: os.path.exists(garbage.name) and os.unlink(garbage.name)
        )
        with poisoned_librosa():
            with self.assertRaises(RuntimeError):
                srv._get_audio_duration(garbage.name)


if __name__ == "__main__":
    unittest.main()
