# [20261001_T5_OnnxGate] Ticket #417 (spec #412 T5, decision 8): the server
# readiness gate must accept an ONNX-generation repo ONLY when the FULL
# pinned exact file set (names + sizes, from scripts/onnx-export/
# model-pin.json) is present. No wildcards: the old "*.onnx" anchor read a
# repo holding only the 34,028,131-byte eb graph (model_eb_quant.onnx) as
# ready. Temp download names (v2 partial suffix, GitHub part chunks,
# modelscope shard names) are excluded on both sides of the name. Torch-era
# dirs are unaffected.
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

from funasr_server import (  # noqa: E402
    ONNX_PIN_FILE_SPECS,
    _ONNX_MARKER_SUFFIX,
    _PARTIAL_TMP_SUFFIXES,
    FunASRServer,
)

# Pinned sizes copied from the committed model-pin.json (parity is locked by
# tests/unit/onnx-pin-anchor-parity.test.ts). Tests use the REAL numbers for
# the asr model so a truncation case can be asserted against the pin.
ASR_SPECS = ONNX_PIN_FILE_SPECS["asr"]


def _write(dir_path, name, content):
    with open(os.path.join(dir_path, name), "wb") as f:
        f.write(content)


def _asr_full_set(dir_path, missing=None, truncate=None):
    """Materialize the full pinned asr set (placeholder bytes with the pinned
    sizes). `missing` skips one name; `truncate` shortens one name."""
    for name, size in ASR_SPECS.items():
        if name == missing:
            continue
        size = size - 1 if name == truncate else size
        _write(dir_path, name, b"x" * size)


class OnnxPinGateTest(unittest.TestCase):
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

    def _repo(self, name="asr-repo"):
        dir_path = os.path.join(self._tmp.name, name)
        os.makedirs(dir_path, exist_ok=True)
        self.addCleanup(shutil.rmtree, dir_path, ignore_errors=True)
        return dir_path

    def test_full_pinned_set_is_ready(self):
        repo = self._repo()
        _asr_full_set(repo)
        self.assertTrue(FunASRServer._repo_ready(repo))

    def test_eb_graph_alone_is_not_ready(self):
        # THE #417 HOLE: 34MB single-file repo — the old "*.onnx" wildcard
        # anchor read it as ready.
        repo = self._repo()
        _write(
            repo,
            "model_eb_quant.onnx",
            b"x" * ASR_SPECS["model_eb_quant.onnx"],
        )
        self.assertTrue(
            any(n.endswith(_ONNX_MARKER_SUFFIX) for n in os.listdir(repo))
        )
        self.assertFalse(FunASRServer._repo_ready(repo))

    def test_main_graph_alone_is_not_ready(self):
        repo = self._repo()
        _write(
            repo,
            "model_quant.onnx",
            b"x" * ASR_SPECS["model_quant.onnx"],
        )
        self.assertFalse(FunASRServer._repo_ready(repo))

    def test_set_missing_one_file_is_not_ready(self):
        repo = self._repo()
        _asr_full_set(repo, missing="tokens.json")
        self.assertFalse(FunASRServer._repo_ready(repo))

    def test_set_with_truncated_file_is_not_ready(self):
        repo = self._repo()
        _asr_full_set(repo, truncate="seg_dict")
        self.assertFalse(FunASRServer._repo_ready(repo))

    def test_exact_names_only_no_suffix_lookalikes(self):
        repo = self._repo()
        _asr_full_set(repo, missing="tokens.json")
        _write(repo, "tokens.json.bak", b"x" * ASR_SPECS["tokens.json"])
        self.assertFalse(FunASRServer._repo_ready(repo))

    def test_temp_names_are_excluded_from_the_set(self):
        repo = self._repo()
        _asr_full_set(repo, missing="tokens.json")
        # A v2 partial or modelscope shard temp carrying the anchor's name
        # prefix must NOT complete the set.
        _write(repo, f"tokens.json{_PARTIAL_TMP_SUFFIXES[0]}", b"partial")
        _write(repo, "tokens.json_0_167772159", b"shard")
        _write(repo, "tokens.json.murmur-partial.part00", b"part")
        self.assertFalse(FunASRServer._repo_ready(repo))

    def test_temp_names_next_to_a_full_set_stay_ready(self):
        repo = self._repo()
        _asr_full_set(repo)
        _write(repo, f"model_quant.onnx{_PARTIAL_TMP_SUFFIXES[0]}", b"partial")
        _write(repo, "tokens.json_0_167772159", b"shard")
        self.assertTrue(FunASRServer._repo_ready(repo))

    def test_non_onnx_onnx_looking_shard_name_is_not_a_marker(self):
        # A shard temp of the graph name ("model_quant.onnx_0_123") is not a
        # plain .onnx entry: it must not flip the dir into ONNX-generation
        # mode, and it must not satisfy the torch anchors either.
        repo = self._repo()
        _write(repo, "model_quant.onnx_0_167772159", b"shard")
        self.assertFalse(FunASRServer._repo_ready(repo))

    def test_torch_generation_dirs_are_unaffected(self):
        # The v1 anchors keep serving the torch rollback era: a repo holding
        # any torch anchor marker (no .onnx files) is still ready.
        for marker in ("model.pt", "config.json", "model.yaml", "vocab.txt"):
            repo = self._repo(f"torch-{marker}")
            _write(repo, marker, b"torch")
            self.assertTrue(FunASRServer._repo_ready(repo), marker)

    def test_shard_filter_still_applies_to_torch_anchors(self):
        # The #255 regression guard survives the ONNX gate addition.
        repo = self._repo()
        _write(repo, "vocab.txt_0_167772159", b"shard")
        self.assertFalse(FunASRServer._repo_ready(repo))


if __name__ == "__main__":
    unittest.main()
