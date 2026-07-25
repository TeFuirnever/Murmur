// [20260725_TDDFix_FullSuiteDetector] Regression test for TDD debt across
// the full unit-test suite. Builds on the prior Ralph run (which fixed 3
// unawaited `expect(...).rejects.toThrow(...)` warnings in the
// server-message-router files) by extending coverage to every test file and
// by handling multi-line `await expect(\n  ...\n).rejects.toThrow(...)`
// patterns that the line-based detector would have false-positived.
//
// The detector collates statements by paren-depth so it can evaluate the
// whole assertion even when `await expect(` is on line N and `.rejects.` is
// on line N+2. This is the minimum mechanism needed to safely cover
// `audioFileHelpers.test.js`, `process.test.js`, and any future test that
// splits its expect() arguments across lines.
// [20260725_TDDFix_FullSuiteDetector] END
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const TEST_DIR = path.resolve(__dirname);

/**
 * Discover every test file the vitest config picks up under tests/unit.
 * Vitest's include glob matches `tests/` recursively for files ending in
 * `.test.{js,ts,jsx,tsx}` (see vitest.config.js). We scope to tests/unit
 * because that is where the `.rejects.` pattern lives today; the detector
 * is general-purpose and can be extended to other dirs if needed.
 */
function discoverTestFiles(): string[] {
  const entries = fs.readdirSync(TEST_DIR);
  const testFiles: string[] = [];
  // Top-level test files: resolve to absolute paths so readFileSync works
  // regardless of the vitest cwd.
  for (const name of entries) {
    if (/\.test\.(js|ts|jsx|tsx)$/.test(name)) {
      testFiles.push(path.join(TEST_DIR, name));
    }
  }
  // Subdirectory test files (tests/unit/components/*.test.tsx etc.).
  const subdirs = entries
    .map((name) => path.join(TEST_DIR, name))
    .filter((p) => fs.statSync(p).isDirectory());
  for (const dir of subdirs) {
    for (const name of fs.readdirSync(dir)) {
      if (/\.test\.(js|ts|jsx|tsx)$/.test(name)) {
        testFiles.push(path.join(dir, name));
      }
    }
  }
  // Exclude this detector file from its own scan — its docstrings and
  // diagnostic messages contain literal `.rejects.` strings that are not
  // assertions and would produce self-referential false positives.
  const selfPath = path.resolve(__filename);
  return testFiles.filter((f) => f !== selfPath).sort();
}

interface Offender {
  file: string;
  startLine: number;
  preview: string;
}

// Offset of the `expect` keyword that opens a `.rejects.` chain. Inlined
// rather than wrapped in an interface because the scanner only carries
// this single value between helpers.
type ExpectStart = number;

/**
 * Count `.rejects.` assertions across all test files that are NOT awaited.
 *
 * Strategy: for every occurrence of `.rejects.` in the file, walk backward
 * through the source to find the start of the enclosing `expect(...)` call,
 * then check whether the token immediately preceding `expect` is `await`.
 * This per-occurrence scan correctly handles:
 *
 *   - single-line `await expect(f()).rejects.toThrow(...)`
 *   - multi-line `await expect(\n  f()\n).rejects.toThrow(...)`
 *   - multiple `.rejects.` sites inside the same `it()` block (each is
 *     evaluated independently — a good site cannot mask a bad one)
 *
 * Comment lines (`//`, `/*`, `*` JSDoc continuation) are skipped before
 * the scan so docstrings that mention `.rejects.` are not flagged.
 */
function findUnawaitedRejectionAssertions(files: string[]): {
  count: number;
  offenders: Offender[];
} {
  const offenders: Offender[] = [];

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const lines = src.split("\n");

    // Build a list of code-only lines with their original 1-indexed line
    // numbers, plus a flat string for substring scanning. Comments are
    // replaced with empty space of the same width so column offsets in the
    // flat string still map to the original source.
    const codeLines: { text: string; lineNo: number }[] = [];
    let inBlockComment = false;
    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const trimmedStart = line.trimStart();

      // Track block-comment state across lines.
      if (inBlockComment) {
        const closeIdx = line.indexOf("*/");
        if (closeIdx === -1) {
          codeLines.push({ text: "", lineNo });
          return;
        }
        inBlockComment = false;
        // Continue processing the remainder after the close.
        const remainder = line.slice(closeIdx + 2);
        codeLines.push({ text: stripComments(remainder), lineNo });
        return;
      }

      // Skip full-line comments.
      if (
        trimmedStart.startsWith("//") ||
        trimmedStart.startsWith("/*") ||
        trimmedStart.startsWith("*")
      ) {
        if (trimmedStart.startsWith("/*") && !trimmedStart.includes("*/")) {
          inBlockComment = true;
        }
        codeLines.push({ text: "", lineNo });
        return;
      }

      codeLines.push({ text: stripComments(line), lineNo });
    });

    // Flat representation: join code lines with newlines so multi-line
    // expect() calls scan correctly.
    const flat = codeLines.map((c) => c.text).join("\n");

    // For each `.rejects.` occurrence, find the matching `expect(` that
    // opens the call chain and inspect the token before `expect`.
    let searchFrom = 0;
    const REJECTS = ".rejects.";
    while (true) {
      const idx = flat.indexOf(REJECTS, searchFrom);
      if (idx === -1) break;

      // Walk back to find the `expect` keyword that starts this chain.
      // The expect( that opens the chain sits at or before idx; we scan
      // backward respecting parens so we land on the right one.
      const expectStart = findEnclosingExpect(flat, idx);
      searchFrom = idx + REJECTS.length;

      if (expectStart === null) {
        // `.rejects.` without an `expect(` — likely a doc reference that
        // survived comment stripping (rare). Skip; not an assertion.
        continue;
      }

      // Check the token immediately before `expect` for `await`.
      const before = flat.slice(0, expectStart);
      const awaited = /\bawait\s+$/.test(before);
      if (!awaited) {
        // Map the flat-string offset back to the original line number.
        const lineNo = flatOffsetToLineNo(flat, expectStart, codeLines);
        offenders.push({
          file: path.basename(file),
          startLine: lineNo,
          preview: flat
            .slice(expectStart, idx + REJECTS.length + 30)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120),
        });
      }
    }
  }

  return { count: offenders.length, offenders };
}

/**
 * Strip line comments (`// ...`) and inline block comments from a single
 * line. A block-comment open without a matching close on the same line is
 * handled by the caller (which tracks block-comment state across lines).
 * Removed text is replaced with spaces to preserve column offsets.
 */
function stripComments(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === "/" && line[i + 1] === "/") {
      out += " ".repeat(line.length - i);
      break;
    }
    if (line[i] === "/" && line[i + 1] === "*") {
      const close = line.indexOf("*/", i + 2);
      const end = close === -1 ? line.length : close + 2;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}

/**
 * Given a flat code string and an offset inside a `.rejects.` chain, walk
 * backward to find the start of the `expect(` keyword that opens the chain.
 * Returns null if no enclosing expect is found (e.g. a stray `.rejects.`
 * mention in a string literal).
 *
 * Walks backward tracking paren depth. Each `)` we encounter increases the
 * depth, each `(` decreases it. The `(` that brings depth to exactly 0 is
 * the opener of the immediately-enclosing call — if the identifier before
 * it is `expect`, we found our chain.
 */
function findEnclosingExpect(flat: string, from: number): ExpectStart | null {
  let depth = 0;
  for (let i = from; i > 0; i--) {
    const ch = flat[i];
    if (ch === ")") {
      depth += 1;
    } else if (ch === "(") {
      depth -= 1;
      if (depth === 0) {
        // This `(` opens the immediately-enclosing call. Check whether the
        // identifier before it is `expect`.
        const ident = flat.slice(0, i).match(/\b(\w+)\s*$/);
        if (ident && ident[1] === "expect") {
          return ident.index ?? -1;
        }
        // Not expect — the enclosing call is something else (e.g. a wrapper
        // function). Stop: this `.rejects.` is not on a top-level expect.
        return null;
      }
    }
  }
  return null;
}

/**
 * Map a flat-string offset back to the original 1-indexed line number using
 * the per-line codeLines index. Walks the flat string counting newlines
 * until reaching the offset, then looks up the corresponding source line.
 */
function flatOffsetToLineNo(
  flat: string,
  offset: number,
  codeLines: { text: string; lineNo: number }[],
): number {
  let lineIdx = 0;
  let pos = 0;
  while (pos < offset && lineIdx < codeLines.length - 1) {
    // +1 for the newline separator
    const lineLen = codeLines[lineIdx].text.length + 1;
    if (pos + lineLen > offset) break;
    pos += lineLen;
    lineIdx += 1;
  }
  return codeLines[lineIdx]?.lineNo ?? 0;
}

describe("[TDD regression] rejection assertions awaited across full suite", () => {
  it("every `.rejects.` assertion in tests/unit/ is awaited (count === 0)", () => {
    const files = discoverTestFiles();
    // Sanity: the detector must actually find the known assertion sites —
    // if it finds zero files it has a discovery bug.
    expect(
      files.length,
      "discoverTestFiles() should find unit test files",
    ).toBeGreaterThan(0);

    const { count, offenders } = findUnawaitedRejectionAssertions(files);
    expect(
      count,
      [
        "Found unawaited `.rejects.` assertions — add `await` before each `expect(...).rejects.*`.",
        "Offending sites (file:startLine → preview):",
        ...offenders.map((o) => `  ${o.file}:${o.startLine} → ${o.preview}`),
      ].join("\n"),
    ).toBe(0);
  });
});
