// [20260724_TS_BigBang_TestFix] Salvaged from ts-migration-parity.test.js.
// The parity test was deleted (it asserted dual-source .js+.ts coexistence),
// but these two type-safety guards are still valuable and now cover ALL
// backend .ts files dynamically, not a hardcoded list.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../..");

// Walk all .ts files under src/helpers, src/utils, src/engines, src/bootstrap,
// src/i18n, and the root main.ts / preload.ts (once they exist).
function walkBackendTsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkBackendTsFiles(full));
    } else if (
      entry.isFile() &&
      full.endsWith(".ts") &&
      !full.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

function collectBackendTsFiles() {
  const dirs = [
    "src/helpers",
    "src/utils",
    "src/engines",
    "src/bootstrap",
    "src/i18n",
  ];
  const files = [];
  for (const dir of dirs) {
    files.push(...walkBackendTsFiles(path.join(rootDir, dir)));
  }
  // Entry points (may not exist yet during early migration phases)
  for (const entry of ["main.ts", "preload.ts"]) {
    const full = path.join(rootDir, entry);
    if (fs.existsSync(full)) files.push(full);
  }
  return files;
}
// [20260724_TS_BigBang_TestFix] END

describe("Backend type safety — all .ts files follow standards", () => {
  const backendFiles = collectBackendTsFiles();

  it("there is at least one backend .ts file to check", () => {
    expect(backendFiles.length).toBeGreaterThan(0);
  });

  it("no backend .ts file uses explicit 'any' type", () => {
    const violations = [];
    for (const fullPath of backendFiles) {
      const relPath = path.relative(rootDir, fullPath);
      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith("//")) continue;
        if (/\b:\s*any\b/.test(line) || /\bas\s+any\b/.test(line)) {
          violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no backend .ts file uses @ts-ignore or @ts-expect-error", () => {
    const violations = [];
    for (const fullPath of backendFiles) {
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
