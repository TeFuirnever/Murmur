# [20261001_T5_SealImplicitPull] Ticket #417 (spec #412 decision 8): the two
# implicit network-pull fallback paths are SEALED.
#
# Path 1 — "model dir unresolvable → implicit snapshot_download pull": the
# loaders used to hand funasr's AutoModel the REPO ID, so a cache miss made
# funasr silently pull (potentially HEAD-ish state) from modelscope. Now
# every loader resolves the local directory FIRST and passes that local dir
# to AutoModel; an unresolvable repo is an explicit, actionable failure with
# NO AutoModel call at all.
#
# The no-network proof at unit level: funasr only auto-downloads for
# non-existent local paths, so the fake AutoModel raises unless it receives
# an EXISTING local directory — a repo-id call cannot pass these tests.
#
# Path 2 — the wildcard readiness gate that let partial onnx repos through
# — is covered by tests/python/test_onnx_pin_gate.py.
import os
import sys
import tempfile
import types
import unittest

sys.path.insert(
    0,
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ),
)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

import funasr_server  # noqa: E402
from funasr_server import FunASRServer  # noqa: E402

SEACO_DIR = FunASRServer.ASR_MODEL_SEACO.split("/", 1)[1]
FALLBACK_DIR = FunASRServer.ASR_MODEL_FALLBACK.split("/", 1)[1]
VAD_DIR = "speech_fsmn_vad_zh-cn-16k-common-pytorch"
PUNC_DIR = "punc_ct-transformer_zh-cn-common-vocab272727-pytorch"
CAMP_DIR = "speech_campplus_sv_zh-cn_16k-common"


def _make_fake_funasr(calls):
    fake = types.ModuleType("funasr")

    def automodel(model=None, **kwargs):
        # THE NO-NETWORK PROOF: only an existing local dir may reach
        # AutoModel; a repo id would let funasr hit the network on cache
        # miss.
        if not isinstance(model, str) or not os.path.isdir(model):
            raise AssertionError(
                f"AutoModel must receive an existing local dir, got {model!r}"
            )
        calls.append(model)
        return object()

    fake.AutoModel = automodel
    return fake


def _make_fake_psutil():
    fake = types.ModuleType("psutil")

    class _Mem:
        available = 8 * 1024**3

    fake.virtual_memory = lambda: _Mem()
    return fake


class ImplicitPullSealTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._old_env = {
            key: os.environ.get(key)
            for key in ("MODELSCOPE_CACHE", "HOME", "USERPROFILE")
        }
        os.environ["HOME"] = self._tmp.name
        os.environ["USERPROFILE"] = self._tmp.name
        os.environ.pop("MODELSCOPE_CACHE", None)

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _make_repo(self, root, repo_dir):
        dir_path = os.path.join(root, repo_dir)
        os.makedirs(dir_path, exist_ok=True)
        with open(os.path.join(dir_path, "config.json"), "w") as f:
            f.write("{}")
        return dir_path

    def _run_with_fakes(self, fn):
        """Run fn() with fake funasr (+psutil); returns (result, calls)."""
        calls = []
        fake_funasr = _make_fake_funasr(calls)
        fake_psutil = _make_fake_psutil()
        saved_funasr = sys.modules.get("funasr")
        saved_psutil = sys.modules.get("psutil")
        sys.modules["funasr"] = fake_funasr
        sys.modules["psutil"] = fake_psutil
        try:
            return fn(), calls
        finally:
            for name, saved in (("funasr", saved_funasr), ("psutil", saved_psutil)):
                if saved is not None:
                    sys.modules[name] = saved
                else:
                    sys.modules.pop(name, None)

    # --- ASR ---------------------------------------------------------------

    def test_asr_unresolvable_never_calls_automodel(self):
        with tempfile.TemporaryDirectory() as root:
            srv = FunASRServer(damo_root=root)
            ok, calls = self._run_with_fakes(srv._load_asr_model)
        self.assertFalse(ok)
        self.assertEqual(calls, [])

    def test_asr_primary_receives_local_dir(self):
        with tempfile.TemporaryDirectory() as root:
            seaco = self._make_repo(root, SEACO_DIR)
            srv = FunASRServer(damo_root=root)
            ok, calls = self._run_with_fakes(srv._load_asr_model)
        self.assertTrue(ok)
        self.assertEqual(calls, [seaco])
        # Identity reporting stays the repo id, not the on-disk path.
        self.assertEqual(srv.asr_model_name, FunASRServer.ASR_MODEL_SEACO)

    def test_asr_fallback_receives_local_dir(self):
        with tempfile.TemporaryDirectory() as root:
            old = self._make_repo(root, FALLBACK_DIR)
            srv = FunASRServer(damo_root=root)
            ok, calls = self._run_with_fakes(srv._load_asr_model)
        self.assertTrue(ok)
        self.assertEqual(calls, [old])
        self.assertEqual(srv.asr_model_name, FunASRServer.ASR_MODEL_FALLBACK)

    # --- VAD ---------------------------------------------------------------

    def test_vad_unresolvable_is_explicit_error_without_automodel(self):
        with tempfile.TemporaryDirectory() as root:
            srv = FunASRServer(damo_root=root)
            ok, calls = self._run_with_fakes(srv._load_vad_model)
        self.assertFalse(ok)
        self.assertEqual(calls, [])

    def test_vad_receives_local_dir(self):
        with tempfile.TemporaryDirectory() as root:
            vad = self._make_repo(root, VAD_DIR)
            srv = FunASRServer(damo_root=root)
            ok, calls = self._run_with_fakes(srv._load_vad_model)
        self.assertTrue(ok)
        self.assertEqual(calls, [vad])

    # --- punc (optional) ---------------------------------------------------

    def test_punc_unresolvable_is_explicit_error_without_automodel(self):
        with tempfile.TemporaryDirectory() as root:
            srv = FunASRServer(damo_root=root)
            ok, calls = self._run_with_fakes(srv._load_punc_model)
        self.assertFalse(ok)
        self.assertEqual(calls, [])

    def test_punc_receives_local_dir(self):
        with tempfile.TemporaryDirectory() as root:
            punc = self._make_repo(root, PUNC_DIR)
            srv = FunASRServer(damo_root=root)
            ok, calls = self._run_with_fakes(srv._load_punc_model)
        self.assertTrue(ok)
        self.assertEqual(calls, [punc])

    # --- CAM++ speaker (lazy, diarize) --------------------------------------

    def test_cam_unresolvable_raises_explicit_error_without_automodel(self):
        with tempfile.TemporaryDirectory() as root:
            srv = FunASRServer(damo_root=root)
            with self.assertRaises(RuntimeError) as ctx:
                self._run_with_fakes(srv._load_cam_model)
        # Actionable: tells the user what to do, no silent network pull.
        self.assertIn("说话人", str(ctx.exception))
        self.assertIn("重新下载", str(ctx.exception))

    def test_cam_receives_local_dir(self):
        with tempfile.TemporaryDirectory() as root:
            camp = self._make_repo(root, CAMP_DIR)
            srv = FunASRServer(damo_root=root)
            _, calls = self._run_with_fakes(srv._load_cam_model)
        self.assertEqual(calls, [camp])


if __name__ == "__main__":
    unittest.main()
