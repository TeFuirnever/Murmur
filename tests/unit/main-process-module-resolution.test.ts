// [20260725_Tier3_MainProcessModuleResolutionMigrate] Migrated from .js to
// .ts as part of Tier 3 batch 2. Pattern: type the fs-walker generator's
// parameter and return type (TS7023/TS7006 — recursive generators cannot
// infer their own return type), declare the `errors` accumulator as
// `string[]` (TS7034/TS7005 — array mutated in a loop has no inferred
// element type), and guard the regex-match destructuring against
// `noUncheckedIndexedAccess` (the captured group is `string | undefined`).
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
// [20260724_TS_BigBang_TestFix] Walk both .js and .ts files, resolve .ts
// extensions, and check both require() and import() syntax. Previously
// only walked .js, which would become a vacuous no-op after migration.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC_DIR = path.resolve(__dirname, "../../src");

// [20260725_Tier3_MainProcessModuleResolutionMigrate] Recursive generator
// needs an explicit `Generator<string>` return type (TS7023) and a typed
// `dir: string` param (TS7006) because the self-reference `yield* walkSourceFiles`
// prevents the inference from converging.
function* walkSourceFiles(dir: string): Generator<string> {
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
  // [20260725_Tier3_MainProcessModuleResolutionMigrate] Explicit `string[]`
  // annotation: this array is pushed to inside a loop, so tsc cannot infer
  // the element type at the declaration site (TS7034/TS7005).
  const errors: string[] = [];

  for (const file of walkSourceFiles(SRC_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    const relFile = path.relative(SRC_DIR, file);
    for (const re of [REQUIRE_RE, IMPORT_RE]) {
      for (const [, reqPath] of source.matchAll(re)) {
        // [20260725_Tier3_MainProcessModuleResolutionMigrate] The captured
        // group is `string | undefined` under `noUncheckedIndexedAccess`;
        // skip empty matches (defensive — the regex always captures group 1
        // when it matches, but tsc cannot prove it).
        if (!reqPath) continue;
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
