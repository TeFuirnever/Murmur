#!/usr/bin/env node
"use strict";
// [20261006_T11_EvidenceChainChecklist] Ticket #424 (spec #412 decision 13):
// the pre-tag release evidence chain evaluator. The release evidence chain
// (发布证据链) is the set of recorded artifacts proving the ONNX migration's
// acceptance verdicts; this script walks the chain and FAILS on the first
// missing item — "缺项即红" is the gate's whole reason to exist.
//
// Five items, each referencing the owning ticket's artifacts:
//   T2  #415  win x64 ONNX spike     — committed report (WIN-SPIKE: PASS)
//                                      + a recorded green CI run
//   T4  #416+#443  A/B verdict       — verdict doc WITH the post-#443
//                                      resolution (判决翻 GO 口径), the
//                                      machine-readable T4a compare verdict
//                                      (passed + zh-hard/en-observe hotword
//                                      subdomain gates), the ONNX corpus
//                                      run.json, + a green harness CI run
//   T7  #421  resource gates         — owner-authorized measurement
//                                      clarification (RESOURCE-GATE: PASS)
//                                      + a recorded green CI run (both
//                                      matrix legs — a run is only
//                                      conclusion:success when both pass)
//   T8  #422  packaging              — sha256-pinned wheel lock (SBOM
//                                      discipline) + the installer-size
//                                      evidence artifacts of THIS build run
//                                      within the #422 budgets (mac ≤260MB
//                                      dmg / win ≤270MB setup exe). The
//                                      build jobs' own gates (import gate,
//                                      boot smoke + ONNX inference segment)
//                                      are already hard steps upstream —
//                                      this job only runs if they stayed
//                                      green (needs:).
//   T9  #420  migration UX           — the explicit-migration modules and
//                                      their regression locks exist (the
//                                      tests themselves run in the `test`
//                                      job; existence pins the evidence
//                                      chain against silent drift)
//
// The chain is a RECORDED-evidence chain, not a per-tag re-run: the heavy
// workflows (spike / resource gates / A/B corpus) are dispatch-only by
// policy (model stack ≈700MB — far too heavy for routine CI). The checklist
// asserts the chain EXISTS and is green; re-running them on a release
// candidate is the owner's operational call (see CONTRIBUTING → Release
// Gates → 分发预案).
//
// Usage:
//   node scripts/release-evidence/check-evidence-chain.js [--repo-root DIR]
//        [--artifacts-dir DIR] [--out report.json]
// Exit codes: 0 chain complete · 1 missing/red item (or infra failure)
//             · 2 usage error.
//
// CI wiring (build.yml `evidence-checklist` job): runs after test +
// build-mac + build-win, with actions/download-artifact@v4 having pulled
// Murmur-macOS/ and Murmur-Windows/ (installer-sizes.json) into the working
// directory, GITHUB_TOKEN in the environment for the runs API.
// [20261006_T11_EvidenceChainChecklist] END

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// #422 AC1 budgets — the same numbers CONTRIBUTING documents; enforced here
// so the release gate reads the MEASURED bytes, not a memory of them.
const INSTALLER_BUDGET_MB = Object.freeze({ mac: 260, win: 270 });
const BYTES_PER_MB = 1024 * 1024;

const WIN_SPIKE_DOC = "docs/research/2026-10-01-onnx-win-x64-spike.md";
const AB_VERDICT_DOC = "docs/research/2026-10-01-onnx-ab-verdict.md";
const AB_COMPARE_T4A_JSON = "docs/research/2026-10-06-onnx-ab-compare-t4a.json";
const AB_ONNX_RUN_JSON = "docs/research/2026-10-01-onnx-ab-run.json";
const RESOURCE_GATE_DOC =
  "docs/research/2026-10-06-resource-gate-measurement-environment-clarification.md";
const WHEEL_LOCK = "scripts/embedded-python/requirements.lock";

// Markers the committed documents must carry — a renamed or reworded doc
// silently loses its verdict otherwise. The T4 markers pin the POST-#443
// 口径 (议决记录 + GO), so an accidental revert to the original NO-GO-only
// doc cannot pass a tag build.
const DOC_MARKERS = {
  [WIN_SPIKE_DOC]: ["WIN-SPIKE: PASS"],
  [AB_VERDICT_DOC]: ["议决记录", "PASS (all gates)"],
  [RESOURCE_GATE_DOC]: ["RESOURCE-GATE: PASS"],
};

// T9 (#420) migration UX artifacts: modules plus the regression locks that
// keep the explicit-migration behaviour from drifting away silently.
const MIGRATION_UX_FILES = [
  "src/components/MigrationDialog.tsx",
  "src/helpers/modelDownloader.ts",
  "src/helpers/onnxMigration.ts",
  "src/hooks/useModelStatus.tsx",
  "tests/unit/migration-dialog.test.tsx",
  "tests/unit/onnx-migration-resume.test.ts",
  "tests/unit/modelManager-torch-fallback.test.ts",
];

// Workflow files whose recorded green runs are chain items.
const WORKFLOW_WIN_SPIKE = "onnx-win-spike.yml";
const WORKFLOW_AB = "asr-ab.yml";
const WORKFLOW_RESOURCE_GATE = "onnx-resource-gate.yml";

// --- helpers ---------------------------------------------------------------

function readIfExists(absPath) {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function docChecks(repoRoot, details) {
  const failures = [];
  for (const [relPath, markers] of Object.entries(DOC_MARKERS)) {
    const content = readIfExists(path.join(repoRoot, relPath));
    if (content === null) {
      failures.push(`MISSING: ${relPath}`);
      continue;
    }
    const missingMarkers = markers.filter(
      (marker) => !content.includes(marker),
    );
    if (missingMarkers.length > 0) {
      failures.push(
        `FAIL: ${relPath} lacks verdict marker(s): ${missingMarkers.join(", ")}`,
      );
      continue;
    }
    details.push(`ok: ${relPath} (${markers.join(" + ")})`);
  }
  return failures;
}

function fileExistsDetail(repoRoot, relPath, details) {
  const ok = fs.existsSync(path.join(repoRoot, relPath));
  // The MISSING line is carried by the failures list only — item.details
  // would otherwise repeat it once per surface.
  if (ok) details.push(`ok: ${relPath}`);
  return ok ? null : `MISSING: ${relPath}`;
}

function parseCompareT4a(repoRoot, details) {
  const raw = readIfExists(path.join(repoRoot, AB_COMPARE_T4A_JSON));
  if (raw === null) return `MISSING: ${AB_COMPARE_T4A_JSON}`;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return `FAIL: ${AB_COMPARE_T4A_JSON} is not valid JSON (${error.message})`;
  }
  const subdomains = parsed?.gates?.hotwordSubdomains;
  const passes = parsed?.passed === true;
  const subdomainGateCorrect =
    subdomains?.zh === "hard" && subdomains?.en === "observation-only";
  if (!passes)
    return `FAIL: ${AB_COMPARE_T4A_JSON} verdict is not GO (passed=false)`;
  if (!subdomainGateCorrect) {
    return (
      `FAIL: ${AB_COMPARE_T4A_JSON} hotword subdomain gates are not the ` +
      `#443 口径 (zh=hard, en=observation-only): ${JSON.stringify(subdomains)}`
    );
  }
  details.push(
    `ok: ${AB_COMPARE_T4A_JSON} (GO, hotword zh=hard / en=observation-only)`,
  );
  return null;
}

// Primary installer = what a user installs (mac .dmg / win *Setup*.exe);
// auto-update companions (zip) are recorded but not budget-gated — the #422
// budget speaks of the 安装包.
function primaryInstaller(platform, files) {
  if (platform === "mac") {
    return (
      files.find((file) => file.name.toLowerCase().endsWith(".dmg")) ?? null
    );
  }
  const setupExe = files.find((file) => /setup/i.test(file.name));
  return setupExe ?? null;
}

function installerSizeChecks(platform, artifactDir, details) {
  if (
    !artifactDir ||
    !fs.existsSync(path.join(artifactDir, "installer-sizes.json"))
  ) {
    return `MISSING: ${platform} installer-sizes.json (packaging evidence artifact absent — build job did not produce it or download-artifact did not fetch it)`;
  }
  const sizesPath = path.join(artifactDir, "installer-sizes.json");
  let parsed;
  try {
    parsed = JSON.parse(readIfExists(sizesPath) ?? "");
  } catch (error) {
    return `FAIL: ${sizesPath} is not valid JSON (${error.message})`;
  }
  const files = Array.isArray(parsed?.files) ? parsed.files : [];
  const primary = primaryInstaller(platform, files);
  if (!primary) {
    return `FAIL: ${sizesPath} lists no primary installer for ${platform}`;
  }
  const budgetBytes = INSTALLER_BUDGET_MB[platform] * BYTES_PER_MB;
  for (const file of files) {
    details.push(
      `ok: ${path.basename(artifactDir)}/installer-sizes.json ${file.name} = ${file.bytes} bytes` +
        (file === primary
          ? ` (primary, budget ${INSTALLER_BUDGET_MB[platform]}MB)`
          : ""),
    );
  }
  if (primary.bytes > budgetBytes) {
    return (
      `FAIL: ${primary.name} is ${primary.bytes} bytes — over the ` +
      `${INSTALLER_BUDGET_MB[platform]}MB ${platform} budget (#422 AC1)`
    );
  }
  return null;
}

// --- default runs fetcher (GitHub REST, read-only) -------------------------

function resolveRepository(repoRoot) {
  const fromEnv = process.env.MURMUR_RELEASE_EVIDENCE_REPO;
  if (fromEnv) return fromEnv;
  return new Promise((resolve) => {
    execFile(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: repoRoot },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const url = String(stdout).trim();
        const https = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
        resolve(https ? https[1] : null);
      },
    );
  });
}

function makeDefaultRunsFetcher(repoRoot) {
  return async function fetchRuns(workflowFile) {
    const repository = await resolveRepository(repoRoot);
    if (!repository)
      return {
        found: false,
        reason:
          "cannot resolve GitHub repository (no remote, no MURMUR_RELEASE_EVIDENCE_REPO)",
      };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const url =
      `https://api.github.com/repos/${repository}/actions/workflows/` +
      `${workflowFile}/runs?status=success&per_page=1`;
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        return {
          found: false,
          reason: `runs API returned HTTP ${response.status}`,
        };
      }
      const data = await response.json();
      const run = data?.workflow_runs?.[0];
      if (!run) {
        return {
          found: false,
          reason: "no successful run recorded for this workflow",
        };
      }
      return {
        found: true,
        run: {
          id: run.id,
          html_url: run.html_url,
          head_sha: run.head_sha,
          created_at: run.created_at,
        },
      };
    } catch (error) {
      return { found: false, reason: `runs API unreachable: ${error.message}` };
    }
  };
}

// --- the chain itself ------------------------------------------------------

async function checkEvidenceChain(options) {
  const repoRoot = options.repoRoot;
  const artifacts = options.artifacts ?? {};
  const fetchRuns = options.fetchRuns ?? makeDefaultRunsFetcher(repoRoot);

  const items = [];
  const addItem = (id, ticket, title, failures, details) => {
    items.push({
      id,
      ticket,
      title,
      status: failures.length === 0 ? "green" : "red",
      details: [...details, ...failures],
    });
  };

  // T2 — #415 win x64 ONNX spike (CI evidence ticket)
  {
    const details = [];
    const failures = docChecks(repoRoot, details);
    const lookup = await fetchRuns(WORKFLOW_WIN_SPIKE);
    if (lookup.found) {
      details.push(
        `ok: green run ${lookup.run.id} ${lookup.run.html_url ?? ""}` +
          (lookup.run.head_sha
            ? ` @ ${String(lookup.run.head_sha).slice(0, 12)}`
            : ""),
      );
    } else {
      failures.push(
        `MISSING: no green ${WORKFLOW_WIN_SPIKE} run (${lookup.reason})`,
      );
    }
    addItem(
      "T2-win-spike",
      415,
      "win x64 ONNX spike evidence",
      failures,
      details,
    );
  }

  // T4 — #416 A/B verdict under the #443 (翻 GO) 口径
  {
    const details = [];
    const failures = docChecks(repoRoot, details);
    const compareFailure = parseCompareT4a(repoRoot, details);
    if (compareFailure) failures.push(compareFailure);
    const runFailure = fileExistsDetail(repoRoot, AB_ONNX_RUN_JSON, details);
    if (runFailure) failures.push(runFailure);
    const lookup = await fetchRuns(WORKFLOW_AB);
    if (lookup.found) {
      details.push(
        `ok: green run ${lookup.run.id} ${lookup.run.html_url ?? ""}`,
      );
    } else {
      failures.push(`MISSING: no green ${WORKFLOW_AB} run (${lookup.reason})`);
    }
    addItem(
      "T4-ab-verdict",
      416,
      "A/B four-dimension verdict (post-#443 GO 口径)",
      failures,
      details,
    );
  }

  // T7 — #421 resource gates
  {
    const details = [];
    const failures = docChecks(repoRoot, details);
    const lookup = await fetchRuns(WORKFLOW_RESOURCE_GATE);
    if (lookup.found) {
      details.push(
        `ok: green run ${lookup.run.id} ${lookup.run.html_url ?? ""}`,
      );
    } else {
      failures.push(
        `MISSING: no green ${WORKFLOW_RESOURCE_GATE} run (${lookup.reason})`,
      );
    }
    addItem(
      "T7-resource-gates",
      421,
      "resource acceptance gates (long audio / concurrency / cold start)",
      failures,
      details,
    );
  }

  // T8 — #422 packaging slimdown + gates
  {
    const details = [];
    const failures = [];
    const lockFailure = fileExistsDetail(repoRoot, WHEEL_LOCK, details);
    if (lockFailure) failures.push(lockFailure);
    failures.push(installerSizeChecks("mac", artifacts.mac, details));
    failures.push(installerSizeChecks("win", artifacts.win, details));
    addItem(
      "T8-packaging",
      422,
      `packaging gates + installer budgets (mac ≤${INSTALLER_BUDGET_MB.mac}MB / win ≤${INSTALLER_BUDGET_MB.win}MB)`,
      failures.filter(Boolean),
      details,
    );
  }

  // T9 — #420 migration UX
  {
    const details = [];
    const failures = [];
    for (const relPath of MIGRATION_UX_FILES) {
      const failure = fileExistsDetail(repoRoot, relPath, details);
      if (failure) failures.push(failure);
    }
    addItem(
      "T9-migration-ux",
      420,
      "explicit migration UX + torch fallback locks",
      failures,
      details,
    );
  }

  return { passed: items.every((item) => item.status === "green"), items };
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    repoRoot: path.resolve(__dirname, "..", ".."),
    artifactsDir: null,
    out: null,
  };
  const rest = argv ?? process.argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === "--repo-root" && value) {
      args.repoRoot = path.resolve(value);
      i++;
    } else if (flag === "--artifacts-dir" && value) {
      args.artifactsDir = path.resolve(value);
      i++;
    } else if (flag === "--out" && value) {
      args.out = path.resolve(value);
      i++;
    } else {
      return {
        error: `usage: check-evidence-chain.js [--repo-root DIR] [--artifacts-dir DIR] [--out report.json] (unexpected ${flag})`,
      };
    }
  }
  return { args };
}

function renderText(report) {
  const lines = ["Release evidence chain (#412 decision 13, ticket #424):"];
  for (const item of report.items) {
    lines.push(
      `  [${item.status.toUpperCase()}] ${item.id} (#${item.ticket}) ${item.title}`,
    );
    for (const detail of item.details) lines.push(`         ${detail}`);
  }
  lines.push(
    `CHAIN: ${report.passed ? "PASS — all five items green" : "FAIL — 缺项即红, see items above"}`,
  );
  return lines.join("\n");
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(parsed.error);
    return 2;
  }
  const { args } = parsed;
  // CI layout: actions/download-artifact@v4 pulls every artifact into the
  // working directory under its own name (Murmur-macOS/, Murmur-Windows/).
  const defaultArtifacts = {
    mac: path.join(args.artifactsDir ?? process.cwd(), "Murmur-macOS"),
    win: path.join(args.artifactsDir ?? process.cwd(), "Murmur-Windows"),
  };
  const artifacts = {
    mac: fs.existsSync(defaultArtifacts.mac) ? defaultArtifacts.mac : null,
    win: fs.existsSync(defaultArtifacts.win) ? defaultArtifacts.win : null,
  };
  const report = await checkEvidenceChain({
    repoRoot: args.repoRoot,
    artifacts,
    fetchRuns: makeDefaultRunsFetcher(args.repoRoot),
  });
  console.log(renderText(report));
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report written: ${args.out}`);
  }
  return report.passed ? 0 : 1;
}

module.exports = {
  INSTALLER_BUDGET_MB,
  checkEvidenceChain,
  makeDefaultRunsFetcher,
  renderText,
  main,
};

// Allow use as a CLI (direct node execution) without running on import.
if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
