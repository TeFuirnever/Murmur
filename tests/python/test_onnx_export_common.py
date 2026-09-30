# [20260930_T413_OnnxExportPipeline] Ticket #413 (spec #412 T1): unit
# tests for the manifest/pin core of the ONNX int8 self-export pipeline.
# Pure stdlib — no torch/funasr needed, so they run under the same
# embedded-python interpreter as the rest of tests/python.
#
# Contract under test (scripts/onnx-export/onnx_export_common.py):
#   1. MODEL_SPECS pins the four official iic Apache-2.0 torch checkpoints
#      (ASR SeACo, VAD fsmn, Punc ct-transformer 272727, Speaker CAM++) and
#      the EXACT runtime file set the funasr-onnx runtime reads per model.
#   2. build_file_manifest hashes every file under a dir (sha256, size).
#   3. check_manifest enforces the exact set: missing file, hash mismatch,
#      and UNLISTED extra file are all failures (spec #412 decision 8:
#      ready-gate accepts the pinned precise file set, no wildcards).
import hashlib
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "scripts",
        "onnx-export",
    ),
)

from onnx_export_common import (  # noqa: E402
    ASSET_NAME_SEPARATOR,
    MODEL_SPECS,
    PIN_SCHEMA_VERSION,
    asset_name,
    build_file_manifest,
    check_manifest,
    is_commit_sha,
    is_sha256_hex,
    sha256_file,
)

EXPECTED_MODEL_KEYS = {"asr", "vad", "punc", "speaker"}

# funasr-onnx 0.4.3 runtime reads (source-verified, see onnx_export_common
# header for file:line citations) — kept here as an independent pin so a
# accidental edit to MODEL_SPECS fails loudly in tests.
EXPECTED_RUNTIME_FILES = {
    # ContextualParaformer/SeacoParaformer (paraformer_bin.py) quant path.
    "asr": [
        "model_quant.onnx",
        "model_eb_quant.onnx",
        "config.yaml",
        "am.mvn",
        "tokens.json",
        "seg_dict",
    ],
    # Fsmn_vad (vad_bin.py) quant path.
    "vad": ["model_quant.onnx", "config.yaml", "am.mvn"],
    # CT_Transformer (punc_bin.py) quant path; jieba_usr_dict is optional
    # upstream (os.path.exists check) and NOT shipped.
    "punc": ["model_quant.onnx", "config.yaml", "tokens.json"],
    # CAMPPlus has no funasr-onnx loader (T-later server ticket loads it
    # directly): quantized graph + architecture config only.
    "speaker": ["model_quant.onnx", "config.yaml"],
}

EXPECTED_MODELSCOPE_REPOS = {
    "asr": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "vad": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "punc": "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
    "speaker": "iic/speech_campplus_sv_zh-cn_16k-common",
}


class ModelSpecsContractTest(unittest.TestCase):
    def test_four_models_pinned(self):
        self.assertEqual(set(MODEL_SPECS.keys()), EXPECTED_MODEL_KEYS)

    def test_repos_are_official_iic_at_pinned_revision(self):
        for key, repo in EXPECTED_MODELSCOPE_REPOS.items():
            spec = MODEL_SPECS[key]
            self.assertEqual(spec["modelscope_repo"], repo, key)
            self.assertTrue(repo.startswith("iic/"), key)
            self.assertTrue(spec["model_revision"], f"{key} revision empty")

    def test_runtime_file_sets_match_funasr_onnx_contract(self):
        for key, files in EXPECTED_RUNTIME_FILES.items():
            self.assertEqual(
                sorted(MODEL_SPECS[key]["runtime_files"]),
                sorted(files),
                f"{key} runtime_files drifted from funasr-onnx contract",
            )

    def test_every_model_declares_exporter_and_license(self):
        for key, spec in MODEL_SPECS.items():
            self.assertIn(spec["exporter"], ("funasr", "campplus-manual"), key)
            self.assertEqual(spec["license"], "Apache-2.0", key)
            self.assertTrue(spec["name"], key)


class ManifestFunctionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, rel, content=b"x"):
        target = os.path.join(self.dir, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(content)
        return target

    def test_sha256_file_matches_hashlib(self):
        target = self._write("a.bin", b"murmur")
        self.assertEqual(sha256_file(target), hashlib.sha256(b"murmur").hexdigest())

    def test_build_file_manifest_lists_every_file_sorted(self):
        self._write("b.onnx", b"1")
        self._write("a.yaml", b"22")
        manifest = build_file_manifest(self.dir)
        self.assertEqual([f["path"] for f in manifest], ["a.yaml", "b.onnx"])
        for entry in manifest:
            self.assertTrue(is_sha256_hex(entry["sha256"]))
            self.assertEqual(entry["size_bytes"], os.path.getsize(
                os.path.join(self.dir, entry["path"])))

    def test_check_manifest_passes_on_untouched_dir(self):
        self._write("a.yaml", b"1")
        manifest = build_file_manifest(self.dir)
        self.assertEqual(check_manifest(self.dir, manifest), [])

    def test_check_manifest_fails_on_byte_flip(self):
        self._write("a.onnx", b"original")
        manifest = build_file_manifest(self.dir)
        self._write("a.onnx", b"tampered")
        problems = check_manifest(self.dir, manifest)
        self.assertTrue(any("sha256 mismatch" in p for p in problems), problems)

    def test_check_manifest_fails_on_missing_file(self):
        self._write("a.onnx", b"1")
        manifest = build_file_manifest(self.dir)
        os.unlink(os.path.join(self.dir, "a.onnx"))
        problems = check_manifest(self.dir, manifest)
        self.assertTrue(any("missing" in p for p in problems), problems)

    def test_check_manifest_fails_on_unlisted_extra_file(self):
        # Spec #412 decision 8: the ready gate accepts only the pinned
        # precise file set — an unexpected file in the model dir (e.g. a
        # partially-renamed temp download) must be a verification failure.
        self._write("a.onnx", b"1")
        manifest = build_file_manifest(self.dir)
        self._write("model_quant.onnx.tmp-download", b"2")
        problems = check_manifest(self.dir, manifest)
        self.assertTrue(any("unexpected" in p for p in problems), problems)


class HelpersTest(unittest.TestCase):
    def test_asset_name_convention(self):
        self.assertEqual(
            asset_name("asr-seaco-paraformer", "model_quant.onnx"),
            "asr-seaco-paraformer" + ASSET_NAME_SEPARATOR + "model_quant.onnx",
        )

    def test_format_validators(self):
        self.assertTrue(is_sha256_hex("a" * 64))
        self.assertFalse(is_sha256_hex("A" * 64))  # lowercase only
        self.assertFalse(is_sha256_hex("g" * 64))
        self.assertTrue(is_commit_sha("0" * 40))
        self.assertFalse(is_commit_sha("0" * 39))
        self.assertFalse(is_commit_sha("z" * 40))

    def test_pin_schema_version_is_positive_int(self):
        self.assertIsInstance(PIN_SCHEMA_VERSION, int)
        self.assertGreater(PIN_SCHEMA_VERSION, 0)


class PinJsonContractTest(unittest.TestCase):
    """The committed pin (scripts/onnx-export/model-pin.json) must exist and
    carry the trust-chain fields once the pipeline has run. Skipped when the
    file is absent so the suite stays green on a fresh clone — the vitest
    twin (tests/unit/onnx-model-pin.test.ts) is the gate that fails there,
    because CI must never merge without the pin."""

    PIN_PATH = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "scripts",
        "onnx-export",
        "model-pin.json",
    )

    def test_pin_matches_model_specs(self):
        if not os.path.exists(self.PIN_PATH):
            self.skipTest("model-pin.json not generated yet (fresh clone)")
        with open(self.PIN_PATH, encoding="utf-8") as f:
            pin = json.load(f)
        self.assertEqual(pin["schema_version"], PIN_SCHEMA_VERSION)
        self.assertEqual(set(pin["models"].keys()), EXPECTED_MODEL_KEYS)
        for key, spec in MODEL_SPECS.items():
            entry = pin["models"][key]
            self.assertEqual(entry["modelscope_repo"], spec["modelscope_repo"], key)
            self.assertTrue(is_commit_sha(entry["checkpoint_commit"]), key)
            for file_entry in entry["files"]:
                self.assertTrue(is_sha256_hex(file_entry["sha256"]), key)
                self.assertGreater(file_entry["size_bytes"], 0, key)
                self.assertEqual(
                    file_entry["asset"], asset_name(entry["name"], file_entry["path"]), key
                )
                # Optional split-part mirror layout (large graphs); when
                # present every part name must extend the canonical asset
                # name in order.
                parts = file_entry.get("asset_parts")
                if parts is not None:
                    self.assertGreater(len(parts), 0, key)
                    for idx, part in enumerate(parts):
                        self.assertEqual(
                            part, f"{file_entry['asset']}.part{idx:02d}", key
                        )
            self.assertEqual(
                sorted(f["path"] for f in entry["files"]),
                sorted(spec["runtime_files"]),
                key,
            )


if __name__ == "__main__":
    unittest.main()
