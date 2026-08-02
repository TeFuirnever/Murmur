// [20260729_Feat_EffectsChunkIsolation] Verify ogl/motion are NOT bundled
// into the main/history entry chunks. Effects are lazy-loaded via React.lazy
// in EffectsLayer.tsx, so users with effects_enabled=false should never pay
// the cost of downloading ogl (~34KB gzip) or motion (~50KB gzip).
//
// This script scans the built output in src/dist/assets/ and fails if the
// entry chunks (main/history/settings) contain references to ogl or motion.
// Run after `vite build` (or as part of ci-check).
//
// Usage: node scripts/check-effects-isolation.js [--build]
//   --build: run `vite build` first before checking (otherwise assumes build exists)

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "src", "dist", "assets");

// Packages that must ONLY appear in lazy chunks, never in entry chunks.
const ISOLATED_PACKAGES = ["ogl", "motion"];

// Entry chunk name prefixes (Vite names them by input key from vite.config.js).
// These correspond to the three HTML entry points: main, history, settings.
const ENTRY_PREFIXES = ["main", "history", "settings"];

function main() {
  const args = process.argv.slice(2);
  const shouldBuild = args.includes("--build");

  if (shouldBuild) {
    console.log("→ Building renderer (vite build)...");
    execSync("npx vite build", { cwd: path.join(ROOT, "src"), stdio: "pipe" });
  }

  if (!fs.existsSync(DIST_DIR)) {
    console.error(
      `✘ Build output not found: ${DIST_DIR}\n` +
        "  Run with --build, or run `vite build` in src/ first.",
    );
    process.exit(1);
  }

  const files = fs.readdirSync(DIST_DIR).filter((f) => f.endsWith(".js"));
  if (files.length === 0) {
    console.error(`✘ No .js files in ${DIST_DIR}. Build may have failed.`);
    process.exit(1);
  }

  const violations = [];

  for (const file of files) {
    const isEntry = ENTRY_PREFIXES.some(
      (p) => file.startsWith(p + "-") || file.startsWith(p + "."),
    );
    if (!isEntry) continue;

    const content = fs.readFileSync(path.join(DIST_DIR, file), "utf8");
    // [20260729_Fix_IsolationFalsePositive] Use regex matching the module
    // specifier boundary (from "pkg" or require("pkg")), NOT a bare substring.
    // A bare includes("motion") false-positives on CSS media queries like
    // "(prefers-reduced-motion: reduce)" which legitimately live in the
    // eagerly-imported EffectsLayer gate. After Rollup bundling, the entry
    // chunk never contains the module-specifier boundary — that stays inside
    // the lazy chunk (e.g. BlurText-[hash].js).
    const ISOLATION_PATTERNS = {
      motion: /(?:from|require\s*\()\s*["']motion\/react["']/,
      ogl: /(?:from|require\s*\()\s*["']ogl["']/,
    };
    for (const pkg of ISOLATED_PACKAGES) {
      const pattern = ISOLATION_PATTERNS[pkg];
      if (pattern && pattern.test(content)) {
        violations.push({ file, pkg });
      }
    }
  }

  if (violations.length > 0) {
    console.error("✘ Effects chunk isolation FAILED:");
    console.error(
      "  Entry chunks must not contain ogl/motion (they should be lazy-loaded).\n" +
        "  Found violations:",
    );
    for (const v of violations) {
      console.error(`    ${v.file} → contains "${v.pkg}"`);
    }
    console.error(
      "\n  Fix: ensure EffectsLayer.tsx uses React.lazy(() => import(...))\n" +
        "  and that no eager import pulls ogl/motion into the entry graph.",
    );
    process.exit(1);
  }

  console.log(
    "✓ Effects chunk isolation OK — ogl/motion absent from entry chunks",
  );
}

main();
