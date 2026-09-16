# [20260820_T15_SeacoSwap] Ticket #192 review fixups: BEHAVIOR tests for
# the ASR fallback (the TS source-contract anchors prove sync, not
# correctness). RED first.
import os
import sys
import tempfile
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

SEACO_DIR = funasr_server.FunASRServer.ASR_MODEL_SEACO.split("/", 1)[1]
OLD_DIR = funasr_server.FunASRServer.ASR_MODEL_FALLBACK.split("/", 1)[1]


class AsrFallbackTest(unittest.TestCase):
    def setUp(self):
        # [20260911_Fix_336_HubLayout] _resolve_repo_dir now falls back to
        # the modelscope default caches under ~ when the explicit damo_root
        # lacks a repo (issue #336) — isolate HOME/USERPROFILE (and any
        # MODELSCOPE_CACHE) so "absent from the explicit root" really means
        # "absent everywhere", independent of the machine's real cache.
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
        os.makedirs(os.path.join(root, repo_dir), exist_ok=True)
        # One config-ish file satisfies _repo_ready's glob patterns.
        with open(os.path.join(root, repo_dir, "config.json"), "w") as f:
            f.write("{}")

    def test_disk_presence_gate_skips_absent_seaco(self):
        # [review BLOCKER] A model whose repo dir is NOT on disk must be
        # skipped WITHOUT any AutoModel call — funasr auto-downloads ~1GB
        # from modelscope on cache miss, which is exactly what the
        # fallback exists to prevent.
        import types

        calls = []
        fake_funasr = types.ModuleType("funasr")

        def fake_automodel(model=None, **kwargs):
            calls.append(model)
            return object()

        fake_funasr.AutoModel = fake_automodel
        real = sys.modules.get("funasr")
        sys.modules["funasr"] = fake_funasr
        try:
            with tempfile.TemporaryDirectory() as root:
                self._make_repo(root, OLD_DIR)  # old model present only
                srv = FunASRServer(damo_root=root)
                ok = srv._load_asr_model()
        finally:
            if real is not None:
                sys.modules["funasr"] = real
            else:
                sys.modules.pop("funasr", None)
        self.assertTrue(ok)
        self.assertEqual(calls, [FunASRServer.ASR_MODEL_FALLBACK])
        self.assertEqual(srv.asr_model_name, FunASRServer.ASR_MODEL_FALLBACK)

    def test_seaco_load_failure_falls_back_to_old(self):
        # Both on disk; SeACo LOAD throws (corrupt download) → old loads.
        import types

        calls = []
        fake_funasr = types.ModuleType("funasr")

        def fake_automodel(model=None, **kwargs):
            calls.append(model)
            if "seaco" in model:
                raise RuntimeError("corrupt weights")
            return object()

        fake_funasr.AutoModel = fake_automodel
        real = sys.modules.get("funasr")
        sys.modules["funasr"] = fake_funasr
        try:
            with tempfile.TemporaryDirectory() as root:
                self._make_repo(root, SEACO_DIR)
                self._make_repo(root, OLD_DIR)
                srv = FunASRServer(damo_root=root)
                ok = srv._load_asr_model()
        finally:
            if real is not None:
                sys.modules["funasr"] = real
            else:
                sys.modules.pop("funasr", None)
        self.assertTrue(ok)
        self.assertEqual(
            calls,
            [FunASRServer.ASR_MODEL_SEACO, FunASRServer.ASR_MODEL_FALLBACK],
        )

    def test_neither_on_disk_returns_false(self):
        import types

        fake_funasr = types.ModuleType("funasr")
        fake_funasr.AutoModel = lambda **kw: (_ for _ in ()).throw(
            AssertionError("must not be called when nothing is on disk")
        )
        real = sys.modules.get("funasr")
        sys.modules["funasr"] = fake_funasr
        try:
            with tempfile.TemporaryDirectory() as root:
                srv = FunASRServer(damo_root=root)
                ok = srv._load_asr_model()
        finally:
            if real is not None:
                sys.modules["funasr"] = real
            else:
                sys.modules.pop("funasr", None)
        self.assertFalse(ok)
        self.assertIsNone(srv.asr_model_name)

    def test_asr_model_name_defaults_none(self):
        srv = FunASRServer(damo_root="/tmp/test-damo")
        self.assertIsNone(srv.asr_model_name)


if __name__ == "__main__":
    unittest.main()
