#!/usr/bin/env node
"use strict";
// [20261006_T8_PackagingSlimdown] Ticket #422 (spec #412 decision 5): SBOM
// pin discipline for the embedded Python runtime. Resolves the DIRECT set
// in requirements.in into the full transitive wheel closure for BOTH
// shipping platforms (macOS arm64, Windows x64 — the platforms
// prepare-embedded-python.js builds), hashes every wheel, and writes:
//
//   requirements.lock     — pip --require-hashes input (one entry per
//                           package, all wheel hashes across platforms)
//   wheel-manifest.json   — per-wheel SBOM detail (filename, sha256,
//                           platform tag) — cross-checked by
//                           tests/unit/embedded-python-wheel-sbom.test.ts
//
// jieba upstream publishes no wheel (dormant maintainer, sdist only), so
// this script builds the py3-none-any wheel once into wheels/ and pip picks
// it up from there via --find-links on both platforms. The committed wheel
// is part of the SBOM like every PyPI wheel.
//
// Regeneration (network + a host python3 with pip required; the output is
// committed):
//   node scripts/embedded-python/generate-wheel-manifest.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const HERE = __dirname;
const REQUIREMENTS_IN = path.join(HERE, "requirements.in");
const LOCK_OUT = path.join(HERE, "requirements.lock");
const MANIFEST_OUT = path.join(HERE, "wheel-manifest.json");
const WHEELS_DIR = path.join(HERE, "wheels");

// Deployment-target tags per shipping platform. mac needs both 11.0 (most
// wheels) and 14.0 (onnxruntime 1.30 / scipy 1.17 publish arm64 only at
// 14.0); win is x64-only (AGENTS.md: no Windows arm64).
const PLATFORM_RUNS = [
  {
    name: "macos-arm64",
    flags: [
      "--platform",
      "macosx_11_0_arm64",
      "--platform",
      "macosx_14_0_arm64",
    ],
  },
  { name: "win-x64", flags: ["--platform", "win_amd64"] },
];
const PYTHON_VERSION = "3.11";
const PYTHON_VERSION_FLAG = "311";

/** sha256 of a file, hex. */
function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/** pip download the full closure of requirements.in for one platform run.
 * Returns [{filename, sha256, platform_tag}]. */
function downloadClosure(run, tmpDir) {
  const dest = path.join(tmpDir, run.name);
  fs.mkdirSync(dest, { recursive: true });
  const args = [
    "-m",
    "pip",
    "download",
    "--dest",
    dest,
    "--only-binary=:all:",
    "--find-links",
    WHEELS_DIR,
    "--implementation",
    "cp",
    "--python-version",
    PYTHON_VERSION_FLAG,
    ...run.flags,
    "--disable-pip-version-check",
    "-q",
    "-r",
    REQUIREMENTS_IN,
  ];
  execFileSync(process.platform === "win32" ? "python" : "python3", args, {
    stdio: "inherit",
  });
  return fs
    .readdirSync(dest)
    .filter((name) => name.endsWith(".whl"))
    .map((filename) => {
      const filePath = path.join(dest, filename);
      // Wheel filename: {dist}-{version}(-{build})?-{python}-{abi}-{platform}.whl
      // Distribution names are normalized (underscores), so the last three
      // dash-separated fields are python/abi/platform.
      const base = filename.slice(0, -".whl".length);
      const parts = base.split("-");
      const platform_tag = parts[parts.length - 1];
      const abi = parts[parts.length - 2];
      const pyver = parts[parts.length - 3];
      const nameAndVersion = parts.slice(0, parts.length - 3);
      const version = nameAndVersion[nameAndVersion.length - 1];
      const name = nameAndVersion.slice(0, -1).join("-");
      if (!name || !version || !pyver || !abi || !platform_tag) {
        throw new Error(`unparseable wheel filename: ${filename}`);
      }
      return {
        name,
        version,
        filename,
        sha256: sha256File(filePath),
        platform_tag,
      };
    });
}

/** Merge per-run wheel lists into per-package records (dedupe by filename;
 * the same pure wheel appears in both runs and must hash identically). */
function mergeWheels(runs) {
  const byFile = new Map();
  for (const wheels of runs) {
    for (const wheel of wheels) {
      const prior = byFile.get(wheel.filename);
      if (prior) {
        if (prior.sha256 !== wheel.sha256) {
          throw new Error(
            `same wheel resolved twice with different bytes: ${wheel.filename}`,
          );
        }
        continue;
      }
      byFile.set(wheel.filename, wheel);
    }
  }
  const packages = new Map();
  for (const wheel of byFile.values()) {
    const key = wheel.name.toLowerCase();
    if (!packages.has(key)) {
      packages.set(key, {
        name: wheel.name,
        version: wheel.version,
        wheels: [],
      });
    }
    const pkg = packages.get(key);
    if (pkg.version !== wheel.version) {
      throw new Error(
        `package ${wheel.name} resolved to two versions across platforms: ` +
          `${pkg.version} vs ${wheel.version}`,
      );
    }
    pkg.wheels.push({
      filename: wheel.filename,
      sha256: wheel.sha256,
      platform_tag: wheel.platform_tag,
    });
  }
  return [...packages.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

function writeLock(packages) {
  const lines = [
    "# [20261006_T8_PackagingSlimdown] Generated by",
    "# scripts/embedded-python/generate-wheel-manifest.js — DO NOT hand-edit.",
    `# Regenerate: node scripts/embedded-python/generate-wheel-manifest.js`,
    `# Input: scripts/embedded-python/requirements.in (intent) resolved to the`,
    `# full transitive closure for Python ${PYTHON_VERSION}, platforms:`,
    "#   macOS arm64 (macosx_11_0_arm64 + macosx_14_0_arm64) and win_amd64.",
    "# Every wheel is sha256-pinned (SBOM discipline, spec #412 decision 5).",
    "# jieba comes from the committed local wheel (wheels/, upstream ships",
    "# sdist only) via --find-links.",
    "# Install: pip install --target <site-packages> --require-hashes",
    "#          --find-links scripts/embedded-python/wheels --only-binary=:all:",
    "#          -r scripts/embedded-python/requirements.lock",
    "",
  ];
  for (const pkg of packages) {
    // [20261006_T8_PackagingSlimdown] Inline --hash values: pip ≥26 stopped
    // accepting the classic pip-tools continuation-line format (a following
    // "--hash" line is ignored as an orphan), so hashes ride on the same
    // line as the requirement — accepted by both old and new pip.
    const hashes = pkg.wheels
      .map((wheel) => `--hash=sha256:${wheel.sha256}`)
      .join(" ");
    lines.push(`${pkg.name}==${pkg.version} ${hashes}`);
  }
  fs.writeFileSync(LOCK_OUT, lines.join("\n") + "\n");
}

function writeManifest(packages) {
  const manifest = {
    // [20261006_T8_PackagingSlimdown] schema bump = regenerate both files.
    schema_version: 1,
    generated_utc: new Date().toISOString(),
    python_version: PYTHON_VERSION,
    platforms: PLATFORM_RUNS.map((run) => run.name),
    packages,
  };
  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2) + "\n");
}

function main() {
  const tmpDir = fs.mkdtempSync(
    path.join(require("os").tmpdir(), "murmur-wheels-"),
  );
  try {
    const runs = PLATFORM_RUNS.map((run) => downloadClosure(run, tmpDir));
    const packages = mergeWheels(runs);
    const totalWheels = packages.reduce(
      (sum, pkg) => sum + pkg.wheels.length,
      0,
    );
    writeLock(packages);
    writeManifest(packages);
    console.log(
      `wheel manifest: ${packages.length} packages / ${totalWheels} wheels ` +
        `→ ${path.relative(process.cwd(), LOCK_OUT)} + ` +
        `${path.relative(process.cwd(), MANIFEST_OUT)}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  sha256File,
  downloadClosure,
  mergeWheels,
  PLATFORM_RUNS,
  PYTHON_VERSION,
};
