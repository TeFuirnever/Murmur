# [20261006_Diag_444_Fp32AsrVariant] Ticket #444 (spec #412 T4b): unit tests
# for the fp32 ASR variant staging script (scripts/onnx-export/
# stage_fp32_asr.py). The script turns the T1 export pipeline's fp32 stage
# output into a shipping-style artifact dir (the exact quantize=False
# runtime set) with its own strict per-file sha256 manifest, so the T4b
# diagnosis runs against VERIFIED fp32 bytes instead of raw stage files.
#
# What these tests pin (stdlib-only — the funasr export call itself is
# dev-machine only and is NOT exercised here):
#   1. offline trust chain — the cached checkpoint snapshot's non-graph
#      files must hash-match the committed int8 pin entries before any
#      staging happens (the snapshot was hub-verified by the T1 run; the
#      pin carries those hashes);
#   2. assembly — graphs come from the stage dir, every other runtime file
#      byte-exact from the snapshot; missing sources are reported;
#   3. manifest build + strict verification — pin-shaped manifest, strict
#      set semantics (missing / tampered / unlisted all fail), set drift
#      vs FP32_ASR_RUNTIME_FILES fails even when disk matches the manifest.
import os
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
EXPORT_SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts", "onnx-export")

sys.path.insert(0, EXPORT_SCRIPTS_DIR)

import onnx_export_common  # noqa: E402
from stage_fp32_asr import (  # noqa: E402
    assemble_fp32_variant,
    build_fp32_manifest,
    verify_snapshot_against_pin,
    verify_staged_fp32,
)


def write_bytes(root, rel, payload):
    full = os.path.join(root, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(payload)
    return full


def make_snapshot_dir(tmpdir):
    """Fake checkpoint snapshot: the four non-graph runtime files (graph
    files never live in the snapshot — they are export outputs)."""
    snapshot = os.path.join(tmpdir, "snapshot")
    for rel in ("config.yaml", "am.mvn", "tokens.json", "seg_dict"):
        write_bytes(snapshot, rel, b"snapshot-bytes-" + rel.encode("utf-8"))
    return snapshot


def make_pin_files(snapshot_dir):
    """Pin-shaped file entries AS THE COMMITTED INT8 PIN carries them:
    the two int8 graph entries (export outputs — the offline trust chain
    ignores them) plus the four non-graph files hashed from the snapshot."""
    entries = [
        {"path": "model_quant.onnx", "sha256": "0" * 64, "size_bytes": 1234},
        {"path": "model_eb_quant.onnx", "sha256": "0" * 64, "size_bytes": 1234},
    ]
    for rel in ("config.yaml", "am.mvn", "tokens.json", "seg_dict"):
        source = os.path.join(snapshot_dir, rel)
        entries.append(
            {
                "path": rel,
                "sha256": onnx_export_common.sha256_file(source),
                "size_bytes": os.path.getsize(source),
            }
        )
    return entries


def make_stage_dir(tmpdir):
    """Fake T1 export stage: the fp32 graphs (ticket #444 consumes the
    quantize=True export's fp32 side outputs)."""
    stage = os.path.join(tmpdir, "stage")
    write_bytes(stage, "model.onnx", b"fp32-bb-graph")
    write_bytes(stage, "model_eb.onnx", b"fp32-eb-graph")
    return stage


class SnapshotTrustChainTest(unittest.TestCase):
    """The snapshot's non-graph files must match the committed pin bytes."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.snapshot = make_snapshot_dir(self.tmp.name)
        # Pin BEFORE any mutation: the pin records the pristine bytes.
        self.pin_files = make_pin_files(self.snapshot)

    def test_matching_snapshot_verifies_clean(self):
        problems = verify_snapshot_against_pin(self.snapshot, self.pin_files)
        self.assertEqual(problems, [])

    def test_tampered_snapshot_file_fails(self):
        write_bytes(self.snapshot, "config.yaml", b"tampered")
        problems = verify_snapshot_against_pin(self.snapshot, self.pin_files)
        self.assertTrue(any("sha256 mismatch" in p for p in problems))

    def test_missing_snapshot_file_fails(self):
        os.unlink(os.path.join(self.snapshot, "tokens.json"))
        problems = verify_snapshot_against_pin(self.snapshot, self.pin_files)
        self.assertTrue(any("missing" in p for p in problems))

    def test_graph_pin_entries_are_ignored(self):
        # int8 graph pin entries describe EXPORT outputs, not snapshot
        # files — the offline chain must not demand them from the snapshot.
        self.assertTrue(
            any(e["path"] == "model_quant.onnx" for e in self.pin_files)
        )
        problems = verify_snapshot_against_pin(self.snapshot, self.pin_files)
        self.assertEqual(problems, [])


class AssemblyTest(unittest.TestCase):
    """Graphs from stage, everything else byte-exact from snapshot."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_assembles_exact_fp32_file_set(self):
        snapshot = make_snapshot_dir(self.tmp.name)
        stage = make_stage_dir(self.tmp.name)
        artifact = os.path.join(self.tmp.name, "artifact")
        problems = assemble_fp32_variant(stage, snapshot, artifact)
        self.assertEqual(problems, [])
        on_disk = sorted(onnx_export_common.iter_dir_files(artifact))
        self.assertEqual(
            on_disk, sorted(onnx_export_common.FP32_ASR_RUNTIME_FILES)
        )
        with open(os.path.join(artifact, "model.onnx"), "rb") as f:
            self.assertEqual(f.read(), b"fp32-bb-graph")
        with open(os.path.join(artifact, "config.yaml"), "rb") as f:
            self.assertEqual(f.read(), b"snapshot-bytes-config.yaml")

    def test_missing_stage_graph_is_reported(self):
        snapshot = make_snapshot_dir(self.tmp.name)
        stage = make_stage_dir(self.tmp.name)
        os.unlink(os.path.join(stage, "model_eb.onnx"))
        problems = assemble_fp32_variant(
            stage, snapshot, os.path.join(self.tmp.name, "artifact")
        )
        self.assertTrue(any("model_eb.onnx" in p for p in problems))

    def test_missing_snapshot_file_is_reported(self):
        snapshot = make_snapshot_dir(self.tmp.name)
        stage = make_stage_dir(self.tmp.name)
        os.unlink(os.path.join(snapshot, "am.mvn"))
        problems = assemble_fp32_variant(
            stage, snapshot, os.path.join(self.tmp.name, "artifact")
        )
        self.assertTrue(any("am.mvn" in p for p in problems))


class ManifestBuildAndVerifyTest(unittest.TestCase):
    """Pin-shaped manifest + strict verification of the staged dir."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.snapshot = make_snapshot_dir(self.tmp.name)
        self.stage = make_stage_dir(self.tmp.name)
        self.artifact = os.path.join(self.tmp.name, "artifact")
        self.assertEqual(
            assemble_fp32_variant(self.stage, self.snapshot, self.artifact),
            [],
        )

    def test_manifest_shape_and_verification_clean(self):
        manifest = build_fp32_manifest(self.artifact, {"checkpoint_commit": "a" * 40})
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["variant"], "fp32")
        self.assertEqual(manifest["models"]["asr"]["checkpoint_commit"], "a" * 40)
        files = manifest["models"]["asr"]["files"]
        self.assertEqual(
            sorted(e["path"] for e in files),
            sorted(onnx_export_common.FP32_ASR_RUNTIME_FILES),
        )
        self.assertEqual(verify_staged_fp32(self.artifact, manifest), [])

    def test_tampered_artifact_fails_verification(self):
        manifest = build_fp32_manifest(self.artifact, {})
        write_bytes(self.artifact, "model.onnx", b"tampered-graph")
        problems = verify_staged_fp32(self.artifact, manifest)
        self.assertTrue(any("sha256 mismatch" in p for p in problems))

    def test_extra_artifact_file_fails_verification(self):
        manifest = build_fp32_manifest(self.artifact, {})
        write_bytes(self.artifact, "model_quant.onnx", b"stray int8 graph")
        problems = verify_staged_fp32(self.artifact, manifest)
        self.assertTrue(any("not in manifest" in p for p in problems))

    def test_manifest_set_drift_fails_verification(self):
        manifest = build_fp32_manifest(self.artifact, {})
        manifest["models"]["asr"]["files"] = [
            e
            for e in manifest["models"]["asr"]["files"]
            if e["path"] != "seg_dict"
        ]
        problems = verify_staged_fp32(self.artifact, manifest)
        self.assertTrue(any("set drift" in p for p in problems))


if __name__ == "__main__":
    unittest.main()
