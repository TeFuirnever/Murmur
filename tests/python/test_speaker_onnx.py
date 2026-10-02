# [20261002_T6b_SpeakerOnnx] Ticket #419 (spec #412): the diarize path loads
# the CAM++ speaker model. The ONNX generation drives the int8 campplus graph
# STRAIGHT through onnxruntime (funasr-onnx ships no speaker loader —
# onnx_export_common.py:31, verified 2026-09-30) with Kaldi-compatible 80-bin
# fbank features (kaldi_native_fbank, numerics matched against the
# torchaudio.compliance.kaldi reference used at export verification: max abs
# diff 1.1e-4, cosine 1.0). The torch AutoModel path stays as rollback.
#
# Stdlib + numpy only by default — onnxruntime / kaldi_native_fbank / funasr
# are faked via sys.modules; numeric fbank tests skip when kaldi_native_fbank
# is absent (CI installs numpy+soundfile only).
import contextlib
import json
import os
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

import numpy as np  # noqa: E402

import funasr_server  # noqa: E402
from funasr_server import (  # noqa: E402
    FunASRServer,
    ONNX_MODEL_DIR_NAMES,
    OnnxSpeakerAdapter,
    _extract_fbank,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PIN_PATH = os.path.join(ROOT, "scripts", "onnx-export", "model-pin.json")


def _knf_available():
    return importlib.util.find_spec("kaldi_native_fbank") is not None


import importlib.util  # noqa: E402


class FakeTensorInfo:
    def __init__(self, name):
        self.name = name


class FakeSessionOptions:
    def __init__(self):
        self.intra_op_num_threads = None


class FakeOrtSession:
    """ort.InferenceSession stand-in: records ctor args and every feed,
    returns a fixed 192-dim embedding (CAM++ output shape)."""

    instances = []
    feeds = []
    ctor_error = None

    @classmethod
    def reset(cls):
        cls.instances = []
        cls.feeds = []
        cls.ctor_error = None

    def __init__(self, model_file, sess_options=None, providers=None):
        if FakeOrtSession.ctor_error is not None:
            raise FakeOrtSession.ctor_error
        self.model_file = model_file
        self.sess_options = sess_options
        self.providers = providers
        FakeOrtSession.instances.append(self)

    def get_inputs(self):
        return [FakeTensorInfo("feats")]

    def run(self, output_names, feed):
        FakeOrtSession.feeds.append(feed)
        return [np.full((1, 192), 0.5, dtype=np.float32)]


class FakeFbankOptions:
    def __init__(self):
        self.frame_opts = types.SimpleNamespace()
        self.mel_opts = types.SimpleNamespace()


class FakeOnlineFbank:
    """knf.OnlineFbank stand-in: three deterministic 4-dim frames."""

    def __init__(self, options):
        self.options = options

    def accept_waveform(self, samplerate, samples):
        self._samples = samples

    @property
    def num_frames_ready(self):
        return 3

    def get_frame(self, index):
        base = [0.25, -0.5, 0.75, 1.0]
        return [value + index for value in base]


class NeverAutoModel:
    def __init__(self, *args, **kwargs):
        raise AssertionError("torch AutoModel must not be called")

    def __call__(self, *args, **kwargs):
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


FAKE_KNF_ATTRS = {
    "FbankOptions": FakeFbankOptions,
    "OnlineFbank": FakeOnlineFbank,
}


class SpeakerTestBase(unittest.TestCase):
    """Isolates the model-root env (same discipline as test_onnx_engine_switch)."""

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
        FakeOrtSession.reset()
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

    def _make_torch_repo(self, repo_dir):
        path = os.path.join(self.damo_root, repo_dir)
        os.makedirs(path, exist_ok=True)
        with open(os.path.join(path, "config.json"), "w") as f:
            f.write("{}")
        return path


class SpeakerDirParityTest(SpeakerTestBase):
    def test_speaker_dir_name_matches_model_pin(self):
        # ONNX_MODEL_DIR_NAMES must mirror scripts/onnx-export/model-pin.json
        # for ALL four models — the T5 downloader writes exactly these dirs.
        with open(PIN_PATH, encoding="utf-8") as f:
            pin = json.load(f)
        pin_names = {key: model["name"] for key, model in pin["models"].items()}
        for key in ("asr", "vad", "punc", "speaker"):
            self.assertEqual(ONNX_MODEL_DIR_NAMES[key], pin_names[key])


class SpeakerLoaderTest(SpeakerTestBase):
    def test_load_cam_model_prefers_onnx_generation(self):
        srv = FunASRServer(damo_root=self.damo_root)
        ready = self._make_onnx_dir("speaker")
        with fake_module(
            "onnxruntime",
            InferenceSession=FakeOrtSession,
            SessionOptions=FakeSessionOptions,
        ), fake_module("kaldi_native_fbank", **FAKE_KNF_ATTRS), fake_module(
            "funasr", AutoModel=NeverAutoModel
        ):
            srv._load_cam_model()
        self.assertIsInstance(srv.cam_model, OnnxSpeakerAdapter)
        self.assertEqual(FakeOrtSession.instances[0].model_file,
                         os.path.join(ready, "model_quant.onnx"))

    def test_load_cam_model_fails_closed_without_any_generation(self):
        # No ONNX dir AND no torch repo → the explicit actionable error
        # (unchanged contract, never an implicit network pull).
        srv = FunASRServer(damo_root=self.damo_root)
        with self.assertRaises(RuntimeError):
            srv._load_cam_model()

    def test_load_cam_model_onnx_failure_falls_back_to_torch(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._make_onnx_dir("speaker")
        torch_calls = []

        class RecordingAutoModel:
            def __init__(self, model=None, **kwargs):
                torch_calls.append(model)

        self._make_torch_repo("speech_campplus_sv_zh-cn_16k-common")
        with fake_module(
            "onnxruntime",
            InferenceSession=FakeOrtSession,
            SessionOptions=FakeSessionOptions,
        ), fake_module("kaldi_native_fbank", **FAKE_KNF_ATTRS), fake_module(
            "funasr", AutoModel=RecordingAutoModel
        ):
            FakeOrtSession.ctor_error = RuntimeError("corrupt onnx bytes")
            try:
                srv._load_cam_model()
            finally:
                FakeOrtSession.ctor_error = None
        self.assertEqual(
            torch_calls,
            [os.path.join(self.damo_root, "speech_campplus_sv_zh-cn_16k-common")],
        )


class SpeakerAdapterTest(SpeakerTestBase):
    def _make_adapter(self):
        ready = self._make_onnx_dir("speaker")
        with fake_module(
            "onnxruntime",
            InferenceSession=FakeOrtSession,
            SessionOptions=FakeSessionOptions,
        ), fake_module("kaldi_native_fbank", **FAKE_KNF_ATTRS):
            return OnnxSpeakerAdapter(ready, intra_op_num_threads=4)

    def test_adapter_call_returns_torch_spk_embedding_shape(self):
        adapter = self._make_adapter()
        samples = np.zeros(16000, dtype=np.float32)
        result = adapter(samples, output_dir=None)
        self.assertEqual(len(result), 1)
        self.assertIn("spk_embedding", result[0])
        embedding = np.asarray(result[0]["spk_embedding"])
        self.assertEqual(embedding.shape, (192,))

    def test_adapter_feeds_batched_fbank_under_input_name(self):
        adapter = self._make_adapter()
        adapter(np.zeros(16000, dtype=np.float32))
        self.assertEqual(len(FakeOrtSession.feeds), 1)
        (feed,) = FakeOrtSession.feeds
        self.assertEqual(list(feed.keys()), ["feats"])
        feats = feed["feats"]
        self.assertEqual(feats.shape, (1, 3, 4))
        # per-bin mean normalization: column means are zero
        np.testing.assert_allclose(
            feats[0].mean(axis=0), np.zeros(4), atol=1e-6
        )

    def test_adapter_rejects_non_ndarray_without_file_read(self):
        # The adapter contract takes SAMPLES (the diarize path already loaded
        # the file); a str input is treated as a path through the same
        # ndarray doorway as every other engine.
        adapter = self._make_adapter()
        result = adapter(np.zeros(8000, dtype=np.float32))
        self.assertEqual(len(result), 1)

    @unittest.skipUnless(_knf_available(), "kaldi_native_fbank required")
    def test_real_fbank_shape_and_mean_normalization(self):
        # 1s of 16k audio → snip-edges frame count = 1 + (16000-400)//160 = 98
        t = np.arange(16000, dtype=np.float64) / 16000.0
        samples = (0.05 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        feats = _extract_fbank(samples)
        self.assertEqual(feats.shape[1], 80)
        self.assertEqual(feats.shape[0], 98)
        self.assertTrue(np.isfinite(feats).all())
        np.testing.assert_allclose(
            feats.mean(axis=0), np.zeros(80), atol=1e-5
        )


class DiarizeOnnxTest(SpeakerTestBase):
    def _make_srv_with_onnx_speaker(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._make_onnx_dir("speaker")
        with fake_module(
            "onnxruntime",
            InferenceSession=FakeOrtSession,
            SessionOptions=FakeSessionOptions,
        ), fake_module("kaldi_native_fbank", **FAKE_KNF_ATTRS), fake_module(
            "funasr", AutoModel=NeverAutoModel
        ):
            srv._load_cam_model()
        return srv

    def _write_wav(self, duration_s=1.0):
        import soundfile as sf

        t = np.arange(int(16000 * duration_s), dtype=np.float64) / 16000.0
        speech = (0.05 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, dir=tempfile.gettempdir()
        )
        sf.write(tmp.name, speech, 16000, subtype="PCM_16")
        tmp.close()
        self.addCleanup(
            lambda: os.path.exists(tmp.name) and os.unlink(tmp.name)
        )
        return tmp.name

    def test_diarize_assigns_speaker_field_with_onnx_embeddings(self):
        import soundfile as sf  # noqa: F401  (fixture dependency check)

        srv = self._make_srv_with_onnx_speaker()
        wav = self._write_wav()
        segments = [
            {"start_ms": 0, "end_ms": 500, "text": "第一段"},
            {"start_ms": 600, "end_ms": 1100, "text": "第二段"},
        ]
        result = srv.diarize_audio(wav, segments)
        self.assertTrue(result["success"], result)
        self.assertEqual(len(FakeOrtSession.feeds), 2)
        for seg in result["segments"]:
            self.assertIn("speaker", seg)
        # identical fake embeddings cluster to a single speaker label
        self.assertEqual(result["segments"][0]["speaker"], "Speaker")
        self.assertEqual(result["segments"][1]["speaker"], "Speaker")

    def test_diarize_skips_segments_shorter_than_100ms(self):
        srv = self._make_srv_with_onnx_speaker()
        wav = self._write_wav()
        segments = [
            {"start_ms": 0, "end_ms": 50, "text": "太短"},
            {"start_ms": 200, "end_ms": 800, "text": "足够长"},
        ]
        result = srv.diarize_audio(wav, segments)
        self.assertTrue(result["success"], result)
        self.assertEqual(len(FakeOrtSession.feeds), 1)
        self.assertEqual(result["segments"][0]["speaker"], "Speaker")

    def test_diarize_empty_segments_rejected(self):
        srv = self._make_srv_with_onnx_speaker()
        result = srv.diarize_audio("/unused.wav", [])
        self.assertFalse(result["success"])
        self.assertEqual(len(FakeOrtSession.feeds), 0)


if __name__ == "__main__":
    unittest.main()
