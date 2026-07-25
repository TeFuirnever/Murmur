// [20260724_TS_BigBang_TestFix] Walk both .js and .ts files, and check
// both require() and import syntax for ipc-contracts. Previously only
// walked .js and checked require(), becoming a vacuous no-op after migration.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && (full.endsWith(".js") || full.endsWith(".ts")))
      out.push(full);
  }
  return out;
}
// [20260724_TS_BigBang_TestFix] END

describe("static import audit — every C.* consumer imports ipc-contracts", () => {
  it("no helper file references C.* without requiring/importing ipc-contracts", () => {
    const root = path.join(process.cwd(), "src", "helpers");
    const files = walk(root).filter(
      (f) => !f.endsWith("ipc-contracts.js") && !f.endsWith("ipc-contracts.ts"),
    );
    const offenders = [];

    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      // Strip comments first to avoid false positives
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      if (!/\bC\.[A-Z_]+\.[A-Z_]+/.test(stripped)) continue;
      // [20260724_TS_BigBang_TestFix] Check both require() and import syntax
      const hasContracts =
        /require\(["'][^"']*ipc-contracts["']\)/.test(stripped) ||
        /(?:from|import)\s+["'][^"']*ipc-contracts["']/.test(stripped);
      if (!hasContracts) {
        // [20260724_TS_BigBang_TestFix] END
        offenders.push(file);
      }
    }

    expect(
      offenders,
      `files use C.X.Y but don't import ipc-contracts:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
