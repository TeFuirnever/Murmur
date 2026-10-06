#!/usr/bin/env node
"use strict";
// [20261006_T11_EvidenceChainChecklist] Ticket #424: emit machine-readable
// installer-size packaging evidence. build.yml's "Record installer sizes"
// steps call this for both platforms: it writes <distDir>/installer-sizes
// .json (consumed by the evidence-checklist job, which enforces the #422
// budgets mac ≤260MB / win ≤270MB against the MEASURED bytes) and appends
// the human-readable table to the job log and GITHUB_STEP_SUMMARY.
//
// Usage: node scripts/release-evidence/installer-sizes.js [distDir=dist]
// Exit codes: 0 evidence written · 1 no installer artifacts found.
// [20261006_T11_EvidenceChainChecklist] END

const fs = require("fs");
const path = require("path");

// Installers + auto-update companions we record. The #422 budget applies to
// the PRIMARY installer (dmg / setup exe) — enforced by check-evidence-chain.
const INSTALLER_EXTENSIONS = /\.(dmg|exe|zip)$/;

function main(argv) {
  const distDir = argv[0] ?? "dist";
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const files = fs
    .readdirSync(distDir)
    .filter((name) => INSTALLER_EXTENSIONS.test(name))
    .map((name) => ({
      name,
      bytes: fs.statSync(path.join(distDir, name)).size,
    }));
  fs.writeFileSync(
    path.join(distDir, "installer-sizes.json"),
    `${JSON.stringify({ files }, null, 2)}\n`,
  );
  const summaryLines = [];
  for (const { name, bytes } of files) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    console.log(`installer-size: ${name} ${bytes} bytes (${mb} MB)`);
    summaryLines.push(`- \`${name}\`: **${bytes} bytes** (${mb} MB)`);
  }
  if (summaryPath && summaryLines.length > 0) {
    fs.appendFileSync(summaryPath, `${summaryLines.join("\n")}\n`);
  }
  if (files.length === 0) {
    console.error(
      `::error::no installer artifacts (dmg/exe/zip) found in ${distDir}`,
    );
    return 1;
  }
  console.log(
    `installer-size evidence written: ${path.join(distDir, "installer-sizes.json")}`,
  );
  return 0;
}

module.exports = { main };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
