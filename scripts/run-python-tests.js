#!/usr/bin/env node
"use strict";
// [20260817_T4_PythonTestRunner] Ticket #180 (spec #177 T4): runs the
// stdlib-unittest suite under tests/python on BOTH platforms. Interpreter
// resolution mirrors the embedded-env layout the runtime expects
// (win32: python/python.exe; darwin: python/bin/python3.11) and falls back
// to a system python — CI runners have no embedded env and provide
// python + numpy via setup-python/pip instead. MURMUR_DEVICE=cpu keeps
// FunASRServer.__init__ from importing torch during tests.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests", "python");

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

if (!fs.existsSync(TESTS_DIR)) {
  console.error(`run-python-tests: suite dir not found: ${TESTS_DIR}`);
  process.exit(1);
}

const interpreter = resolveInterpreter();
if (!interpreter) {
  console.error("run-python-tests: no python interpreter found");
  process.exit(1);
}

const result = spawnSync(
  interpreter,
  ["-m", "unittest", "discover", "-s", TESTS_DIR, "-p", "test_*.py", "-v"],
  { stdio: "inherit", env: { ...process.env, MURMUR_DEVICE: "cpu" } },
);
process.exit(result.status === null ? 1 : result.status);
