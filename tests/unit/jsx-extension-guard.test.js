const fs = require("fs");
const path = require("path");

const SRC_DIR = path.resolve(__dirname, "../../src");

function walk(dir, ext, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, files);
    else if (entry.name.endsWith(ext)) files.push(full);
  }
  return files;
}

// Strip string literals and template literals to avoid false positives from
// HTML inside strings (e.g. '<h1>error</h1>' or `<transcript>...</transcript>`).
function stripStrings(src) {
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
    const violating = [];

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
