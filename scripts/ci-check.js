#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

const FIX = args.includes("--fix");
const FIX_FORMAT = args.includes("--fix-format");
const FIX_LINT = args.includes("--fix-lint");
const JSON_OUT = args.includes("--json");
const QUIET = args.includes("--quiet");
const E2E = args.includes("--e2e");

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function checkNodeVersion() {
  const nvmrcPath = path.join(ROOT, ".nvmrc");
  if (!fs.existsSync(nvmrcPath)) return;
  const expected = fs.readFileSync(nvmrcPath, "utf8").trim();
  const current = process.version.replace(/^v/, "");
  const major = current.split(".")[0];
  if (major !== expected) {
    const msg = `Node version mismatch: running v${current}, .nvmrc expects ${expected}`;
    if (!QUIET && !JSON_OUT) console.log(`${YELLOW}⚠ ${msg}${RESET}`);
    return msg;
  }
}

function run(cmd, label) {
  const start = performance.now();
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    const dur = ((performance.now() - start) / 1000).toFixed(1);
    return { step: label, ok: true, duration: dur, output: out };
  } catch (e) {
    const dur = ((performance.now() - start) / 1000).toFixed(1);
    return {
      step: label,
      ok: false,
      duration: dur,
      output: (e.stdout || "") + (e.stderr || ""),
    };
  }
}

function extractFailHint(result) {
  const lines = result.output.split("\n").filter((l) => l.trim());
  const errorLines = lines.filter(
    (l) =>
      l.includes("error") ||
      l.includes("Error") ||
      l.includes("FAIL") ||
      l.includes("failed"),
  );
  if (errorLines.length === 0) return "";
  return errorLines.slice(0, 3).join("\n    ").trim();
}

function printResult(r) {
  if (JSON_OUT) return;
  if (QUIET && r.ok) return;
  const icon = r.ok ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
  const suffix = r.ok ? "" : `  ${RED}→ see output above${RESET}`;
  console.log(`${icon} ${r.step.padEnd(22)} ${r.duration}s${suffix}`);
  if (!r.ok && !QUIET) {
    const hint = extractFailHint(r);
    if (hint) console.log(`    ${DIM}${hint.slice(0, 200)}${RESET}`);
  }
}

function printSummary(results, warnings) {
  const failed = results.filter((r) => !r.ok);

  if (JSON_OUT) {
    const json = {
      nodeVersion: process.version,
      results: results.map((r) => ({
        step: r.step,
        ok: r.ok,
        duration: r.duration,
        ...(r.ok ? {} : { output: r.output.slice(0, 2000) }),
      })),
      warnings,
      failed: failed.length,
      total: results.length,
    };
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  console.log("");
  for (const w of warnings) console.log(`${YELLOW}⚠ ${w}${RESET}`);
  if (failed.length === 0) {
    console.log(
      `${GREEN}All ${results.length} checks passed${RESET}${warnings.length ? ` (${warnings.length} warnings)` : ""}`,
    );
  } else {
    const names = failed.map((r) => r.step).join(", ");
    console.log(
      `${RED}Failed: ${failed.length}/${results.length}  [${names}]${RESET}`,
    );
    const fixes = [];
    for (const f of failed) {
      if (f.step.includes("format")) fixes.push("--fix-format");
      if (f.step.includes("lint")) fixes.push("--fix-lint");
    }
    if (fixes.length)
      console.log(
        `${DIM}Fix: node scripts/ci-check.js ${fixes.join(" ")}${RESET}`,
      );
  }
}

async function main() {
  const warnings = [];
  const nodeWarn = checkNodeVersion();
  if (nodeWarn) warnings.push(nodeWarn);

  if (!QUIET && !JSON_OUT) console.log("Running CI gate checks...\n");

  // Fix modes
  if (FIX_FORMAT || FIX) {
    if (!QUIET && !JSON_OUT) console.log("Fixing formatting...");
    execSync("pnpm format", {
      cwd: ROOT,
      stdio: JSON_OUT ? "pipe" : "inherit",
    });
    if (FIX_FORMAT && !FIX) {
      // Only format fix requested, then run checks
    }
  }
  if (FIX_LINT || FIX) {
    if (!QUIET && !JSON_OUT) console.log("Fixing lint issues...");
    execSync("pnpm lint --fix", {
      cwd: ROOT,
      stdio: JSON_OUT ? "pipe" : "inherit",
    });
  }
  if (FIX || FIX_FORMAT || FIX_LINT) {
    if (!QUIET && !JSON_OUT) console.log("");
  }

  // Stage 1: parallel fast checks
  const stage1 = await Promise.all([
    run("pnpm format:check", "format:check"),
    run("pnpm lint", "lint"),
    run("pnpm license:check", "license:check"),
  ]);
  stage1.forEach(printResult);

  // Stage 2: build preload then test
  const stage2a = run("pnpm run build:preload", "build:preload");
  printResult(stage2a);
  const stage2b = run("pnpm test -- --coverage", "test + coverage");
  printResult(stage2b);

  // Stage 3: build renderer
  const stage3 = run("pnpm run build:renderer", "build:renderer");
  printResult(stage3);

  const results = [...stage1, stage2a, stage2b, stage3];

  // Security audit (non-blocking)
  const audit = run("pnpm audit --audit-level moderate", "security audit");
  if (!audit.ok) {
    warnings.push("Security audit found issues (non-blocking)");
    if (!QUIET && !JSON_OUT) {
      console.log(
        `${YELLOW}⚠ security audit       ${audit.duration}s (non-blocking)${RESET}`,
      );
    }
  } else {
    printResult(audit);
    results.push(audit);
  }

  // E2E (opt-in)
  if (E2E) {
    const e2e = run("pnpm test:e2e", "e2e tests");
    printResult(e2e);
    results.push(e2e);
  }

  printSummary(results, warnings);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main().catch((e) => {
  console.error(`${RED}Fatal: ${e.message}${RESET}`);
  process.exit(1);
});
