// [20260906_Test_CoverageMetaPin] Spec #266 T05 (#281): the coverage gates
// themselves are pinned by a test, so lowering a threshold, unbinding the
// macOS enforcement, or dropping the Windows-leg coverage signal fails CI
// with an explanation instead of silently regressing. Pattern: text-level
// assertions on the two config sources, same style as ci-config.test.ts.
//
// Pinned floor (2026-09-05 actuals: 96.6 S / 92.8 B / 94.5 F / 97.1 L):
// thresholds may RISE freely; any drop below the floor fails here.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const vitestConfig = fs.readFileSync(
  path.join(root, "vitest.config.ts"),
  "utf8",
);
const ciWorkflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "ci.yml"),
  "utf8",
);

// [20260906_Spec259_T1] Re-baselined 2026-09-07: the six newly instrumented
// module groups (modelManager, ipc/**, windowManager, updateManager,
// logManager, pythonEnvironment) enter the aggregate at their measured
// values, so the global floor moves 96/92/94/96 -> 88/83/88/89. The gate is
// NOT weakened overall: per-glob floors (see thresholds config) pin each new
// group at its measured branches, and the ratchet path is T2 (#274) +
// T3 (#275) raising those groups to 92, after which the global floor rises
// again. Thresholds may RISE freely; any drop fails here.
const COVERAGE_FLOOR = {
  statements: 88,
  branches: 83,
  functions: 88,
  lines: 89,
} as const;

function parseThresholds(config: string): Record<string, number> {
  // [20260906_Spec259_T1] Line-based scan: the thresholds block now contains
  // nested per-glob objects whose `branches: <n>` entries must not shadow
  // the global metrics. Global entries sit at exactly 8-space indent.
  const start = config.indexOf("thresholds: {");
  if (start === -1) return {};
  const out: Record<string, number> = {};
  for (const line of config.slice(start).split("\n").slice(1)) {
    if (/^ {6}\}/.test(line)) break;
    const m = /^ {8}(\w+): (\d+),$/.exec(line);
    if (m) out[m[1]!] = Number(m[2]);
  }
  return out;
}

/** Extract one workflow step block ("- name: X" through its `run:` line). */
// [20260906_Test_CoverageMetaPin_ReviewFix] Extract the WHOLE step (through
// the next "- name:" boundary) so a `continue-on-error: true` placed after
// `run:` — GitHub's conventional placement, and the most likely form of a
// silent revert — is still inside the slice. Comment lines are stripped:
// the promotion comments legitimately mention continue-on-error in prose.
function extractStep(workflow: string, stepName: string): string {
  const start = workflow.indexOf(`- name: ${stepName}`);
  if (start === -1) return "";
  const next = workflow.indexOf("- name:", start + 1);
  const block = workflow.slice(start, next === -1 ? undefined : next);
  return block
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("[20260906_Test_CoverageMetaPin] vitest coverage thresholds", () => {
  it("keeps every metric at or above the pinned release floor", () => {
    const thresholds = parseThresholds(vitestConfig);
    expect(Object.keys(thresholds)).toEqual(
      expect.arrayContaining(["statements", "branches", "functions", "lines"]),
    );
    for (const [metric, floor] of Object.entries(COVERAGE_FLOOR)) {
      expect(
        thresholds[metric],
        `${metric} threshold dropped below the pinned floor ${floor} — ` +
          "raising the bar is fine, lowering it requires a spec",
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it("documents the macOS-authoring rationale next to the thresholds", () => {
    // The floor is authored from macOS measurements (first honest win
    // measurement: 91.53 branch). Losing that note reintroduces the
    // "why is the win leg different" confusion.
    expect(vitestConfig).toMatch(/authored from[\s/*]*macOS/i);
  });
});

describe("[20260906_Test_CoverageMetaPin] CI coverage enforcement", () => {
  it("keeps the threshold enforcement bound to the macOS leg", () => {
    const step = extractStep(ciWorkflow, "Test with coverage");
    expect(step).toContain("if: runner.os == 'macOS'");
    expect(step).toContain("run: pnpm run test:coverage");
  });

  it("keeps a threshold-free coverage signal on the Windows leg", () => {
    const winStep = extractStep(
      ciWorkflow,
      "Test (full suite) with coverage report",
    );
    expect(winStep).toContain("runner.os == 'Windows'");
    expect(winStep).toContain("vitest run --coverage");
    // Load-bearing: without zeroed thresholds the global floor from
    // vitest.config.ts would apply to the win leg and fail it (win
    // branch actuals sit below the mac-authored floor by design).
    expect(winStep).toContain("--coverage.thresholds.statements=0");
    expect(winStep).toContain("--coverage.thresholds.branches=0");
    expect(winStep).toContain("--coverage.thresholds.functions=0");
    expect(winStep).toContain("--coverage.thresholds.lines=0");
  });
});

describe("[20260906_Test_CoverageMetaPin] e2e gate protection", () => {
  it("boot health stays a blocking step (no continue-on-error)", () => {
    // Promoted by Spec #266 T01; silently re-adding continue-on-error
    // would revert the only e2e merge gate without a trace.
    const step = extractStep(ciWorkflow, "E2E boot health");
    expect(step).toContain("pnpm test:e2e:boot");
    expect(step).not.toContain("continue-on-error");
  });

  it("records the promotion condition for the full e2e suite", () => {
    const step = extractStep(ciWorkflow, "E2E tests");
    expect(step).toContain("pnpm test:e2e");
    // The documented condition must survive until promotion happens.
    expect(ciWorkflow).toMatch(/2-3 consecutive PRs/);
  });
});
