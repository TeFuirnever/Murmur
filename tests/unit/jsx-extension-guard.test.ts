// [20260725_Tier3_JsxExtensionGuardMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 2. Pattern: type the recursive `walk` helper's
// params (`dir: string`, `ext: string`) and the `files = []` accumulator
// as `string[]` (TS7031 — default array params infer `never[]` under
// strict mode, then poison downstream `.endsWith` calls); type the
// `stripStrings(src)` param (TS7006). No `let` bindings or require()
// at module scope (fs/path are required, not imported, but that resolves
// fine via @types/node). Template reference: phase4-i18n.test.ts (commit
// d52f2e0).
const fs: typeof import("fs") = require("fs");
const path: typeof import("path") = require("path");

const SRC_DIR = path.resolve(__dirname, "../../src");

// [20260725_Tier3_JsxExtensionGuardMigrate] Recursive walker with an
// accumulator: every param needs an explicit type. `files = []` defaults
// to `never[]` under strict mode, which then makes every pushed element
// `never` and breaks the downstream `.endsWith(ext)` filter (TS2345/TS2339).
function walk(dir: string, ext: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, files);
    else if (entry.name.endsWith(ext)) files.push(full);
  }
  return files;
}

// [20260725_Tier3_JsxExtensionGuardMigrate] `src` param typed (TS7006):
// the function only runs regex replaces, so `string` is the narrowest
// correct type.
// Strip string literals and template literals to avoid false positives from
// HTML inside strings (e.g. '<h1>error</h1>' or `<transcript>...</transcript>`).
function stripStrings(src: string): string {
  return src
    .replace(/`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

// Detect JSX: PascalCase component tags, closing tags, or self-closing />.
const JSX_PATTERNS = [
  /<\/[a-zA-Z]/,
  /<[A-Z][a-zA-Z0-9]*\s*\/?>/,
  /<[A-Z][a-zA-Z0-9]*\s[^>]*>/,
];

describe("jsx-extension-guard", () => {
  it("no .js or .ts file in src/ contains JSX syntax", () => {
    const jsFiles = [
      ...walk(SRC_DIR, ".js"),
      ...walk(SRC_DIR, ".ts").filter((f) => !f.endsWith(".d.ts")),
    ];
    const violating: string[] = [];

    for (const file of jsFiles) {
      const content = stripStrings(fs.readFileSync(file, "utf8"));
      // Strip TypeScript generics: Foo<Type> → Foo
      const noGenerics = content.replace(/<[^>]+>/g, "");
      if (JSX_PATTERNS.some((p) => p.test(noGenerics))) {
        violating.push(path.relative(SRC_DIR, file));
      }
    }

    if (violating.length > 0) {
      throw new Error(
        `JSX syntax found in .js/.ts files (rename to .jsx/.tsx):\n  ${violating.join("\n  ")}`,
      );
    }
  });
});
