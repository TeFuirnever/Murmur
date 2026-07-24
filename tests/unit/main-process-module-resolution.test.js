// [20260724_TS_BigBang_TestFix] Walk both .js and .ts files, resolve .ts
// extensions, and check both require() and import() syntax. Previously
// only walked .js, which would become a vacuous no-op after migration.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC_DIR = path.resolve(__dirname, "../../src");

function* walkSourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip frontend-only dirs that never run in main process
      if (["dist", "components", "hooks"].includes(entry.name)) continue;
      yield* walkSourceFiles(full);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".js") || entry.name.endsWith(".ts"))
    ) {
      yield full;
    }
  }
}

// [20260724_TS_BigBang_TestFix] Match require() and import/from statements.
// The [^\n'"]* prevents cross-line matching that would pick up unrelated
// string literals (e.g. ".env" in path.join).
const REQUIRE_RE = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const IMPORT_RE = /(?:import|export)[^\n'"]*['"](\.[^'"]+)['"]/g;
// [20260724_TS_BigBang_TestFix] END

describe("main process module resolution", () => {
  const errors = [];

  for (const file of walkSourceFiles(SRC_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    const relFile = path.relative(SRC_DIR, file);
    for (const re of [REQUIRE_RE, IMPORT_RE]) {
      for (const [, reqPath] of source.matchAll(re)) {
        const resolvedBase = path.resolve(path.dirname(file), reqPath);
        // [20260724_TS_BigBang_TestFix] Check .ts, .js, and index variants
        const candidates = [
          resolvedBase,
          `${resolvedBase}.js`,
          `${resolvedBase}.ts`,
          `${resolvedBase}/index.js`,
          `${resolvedBase}/index.ts`,
        ];
        // [20260724_TS_BigBang_TestFix] END
        const exists = candidates.some((c) => fs.existsSync(c));
        if (!exists) {
          errors.push(`${relFile}: '${reqPath}' does not resolve`);
        }
      }
    }
  }

  it("all relative require()/import() calls in src/ resolve to existing files", () => {
    expect(errors, `Unresolved imports:\n${errors.join("\n")}`).toHaveLength(0);
  });
});
