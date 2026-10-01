# [20261001_T415_OnnxWinSpike] Ticket #415 (spec #412 T2): unit tests for
# the Windows x64 ONNX spike runner core (scripts/onnx-spike/win_spike.py).
# Pure stdlib — no onnxruntime/funasr-onnx/psutil needed, so the suite runs
# under the same embedded-python interpreter as the rest of tests/python
# (the heavy deps are CI-only; win_spike must import WITHOUT them and load
# them lazily inside the measurement phases).
#
# Contract under test:
#   1. Import cleanliness — importing win_spike pulls no heavy runtime dep
#      (onnxruntime / funasr_onnx / psutil): the stdlib unittest suite and
#      any future gate must be able to import the module cold.
#   2. Four-model contract — the spike covers exactly asr/vad/punc/speaker
#      (spec #412: SeACo-Paraformer, fsmn-vad, ct-transformer, CAM++).
#   3. verify_models_dir re-verifies the downloaded bytes against the
#      committed pin with onnx_export_common.check_manifest strict-set
#      semantics (ticket: the spike must run on SELF-EXPORTED bytes; a
#      tampered/missing/extra file must fail the spike before inference).
#   4. cold_start_stats aggregates N samples (min/median/max).
#   5. evaluate_acceptance implements the ticket gate: 40s-wav text
#      non-empty (plus structural sanity thresholds documented in the
#      script: >=30 chars, similarity >=0.60, >=1 VAD segment).
#   6. Install-size helpers (dir_size_bytes / largest_site_packages).
#   7. char_similarity matches the T1 smoke algorithm (identical text -> 1,
#      disjoint equal-length text -> 0).
#   8. render_markdown emits the three evidence sections the acceptance
#      criteria require (install size / RSS / cold start).
#   9. The committed 40s wav fixture exists, is 16kHz mono s16 RIFF, and is
#      35-45s long (the ticket's "40s wav").
import json
import os
import sys
import tempfile
import unittest
import wave

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts", "onnx-spike"))

import win_spike  # noqa: E402

FIXTURE_WAV = os.path.join(
    REPO_ROOT, "scripts", "onnx-spike", "fixtures", "onnx-spike-40s.wav"
)


class ImportCleanlinessTest(unittest.TestCase):
    def test_importing_module_pulls_no_heavy_runtime_dep(self):
        # The stdlib suite (and any pre-flight check) imports win_spike on
        # machines without onnxruntime — module level must stay stdlib-only.
        for heavy in ("onnxruntime", "funasr_onnx", "psutil", "soundfile"):
            self.assertNotIn(heavy, sys.modules, heavy)


class FourModelContractTest(unittest.TestCase):
    def test_spike_covers_exactly_the_four_spec_models(self):
        self.assertEqual(win_spike.MODEL_KEYS, ("asr", "vad", "punc", "speaker"))

    def test_gate_thresholds_are_the_documented_constants(self):
        # Ticket gate is "text non-empty"; the structural sanity thresholds
        # are pinned constants so the CI evidence cannot silently loosen.
        self.assertEqual(win_spike.MIN_TEXT_CHARS, 30)
        self.assertEqual(win_spike.MIN_SIMILARITY, 0.60)
        self.assertEqual(win_spike.MIN_VAD_SEGMENTS, 1)


class VerifyModelsDirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        # Minimal pin mirroring model-pin.json's per-model shape, with all
        # FOUR model keys — verify_models_dir must cover exactly those.
        def _model(name, payload):
            return {
                "name": name,
                "files": [
                    {
                        "path": "model_quant.onnx",
                        "sha256": _sha256_bytes(payload),
                        "size_bytes": len(payload),
                    }
                ],
            }

        self.pin = {
            "models": {
                "asr": _model("asr-mini", b"asr-bytes"),
                "vad": _model("vad-mini", b"vad-bytes"),
                "punc": _model("punc-mini", b"punc-bytes"),
                "speaker": _model("speaker-mini", b"speaker-bytes"),
            }
        }

    def tearDown(self):
        self.tmp.cleanup()

    def _write_all_models(self):
        self._write("asr-mini", "model_quant.onnx", b"asr-bytes")
        self._write("vad-mini", "model_quant.onnx", b"vad-bytes")
        self._write("punc-mini", "model_quant.onnx", b"punc-bytes")
        self._write("speaker-mini", "model_quant.onnx", b"speaker-bytes")

    def _write(self, model, rel, content):
        target = os.path.join(self.dir, model, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(content)

    def test_passes_on_pinned_bytes(self):
        self._write_all_models()
        self.assertEqual(win_spike.verify_models_dir(self.dir, self.pin), [])

    def test_fails_on_tampered_bytes(self):
        self._write_all_models()
        self._write("asr-mini", "model_quant.onnx", b"evil-bytes")
        problems = win_spike.verify_models_dir(self.dir, self.pin)
        self.assertTrue(any("sha256 mismatch" in p for p in problems), problems)

    def test_fails_on_missing_model_dir(self):
        self._write("vad-mini", "model_quant.onnx", b"vad-bytes")
        problems = win_spike.verify_models_dir(self.dir, self.pin)
        self.assertTrue(
            any("missing file" in p for p in problems), problems
        )

    def test_fails_on_unlisted_extra_file(self):
        self._write_all_models()
        self._write("vad-mini", "tmp-download.part", b"stray")
        problems = win_spike.verify_models_dir(self.dir, self.pin)
        self.assertTrue(any("unexpected file" in p for p in problems), problems)


class ColdStartStatsTest(unittest.TestCase):
    def test_aggregates_min_median_max(self):
        stats = win_spike.cold_start_stats([5.0, 1.0, 4.0, 2.0, 3.0])
        self.assertEqual(stats["count"], 5)
        self.assertEqual(stats["min_s"], 1.0)
        self.assertEqual(stats["max_s"], 5.0)
        self.assertEqual(stats["median_s"], 3.0)

    def test_even_sample_median_is_mean_of_middle_pair(self):
        stats = win_spike.cold_start_stats([1.0, 2.0, 3.0, 4.0])
        self.assertEqual(stats["median_s"], 2.5)

    def test_single_sample(self):
        stats = win_spike.cold_start_stats([7.5])
        self.assertEqual(
            stats, {"count": 1, "min_s": 7.5, "median_s": 7.5, "max_s": 7.5}
        )

    def test_empty_samples_raise(self):
        with self.assertRaises(ValueError):
            win_spike.cold_start_stats([])


class EvaluateAcceptanceTest(unittest.TestCase):
    def _good_text(self):
        return "语音识别" * 10  # 40 chars, well above MIN_TEXT_CHARS

    def test_passes_on_nonempty_coherent_output(self):
        passed, problems = win_spike.evaluate_acceptance(
            self._good_text(), similarity=0.9, vad_segments=1
        )
        self.assertTrue(passed, problems)
        self.assertEqual(problems, [])

    def test_fails_on_empty_text(self):
        # The ticket gate itself: 文本非空.
        passed, problems = win_spike.evaluate_acceptance(
            "", similarity=1.0, vad_segments=3
        )
        self.assertFalse(passed)
        self.assertTrue(any("non-empty" in p for p in problems), problems)

    def test_fails_on_whitespace_only_text(self):
        passed, problems = win_spike.evaluate_acceptance(
            "   ", similarity=1.0, vad_segments=3
        )
        self.assertFalse(passed)
        self.assertTrue(any("non-empty" in p for p in problems), problems)

    def test_fails_on_too_short_text(self):
        passed, _problems = win_spike.evaluate_acceptance(
            "太短", similarity=0.99, vad_segments=1
        )
        self.assertFalse(passed)

    def test_fails_on_similarity_below_threshold(self):
        passed, problems = win_spike.evaluate_acceptance(
            self._good_text(), similarity=0.42, vad_segments=1
        )
        self.assertFalse(passed)
        self.assertTrue(any("similarity" in p for p in problems), problems)

    def test_fails_on_no_vad_segment(self):
        passed, problems = win_spike.evaluate_acceptance(
            self._good_text(), similarity=0.9, vad_segments=0
        )
        self.assertFalse(passed)
        self.assertTrue(any("VAD" in p for p in problems), problems)


class InstallSizeHelpersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, rel, size):
        target = os.path.join(self.dir, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(b"\0" * size)

    def test_dir_size_sums_all_files_recursively(self):
        self._write("pkg_a/a.bin", 100)
        self._write("pkg_a/nested/b.bin", 50)
        self._write("pkg_c/c.bin", 25)
        self.assertEqual(win_spike.dir_size_bytes(self.dir), 175)

    def test_missing_dir_is_zero(self):
        self.assertEqual(
            win_spike.dir_size_bytes(os.path.join(self.dir, "nope")), 0
        )

    def test_largest_site_packages_sorted_desc_with_top_n(self):
        self._write("onnxruntime/big.dll", 300)
        self._write("numpy/small.bin", 100)
        self._write("psutil/mid.bin", 200)
        breakdown = win_spike.largest_site_packages(self.dir, top_n=2)
        self.assertEqual(
            [entry["name"] for entry in breakdown], ["onnxruntime", "psutil"]
        )
        self.assertEqual(breakdown[0]["size_bytes"], 300)

    def test_largest_site_packages_ignores_files_at_root(self):
        # pip freeze output / .dist-info siblings at the site root are not
        # packages; stray files must not crash the breakdown.
        self._write("numpy/small.bin", 100)
        with open(os.path.join(self.dir, "stray-root-file.txt"), "wb") as f:
            f.write(b"x")
        breakdown = win_spike.largest_site_packages(self.dir, top_n=5)
        self.assertEqual(
            [entry["name"] for entry in breakdown], ["numpy"]
        )


class SimilarityTest(unittest.TestCase):
    def test_identical_text_scores_one(self):
        self.assertEqual(
            win_spike.char_similarity("语音识别技术", "语音识别技术"), 1.0
        )

    def test_disjoint_equal_length_scores_zero(self):
        self.assertEqual(win_spike.char_similarity("甲甲甲", "乙乙乙"), 0.0)

    def test_whitespace_is_ignored(self):
        self.assertEqual(
            win_spike.char_similarity("语音 识别", "语音识别"), 1.0
        )

    def test_empty_reference_scores_zero(self):
        self.assertEqual(win_spike.char_similarity("", "语音"), 0.0)


class RenderMarkdownTest(unittest.TestCase):
    def _minimal_report(self):
        return {
            "environment": {
                "platform": "Windows-2025",
                "machine": "AMD64",
                "python": "3.11.9",
                "onnxruntime": "1.30.0",
                "funasr_onnx": "0.4.3",
                "cpu_count": 4,
                "pin_release_tag": "models-onnx-int8-1",
            },
            "install_size": {
                "site_packages_mb": 123.4,
                "largest_packages": [
                    {"name": "onnxruntime", "size_bytes": 100}
                ],
            },
            "cold_start": {
                "samples_s": [10.0, 11.0, 12.0],
                "stats": {"count": 3, "min_s": 10.0, "median_s": 11.0, "max_s": 12.0},
            },
            "measure": {
                "rss_mb": {
                    "after_model_loads": 900.0,
                    "peak_asr_inference": 1200.0,
                },
                "asr": {
                    "text_plain": "x" * 40,
                    "char_similarity_vs_reference": 0.9,
                    "timestamp_present": True,
                },
                "performance": {"asr_rtf_best": 0.02, "asr_rtf_runs": [0.02]},
            },
            "acceptance": {"passed": True, "problems": []},
        }

    def test_markdown_has_the_three_required_evidence_sections(self):
        markdown = win_spike.render_markdown(self._minimal_report())
        for section in ("Install size", "Cold start", "RSS"):
            self.assertIn(section, markdown)

    def test_markdown_carries_numbers_and_verdict(self):
        markdown = win_spike.render_markdown(self._minimal_report())
        self.assertIn("123.4", markdown)  # site-packages MB
        self.assertIn("11.0", markdown)  # cold-start median
        self.assertIn("1200.0", markdown)  # peak RSS
        self.assertIn("PASS", markdown)


class FixtureWavContractTest(unittest.TestCase):
    def test_committed_40s_wav_fixture_exists_and_is_16k_mono_s16(self):
        self.assertTrue(
            os.path.exists(FIXTURE_WAV), f"missing committed fixture {FIXTURE_WAV}"
        )
        with wave.open(FIXTURE_WAV, "rb") as reader:
            self.assertEqual(reader.getframerate(), 16000)
            self.assertEqual(reader.getnchannels(), 1)
            self.assertEqual(reader.getsampwidth(), 2)
            duration = reader.getnframes() / 16000.0
        self.assertGreaterEqual(duration, 35.0)
        self.assertLessEqual(duration, 45.0)


class ReferenceTextContractTest(unittest.TestCase):
    def test_reference_text_is_pinned_and_committed_wav_provenance_exists(self):
        # The fixture is a TTS render of REFERENCE_TEXT (same generator as
        # the T1 smoke), so similarity is measurable on every platform.
        self.assertGreaterEqual(len(win_spike.REFERENCE_TEXT), 100)
        self.assertIn("语音识别", win_spike.REFERENCE_TEXT)
        self.assertTrue(win_spike.HOTWORDS)


def _sha256_bytes(payload: bytes) -> str:
    import hashlib

    return hashlib.sha256(payload).hexdigest()


class ResultsJsonShapeTest(unittest.TestCase):
    """Pin the top-level JSON shape the CI artifact must carry — the
    docs/research report and any future gate consume these keys."""

    REQUIRED_KEYS = [
        "schema_version",
        "environment",
        "install_size",
        "cold_start",
        "measure",
        "acceptance",
    ]

    def test_schema_constant(self):
        self.assertEqual(win_spike.RESULTS_SCHEMA_VERSION, 1)

    def test_required_keys_constant_matches(self):
        self.assertEqual(
            sorted(win_spike.RESULTS_REQUIRED_KEYS), sorted(self.REQUIRED_KEYS)
        )


if __name__ == "__main__":
    unittest.main()
