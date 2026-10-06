# [20261006_Diag_444_Fp32AsrVariant] Ticket #444 (spec #412 T4b): unit tests
# for the fp32 ASR variant mode of the ONNX A/B verdict server
# (scripts/onnx-ab/funasr_server_onnx_ab.py). The T4b diagnosis needs the
# same verdict instrument to drive an UNQUANTIZED ASR main graph (fp32 bb)
# against the pinned int8 one, with VAD/punc held at int8 so the only
# variable is the ASR graph's precision.
#
# What these tests pin:
#   1. variant resolution — argv wins over env (the harness can only pass
#      env, direct CLI runs use argv); unknown variants are rejected;
#   2. the fp32 pin gate — the fp32 ASR dir is verified against its own
#      standalone strict manifest (ticket #444 staging output), NOT against
#      the committed int8 model-pin.json; VAD/punc stay pin-gated;
#   3. ASR model construction wiring — fp32 loads model.onnx with
#      quantize=False from the fp32 dir; int8 keeps the T4 behavior
#      byte-for-byte (pin dir + quantize=True).
#
# Runs on stdlib unittest only — funasr_onnx/onnxruntime are never imported
# (engines are stubbed, mirroring test_funasr_server_onnx_ab.py).
import importlib.util
import os
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
SERVER_PATH = os.path.join(
    REPO_ROOT, "scripts", "onnx-ab", "funasr_server_onnx_ab.py"
)
EXPORT_SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts", "onnx-export")

sys.path.insert(0, REPO_ROOT)
sys.path.insert(0, EXPORT_SCRIPTS_DIR)
os.environ.setdefault("MURMUR_DEVICE", "cpu")

import onnx_export_common  # noqa: E402


def load_server_module():
    spec = importlib.util.spec_from_file_location(
        "funasr_server_onnx_ab", SERVER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_SERVER_MODULE = None


def server_module():
    """Load the server module once and reuse it (module-level constants are
    needed by the fixture helpers before any test's setUp runs)."""
    global _SERVER_MODULE
    if _SERVER_MODULE is None:
        _SERVER_MODULE = load_server_module()
    return _SERVER_MODULE


def make_int8_pin_for(tmpdir, keys):
    """Fabricate a pin + artifacts tree for the given model keys (stub
    bytes), exactly like make_server_with_stubs in
    test_funasr_server_onnx_ab.py."""
    artifacts_dir = os.path.join(tmpdir, "artifacts")
    pin = {"schema_version": 1, "models": {}}
    for key in keys:
        spec = onnx_export_common.MODEL_SPECS[key]
        model_dir = os.path.join(artifacts_dir, spec["name"])
        os.makedirs(model_dir, exist_ok=True)
        files = []
        for rel in spec["runtime_files"]:
            full = os.path.join(model_dir, rel)
            with open(full, "wb") as f:
                f.write(b"stub-bytes-" + rel.encode("utf-8"))
            files.append(
                {
                    "path": rel,
                    "sha256": onnx_export_common.sha256_file(full),
                    "size_bytes": os.path.getsize(full),
                }
            )
        pin["models"][key] = {"name": spec["name"], "files": files}
    return artifacts_dir, pin


def make_fp32_variant(tmpdir, files=None):
    """Fabricate the fp32 ASR variant dir + standalone manifest. Default
    file set is the exact quantize=False runtime set of
    funasr_onnx ContextualParaformer."""
    if files is None:
        files = server_module().FP32_ASR_RUNTIME_FILES
    fp32_dir = os.path.join(tmpdir, "artifacts-fp32")
    model_dir = os.path.join(
        fp32_dir, onnx_export_common.MODEL_SPECS["asr"]["name"]
    )
    os.makedirs(model_dir, exist_ok=True)
    entries = []
    for rel in files:
        full = os.path.join(model_dir, rel)
        with open(full, "wb") as f:
            f.write(b"fp32-stub-" + rel.encode("utf-8"))
        entries.append(
            {
                "path": rel,
                "sha256": onnx_export_common.sha256_file(full),
                "size_bytes": os.path.getsize(full),
            }
        )
    manifest = {
        "schema_version": 1,
        "variant": "fp32",
        "models": {
            "asr": {
                "name": onnx_export_common.MODEL_SPECS["asr"]["name"],
                "files": entries,
            }
        },
    }
    import json

    manifest_path = os.path.join(fp32_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f)
    return fp32_dir, manifest_path


class VariantResolutionTest(unittest.TestCase):
    """argv wins over env; env falls back to committed defaults."""

    def setUp(self):
        self.module = load_server_module()

    def test_default_is_int8(self):
        resolved = self.module.resolve_asr_variant(env={})
        self.assertEqual(resolved["variant"], "int8")

    def test_env_selects_fp32_with_default_paths(self):
        resolved = self.module.resolve_asr_variant(
            env={self.module.ENV_ASR_VARIANT: "fp32"}
        )
        self.assertEqual(resolved["variant"], "fp32")
        self.assertEqual(
            resolved["fp32_artifacts_dir"], self.module.DEFAULT_FP32_ARTIFACTS_DIR
        )
        self.assertEqual(
            resolved["fp32_manifest_path"],
            self.module.DEFAULT_FP32_MANIFEST_PATH,
        )

    def test_argv_overrides_env(self):
        resolved = self.module.resolve_asr_variant(
            argv_variant="int8", env={self.module.ENV_ASR_VARIANT: "fp32"}
        )
        self.assertEqual(resolved["variant"], "int8")

    def test_argv_paths_override_env_paths(self):
        resolved = self.module.resolve_asr_variant(
            argv_variant="fp32",
            argv_fp32_artifacts="/tmp/a",
            argv_fp32_manifest="/tmp/m.json",
            env={
                self.module.ENV_ASR_VARIANT: "fp32",
                self.module.ENV_FP32_ARTIFACTS: "/env/a",
                self.module.ENV_FP32_MANIFEST: "/env/m.json",
            },
        )
        self.assertEqual(resolved["fp32_artifacts_dir"], "/tmp/a")
        self.assertEqual(resolved["fp32_manifest_path"], "/tmp/m.json")

    def test_unknown_variant_rejected(self):
        with self.assertRaises(ValueError):
            self.module.resolve_asr_variant(argv_variant="fp16", env={})
        with self.assertRaises(ValueError):
            self.module.resolve_asr_variant(
                env={self.module.ENV_ASR_VARIANT: "bf16"}
            )


class Fp32PinGateTest(unittest.TestCase):
    """The fp32 ASR dir is gated by its own strict manifest; VAD/punc stay
    gated by the committed int8 pin."""

    def setUp(self):
        self.module = load_server_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def make_server(self, fp32_dir=None, manifest_path=None):
        artifacts_dir, pin = make_int8_pin_for(self.tmp.name, ("vad", "punc"))
        if fp32_dir is None:
            fp32_dir, manifest_path = make_fp32_variant(self.tmp.name)
        return self.module.OnnxAbServer(
            artifacts_dir,
            pin,
            asr_variant="fp32",
            fp32_artifacts_dir=fp32_dir,
            fp32_manifest_path=manifest_path,
        )

    def test_clean_fp32_variant_verifies(self):
        server = self.make_server()
        self.assertEqual(server.verify_pin(), [])

    def test_tampered_fp32_graph_fails(self):
        server = self.make_server()
        spec = onnx_export_common.MODEL_SPECS["asr"]
        target = os.path.join(
            server.fp32_artifacts_dir, spec["name"], "model.onnx"
        )
        with open(target, "ab") as f:
            f.write(b"tampered")
        problems = server.verify_pin()
        self.assertTrue(any("sha256 mismatch" in p for p in problems))

    def test_missing_fp32_file_fails(self):
        server = self.make_server()
        spec = onnx_export_common.MODEL_SPECS["asr"]
        os.unlink(
            os.path.join(server.fp32_artifacts_dir, spec["name"], "seg_dict")
        )
        problems = server.verify_pin()
        self.assertTrue(any("missing file" in p for p in problems))

    def test_unlisted_extra_fp32_file_fails(self):
        server = self.make_server()
        spec = onnx_export_common.MODEL_SPECS["asr"]
        stray = os.path.join(
            server.fp32_artifacts_dir, spec["name"], "model_quant.onnx"
        )
        with open(stray, "wb") as f:
            f.write(b"stray int8 graph must never ride along")
        problems = server.verify_pin()
        self.assertTrue(any("not in manifest" in p for p in problems))

    def test_manifest_set_drift_fails(self):
        # Manifest lists a file the fp32 runtime never reads (the int8
        # graph name) — disk matches the manifest, but the SET is wrong.
        files = ["model.onnx", "model_eb.onnx", "model_quant.onnx"]
        fp32_dir, manifest_path = make_fp32_variant(self.tmp.name, files=files)
        server = self.make_server(fp32_dir, manifest_path)
        problems = server.verify_pin()
        self.assertTrue(any("set drift" in p for p in problems))

    def test_missing_manifest_file_reports_problem(self):
        server = self.make_server(
            fp32_dir=os.path.join(self.tmp.name, "artifacts-fp32"),
            manifest_path=os.path.join(self.tmp.name, "nope", "manifest.json"),
        )
        problems = server.verify_pin()
        self.assertTrue(any("manifest" in p for p in problems))

    def test_tampered_int8_vad_still_gated_in_fp32_mode(self):
        server = self.make_server()
        spec = onnx_export_common.MODEL_SPECS["vad"]
        with open(
            os.path.join(server.artifacts_dir, spec["name"], "am.mvn"), "ab"
        ) as f:
            f.write(b"tampered")
        problems = server.verify_pin()
        self.assertTrue(any("sha256 mismatch" in p for p in problems))


class AsrModelSpecTest(unittest.TestCase):
    """Construction wiring: fp32 -> (fp32 dir, quantize=False); int8 keeps
    the T4 behavior exactly (pin artifacts dir, quantize=True)."""

    def setUp(self):
        self.module = load_server_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_int8_spec_matches_t4_behavior(self):
        artifacts_dir, pin = make_int8_pin_for(
            self.tmp.name, ("asr", "vad", "punc")
        )
        server = self.module.OnnxAbServer(artifacts_dir, pin)
        asr_dir, quantize = server.asr_model_spec()
        self.assertEqual(
            asr_dir,
            os.path.join(
                artifacts_dir, onnx_export_common.MODEL_SPECS["asr"]["name"]
            ),
        )
        self.assertTrue(quantize)

    def test_fp32_spec_points_at_variant_dir(self):
        artifacts_dir, pin = make_int8_pin_for(self.tmp.name, ("vad", "punc"))
        fp32_dir, manifest_path = make_fp32_variant(self.tmp.name)
        server = self.module.OnnxAbServer(
            artifacts_dir,
            pin,
            asr_variant="fp32",
            fp32_artifacts_dir=fp32_dir,
            fp32_manifest_path=manifest_path,
        )
        asr_dir, quantize = server.asr_model_spec()
        self.assertEqual(
            asr_dir,
            os.path.join(
                fp32_dir, onnx_export_common.MODEL_SPECS["asr"]["name"]
            ),
        )
        self.assertFalse(quantize)


if __name__ == "__main__":
    unittest.main()
