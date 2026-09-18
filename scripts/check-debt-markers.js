#!/usr/bin/env node
"use strict";

// [20260918_Ci_DebtMarkerGate] Debt-marker gate (ADHA-2, follow-up to the
// ADHA-1 inventory). Zero debt-marker comments in code is established repo
// policy — debt is tracked in docs/follow-ups.md / backlog.md, never as
// marker comments — but nothing enforced it, so a new marker could enter
// silently. This script fails (exit 1, one line per hit) when any scanned
// file contains a marker, and passes (exit 0) otherwise.
//
// Scanned scope (matches the ADHA-1 inventory): src/, scripts/, build/
// recursively, plus root-level entry/build scripts and code configs. Only
// comment-capable code extensions are scanned — json/md/toml carry prose,
// not comment markers, and ADHA-1 found zero there. Exclusions (also the
// ADHA-1 set): node_modules, python/, out/, website/, and any dist/ or
// dist-*/ directory (generated bundles can carry upstream marker comments).
//
// Usage: node scripts/check-debt-markers.js [rootDir]
//   rootDir defaults to the repo root; tests pass fixture roots instead.

const fs = require("fs");
const path = require("path");

// The marker words are assembled at runtime: this script lives inside the
// scanned scripts/ tree, so writing the literals here (or in its messages)
// would make the gate match its own source.
const MARKERS = ["TO" + "DO", "FIX" + "ME", "HA" + "CK"];
const MARKER_RE = new RegExp("\\b(" + MARKERS.join("|") + ")\\b");

// Comment-capable code extensions only (see header).
const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".css",
  ".nsh",
  ".sh",
]);

// Directory prefixes scanned recursively, relative to the root.
const SCANNED_DIRS = ["src", "scripts", "build"];

// Excluded path segments, matched per segment of the root-relative path.
// "dist" and "dist-*" cover dist/, dist-main/, dist-preload/, src/dist/,
// cli/dist/ — all generated output.
const EXCLUDED_SEGMENTS = new Set(["node_modules", "python", "out", "website"]);

function isExcluded(relPath) {
  for (const segment of relPath.split(path.sep)) {
    if (EXCLUDED_SEGMENTS.has(segment)) return true;
    if (segment === "dist" || segment.startsWith("dist-")) return true;
  }
  return false;
}

function collectFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.name.startsWith(".") || isExcluded(rel)) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else if (
        entry.isFile() &&
        CODE_EXTENSIONS.has(path.extname(entry.name))
      ) {
        files.push(abs);
      }
    }
  };
  for (const dirName of SCANNED_DIRS) {
    const dir = path.join(root, dirName);
    if (fs.existsSync(dir)) walk(dir);
  }
  // Root-level entry points, build scripts, and code configs (main.ts,
  // preload.ts, cleanup.js, eslint.config.mjs, *.config.*, root *.py ...).
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      !entry.name.startsWith(".") &&
      CODE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      files.push(path.join(root, entry.name));
    }
  }
  return files;
}

function scanFile(root, absPath) {
  const hits = [];
  const rel = path.relative(root, absPath).split(path.sep).join("/");
  const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (MARKER_RE.test(line)) {
      hits.push(`${rel}:${index + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

function main() {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, "..");
  const files = collectFiles(root);
  const hits = files.flatMap((file) => scanFile(root, file));
  if (hits.length > 0) {
    console.log(
      `Found ${hits.length} debt marker(s) [${MARKERS.join("/")}] in scanned code:`,
    );
    for (const hit of hits) console.log(`  ${hit}`);
    console.log(
      "Policy: zero marker comments in code — track debt in docs/follow-ups.md or backlog.md instead.",
    );
    process.exit(1);
  }
  console.log(`No debt markers found (scanned ${files.length} files).`);
}

main();
