#!/usr/bin/env node
"use strict";

const { execSync, spawn } = require("child_process");
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

// [20260816_DevSmokeGate] pnpm run dev gate: launches the dev stack
// (electron-rebuild + build:preload + concurrently: vite dev server + electron
// main) in the background and waits for the renderer to be reachable on the
// vite port, or for the main process to emit a fatal error. The gate exists
// because the app booted with a stale better-sqlite3 ABI and crashed at
// startup — a state no build/test gate catches.
// Ports mirror src/vite.config.js server.port; VITE_DEV_PORT overrides.
const DEV_VITE_PORT = process.env.VITE_DEV_PORT || "5173";
const DEV_READY_TIMEOUT_MS = 120_000;

async function runDevSmoke() {
  const start = performance.now();
  // [20260816_DevSmokeGate] The unit-test phase runs better-sqlite3 under the
  // system node ABI (pretest asserts it). pnpm run dev needs the ELECTRON ABI,
  // so rebuild for electron first — exactly what `pnpm dev`'s predev hook does.
  try {
    execSync("npx electron-rebuild -f -w better-sqlite3", {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 120_000,
    });
  } catch (e) {
    return {
      step: "dev smoke (pnpm run dev)",
      ok: false,
      duration: "0.0",
      output:
        "electron-rebuild failed:\n" + String((e.stderr || "").slice(0, 400)),
    };
  }

  const child = spawn("pnpm", ["run", "dev"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let fatal = null;
  const onData = (buf) => {
    const text = buf.toString();
    output += text;
    // A main-process crash (e.g. better-sqlite3 ABI mismatch) aborts the run
    // early so the gate fails fast instead of waiting out the timeout.
    if (/SQLite 原生模块版本不匹配|NODE_MODULE_VERSION/.test(text)) {
      fatal = text.slice(0, 300);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  const deadline = Date.now() + DEV_READY_TIMEOUT_MS;
  let result;
  while (Date.now() < deadline) {
    if (fatal) break;
    try {
      const res = await fetch(`http://localhost:${DEV_VITE_PORT}/`);
      if (res.ok) {
        const dur = ((performance.now() - start) / 1000).toFixed(1);
        result = {
          step: "dev smoke (pnpm run dev)",
          ok: true,
          duration: dur,
          output:
            "dev server reached on :" +
            DEV_VITE_PORT +
            "\n" +
            output.slice(-800),
        };
        break;
      }
    } catch {
      // Port not up yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill("SIGTERM");
  // Give concurrently a moment to tear down.
  await new Promise((r) => setTimeout(r, 1500));
  if (!result) {
    const dur = ((performance.now() - start) / 1000).toFixed(1);
    result = {
      step: "dev smoke (pnpm run dev)",
      ok: false,
      duration: dur,
      output:
        (fatal || "dev server did not become ready within the timeout") +
        "\n" +
        output.slice(-1200),
    };
  }
  // [20260816_DevSmokeGate] Restore the system-node ABI so the next `pnpm
  // test` / ci-check run starts from the state pretest asserts.
  try {
    execSync("pnpm rebuild better-sqlite3", {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 120_000,
    });
  } catch {
    // Non-fatal: the next run's pretest surfaces the mismatch clearly.
  }
  return result;
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
  // [20260725_Autopilot_T2.2] Add typecheck:tests — runs tsc against
  // tsconfig.test.json which covers tests/**. Catches type errors in .ts
  // and .tsx test files that pnpm test (vitest transform) does not.
  const stage1 = await Promise.all([
    run("pnpm format:check", "format:check"),
    run("pnpm lint", "lint"),
    run("pnpm license:check", "license:check"),
    run("pnpm typecheck", "typecheck"),
    run("pnpm typecheck:tests", "typecheck:tests"),
  ]);
  stage1.forEach(printResult);
  // [20260725_Autopilot_T2.2] END

  // [20260724_TS_BigBang_BuildPipeline] Add build:main to ci-check so the
  // main bundle is validated locally, matching CI workflows.
  // Stage 2: build main + preload then test
  const stage2main = run("pnpm run build:main", "build:main");
  printResult(stage2main);
  // [20260724_TS_BigBang_BuildPipeline] END
  const stage2a = run("pnpm run build:preload", "build:preload");
  printResult(stage2a);
  const stage2b = run("pnpm test -- --coverage", "test + coverage");
  printResult(stage2b);

  // Stage 3: build renderer
  const stage3 = run("pnpm run build:renderer", "build:renderer");
  printResult(stage3);

  // [20260816_Refactor_RemoveEffects] The effects chunk isolation gate was
  // removed with the visual-effects feature (ogl/motion deps deleted).

  // [20260816_DevSmokeGate] pnpm run dev gate: verifies the dev stack boots
  // end-to-end (electron-rebuild ABI, preload build, vite dev server, main
  // process) and the renderer becomes reachable — a regression the static
  // gates cannot see.
  const stageDev = await runDevSmoke();
  printResult(stageDev);

  const results = [...stage1, stage2main, stage2a, stage2b, stage3, stageDev];

  // Security audit (non-blocking)
  // [20260816_Fix_AuditRegistry] The local install registry (npmmirror.com)
  // does not implement the npm audit endpoint, which made every audit run
  // fail with ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS and show a misleading
  // "found issues" warning. Audit against the official registry explicitly;
  // MURMUR_AUDIT_REGISTRY overrides it (e.g. for an internal mirror that
  // does implement the endpoint).
  const auditRegistry =
    process.env.MURMUR_AUDIT_REGISTRY || "https://registry.npmjs.org";
  const audit = run(
    `pnpm audit --audit-level moderate --registry=${auditRegistry}`,
    "security audit",
  );
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
