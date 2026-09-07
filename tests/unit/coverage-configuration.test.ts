// [20260906_Spec259_T1] Spec #259 T1 (#273): configuration assertion test
// pinning the instrumentation close-out. Guards against "temporary
// exclusion" drift in vitest.config.ts:
//   - the six module groups moved INTO instrumentation stay instrumented
//     (they must not sneak back into coverage.exclude)
//   - the three remaining exclusions keep their inline exemption comment
//     (tag [20260906_Spec259_T1]); removing the comment while keeping the
//     exclusion fails here
//   - every instrumented group keeps its per-glob branch floor, and floors
//     never drop below the first-measured values pinned here
// Text-level assertions, same style as coverage-meta.test.ts.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const config = fs.readFileSync(
  path.resolve(__dirname, "../../vitest.config.ts"),
  "utf8",
);

const INSTRUMENTED_GROUPS = [
  "src/helpers/modelManager.ts",
  "src/helpers/windowManager.ts",
  "src/helpers/updateManager.ts",
  "src/helpers/logManager.ts",
  "src/helpers/pythonEnvironment.ts",
  "src/helpers/ipc/**",
] as const;

const EXEMPT_GROUPS = [
  "src/helpers/clipboard.ts",
  "src/helpers/tray.ts",
  "src/helpers/hotkeyManager.ts",
] as const;

const EXEMPTION_TAG = "[20260906_Spec259_T1]";

const FIRST_MEASURED_FLOORS = {
  "src/helpers/modelManager.ts": 55,
  "src/helpers/windowManager.ts": 48,
  "src/helpers/updateManager.ts": 14,
  "src/helpers/logManager.ts": 79,
  "src/helpers/pythonEnvironment.ts": 28,
  "src/helpers/ipc/**": 67,
} as const;

function excludeBlock(src: string): string {
  // Anchor inside the coverage section: test.exclude comes first in the
  // file and would otherwise match.
  const covStart = src.indexOf("coverage: {");
  const start = src.indexOf("exclude: [", covStart);
  const end = src.indexOf("],", start);
  return src.slice(start, end);
}

function thresholdsBlock(src: string): string {
  const start = src.indexOf("thresholds: {");
  return src.slice(start);
}

describe("[20260906_Spec259_T1] coverage instrumentation close-out", () => {
  it("keeps the six measured groups instrumented (absent from exclude)", () => {
    const exclude = excludeBlock(config);
    for (const group of INSTRUMENTED_GROUPS) {
      expect(
        exclude.includes(group),
        `${group} regressed into coverage.exclude — it was instrumented by Spec #259 T1 and its branch floor enforces from thresholds`,
      ).toBe(false);
      expect(
        thresholdsBlock(config).includes(`"${group}"`),
        `${group} lost its per-glob branch floor`,
      ).toBe(true);
    }
  });

  it("keeps the three exemptions excluded WITH an inline reason comment", () => {
    const exclude = excludeBlock(config);
    for (const group of EXEMPT_GROUPS) {
      expect(exclude.includes(group)).toBe(true);
    }
    // [20260906_Spec259_T1_ReviewFix] The pin must survive SURGICAL removal
    // of just the exemption comment: assert the distinctive reason prose
    // INSIDE the coverage exclude slice (the tag alone appears elsewhere in
    // the file, so a file-global includes() would pass a stripped comment).
    expect(
      exclude,
      "exemption reason comment was stripped while the exclusions remain — restore the reason or consciously rewrite it with a new ticket tag",
    ).toContain("thin Electron wrappers");
    expect(exclude).toContain("mock-driven execution");
  });

  it("never lowers a per-glob branch floor below first-measured values", () => {
    const thresholds = thresholdsBlock(config);
    for (const [glob, floor] of Object.entries(FIRST_MEASURED_FLOORS)) {
      const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`"${escaped}": \\{ branches: (\\d+) \\}`);
      const match = re.exec(thresholds);
      expect(match, `per-glob floor missing for ${glob}`).toBeTruthy();
      expect(
        Number(match?.[1]),
        `${glob} floor dropped below the first-measured ${floor}`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });
});
