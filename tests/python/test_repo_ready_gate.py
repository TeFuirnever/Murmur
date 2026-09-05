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


if __name__ == "__main__":
    unittest.main()
