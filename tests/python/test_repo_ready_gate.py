# [20260905_Fix_255_RepoReadyShardGlob] Regression tests for issue #255.
#
# _repo_ready gated model-readiness on glob patterns including "vocab*".
# ModelScope's downloader leaves SHARD part-files in the repo dir mid-download
# (e.g. vocab.txt_0_167772159 = byte-range temp name), which "vocab*" also
# matches. If the server (re)starts mid-download, the gate misread the repo
# as ready and AutoModel failed with a confusing error instead of the clean
# models_not_downloaded path.
#
# Contract: shard-style part-files (_<start>_<end> byte suffixes) never
# satisfy the gate; real anchor files still do.
import os
import shutil
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

from funasr_server import FunASRServer  # noqa: E402

# Repo dir name (strip the "damo/" prefix) of the SeACo ASR model, for the
# _load_asr_model candidate-filter regression below.
SEACO_DIR = FunASRServer.ASR_MODEL_SEACO.split("/", 1)[1]


class RepoReadyGateTest(unittest.TestCase):
    def _dir_with(self, *names):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        for name in names:
            with open(os.path.join(tmp, name), "w") as f:
                f.write("x")
        return tmp

    def test_absent_dir_not_ready(self):
        self.assertFalse(FunASRServer._repo_ready("/nonexistent/repo"))

    def test_config_anchor_satisfies_gate(self):
        self.assertTrue(
            FunASRServer._repo_ready(self._dir_with("config.json"))
        )

    def test_complete_vocab_satisfies_gate(self):
        self.assertTrue(FunASRServer._repo_ready(self._dir_with("vocab.txt")))

    def test_weights_anchor_satisfies_gate(self):
        self.assertTrue(
            FunASRServer._repo_ready(self._dir_with("pytorch_model.bin"))
        )

    def test_shard_part_file_alone_does_not_satisfy_gate(self):
        # THE #255 BUG: a mid-download shard matched "vocab*" and the gate
        # misread the repo as ready.
        self.assertFalse(
            FunASRServer._repo_ready(
                self._dir_with("vocab.txt_0_167772159")
            )
        )

    def test_shard_of_exact_name_pattern_alone_does_not_satisfy_gate(self):
        # The shard filter applies to ALL patterns, not just vocab* — lock
        # the exact-name path too so a scoped refactor can't regress it.
        self.assertFalse(
            FunASRServer._repo_ready(
                self._dir_with("model.pt_0_167772159")
            )
        )

    def test_shard_plus_real_anchor_still_ready(self):
        self.assertTrue(
            FunASRServer._repo_ready(
                self._dir_with("vocab.txt_0_167772159", "config.json")
            )
        )

    def test_onnx_anchor_satisfies_gate(self):
        self.assertTrue(FunASRServer._repo_ready(self._dir_with("model.onnx")))

    def test_configuration_json_anchor_satisfies_gate(self):
        self.assertTrue(
            FunASRServer._repo_ready(self._dir_with("configuration.json"))
        )

    def test_model_yaml_anchor_satisfies_gate(self):
        self.assertTrue(FunASRServer._repo_ready(self._dir_with("model.yaml")))

    def test_load_asr_model_skips_shard_only_candidate(self):
        # [20260905_Fix_255_ReviewFixup] The reload/lazy-init path
        # (_do_reload → _ensure_initialized → _load_asr_model) bypasses
        # run()'s readiness gate, and its isdir-only candidate filter let a
        # SHARD-ONLY mid-download dir through to AutoModel — the same
        # confusing-failure symptom #255 fixed on the startup path. Contract:
        # a repo whose dir holds only shard part-files is NOT a load
        # candidate; AutoModel is never called and the load fails cleanly.
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
                seaco_dir = os.path.join(root, SEACO_DIR)
                os.makedirs(seaco_dir, exist_ok=True)
                with open(
                    os.path.join(seaco_dir, "vocab.txt_0_167772159"), "w"
                ) as f:
                    f.write("x")
                srv = FunASRServer(damo_root=root)
                ok = srv._load_asr_model()
        finally:
            if real is not None:
                sys.modules["funasr"] = real
            else:
                sys.modules.pop("funasr", None)
        self.assertFalse(ok)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
