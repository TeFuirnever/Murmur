import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("static import audit — every C.* consumer imports ipc-contracts", () => {
  it("no helper file references C.* without requiring ipc-contracts", () => {
    const root = path.join(process.cwd(), "src", "helpers");
    const files = walk(root).filter((f) => !f.endsWith("ipc-contracts.js"));
    const offenders = [];

    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      // Strip comments first to avoid false positives
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      if (!/\bC\.[A-Z_]+\.[A-Z_]+/.test(stripped)) continue;
      if (!/require\(["'][^"']*ipc-contracts["']\)/.test(stripped)) {
        offenders.push(file);
      }
    }

    expect(
      offenders,
      `files use C.X.Y but don't require ipc-contracts:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
