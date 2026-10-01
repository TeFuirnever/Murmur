# [20261001_T6a_OnnxEngine] Ticket #418 (spec #412 T6a): the engine-switch
# tracer contract for funasr_server.py.
#
# The production server loads the T1 self-exported ONNX int8 models
# (ASR SeACo / VAD fsmn / Punc ct-transformer) through funasr-onnx from the
# T5 downloader layout (<models root>/onnx-int8/<pin name>/) FIRST, keeping
# the torch AutoModel path as the rollback generation (user story #412-5).
# Audio reaches the funasr-onnx engines as an ndarray — funasr_onnx's
# load_data() only calls librosa.load for str/path inputs, so the ndarray
# entry makes the internal librosa.load unreachable (spec #412 decision 3).
# The stdin/stdout protocol is UNCHANGED: the adapters normalize the
# funasr-onnx result shapes (preds/value/tuple) to the torch shapes
# (text/value-dict/text-list) the transcription code already consumes.
#
# Stdlib + numpy/soundfile only — the funasr/funasr_onnx modules are faked
# via sys.modules, mirroring test_seaco_fallback / test_implicit_pull_seal.
import contextlib
import importlib.util
import json
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
    ONNX_MODEL_GENERATION_NAMES,
    OnnxAsrAdapter,
    OnnxPuncAdapter,
    OnnxVadAdapter,
    _ONNX_MARKER_SUFFIX,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PIN_PATH = os.path.join(ROOT, "scripts", "onnx-export", "model-pin.json")


def _scipy_available():
    return importlib.util.find_spec("scipy") is not None


class FakeSeaco:
    """funasr_onnx.SeacoParaformer stand-in recording its constructor args
    and every (samples, hotword) call."""

    instances = []
    calls = []
    ctor_error = None

    @classmethod
    def reset(cls):
        cls.instances = []
        cls.calls = []
        cls.ctor_error = None

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        if FakeSeaco.ctor_error is not None:
            raise FakeSeaco.ctor_error
        self.model_or_dir = model_or_dir
        self.quantize = quantize
        FakeSeaco.instances.append(self)

    def __call__(self, samples, hotwords="", **kwargs):
        FakeSeaco.calls.append((samples, hotwords))
        return [
            {
                "preds": "你好世界。今天的会议",
                "timestamp": [[0, 400], [400, 800], [800, 1200], [1200, 1600], [1600, 2000], [2000, 2400], [2400, 2800], [2800, 3200], [3200, 3600]],
            }
        ]


class FakeFsmn:
    """funasr_onnx.Fsmn_vad stand-in: returns [[start_ms, end_ms], ...]."""

    instances = []
    calls = []

    @classmethod
    def reset(cls):
        cls.instances = []
        cls.calls = []

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        self.model_or_dir = model_or_dir
        self.quantize = quantize
        FakeFsmn.instances.append(self)

    def __call__(self, samples, **kwargs):
        FakeFsmn.calls.append(samples)
        return [[[0, 16000]]]


class FakeCt:
    """funasr_onnx.CT_Transformer stand-in: returns (text, punc_ids)."""

    instances = []
    calls = []

    @classmethod
    def reset(cls):
        cls.instances = []
        cls.calls = []

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        self.model_or_dir = model_or_dir
        self.quantize = quantize
        FakeCt.instances.append(self)

    def __call__(self, text, split_size=20):
        FakeCt.calls.append(text)
        return ("你好，世界。今天，的会议。", None)


class NeverAutoModel:
    """funasr.AutoModel stand-in that FAILS the test if reached — used to
    prove the ONNX generation wins without touching the torch path."""

    def __init__(self, *args, **kwargs):
        raise AssertionError("torch AutoModel must not be called")

    def generate(self, *args, **kwargs):
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


@contextlib.contextmanager
def forbid_librosa_load():
    """Fail the test if librosa.load is ever invoked. When librosa is not
    importable (CI test env), the guard is vacuous by construction."""
    try:
        import librosa
    except ImportError:
        yield None
        return
    original = librosa.load

    def forbidden(*args, **kwargs):
        raise AssertionError("librosa.load must never be called (ndarray path)")

    librosa.load = forbidden
    try:
        yield None
    finally:
        librosa.load = original


class EngineSwitchTestBase(unittest.TestCase):
    """Isolates the model-root env so probes never see the developer
    machine's caches (same discipline as test_repo_ready_gate)."""

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
        for fake in (FakeSeaco, FakeFsmn, FakeCt):
            fake.reset()
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _make_onnx_dir(self, root, model_key, missing=None, truncate=None):
        """Materialize a pin-shaped model dir (sparse files with the pinned
        sizes) under <root>/onnx-int8/<pin name>. readiness is decided by
        ONNX_PIN_FILE_SPECS names+sizes only, so sparse placeholders suffice."""
        spec = funasr_server.ONNX_PIN_FILE_SPECS[model_key]
        dir_path = os.path.join(root, "onnx-int8", ONNX_MODEL_DIR_NAMES[model_key])
        os.makedirs(dir_path, exist_ok=True)
        self.addCleanup(shutil.rmtree, dir_path, ignore_errors=True)
        for name, size in spec.items():
            if name == missing:
                continue
            with open(os.path.join(dir_path, name), "wb") as f:
                f.truncate(size - 1 if name == truncate else size)
        return dir_path

    def _make_torch_repo(self, root, repo_dir):
        path = os.path.join(root, repo_dir)
        os.makedirs(path, exist_ok=True)
        with open(os.path.join(path, "config.json"), "w") as f:
            f.write("{}")
        return path

class OnnxRootResolutionTest(EngineSwitchTestBase):
    def test_dir_names_match_model_pin(self):
        # ONNX_MODEL_DIR_NAMES must mirror scripts/onnx-export/model-pin.json
        # model names — the T5 downloader writes exactly these directories.
        with open(PIN_PATH, encoding="utf-8") as f:
            pin = json.load(f)
        pin_names = {key: model["name"] for key, model in pin["models"].items()}
        for key in ("asr", "vad", "punc"):
            self.assertEqual(ONNX_MODEL_DIR_NAMES[key], pin_names[key])

    def test_onnx_roots_damo_root_then_electron_user_data(self):
        srv = FunASRServer(damo_root=self.damo_root)
        user_data = os.path.join(self._tmp.name, "user-data")
        os.environ["ELECTRON_USER_DATA"] = user_data
        roots = srv._onnx_roots()
        self.assertEqual(
            roots,
            [
                os.path.join(self.damo_root, "onnx-int8"),
                os.path.join(user_data, "models", "onnx-int8"),
            ],
        )

    def test_resolve_onnx_model_dir_returns_pin_ready_dir(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self.assertIsNone(srv._resolve_onnx_model_dir("asr"))
        ready = self._make_onnx_dir(self.damo_root, "asr")
        self.assertEqual(srv._resolve_onnx_model_dir("asr"), ready)

    def test_resolve_onnx_model_dir_rejects_truncated_pin_set(self):
        srv = FunASRServer(damo_root=self.damo_root)
        dir_path = self._make_onnx_dir(self.damo_root, "asr", truncate="seg_dict")
        # the dir carries a plain .onnx entry → ONNX-generation gating applies
        self.assertTrue(
            any(n.endswith(_ONNX_MARKER_SUFFIX) for n in os.listdir(dir_path))
        )
        self.assertIsNone(srv._resolve_onnx_model_dir("asr"))

    def test_resolve_onnx_model_dir_falls_back_to_electron_user_data(self):
        srv = FunASRServer(damo_root=self.damo_root)
        user_data = os.path.join(self._tmp.name, "user-data")
        os.environ["ELECTRON_USER_DATA"] = user_data
        ready = self._make_onnx_dir(
            os.path.join(user_data, "models"), "vad"
        )
        self.assertEqual(srv._resolve_onnx_model_dir("vad"), ready)


class OnnxLoaderPreferenceTest(EngineSwitchTestBase):
    def test_load_asr_model_prefers_onnx_generation(self):
        srv = FunASRServer(damo_root=self.damo_root)
        ready = self._make_onnx_dir(self.damo_root, "asr")
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", SeacoParaformer=FakeSeaco
        ):
            ok = srv._load_asr_model()
        self.assertTrue(ok)
        self.assertEqual(len(FakeSeaco.instances), 1)
        self.assertEqual(FakeSeaco.instances[0].model_or_dir, ready)
        self.assertTrue(FakeSeaco.instances[0].quantize)
        self.assertEqual(srv.asr_model_name, ONNX_MODEL_GENERATION_NAMES["asr"])
        self.assertIsInstance(srv.asr_model, OnnxAsrAdapter)

    def test_load_asr_model_onnx_failure_falls_back_to_torch(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._make_onnx_dir(self.damo_root, "asr")
        seaco_dir = FunASRServer.ASR_MODEL_SEACO.split("/", 1)[1]
        self._make_torch_repo(self.damo_root, seaco_dir)
        torch_calls = []

        class RecordingAutoModel:
            def __init__(self, model=None, **kwargs):
                torch_calls.append(model)

        with fake_module("funasr", AutoModel=RecordingAutoModel), fake_module(
            "funasr_onnx", SeacoParaformer=FakeSeaco
        ):
            FakeSeaco.ctor_error = RuntimeError("corrupt onnx bytes")
            try:
                ok = srv._load_asr_model()
            finally:
                FakeSeaco.ctor_error = None
        self.assertTrue(ok)
        self.assertEqual(torch_calls, [os.path.join(self.damo_root, seaco_dir)])

    def test_load_vad_model_prefers_onnx_generation(self):
        srv = FunASRServer(damo_root=self.damo_root)
        ready = self._make_onnx_dir(self.damo_root, "vad")
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", Fsmn_vad=FakeFsmn
        ):
            ok = srv._load_vad_model()
        self.assertTrue(ok)
        self.assertEqual(FakeFsmn.instances[0].model_or_dir, ready)
        self.assertIsInstance(srv.vad_model, OnnxVadAdapter)

    def test_load_punc_model_prefers_onnx_generation(self):
        srv = FunASRServer(damo_root=self.damo_root)
        ready = self._make_onnx_dir(self.damo_root, "punc")
        with fake_module("funasr", AutoModel=NeverAutoModel), fake_module(
            "funasr_onnx", CT_Transformer=FakeCt
        ):
            ok = srv._load_punc_model()
        self.assertTrue(ok)
        self.assertEqual(FakeCt.instances[0].model_or_dir, ready)
        self.assertIsInstance(srv.punc_model, OnnxPuncAdapter)

    def test_gate_passes_with_onnx_generation_only(self):
        # Fresh-install shape: ONLY the T5-layout ONNX dirs exist (no torch
        # repos anywhere) — the startup gate must NOT report missing.
        self._make_onnx_dir(self.damo_root, "asr")
        self._make_onnx_dir(self.damo_root, "vad")
        srv = FunASRServer(damo_root=self.damo_root)
        self.assertEqual(srv._find_missing_required_models(), [])


class OnnxAdapterTest(EngineSwitchTestBase):
    def test_asr_adapter_normalizes_preds_to_text(self):
        import numpy as np

        engine = FakeSeaco()
        adapter = OnnxAsrAdapter(engine)
        result = adapter.generate(
            input=np.zeros(16, dtype=np.float32), hotword="张晗玥"
        )
        self.assertEqual(len(result), 1)
        self.assertIn("text", result[0])
        self.assertNotIn("preds", result[0])
        self.assertEqual(result[0]["timestamp"][0], [0, 400])

    def test_vad_adapter_normalizes_to_value_dict(self):
        import numpy as np

        adapter = OnnxVadAdapter(FakeFsmn())
        result = adapter.generate(input=np.zeros(16, dtype=np.float32))
        self.assertEqual(result, [{"value": [[0, 16000]]}])

    def test_punc_adapter_normalizes_tuple_to_text_list(self):
        adapter = OnnxPuncAdapter(FakeCt())
        result = adapter.generate(input="你好世界今天的会议")
        self.assertEqual(result, [{"text": "你好，世界。今天，的会议。"}])

    def test_adapters_carry_onnx_engine_name(self):
        self.assertEqual(OnnxAsrAdapter(FakeSeaco()).engine_name, "onnx")
        self.assertEqual(OnnxVadAdapter(FakeFsmn()).engine_name, "onnx")
        self.assertEqual(OnnxPuncAdapter(FakeCt()).engine_name, "onnx")

    @unittest.skipUnless(_scipy_available(), "scipy required for resampling")
    def test_asr_adapter_resamples_non_16k_to_16k_mono(self):
        # A 44.1k stereo wav reaches the passthrough branch (wav ext, no
        # conversion): the adapter must deliver 16k mono ndarray samples.
        import numpy as np
        import soundfile as sf

        t = np.arange(44100, dtype=np.float64) / 44100.0
        stereo = np.stack(
            [0.05 * np.sin(2 * np.pi * 440.0 * t)] * 2, axis=1
        ).astype(np.float32)
        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, dir=tempfile.gettempdir()
        )
        sf.write(tmp.name, stereo, 44100, subtype="PCM_16")
        tmp.close()
        self.addCleanup(lambda: os.path.exists(tmp.name) and os.unlink(tmp.name))

        class RecordingEngine:
            def __init__(self):
                self.samples = None

            def __call__(self, samples, hotwords="", **kwargs):
                self.samples = samples
                return [{"preds": "x", "timestamp": []}]

        engine = RecordingEngine()
        OnnxAsrAdapter(engine).generate(input=tmp.name, hotword="")
        self.assertIsInstance(engine.samples, np.ndarray)
        self.assertEqual(engine.samples.ndim, 1)
        self.assertEqual(len(engine.samples), 16000, "must be resampled to 16k")


class OnnxTranscribeNdarrayTest(EngineSwitchTestBase):
    """The acceptance tracer: real wav → real adapters (fake engines) →
    ndarray at every funasr-onnx boundary, librosa.load never fired, torch
    result shapes preserved on the protocol payload."""

    def _load_onnx_models(self, srv):
        """Run the REAL loader bodies with fake funasr_onnx engines and the
        torch path forbidden (NeverAutoModel fails the test if reached)."""
        self._make_onnx_dir(self.damo_root, "asr")
        self._make_onnx_dir(self.damo_root, "vad")
        self._make_onnx_dir(self.damo_root, "punc")
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

    def setUp(self):
        super().setUp()
        import numpy as np
        import soundfile as sf

        self.np = np
        t = np.arange(16000, dtype=np.float64) / 16000.0
        speech = (0.05 * np.sin(2 * np.pi * 500.0 * t)).astype(np.float32)
        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, dir=tempfile.gettempdir()
        )
        sf.write(tmp.name, speech, 16000, subtype="PCM_16")
        tmp.close()
        self.mic_wav = tmp.name
        self.addCleanup(
            lambda: os.path.exists(self.mic_wav) and os.unlink(self.mic_wav)
        )

    def test_mic_path_feeds_ndarray_and_reports_onnx_generation(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._load_onnx_models(srv)
        with forbid_librosa_load():
            result = srv.transcribe_audio(self.mic_wav, {"hotword": "张晗玥"})
        self.assertTrue(result["success"], result)
        # every engine boundary received an ndarray, never a path
        self.assertEqual(len(FakeFsmn.calls), 1)
        self.assertIsInstance(FakeFsmn.calls[0], self.np.ndarray)
        self.assertEqual(len(FakeSeaco.calls), 1)
        samples, hotword = FakeSeaco.calls[0]
        self.assertIsInstance(samples, self.np.ndarray)
        self.assertEqual(samples.ndim, 1)
        self.assertEqual(hotword, "张晗玥")
        # punc text flows through, protocol payload keeps the torch shape
        self.assertEqual(result["text"], "你好，世界。今天，的会议。")
        self.assertEqual(result["raw_text"], "你好世界。今天的会议")
        self.assertEqual(result["model_type"], "onnx")
        self.assertEqual(result["language"], "zh-CN")

    def test_file_path_feeds_ndarray_and_builds_segments(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._load_onnx_models(srv)
        srv.response_queue = queue.Queue()
        # [20261002_T6b_NoLibrosa] duration now comes from soundfile.info
        # (pure C, CI-safe) — the 1s fixture needs no patching, and the
        # real probe path is exercised.
        with forbid_librosa_load():
            result = srv.transcribe_file_audio(
                self.mic_wav,
                {"request_id": "r418", "hotword": "张晗玥 龚燊"},
            )
        self.assertTrue(result["success"], result)
        # VAD boundary: ndarray. ASR boundary (per-region temp chunk): ndarray.
        self.assertEqual(len(FakeFsmn.calls), 1)
        self.assertIsInstance(FakeFsmn.calls[0], self.np.ndarray)
        self.assertGreaterEqual(len(FakeSeaco.calls), 1)
        for samples, hotword in FakeSeaco.calls:
            self.assertIsInstance(samples, self.np.ndarray)
            self.assertEqual(hotword, "张晗玥 龚燊")
        # timestamp segments were built and punc applied — protocol keys
        # identical to the torch generation
        self.assertEqual(result["text"], "你好，世界。今天，的会议。")
        self.assertEqual(result["raw_text"], "你好世界。今天的会议")
        self.assertIn("segments", result)
        self.assertIn("raw_segments", result)
        self.assertGreaterEqual(len(result["raw_segments"]), 1)
        self.assertIn("start_ms", result["raw_segments"][0])
        self.assertIn("end_ms", result["raw_segments"][0])


if __name__ == "__main__":
    unittest.main()
