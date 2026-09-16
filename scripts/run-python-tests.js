#!/usr/bin/env node
"use strict";
// [20260817_T4_PythonTestRunner] Ticket #180 (spec #177 T4): runs the
// stdlib-unittest suite under tests/python on BOTH platforms. Interpreter
// resolution mirrors the embedded-env layout the runtime expects
// (win32: python/python.exe; darwin: python/bin/python3.11) and falls back
// to a system python — CI runners have no embedded env and provide
// python + numpy via setup-python/pip instead. MURMUR_DEVICE=cpu keeps
// FunASRServer.__init__ from importing torch during tests.
//
// [20260906_Spec259_T4] Ticket #276: the suite now runs under coverage.py
// (coverage run --branch -m unittest …) and the report gate enforces a
// --fail-under floor, giving the Python layer the same regression
// visibility as the TS layer. The coverage module must be importable by
// the resolved interpreter (project-local embedded envs: pip install
// coverage; CI: added to the setup-python dependency step).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests", "python");

// [20260906_Spec259_T4] Branch-inclusive coverage floor, set AT the first
// measured value (43%, 2026-09-07, embedded python 3.11 + coverage 7.16).
// Ratchet plan: raise as the funasr_server protocol arms gain tests (34%
// today is the big reserve) — never lower without a spec. Note:
// --fail-under compares the UNROUNDED total while the table prints
// rounded integers (a 42.6% actual prints 43% yet fails the gate).
// [20260907_Fix_317_PythonBranchFill] raised from 43 after the protocol/
// lifecycle branch tests lifted funasr_server.py 34%→39% (total 47%).
const PYTHON_FAIL_UNDER = 46;

// Modules exercised by tests/python; everything else in the repo is out of
// the Python measurement scope.
const COVERAGE_INCLUDE =
  "funasr_server.py,audio_preprocessing.py,download_models.py";

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

function hasCoverageModule(interpreter) {
  const probe = spawnSync(interpreter, ["-m", "coverage", "--version"], {
    encoding: "utf8",
  });
  return !probe.error && probe.status === 0;
}

function run(interpreter, deps = {}) {
  // [20260906_Spec259_T4] spawnSync is injectable so the two-arm behavior
  // tests can drive the runner without a real interpreter.
  const spawn = deps.spawnSync || spawnSync;
  const coverageUnavailable = spawn(
    interpreter,
    ["-m", "coverage", "--version"],
    { encoding: "utf8" },
  );
  if (coverageUnavailable.status !== 0) {
    console.error(
      `run-python-tests: the resolved interpreter cannot import the coverage module.\n` +
        `  interpreter: ${interpreter}\n` +
        `  fix: "<interpreter> -m pip install coverage" (CI installs it via the Python deps step)`,
    );
    return 1;
  }

  const runResult = spawn(
    interpreter,
    [
      "-m",
      "coverage",
      "run",
      "--branch",
      "-m",
      "unittest",
      "discover",
      "-s",
      TESTS_DIR,
      "-p",
      "test_*.py",
      "-v",
    ],
    { stdio: "inherit", env: { ...process.env, MURMUR_DEVICE: "cpu" } },
  );
  if (runResult.status !== 0) {
    const code = runResult.status === null ? 1 : runResult.status;
    console.error(`run-python-tests: unittest suite failed (exit ${code})`);
    return code;
  }

  const report = spawn(
    interpreter,
    [
      "-m",
      "coverage",
      "report",
      `--include=${COVERAGE_INCLUDE}`,
      `--fail-under=${PYTHON_FAIL_UNDER}`,
    ],
    { stdio: "inherit" },
  );
  if (report.status !== 0) {
    console.error(
      `run-python-tests: coverage ${PYTHON_FAIL_UNDER}% floor violated — see the table above`,
    );
    return 1;
  }
  return 0;
}

function main() {
  if (!fs.existsSync(TESTS_DIR)) {
    console.error(`run-python-tests: suite dir not found: ${TESTS_DIR}`);
    process.exit(1);
  }
  const interpreter = resolveInterpreter();
  if (!interpreter) {
    console.error("run-python-tests: no python interpreter found");
    process.exit(1);
  }
  process.exit(run(interpreter));
}

module.exports = {
  resolveInterpreter,
  hasCoverageModule,
  run,
  PYTHON_FAIL_UNDER,
  COVERAGE_INCLUDE,
};

if (require.main === module) {
  main();
}
