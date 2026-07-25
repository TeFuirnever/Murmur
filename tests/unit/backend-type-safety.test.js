// [20260724_TS_BigBang_TestFix] Salvaged from ts-migration-parity.test.js.
// The parity test was deleted (it asserted dual-source .js+.ts coexistence),
// but these two type-safety guards are still valuable and now cover ALL
// backend .ts files dynamically, not a hardcoded list.
// [20260725_CodeReview_S1] Extended scope: include .d.ts declarations under
// src/. The original guard excluded .d.ts to avoid noise from third-party
// ambient typings, but src/electronAPI.d.ts is first-party contract code
// (the renderer ↔ preload ↔ handler surface). Allowing `any` there silently
// breaks the type contract — see code-review S1, ADR-013.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../..");

// Walk all .ts files (including .d.ts) under the given dirs.
// [20260725_CodeReview_S1_FixAll] Walker now matches .tsx as well as .ts so
// the renderer (src/hooks, src/components, src/settings, src/main.tsx,
// src/App.tsx) is in scope. Previously the test name claimed "all project
// .ts/.d.ts" but silently exempted every .tsx — code-review caught this as
// "allowlist theater": ALLOWED_ANY_PATTERNS listed useRecording.ts entries
// the scanner could never reach. The walker fix surfaces the real renderer
// `as any` sites (HMR, performance.memory, webkitAudioContext) so they can
// be explicitly allowlisted instead of hidden.
function walkTsFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (
      entry.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx"))
    ) {
      out.push(full);
    }
  }
}

function collectProjectTsFiles() {
  const dirs = [
    "src/helpers",
    "src/utils",
    "src/bootstrap",
    "src/i18n",
    "src/types",
    "src/hooks",
    "src/components",
    "src/settings",
    "src", // picks up src/electronAPI.d.ts, src/vite-env.d.ts, src/App.tsx, src/main.tsx
  ];
  const files = [];
  for (const dir of dirs) {
    walkTsFiles(path.join(rootDir, dir), files);
  }
  // Entry points
  for (const entry of ["main.ts", "preload.ts"]) {
    const full = path.join(rootDir, entry);
    if (fs.existsSync(full)) files.push(full);
  }
  // De-duplicate (src/ glob overlaps with sub-dir globs)
  return [...new Set(files)];
}
// [20260725_CodeReview_S1_FixAll] END

describe("Project type safety — all .ts/.tsx/.d.ts follow standards", () => {
  const projectFiles = collectProjectTsFiles();

  it("there is at least one project .ts file to check", () => {
    expect(projectFiles.length).toBeGreaterThan(0);
  });

  // [20260725_CodeReview_S1] Broadened to .d.ts. Catches `: any` in
  // src/electronAPI.d.ts that skipLibCheck hides. Pre-existing violations
  // surface as RED until fixed.
  //
  // Allowlist: each entry is a deliberate escape hatch for a typed-as-any
  // browser/extension API that has no standard lib type. Add a comment per
  // entry naming the API and why no narrower type exists.
  const ALLOWED_ANY_PATTERNS = [
    {
      pattern: "(window as any).webkitAudioContext",
      reason: "Legacy Safari/Chrome prefixed AudioContext — not in TS DOM lib",
    },
    {
      pattern: "finalData as any",
      reason: "AudioWorklet port message shape — untyped at the boundary",
    },
    {
      pattern: "(import.meta as any).hot",
      reason:
        "Vite HMR API — import.meta.hot is added by Vite's client types, not in tsc's lib path for this project",
    },
    {
      pattern: "(newModule: any)",
      reason:
        "Vite HMR accept callback param — Vite Client types not in tsc lib",
    },
    {
      pattern: "(performance as any).memory",
      reason:
        "Chrome-only performance.memory — not in TS DOM lib (standard performance.memory is non-normative)",
    },
    {
      pattern: "modelStatus as any",
      reason:
        "Context provider prop-shape mismatch shim — ModelStatusContextValue widens ModelStatus; tracked for proper fix in Tier 2.3 finalize",
    },
  ];

  it("no project .ts/.tsx/.d.ts file uses explicit 'any' type (except allowlist)", () => {
    const violations = [];
    for (const fullPath of projectFiles) {
      const relPath = path.relative(rootDir, fullPath);
      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split("\n");
      lineLoop: for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith("//")) continue;
        if (/\b:\s*any\b/.test(line) || /\bas\s+any\b/.test(line)) {
          for (const allowed of ALLOWED_ANY_PATTERNS) {
            if (line.includes(allowed.pattern)) continue lineLoop;
          }
          violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no project .ts or .d.ts file uses @ts-ignore or @ts-expect-error", () => {
    const violations = [];
    for (const fullPath of projectFiles) {
      const relPath = path.relative(rootDir, fullPath);
      const content = fs.readFileSync(fullPath, "utf8");
      if (
        content.includes("@ts-ignore") ||
        content.includes("@ts-expect-error")
      ) {
        violations.push(relPath);
      }
    }
    expect(violations).toEqual([]);
  });
});
