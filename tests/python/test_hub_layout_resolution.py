# [20260911_Fix_336_HubLayout] Regression tests for issue #336
# ("模型下载完成后服务端永远报 models_not_downloaded，UI 在 已加载/下载中/下载中断 之间抖动").
#
# Root cause (verified on the user machine): modelscope 1.39's real on-disk
# layout matches NONE of the candidates known to the readiness gate:
#
#     ~/.cache/modelscope/models/damo--<repo>/snapshots/v2.0.4/model.pt
#
# i.e. cache root WITHOUT the legacy `hub` layer, repo dirs renamed
# `damo--<name>`, and an extra `snapshots/<revision>` level. On top of that
# the app always spawns the server with an EXPLICIT --damo-root
# (<userData>/models, which stays EMPTY because download_models.py calls
# snapshot_download without cache_dir), so `_default_damo_root()` never ran
# at all and the gate could never see the modelscope cache.
#
# Contract under test:
#   * _resolve_hub_repo(root, repo) returns the first READY
#     damo--<repo>/snapshots/<rev> dir (pinned revision preferred), else None
#   * _resolve_repo_dir(repo) probes the explicit damo_root FIRST (legacy
#     AND hub shapes) and only then the modelscope default caches — an
#     explicit root that DOES contain the models wins; an EMPTY explicit
#     root must not shadow a populated modelscope cache
#   * _find_missing_required_models() (run()'s startup gate) passes when the
#     required repos exist ONLY in the 1.39 hub layout
#   * _load_asr_model() resolves through the same hub layout
# Runs on stdlib unittest + tempfile only.
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(
    0,
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ),
)

os.environ.setdefault("MURMUR_DEVICE", "cpu")

from funasr_server import FunASRServer  # noqa: E402

SEACO_DIR = FunASRServer.ASR_MODEL_SEACO.split("/", 1)[1]
VAD_DIR = "speech_fsmn_vad_zh-cn-16k-common-pytorch"
PINNED_REVISION = "v2.0.4"


class HubLayoutResolutionTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = os.path.join(self._tmp.name, "home")
        self.explicit_root = os.path.join(self._tmp.name, "userdata", "models")
        os.makedirs(self.home, exist_ok=True)
        os.makedirs(self.explicit_root, exist_ok=True)
        # os.path.expanduser("~") reads USERPROFILE on Windows and HOME on
        # POSIX — patch both so the fake home applies on every platform
        # (same reasoning as test_damo_root_layout.py).
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

    # --- fixture helpers -------------------------------------------------

    @staticmethod
    def _materialize_hub_repo(hub_root, repo_dir, revision=PINNED_REVISION,
                              marker="model.pt"):
        """Build <hub_root>/damo--<repo>/snapshots/<rev>/<marker> (1.39 layout)."""
        snapshot_dir = os.path.join(
            hub_root, f"damo--{repo_dir}", "snapshots", revision
        )
        os.makedirs(snapshot_dir, exist_ok=True)
        Path(snapshot_dir, marker).write_text("x", encoding="utf-8")
        return snapshot_dir

    @staticmethod
    def _materialize_legacy_repo(root, repo_dir, marker="model.pt"):
        """Build <root>/<repo>/<marker> (damo-root layout)."""
        repo_path = os.path.join(root, repo_dir)
        os.makedirs(repo_path, exist_ok=True)
        Path(repo_path, marker).write_text("x", encoding="utf-8")
        return repo_path

    def _home_hub_root(self):
        """The 1.39 default cache root: ~/.cache/modelscope/models (no hub)."""
        return os.path.join(self.home, ".cache", "modelscope", "models")

    # --- _resolve_hub_repo ------------------------------------------------

    def test_hub_repo_resolves_ready_snapshot(self):
        hub_root = self._home_hub_root()
        expected = self._materialize_hub_repo(hub_root, SEACO_DIR)
        self.assertEqual(
            FunASRServer._resolve_hub_repo(hub_root, SEACO_DIR), expected
        )

    def test_hub_repo_missing_snapshots_dir_returns_none(self):
        hub_root = self._home_hub_root()
        os.makedirs(os.path.join(hub_root, f"damo--{SEACO_DIR}"), exist_ok=True)
        self.assertIsNone(FunASRServer._resolve_hub_repo(hub_root, SEACO_DIR))

    def test_hub_repo_shard_only_snapshot_is_not_ready(self):
        # A mid-download snapshot holding only a shard part-file must NOT
        # satisfy the gate (same shard rule as issue #255).
        hub_root = self._home_hub_root()
        self._materialize_hub_repo(
            hub_root, SEACO_DIR, marker="vocab.txt_0_167772159"
        )
        self.assertIsNone(FunASRServer._resolve_hub_repo(hub_root, SEACO_DIR))

    def test_hub_repo_prefers_pinned_revision(self):
        hub_root = self._home_hub_root()
        self._materialize_hub_repo(hub_root, SEACO_DIR, revision="v9.9.9")
        pinned = self._materialize_hub_repo(
            hub_root, SEACO_DIR, revision=PINNED_REVISION
        )
        self.assertEqual(
            FunASRServer._resolve_hub_repo(hub_root, SEACO_DIR), pinned
        )

    def test_hub_repo_accepts_other_ready_revision_when_pinned_absent(self):
        hub_root = self._home_hub_root()
        other = self._materialize_hub_repo(hub_root, SEACO_DIR, revision="v9.9.9")
        self.assertEqual(
            FunASRServer._resolve_hub_repo(hub_root, SEACO_DIR), other
        )

    # --- _resolve_repo_dir -------------------------------------------------

    def test_empty_explicit_root_falls_back_to_home_hub_cache(self):
        # THE #336 BUG: --damo-root points at the empty <userData>/models
        # while the models live in the 1.39 hub layout under ~.
        expected = self._materialize_hub_repo(self._home_hub_root(), SEACO_DIR)
        server = FunASRServer(damo_root=self.explicit_root)
        self.assertEqual(server._resolve_repo_dir(SEACO_DIR), expected)

    def test_populated_explicit_root_wins_over_hub_cache(self):
        # An explicit damo_root that DOES contain the models keeps priority
        # (the user's symlink workaround and upgrading users rely on it).
        explicit = self._materialize_legacy_repo(self.explicit_root, SEACO_DIR)
        self._materialize_hub_repo(self._home_hub_root(), SEACO_DIR)
        server = FunASRServer(damo_root=self.explicit_root)
        self.assertEqual(server._resolve_repo_dir(SEACO_DIR), explicit)

    def test_explicit_root_in_hub_shape_is_found(self):
        # The explicit root itself may hold damo--<repo> dirs (e.g. when it
        # IS the resolved modelscope models root passed via --damo-root).
        expected = self._materialize_hub_repo(self.explicit_root, SEACO_DIR)
        server = FunASRServer(damo_root=self.explicit_root)
        self.assertEqual(server._resolve_repo_dir(SEACO_DIR), expected)

    def test_legacy_default_cache_still_resolves(self):
        # Backward compat: models in the legacy default layout, no explicit
        # root at all.
        default_root = FunASRServer._default_damo_root()
        expected = self._materialize_legacy_repo(default_root, SEACO_DIR)
        server = FunASRServer()
        self.assertEqual(server._resolve_repo_dir(SEACO_DIR), expected)

    def test_missing_everywhere_returns_none(self):
        server = FunASRServer(damo_root=self.explicit_root)
        self.assertIsNone(server._resolve_repo_dir(SEACO_DIR))

    def test_env_cache_hub_layout_is_found(self):
        # MODELSCOPE_CACHE pointing at a custom root with the 1.39 layout.
        env_root = os.path.join(self._tmp.name, "mc")
        expected = self._materialize_hub_repo(
            os.path.join(env_root, "models"), SEACO_DIR
        )
        os.environ["MODELSCOPE_CACHE"] = env_root
        server = FunASRServer(damo_root=self.explicit_root)
        self.assertEqual(server._resolve_repo_dir(SEACO_DIR), expected)

    # --- startup gate (_find_missing_required_models) ----------------------

    def test_gate_passes_with_hub_layout_and_empty_explicit_root(self):
        # Full #336 scenario: required repos exist ONLY in the 1.39 hub
        # layout; the explicit --damo-root is empty → gate must NOT report
        # models_not_downloaded.
        hub_root = self._home_hub_root()
        self._materialize_hub_repo(hub_root, SEACO_DIR)
        self._materialize_hub_repo(hub_root, VAD_DIR)
        server = FunASRServer(damo_root=self.explicit_root)
        self.assertEqual(server._find_missing_required_models(), [])

    def test_gate_reports_missing_when_nowhere_ready(self):
        server = FunASRServer(damo_root=self.explicit_root)
        self.assertEqual(
            server._find_missing_required_models(), [SEACO_DIR, VAD_DIR]
        )

    def test_gate_passes_on_fallback_asr_generation(self):
        # The rollback paraformer satisfies the required-ASR check in the
        # hub layout too (mirrors the legacy [20260820_T15_SeacoSwap] rule).
        hub_root = self._home_hub_root()
        fallback_dir = FunASRServer.ASR_MODEL_FALLBACK.split("/", 1)[1]
        self._materialize_hub_repo(hub_root, fallback_dir)
        self._materialize_hub_repo(hub_root, VAD_DIR)
        server = FunASRServer(damo_root=self.explicit_root)
        self.assertEqual(server._find_missing_required_models(), [])

    # --- _load_asr_model through the hub layout ----------------------------

    def test_load_asr_model_resolves_hub_layout(self):
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
            self._materialize_hub_repo(self._home_hub_root(), SEACO_DIR)
            server = FunASRServer(damo_root=self.explicit_root)
            ok = server._load_asr_model()
        finally:
            if real is not None:
                sys.modules["funasr"] = real
            else:
                sys.modules.pop("funasr", None)
        self.assertTrue(ok)
        self.assertEqual(calls, [FunASRServer.ASR_MODEL_SEACO])


if __name__ == "__main__":
    unittest.main()
