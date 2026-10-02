# [20261002_T6b_OrtThreads] Ticket #419 (spec #412 decision 4): the ONNX
# inference thread count comes from the ONE derivation function
# (compute_inference_threads — the T8 #187 formula min(max(1, cores-2), 8)
# with the MURMUR_NUM_THREADS override) and is INJECTED into every ONNX
# session: the three funasr_onnx constructors (SeacoParaformer / Fsmn_vad /
# CT_Transformer, whose default was a hard-coded 4) and the direct
# onnxruntime campplus session. Env var semantics are unchanged.
#
# Stdlib only — engines are faked via sys.modules.
import contextlib
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

import funasr_server  # noqa: E402
from funasr_server import (  # noqa: E402
    FunASRServer,
    ONNX_MODEL_DIR_NAMES,
    OnnxSpeakerAdapter,
    compute_inference_threads,
)


class FakeTensorInfo:
    def __init__(self, name):
        self.name = name


class FakeSessionOptions:
    def __init__(self):
        self.intra_op_num_threads = None


class FakeOrtSession:
    instances = []

    def __init__(self, model_file, sess_options=None, providers=None):
        self.model_file = model_file
        self.sess_options = sess_options
        FakeOrtSession.instances.append(self)

    def get_inputs(self):
        return [FakeTensorInfo("feats")]

    def run(self, output_names, feed):
        import numpy as np

        return [np.zeros((1, 192), dtype=np.float32)]


class FakeFbankOptions:
    def __init__(self):
        self.frame_opts = types.SimpleNamespace()
        self.mel_opts = types.SimpleNamespace()


class FakeOnlineFbank:
    def __init__(self, options):
        pass

    def accept_waveform(self, samplerate, samples):
        pass

    @property
    def num_frames_ready(self):
        return 1

    def get_frame(self, index):
        return [0.0] * 4


class ThreadRecordingEngine:
    """Base fake: records the ctor kwargs (the thread injection point)."""

    instances = []

    def __init__(self, model_or_dir="<engine>", quantize=False, **kwargs):
        self.model_or_dir = model_or_dir
        self.quantize = quantize
        self.kwargs = kwargs
        ThreadRecordingEngine.instances.append(self)


class FakeSeaco(ThreadRecordingEngine):
    pass


class FakeFsmn(ThreadRecordingEngine):
    pass


class FakeCt(ThreadRecordingEngine):
    pass


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


class OrtThreadInjectionTest(unittest.TestCase):
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
                "MURMUR_NUM_THREADS",
            )
        }
        os.environ["HOME"] = self._tmp.name
        os.environ["USERPROFILE"] = self._tmp.name
        for key in ("MODELSCOPE_CACHE", "ELECTRON_USER_DATA",
                    "MURMUR_NUM_THREADS"):
            os.environ.pop(key, None)
        self.damo_root = os.path.join(self._tmp.name, "damo-root")
        os.makedirs(self.damo_root, exist_ok=True)
        ThreadRecordingEngine.instances = []
        FakeOrtSession.instances = []
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

    def _load_all_three(self, srv):
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

    def _load_speaker(self, srv):
        self._make_onnx_dir("speaker")
        with fake_module(
            "onnxruntime",
            InferenceSession=FakeOrtSession,
            SessionOptions=FakeSessionOptions,
        ), fake_module(
            "kaldi_native_fbank",
            FbankOptions=FakeFbankOptions,
            OnlineFbank=FakeOnlineFbank,
        ), fake_module(
            "funasr", AutoModel=NeverAutoModel
        ):
            srv._load_cam_model()

    def test_all_three_sessions_get_derived_thread_count(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._load_all_three(srv)
        expected = compute_inference_threads(
            os.cpu_count(), os.environ.get("MURMUR_NUM_THREADS")
        )
        self.assertEqual(expected, srv.inference_threads)
        injected = [
            instance.kwargs.get("intra_op_num_threads")
            for instance in ThreadRecordingEngine.instances
        ]
        self.assertEqual(injected, [expected, expected, expected])

    def test_env_override_flows_through_to_sessions(self):
        # MURMUR_NUM_THREADS semantics unchanged: an integer override wins
        # (clamped), and the SAME value reaches every session.
        os.environ["MURMUR_NUM_THREADS"] = "3"
        srv = FunASRServer(damo_root=self.damo_root)
        self.assertEqual(srv.inference_threads, 3)
        self._load_all_three(srv)
        injected = [
            instance.kwargs.get("intra_op_num_threads")
            for instance in ThreadRecordingEngine.instances
        ]
        self.assertEqual(injected, [3, 3, 3])

    def test_speaker_session_gets_derived_thread_count(self):
        srv = FunASRServer(damo_root=self.damo_root)
        self._load_speaker(srv)
        self.assertIsInstance(srv.cam_model, OnnxSpeakerAdapter)
        self.assertEqual(
            FakeOrtSession.instances[0].sess_options.intra_op_num_threads,
            srv.inference_threads,
        )

    def test_two_and_sixteen_core_scenarios(self):
        # The derivation is the single source: 2 cores → 1 thread, 16 cores
        # → 8 (cap). The injected value must equal it on each machine shape.
        self.assertEqual(compute_inference_threads(2), 1)
        self.assertEqual(compute_inference_threads(16), 8)
        srv = FunASRServer(damo_root=self.damo_root)
        srv.inference_threads = compute_inference_threads(2)
        self._load_all_three(srv)
        injected = [
            instance.kwargs.get("intra_op_num_threads")
            for instance in ThreadRecordingEngine.instances
        ]
        self.assertEqual(injected, [1, 1, 1])

        ThreadRecordingEngine.instances = []
        srv16 = FunASRServer(damo_root=self.damo_root)
        srv16.inference_threads = compute_inference_threads(16)
        self._load_all_three(srv16)
        injected16 = [
            instance.kwargs.get("intra_op_num_threads")
            for instance in ThreadRecordingEngine.instances
        ]
        self.assertEqual(injected16, [8, 8, 8])


if __name__ == "__main__":
    unittest.main()
