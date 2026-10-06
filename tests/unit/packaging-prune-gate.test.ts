// [20261006_T8_PackagingSlimdown] Ticket #422 (spec #412 decision 14, list
// entries 3/5 CI boot smoke + 4/5 criticalDeps + 5/5 import-gate): pins the
// packaging pipeline's dependency swap. The embedded-Python builder must
// install the funasr-onnx stack from the hashed lock, prune numba/llvmlite
// only behind a real-inference gate, and the CI workflow's import gate /
// boot smoke must probe the NEW stack (an old `import funasr` gate passes a
// broken env and fails a good one — the exact silent-disconnect class the
// five-reference checklist exists for). RED first: fails until prepare
// script, gate script, and build.yml all carry the swap.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
// CJS interop precedent: tests/unit/python-coverage-runner.test.ts
import EmbeddedPythonBuilder from "../../scripts/prepare-embedded-python";

const ROOT = path.resolve(__dirname, "../..");
const BUILD_YML = fs.readFileSync(
  path.join(ROOT, ".github/workflows/build.yml"),
  "utf8",
);

// Policy lives in class statics (constructor-independent), so the pins
// read off the constructor itself.
const {
  CRITICAL_DEPS,
  RUNTIME_LOCK_PATH,
  PRUNE_PACKAGES,
  GATE_SCRIPT_PATH,
  PACKAGING_STATE_FILENAME,
} = EmbeddedPythonBuilder as unknown as {
  CRITICAL_DEPS: string[];
  RUNTIME_LOCK_PATH: string;
  PRUNE_PACKAGES: string[];
  GATE_SCRIPT_PATH: string;
  PACKAGING_STATE_FILENAME: string;
};

describe("[20261006_T8_PackagingSlimdown] prepare-embedded-python swap", () => {
  it("verifies the ONNX runtime stack as the critical deps (no torch/funasr)", () => {
    expect(CRITICAL_DEPS).toEqual([
      "numpy",
      "soundfile",
      "onnxruntime",
      "funasr_onnx",
    ]);
  });

  it("installs from the committed hashed lock, not floating PyPI ranges", () => {
    expect(RUNTIME_LOCK_PATH).toBe(
      path.join(ROOT, "scripts", "embedded-python", "requirements.lock"),
    );
    expect(fs.existsSync(RUNTIME_LOCK_PATH)).toBe(true);
  });

  it("prunes exactly numba/llvmlite behind the import gate script", () => {
    expect(PRUNE_PACKAGES).toEqual(["numba", "llvmlite"]);
    expect(GATE_SCRIPT_PATH).toBe(
      path.join(ROOT, "scripts", "embedded-python", "import_gate.py"),
    );
    expect(fs.existsSync(GATE_SCRIPT_PATH)).toBe(true);
    expect(PACKAGING_STATE_FILENAME).toBe(".murmur-packaging-state.json");
  });

  // [20261006_T8_PackagingSlimdown] Marker semantics: the packaging-state
  // file is the CI import gate's consistency input — "pruned" must mean
  // numba/llvmlite are really absent, so a gate-passed outcome MUST write
  // pruned:true (a pruned:false marker on a pruned tree makes
  // import_gate.py --check-only fail the build). RED first: the success
  // path wrote pruned:false.
  describe("packaging marker semantics", () => {
    const builderAny = EmbeddedPythonBuilder as unknown as {
      buildPackagingState: (
        outcome: string,
        gatedAt: string,
      ) => { pruned: boolean; reason: string; packages: string[] };
    };

    it("gate-passed records a pruned env", () => {
      const state = builderAny.buildPackagingState(
        "gate-passed",
        "2026-10-06T00:00:00Z",
      );
      expect(state.pruned).toBe(true);
      expect(state.reason).toBe("gate-passed");
      expect(state.packages).toEqual(["numba", "llvmlite"]);
    });

    it("degraded outcomes record an unpruned env with the reason", () => {
      for (const outcome of ["gate-failed", "gate-models-missing"]) {
        const state = builderAny.buildPackagingState(
          outcome,
          "2026-10-06T00:00:00Z",
        );
        expect(state.pruned).toBe(false);
        expect(state.reason).toBe(outcome);
      }
    });

    it("unknown outcomes are rejected, not silently recorded as unpruned", () => {
      expect(() =>
        builderAny.buildPackagingState("whatever", "2026-10-06T00:00:00Z"),
      ).toThrow(/unknown packaging outcome/i);
    });
  });
});

describe("[20261006_T8_PackagingSlimdown] build.yml gate swap", () => {
  it("import gate probes the ONNX stack via the gate script (both platforms)", () => {
    const gateCalls = BUILD_YML.match(/import_gate\.py --check-only/g) ?? [];
    expect(gateCalls.length).toBeGreaterThanOrEqual(2); // mac + win
    // The old inline import must not survive anywhere in the workflow.
    expect(BUILD_YML).not.toMatch(/import funasr(?![_\w])/);
    expect(BUILD_YML).not.toMatch(/import torch/);
  });

  it("boot smoke warms the ONNX stack, not torch", () => {
    // Warm-up calls in both the mac and the win smoke steps.
    const warmups =
      BUILD_YML.match(/import funasr_onnx, onnxruntime, soundfile/g) ?? [];
    expect(warmups.length).toBeGreaterThanOrEqual(2);
  });

  it("caches models for the gate and keys both caches on the new inputs", () => {
    // Models cache: keyed on the pin, consumed by the prune gate.
    expect(BUILD_YML).toContain(
      "hashFiles('scripts/onnx-export/model-pin.json')",
    );
    expect(BUILD_YML).toContain("verify_artifacts.py --from-release");
    // Embedded-python cache must be invalidated by lock changes too, or a
    // re-hashed lock would keep serving the stale (torch-era) env.
    expect(BUILD_YML).toContain(
      "hashFiles('scripts/prepare-embedded-python.js', 'scripts/embedded-python/requirements.lock')",
    );
    // Both prepare steps receive the gate models dir.
    const envUses = BUILD_YML.match(/MURMUR_ONNX_GATE_MODELS_DIR:/g) ?? [];
    expect(envUses.length).toBeGreaterThanOrEqual(2);
  });
});
