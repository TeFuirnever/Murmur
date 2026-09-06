#!/usr/bin/env node
"use strict";
// [20260906_Test_AsrRegressionHarness] Spec #266 T03 (#279): golden-set ASR
// regression. Drives the PRODUCTION funasr_server.py over its real
// stdin/stdout JSON-lines protocol (same spawn shape and init handshake as
// src/helpers/funasrServer.ts) against the corpus in scripts/golden_set/,
// scores every case with character error rate (CER, 字错率 — the standard
// Chinese accuracy metric) and exits non-zero when any case exceeds the
// threshold. Dev-machine only by design: torch model load is far too heavy
// for CI (docs/qa/release-manual-checklist.md §0.1 consumes its output).
//
// Usage:
//   node scripts/asr-regression.js                       # base clips only
//   node scripts/asr-regression.js --all                 # + SNR variants
//   node scripts/asr-regression.js --threshold 0.10
//   node scripts/asr-regression.js --damo-root /path/to/models
//
// Exit codes: 0 pass · 1 regression (or infra failure) · 2 usage error.
// [20260906_Test_AsrRegressionHarness] END

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_GOLDEN_DIR = path.join(ROOT, "scripts", "golden_set");
const DEFAULT_REPORT_PATH = path.join(
  ROOT,
  "scripts",
  "asr_regression_results.json",
);

// [20260906_Test_AsrRegressionHarness] Thresholds and timeouts are named
// constants (repo rule: no magic numbers). 0.15 CER is a conservative
// release floor for Paraformer on the clean golden clips (typical actuals
// are well below); tighten via --threshold once baselines exist.
const DEFAULT_CER_THRESHOLD = 0.15;
const DEFAULT_INIT_TIMEOUT_MS = 10 * 60 * 1000; // torch cold load budget
const DEFAULT_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const SERVER_EXIT_GRACE_MS = 3000;

function normalizeForCer(text) {
  return (
    String(text ?? "")
      .normalize("NFKC")
      .toLowerCase()
      // Drop whitespace and punctuation (CJK + latin): ASR output punctuation
      // is a formatting choice, not a recognition error.
      .replace(/[\p{P}\p{Z}\p{S}]+/gu, "")
  );
}

function charErrorRate(reference, hypothesis) {
  const ref = normalizeForCer(reference);
  const hyp = normalizeForCer(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  // Classic Levenshtein DP; refs are short sentences, O(m·n) is trivial.
  let prev = Array.from({ length: hyp.length + 1 }, (_, i) => i);
  for (let i = 1; i <= ref.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= hyp.length; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[hyp.length] / ref.length;
}

// A "case" pairs one wav with the reference text of its utterance group
// (s00_base.wav and every s00_* variant share s00_ref.txt).
function discoverGoldenCases(goldenDir, { includeVariants = false } = {}) {
  const entries = fs
    .readdirSync(goldenDir)
    .filter((name) => name.endsWith(".wav"))
    .sort();
  const cases = [];
  for (const name of entries) {
    const match = /^(s\d+)_/.exec(name);
    if (!match) continue;
    const isVariant = !name.endsWith("_base.wav");
    if (isVariant && !includeVariants) continue;
    const refPath = path.join(goldenDir, `${match[1]}_ref.txt`);
    if (!fs.existsSync(refPath)) continue;
    cases.push({
      name: name.replace(/\.wav$/, ""),
      audioPath: path.join(goldenDir, name),
      reference: fs.readFileSync(refPath, "utf8"),
    });
  }
  return cases;
}

function evaluateCases(scoredCases, threshold) {
  const failed = scoredCases.filter((c) => !(c.cer <= threshold));
  const meanCer =
    scoredCases.length === 0
      ? 0
      : scoredCases.reduce((sum, c) => sum + c.cer, 0) / scoredCases.length;
  const maxCer =
    scoredCases.length === 0 ? 0 : Math.max(...scoredCases.map((c) => c.cer));
  return {
    summary: {
      total: scoredCases.length,
      failed: failed.length,
      threshold,
      meanCer,
      maxCer,
    },
    passed: failed.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Client loop against the real server (spawn shape mirrors funasrServer.ts)
// ---------------------------------------------------------------------------

function resolveInterpreter() {
  const candidates =
    process.platform === "win32"
      ? [path.join(ROOT, "python", "python.exe"), "python"]
      : [path.join(ROOT, "python", "bin", "python3.11"), "python3", "python"];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
      if (!probe.error) return candidate;
    }
  }
  return null;
}

function killServerProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], {
      windowsHide: true,
    });
    return;
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    // already dead — nothing to clean up
  }
}

function runGoldenSet(options, callbacks = {}) {
  const {
    interpreter,
    serverPath,
    goldenDir = DEFAULT_GOLDEN_DIR,
    threshold = DEFAULT_CER_THRESHOLD,
    includeVariants = false,
    initTimeoutMs = DEFAULT_INIT_TIMEOUT_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    damoRoot = process.env.DAMO_ROOT || null,
    reportPath = DEFAULT_REPORT_PATH,
  } = options;

  if (!interpreter)
    return Promise.reject(new Error("no python interpreter found"));
  if (!fs.existsSync(serverPath)) {
    return Promise.reject(new Error(`server script not found: ${serverPath}`));
  }
  const cases = discoverGoldenCases(goldenDir, { includeVariants });
  if (cases.length === 0) {
    return Promise.reject(new Error(`no golden cases found in ${goldenDir}`));
  }

  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const serverArgs = damoRoot
      ? [serverPath, "--damo-root", damoRoot]
      : [serverPath];
    const proc = spawn(interpreter, serverArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let buffer = "";
    let serverReady = false;
    let settled = false;
    let caseIndex = 0;
    let initTimer = null;
    let requestTimer = null;
    const scored = [];

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (initTimer) clearTimeout(initTimer);
      if (requestTimer) clearTimeout(requestTimer);
      // Ask politely, then make sure the tree is dead — a leaked torch
      // process pins ~2GB of RAM on the dev machine.
      try {
        proc.stdin.write(JSON.stringify({ action: "exit" }) + "\n");
      } catch {
        // stdin already closed
      }
      const graceTimer = setTimeout(
        () => killServerProcess(proc),
        SERVER_EXIT_GRACE_MS,
      );
      graceTimer.unref?.();
      proc.stdout.removeAllListeners();
      if (error) {
        killServerProcess(proc);
        reject(error);
        return;
      }
      const report = {
        generatedAt: new Date().toISOString(),
        goldenDir,
        includeVariants,
        interpreter,
        cases: scored,
        ...evaluateCases(scored, threshold),
        elapsedMs: Date.now() - startedAt,
      };
      try {
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      } catch (writeError) {
        callbacks.onLog?.(
          `warn: could not write report: ${writeError.message}`,
        );
      }
      resolve(report);
    };

    proc.stderr.on("data", (data) => {
      for (const line of String(data).split("\n").filter(Boolean)) {
        callbacks.onLog?.(`[server:stderr] ${line}`);
      }
    });

    proc.on("error", (err) =>
      finish(new Error(`server spawn failed: ${err.message}`)),
    );
    proc.on("close", (code) => {
      if (!settled) finish(new Error(`server exited early (code ${code})`));
    });

    const sendNextCase = () => {
      if (caseIndex >= cases.length) {
        finish(null);
        return;
      }
      const current = cases[caseIndex];
      const request = {
        action: "transcribe_file",
        audio_path: current.audioPath,
        options: {},
        request_id: current.name,
      };
      callbacks.onLog?.(`[${current.name}] transcribing…`);
      if (requestTimer) clearTimeout(requestTimer);
      requestTimer = setTimeout(() => {
        finish(
          new Error(
            `request timeout after ${requestTimeoutMs}ms: ${current.name}`,
          ),
        );
      }, requestTimeoutMs);
      proc.stdin.write(`${JSON.stringify(request)}\n`);
    };

    const handleLine = (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        callbacks.onLog?.(`[server] (non-json) ${line.slice(0, 200)}`);
        return;
      }
      if (!serverReady) {
        serverReady = true;
        if (initTimer) clearTimeout(initTimer);
        if (msg.success !== true) {
          finish(
            new Error(
              `server init failed: ${JSON.stringify(msg).slice(0, 300)}`,
            ),
          );
          return;
        }
        callbacks.onLog?.("[server] ready (models initialized)");
        sendNextCase();
        return;
      }
      if (typeof msg.success !== "boolean") {
        callbacks.onLog?.(`[server:progress] ${line.slice(0, 160)}`);
        return;
      }
      if (requestTimer) clearTimeout(requestTimer);
      const current = cases[caseIndex];
      caseIndex += 1;
      const text = typeof msg.text === "string" ? msg.text : "";
      const cer = msg.success
        ? charErrorRate(current.reference, text)
        : Number.POSITIVE_INFINITY;
      scored.push({
        name: current.name,
        cer,
        passed: msg.success && cer <= threshold,
        reference: current.reference.trim(),
        hypothesis: text.trim(),
        serverError: msg.success
          ? undefined
          : String(msg.error || "transcription failed"),
      });
      callbacks.onCaseDone?.(scored[scored.length - 1]);
      sendNextCase();
    };

    proc.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) handleLine(line);
      }
    });

    initTimer = setTimeout(() => {
      finish(new Error(`server init timeout after ${initTimeoutMs}ms`));
    }, initTimeoutMs);
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    includeVariants: false,
    threshold: DEFAULT_CER_THRESHOLD,
    goldenDir: DEFAULT_GOLDEN_DIR,
    reportPath: DEFAULT_REPORT_PATH,
    initTimeoutMs: DEFAULT_INIT_TIMEOUT_MS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    damoRoot: process.env.DAMO_ROOT || null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") args.includeVariants = true;
    else if (arg === "--threshold") args.threshold = Number(argv[++i]);
    else if (arg === "--golden-dir") args.goldenDir = path.resolve(argv[++i]);
    else if (arg === "--report") args.reportPath = path.resolve(argv[++i]);
    else if (arg === "--damo-root") args.damoRoot = path.resolve(argv[++i]);
    else if (arg === "--init-timeout") args.initTimeoutMs = Number(argv[++i]);
    else if (arg === "--request-timeout")
      args.requestTimeoutMs = Number(argv[++i]);
    else return { error: `unknown or incomplete argument: ${arg}` };
  }
  if (
    !Number.isFinite(args.threshold) ||
    args.threshold < 0 ||
    args.threshold > 1
  ) {
    return { error: "--threshold must be a number in [0, 1]" };
  }
  return { args };
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`asr-regression: ${parsed.error}`);
    return 2;
  }
  const interpreter = resolveInterpreter();
  if (!interpreter) {
    console.error(
      "asr-regression: no python interpreter found (embedded env or system python)",
    );
    return 1;
  }
  // Dev layout mirrors pythonEnvironment.getFunASRServerPath(): repo root.
  const serverPath = path.join(ROOT, "funasr_server.py");
  const report = await runGoldenSet(
    { ...parsed.args, interpreter, serverPath },
    { onLog: (line) => console.log(line) },
  );
  const { summary } = report;
  console.log("\n===== ASR regression summary =====");
  for (const c of report.cases) {
    const cerText = Number.isFinite(c.cer)
      ? `${(c.cer * 100).toFixed(1)}%`
      : "FAILED";
    console.log(
      `  ${c.passed ? "PASS" : "FAIL"}  ${c.name.padEnd(28)} CER=${cerText}`,
    );
    if (!c.passed) {
      console.log(`        ref: ${c.reference}`);
      console.log(`        hyp: ${c.serverError || c.hypothesis}`);
    }
  }
  console.log(
    `total=${summary.total} failed=${summary.failed} meanCER=${(summary.meanCer * 100).toFixed(2)}% ` +
      `maxCER=${(summary.maxCer * 100).toFixed(2)}% threshold=${(summary.threshold * 100).toFixed(1)}% ` +
      `elapsed=${(report.elapsedMs / 1000).toFixed(1)}s`,
  );
  console.log(`report: ${report.reportPath || DEFAULT_REPORT_PATH}`);
  return report.passed ? 0 : 1;
}

module.exports = {
  normalizeForCer,
  charErrorRate,
  discoverGoldenCases,
  evaluateCases,
  runGoldenSet,
  parseArgs,
  main,
  DEFAULT_CER_THRESHOLD,
  DEFAULT_GOLDEN_DIR,
  DEFAULT_REPORT_PATH,
};

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`asr-regression: ${err.message}`);
      process.exit(1);
    },
  );
}
