# [20260905_Fix_216_DamoRootLayout] Regression tests for issue #216
# ("模型下载完成后 FunASR 服务端仍判定模型缺失"). Root cause: modelscope
# >= 1.19 downloads into a NEW cache layout with an extra `models` layer:
#
#     <cache>/models/damo/<repo>          (new, modelscope 1.37 verified)
#     <cache>/damo/<repo>                 (legacy)
#     where <cache> defaults to ~/.cache/modelscope/hub
#     and MODELSCOPE_CACHE overrides the whole prefix.
#
# The server's _default_damo_root() only knew the two legacy shapes, so on a
# machine whose only copy of the models lives in the new layout, the
# disk-presence gate reports models_not_downloaded forever (loader AutoModel
# would resolve fine, but the gate runs first and short-circuits).
#
# Contract under test — _default_damo_root() must find `damo` under:
#   $MODELSCOPE_CACHE/damo               (legacy, env)
#   $MODELSCOPE_CACHE/hub/damo           (legacy, env)
#   $MODELSCOPE_CACHE/models/damo        (new, env)
#   $MODELSCOPE_CACHE/hub/models/damo    (new, env)
#   ~/.cache/modelscope/hub/models/damo  (new, no env)   ← #216 default case
#   ~/.cache/modelscope/hub/damo         (legacy, no env) ← backward compat
# preferring an EXISTING directory; when nothing exists it must return the
# new-layout default so a fresh download (which lands there) is found next
# time. Runs on stdlib unittest + tempfile only.
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from funasr_server import FunASRServer  # noqa: E402


class TestDefaultDamoRootLayouts(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self._tmp.name, "home")
        self.mc = os.path.join(self._tmp.name, "mc")
        os.makedirs(self.home, exist_ok=True)
        os.makedirs(self.mc, exist_ok=True)
        # os.path.expanduser("~") reads USERPROFILE on Windows and HOME on
        # POSIX — patch both so the fake home applies on every platform
        # (the Windows CI matrix caught the HOME-only version).
        self._old_env = {
            key: os.environ.get(key)
            for key in ("MODELSCOPE_CACHE", "HOME", "USERPROFILE")
        }
        os.environ["HOME"] = self.home
        os.environ["USERPROFILE"] = self.home
        os.environ.pop("MODELSCOPE_CACHE", None)

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    # helper: touch a marker file so the directory "exists" meaningfully
    @staticmethod
    def _materialize(*parts: str) -> str:
        path = os.path.join(*parts)
        os.makedirs(path, exist_ok=True)
        Path(path, "model.pt").write_text("x", encoding="utf-8")
        return path

    def test_env_new_layout_models_damo(self):
        expected = self._materialize(self.mc, "models", "damo")
        os.environ["MODELSCOPE_CACHE"] = self.mc
        self.assertEqual(FunASRServer._default_damo_root(), expected)

    def test_env_new_layout_hub_models_damo(self):
        expected = self._materialize(self.mc, "hub", "models", "damo")
        os.environ["MODELSCOPE_CACHE"] = self.mc
        self.assertEqual(FunASRServer._default_damo_root(), expected)

    def test_env_legacy_damo(self):
        expected = self._materialize(self.mc, "damo")
        os.environ["MODELSCOPE_CACHE"] = self.mc
        self.assertEqual(FunASRServer._default_damo_root(), expected)

    def test_env_legacy_hub_damo(self):
        expected = self._materialize(self.mc, "hub", "damo")
        os.environ["MODELSCOPE_CACHE"] = self.mc
        self.assertEqual(FunASRServer._default_damo_root(), expected)

    def test_no_env_home_new_layout(self):
        expected = self._materialize(
            self.home, ".cache", "modelscope", "hub", "models", "damo"
        )
        self.assertEqual(FunASRServer._default_damo_root(), expected)

    def test_no_env_home_legacy_layout(self):
        expected = self._materialize(self.home, ".cache", "modelscope", "hub", "damo")
        self.assertEqual(FunASRServer._default_damo_root(), expected)

    def test_no_env_nothing_exists_returns_new_layout_default(self):
        # Fresh machine: nothing downloaded yet. The resolver must predict
        # where a fresh modelscope download WILL land (the new layout), so
        # the next gate run finds it.
        expected = os.path.join(
            self.home, ".cache", "modelscope", "hub", "models", "damo"
        )
        self.assertEqual(FunASRServer._default_damo_root(), expected)

    def test_env_new_layout_wins_over_existing_legacy(self):
        # Both exist → the modelscope-1.37 layout (where fresh downloads
        # land) takes precedence over the legacy copy.
        self._materialize(self.mc, "damo")
        expected = self._materialize(self.mc, "models", "damo")
        os.environ["MODELSCOPE_CACHE"] = self.mc
        self.assertEqual(FunASRServer._default_damo_root(), expected)


if __name__ == "__main__":
    unittest.main()
