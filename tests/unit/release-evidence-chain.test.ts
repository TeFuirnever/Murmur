// [20261006_T11_EvidenceChainChecklist] Ticket #424 (spec #412 decision 13):
// the pre-tag release evidence chain. Pins two things:
//
//   1. The checklist evaluator (scripts/release-evidence/check-evidence-chain
//      .js) — five items (T2 win spike / T4 A/B verdict / T7 resource gates /
//      T8 packaging / T9 migration UX), each referencing that ticket's
//      committed artifacts (and, for the CI-evidence tickets, a recorded
//      green run). Any missing item turns its entry red and fails the chain:
//      "缺项即红" is the whole point of the gate.
//   2. build.yml wiring — the mac/win boot smokes each gained a real ONNX
//      inference segment against the PACKAGED interpreter (spec #412 testing
//      decision S3), an `evidence-checklist` job gates `release`, and the
//      installer-size evidence (#422 budgets) becomes a machine-readable
//      artifact the checklist can enforce.
//
// RED first: the evaluator module and the build.yml segments do not exist
// yet; every assertion below fails until they land.
import { afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
// CJS interop precedent: tests/unit/asr-ab-harness.test.ts — the default
// import IS the module.exports object.
import evidenceChainModule from "../../scripts/release-evidence/check-evidence-chain.js";
import type { RunLookup } from "../../scripts/release-evidence/check-evidence-chain.js";

const { checkEvidenceChain, INSTALLER_BUDGET_MB } = evidenceChainModule;

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BUILD_YML = fs.readFileSync(
  path.join(ROOT, ".github/workflows/build.yml"),
  "utf8",
);

const MB = 1024 * 1024;

// --- fixture helpers -------------------------------------------------------

interface FixtureOverrides {
  omit?: string[];
  verdictDocNoResolution?: boolean;
  compareT4aPassed?: boolean;
  compareT4aSubdomains?: Record<string, string>;
  dmgBytes?: number;
  exeBytes?: number;
  withArtifacts?: boolean;
  runLookups?: Record<string, RunLookup>;
}

const DOC_WIN_SPIKE = "# win spike report\n\nWIN-SPIKE: PASS\n";
const DOC_VERDICT_GO =
  "# A/B verdict\n\n## 议决记录（#443）\n\n判决翻 GO：VERDICT: PASS (all gates)\n";
const DOC_RESOURCE_GATE =
  "# measurement environment\n\n双平台 RESOURCE-GATE: PASS\n";
const T9_SRC_FILES = [
  "src/components/MigrationDialog.tsx",
  "src/helpers/modelDownloader.ts",
  "src/helpers/onnxMigration.ts",
  "src/hooks/useModelStatus.tsx",
];
const T9_TEST_FILES = [
  "tests/unit/migration-dialog.test.tsx",
  "tests/unit/onnx-migration-resume.test.ts",
  "tests/unit/modelManager-torch-fallback.test.ts",
];

function writeFixtureRepo(overrides: FixtureOverrides = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-chain-"));
  const docs = path.join(root, "docs/research");
  fs.mkdirSync(docs, { recursive: true });

  const omit = overrides.omit ?? [];
  const writeText = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  if (!omit.includes("t2-doc"))
    writeText("docs/research/2026-10-01-onnx-win-x64-spike.md", DOC_WIN_SPIKE);
  if (!omit.includes("t4-verdict")) {
    writeText(
      "docs/research/2026-10-01-onnx-ab-verdict.md",
      overrides.verdictDocNoResolution
        ? "# A/B verdict\n\nNO-GO appendix only\n"
        : DOC_VERDICT_GO,
    );
  }
  if (!omit.includes("t4-compare")) {
    writeText(
      "docs/research/2026-10-06-onnx-ab-compare-t4a.json",
      JSON.stringify({
        passed: overrides.compareT4aPassed ?? true,
        gates: {
          hotwordSubdomains: overrides.compareT4aSubdomains ?? {
            zh: "hard",
            en: "observation-only",
          },
        },
      }),
    );
  }
  if (!omit.includes("t4-run"))
    writeText("docs/research/2026-10-01-onnx-ab-run.json", "{}");
  if (!omit.includes("t7-doc")) {
    writeText(
      "docs/research/2026-10-06-resource-gate-measurement-environment-clarification.md",
      DOC_RESOURCE_GATE,
    );
  }
  if (!omit.includes("t8-lock"))
    writeText("scripts/embedded-python/requirements.lock", "# pinned wheels\n");
  for (const rel of T9_SRC_FILES) {
    if (!omit.includes("t9-src")) writeText(rel, "// migration ux\n");
  }
  for (const rel of T9_TEST_FILES) {
    if (!omit.includes("t9-tests")) writeText(rel, "// test lock\n");
  }
  return root;
}

function writeArtifactSizes(
  artifactsRoot: string,
  platform: "mac" | "win",
  files: Array<{ name: string; bytes: number }>,
): string {
  const dir = path.join(
    artifactsRoot,
    platform === "mac" ? "Murmur-macOS" : "Murmur-Windows",
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "installer-sizes.json"),
    JSON.stringify({ platform, files }),
  );
  return dir;
}

interface Harness {
  root: string;
  artifactsRoot: string;
  cleanup: () => void;
  artifacts: { mac: string; win: string };
  allRunsFound: (workflowFile: string) => Promise<RunLookup>;
}

function makeHarness(overrides: FixtureOverrides = {}): Harness {
  const root = writeFixtureRepo(overrides);
  const artifactsRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "evidence-artifacts-"),
  );
  const withArtifacts = overrides.withArtifacts ?? true;
  const macDir = withArtifacts
    ? writeArtifactSizes(artifactsRoot, "mac", [
        { name: "Murmur-1.2.0.dmg", bytes: overrides.dmgBytes ?? 210 * MB },
        { name: "Murmur-1.2.0.zip", bytes: 230 * MB },
      ])
    : "";
  const winDir = withArtifacts
    ? writeArtifactSizes(artifactsRoot, "win", [
        {
          name: "Murmur Setup 1.2.0.exe",
          bytes: overrides.exeBytes ?? 230 * MB,
        },
      ])
    : "";
  const runLookups = overrides.runLookups ?? {};
  return {
    root,
    artifactsRoot,
    artifacts: { mac: macDir, win: winDir },
    allRunsFound: async (workflowFile: string) =>
      runLookups[workflowFile] ?? {
        found: true,
        run: {
          id: 42,
          html_url: `https://example.test/run/42/${workflowFile}`,
        },
      },
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(artifactsRoot, { recursive: true, force: true });
    },
  };
}

const createdHarnesses: Harness[] = [];
function harness(overrides: FixtureOverrides = {}): Harness {
  const h = makeHarness(overrides);
  createdHarnesses.push(h);
  return h;
}
afterAll(() => {
  for (const h of createdHarnesses) h.cleanup();
});

// --- evaluator behaviour ---------------------------------------------------

describe("[20261006_T11_EvidenceChainChecklist] evidence chain evaluator", () => {
  it("passes when every ticket's artifact chain is present", async () => {
    const h = harness();
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items).toHaveLength(5);
    expect(report.passed).toBe(true);
    for (const item of report.items) expect(item.status).toBe("green");
  });

  it("exposes the #422 installer budgets as named constants", () => {
    expect(INSTALLER_BUDGET_MB).toEqual({ mac: 260, win: 270 });
  });

  it("T2: missing win-spike doc turns the item red", async () => {
    const h = harness({ omit: ["t2-doc"] });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.passed).toBe(false);
    const t2 = report.items.find((i) => i.ticket === 415);
    expect(t2?.status).toBe("red");
  });

  it("T2: a win-spike doc without its PASS marker is not evidence", async () => {
    const h = harness({ omit: ["t2-doc"] });
    fs.writeFileSync(
      path.join(h.root, "docs/research/2026-10-01-onnx-win-x64-spike.md"),
      "# draft spike report without verdict\n",
    );
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 415)?.status).toBe("red");
  });

  it("T2: no recorded green CI run is a missing item", async () => {
    const h = harness({
      runLookups: {
        "onnx-win-spike.yml": { found: false, reason: "no successful run" },
      },
    });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 415)?.status).toBe("red");
    expect(report.passed).toBe(false);
  });

  it("T4: the verdict doc must carry the post-#443 resolution, not just the original NO-GO", async () => {
    const h = harness({ verdictDocNoResolution: true });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 416)?.status).toBe("red");
    expect(report.passed).toBe(false);
  });

  it("T4: compare verdict passed=false fails the chain", async () => {
    const h = harness({ compareT4aPassed: false });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 416)?.status).toBe("red");
  });

  it("T4: hotword subdomain gates must be zh-hard / en-observation-only (#443 口径)", async () => {
    const h = harness({ compareT4aSubdomains: { zh: "hard", en: "hard" } });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 416)?.status).toBe("red");
  });

  it("T7: missing clarification doc turns the item red", async () => {
    const h = harness({ omit: ["t7-doc"] });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 421)?.status).toBe("red");
    expect(report.passed).toBe(false);
  });

  it("T7: no recorded green resource-gate run is a missing item", async () => {
    const h = harness({
      runLookups: {
        "onnx-resource-gate.yml": { found: false, reason: "no successful run" },
      },
    });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 421)?.status).toBe("red");
  });

  it("T8: missing installer-size artifact is a missing packaging evidence", async () => {
    const h = harness({ withArtifacts: false });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: { mac: null, win: null },
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 422)?.status).toBe("red");
    expect(report.passed).toBe(false);
  });

  it("T8: a primary installer over budget fails the chain", async () => {
    const h = harness({ dmgBytes: 261 * MB, exeBytes: 271 * MB });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 422)?.status).toBe("red");
    expect(report.passed).toBe(false);
  });

  it("T8: only the primary installer is budget-gated (dmg/exe), not update zips", async () => {
    const h = harness({ dmgBytes: 210 * MB });
    // Overwrite the mac artifact with a within-budget dmg plus an oversized
    // auto-update zip — the zip is not the 安装包 the #422 budget covers.
    writeArtifactSizes(h.artifactsRoot, "mac", [
      { name: "Murmur-1.2.0.dmg", bytes: 210 * MB },
      { name: "Murmur-1.2.0.zip", bytes: 400 * MB },
    ]);
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 422)?.status).toBe("green");
  });

  it("T9: dropping a migration UX module turns the item red", async () => {
    const h = harness({ omit: ["t9-src"] });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 420)?.status).toBe("red");
    expect(report.passed).toBe(false);
  });

  it("T9: dropping the torch-fallback regression lock turns the item red", async () => {
    const h = harness({ omit: ["t9-tests"] });
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    expect(report.items.find((i) => i.ticket === 420)?.status).toBe("red");
  });

  it("the report carries citable evidence pointers (paths and run urls)", async () => {
    const h = harness();
    const report = await checkEvidenceChain({
      repoRoot: h.root,
      artifacts: h.artifacts,
      fetchRuns: h.allRunsFound,
    });
    const flattened = report.items.map((i) => i.details.join("\n")).join("\n");
    expect(flattened).toContain(
      "docs/research/2026-10-01-onnx-win-x64-spike.md",
    );
    expect(flattened).toContain(
      "https://example.test/run/42/onnx-win-spike.yml",
    );
    expect(flattened).toContain("installer-sizes.json");
  });
});

// --- build.yml wiring ------------------------------------------------------

describe("[20261006_T11_EvidenceChainChecklist] build.yml evidence wiring", () => {
  it("both boot smokes run a real ONNX inference against the packaged interpreter", () => {
    const steps = BUILD_YML.match(
      /ONNX inference smoke against packaged Python \((mac|win)\)/g,
    );
    expect(steps).toHaveLength(2);
    // Full mode (real transcription), not just --check-only imports:
    // --models-dir is only used by the full-mode gate invocation.
    expect(
      BUILD_YML.match(/--models-dir ("?\$\{?[A-Za-z_]|")/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("the inference segment hard-ensures gate model bytes (缺项即红, no silent skip)", () => {
    // The soft pre-package download may degrade (continue-on-error); the
    // smoke must re-fetch hard when bytes are absent.
    expect(
      BUILD_YML.match(/packaged-inference-smoke-/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("the evidence-checklist job gates release", () => {
    expect(BUILD_YML).toContain("evidence-checklist:");
    expect(BUILD_YML).toContain("needs: [test, build-mac, build-win]");
    expect(BUILD_YML).toContain(
      "needs: [build-mac, build-win, evidence-checklist]",
    );
    expect(BUILD_YML).toContain("check-evidence-chain.js");
  });

  it("installer sizes become a machine-readable evidence artifact on both platforms", () => {
    // 2 write sites + 2 upload sites minimum.
    expect(
      BUILD_YML.match(/installer-sizes\.json/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("inference verdicts upload as release evidence artifacts", () => {
    // Both the verdict-producing steps (tee) and the upload steps name the
    // verdict file, on both platforms.
    expect(
      BUILD_YML.match(/packaged-inference-smoke-(mac|win)\.json/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("the inference smoke pins PYTHONIOENCODING=utf-8 on both platforms", () => {
    // Regression guard for run 37418367379: the gate's SUCCESS verdict
    // embeds the recognized Chinese text; Windows' default console codec
    // (cp1252) cannot encode it, so without PYTHONIOENCODING the print of
    // a PASSING verdict crashes the step.
    expect(BUILD_YML.match(/PYTHONIOENCODING=utf-8/g)?.length).toBe(1);
    expect(BUILD_YML.match(/\$env:PYTHONIOENCODING = 'utf-8'/g)?.length).toBe(
      1,
    );
  });
});
