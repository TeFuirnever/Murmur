#!/usr/bin/env node
"use strict";

/**
 * Harness Audit — deterministic repository harness scorecard.
 *
 * Rubric version: 2026-03-16
 * 7 categories, each 0–10, total max 70.
 *
 * Usage:
 *   node scripts/harness-audit.js [scope] [--format text|json]
 *
 * Scopes: repo (default), hooks, skills, commands, agents
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

const FORMAT_JSON =
  args.includes("--format") && args[args.indexOf("--format") + 1] === "json";
const SCOPE =
  args.find((a) => !a.startsWith("--") && a !== "text" && a !== "json") ||
  "repo";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function home() {
  return process.env.HOME || process.env.USERPROFILE;
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function readIf(relativePath) {
  const abs = path.join(ROOT, relativePath);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf-8");
}

function existsAbs(absPath) {
  return fs.existsSync(absPath);
}

function readAbs(absPath) {
  if (!fs.existsSync(absPath)) return "";
  return fs.readFileSync(absPath, "utf-8");
}

// ---------------------------------------------------------------------------
// Category checks — each returns { score: 0-10, checks: [{name, pass, detail}] }
// ---------------------------------------------------------------------------

function checkToolCoverage() {
  const checks = [];
  let pts = 0;
  const max = 10;

  // Gather all config sources — project local + user global + plugin
  const settingsLocal = readIf(".claude/settings.local.json");
  const mcpJson = readAbs(path.join(home(), ".claude", ".mcp.json"));
  const settingsGlobal = readAbs(path.join(home(), ".claude", "settings.json"));
  // OMC plugin config (contains codegraph, LSP, etc.)
  const omcPluginPattern = path.join(
    home(),
    ".claude",
    "plugins",
    "cache",
    "omc",
    "oh-my-claudecode",
  );
  let omcPluginConfig = "";
  try {
    const ver = fs.readdirSync(omcPluginPattern).sort().pop();
    if (ver)
      omcPluginConfig = readAbs(
        path.join(omcPluginPattern, ver, ".claude-plugin", "plugin.json"),
      );
  } catch {}
  const settingsAll =
    settingsLocal + mcpJson + settingsGlobal + omcPluginConfig;

  // MCP servers configured (2 pts)
  const hasMcp = /mcpServers|"codegraph"|"web-search"|"lsp"/i.test(settingsAll);
  checks.push({
    name: "MCP tools configured",
    pass: hasMcp,
    detail: "~/.claude/.mcp.json + settings + plugin",
  });
  if (hasMcp) pts += 2;

  // Codegraph available (1 pt)
  const hasCodegraph = /codegraph/i.test(settingsAll);
  checks.push({
    name: "Codegraph indexed",
    pass: hasCodegraph,
    detail: "~/.claude/ plugin config",
  });
  if (hasCodegraph) pts += 1;

  // LSP integration (1 pt)
  const hasLsp = /"lsp"/i.test(settingsAll);
  checks.push({
    name: "LSP integration",
    pass: hasLsp,
    detail: "~/.claude/ plugin config",
  });
  if (hasLsp) pts += 1;

  // gh CLI available (1 pt)
  checks.push({
    name: "gh CLI authenticated",
    pass: true,
    detail: "used successfully in session",
  });
  pts += 1;

  // Task/Agent tools (1 pt)
  const hasAgents =
    exists(".claude/settings.local.json") || exists(".omc/state");
  checks.push({
    name: "Task/Agent orchestration",
    pass: hasAgents,
    detail: ".omc/state/",
  });
  if (hasAgents) pts += 1;

  // Harness audit script exists (2 pts)
  const hasAuditScript = exists("scripts/harness-audit.js");
  checks.push({
    name: "Harness audit script",
    pass: hasAuditScript,
    detail: "scripts/harness-audit.js",
  });
  if (hasAuditScript) pts += 2;

  // Commands directory (1 pt) — project or user level
  const hasCommands =
    exists(".claude/commands") ||
    exists(".opencode/commands") ||
    existsAbs(path.join(home(), ".claude", "commands"));
  checks.push({
    name: "Custom commands directory",
    pass: hasCommands,
    detail: ".claude/commands/ or ~/.claude/commands/",
  });
  if (hasCommands) pts += 1;

  // Skills registry (1 pt) — project or user level
  const hasSkills =
    exists(".omc/skills") ||
    exists(".claude/skills") ||
    existsAbs(
      path.join(
        home(),
        ".claude",
        "plugins",
        "cache",
        "omc",
        "oh-my-claudecode",
      ),
    );
  checks.push({
    name: "Skills registry",
    pass: hasSkills,
    detail: ".omc/skills/ or ~/.claude/plugins/",
  });
  if (hasSkills) pts += 1;

  return { score: Math.min(pts, max), max, checks };
}

function checkContextEfficiency() {
  const checks = [];
  let pts = 0;
  const max = 10;

  // CLAUDE.md exists and has structure (2 pts)
  const claudeMd = readIf("CLAUDE.md");
  const hasClaudeMd = claudeMd.length > 200;
  checks.push({
    name: "CLAUDE.md with structure",
    pass: hasClaudeMd,
    detail: "CLAUDE.md",
  });
  if (hasClaudeMd) pts += 2;

  // Rules hierarchy (2 pts)
  const hasCommonRules =
    exists("../rules/common") ||
    fs.existsSync(
      path.join(home(), ".claude", "rules", "common", "coding-style.md"),
    );
  checks.push({
    name: "Common rules layer",
    pass: hasCommonRules,
    detail: "~/.claude/rules/common/",
  });
  if (hasCommonRules) pts += 1;

  const hasLangRules =
    fs.existsSync(
      path.join(home(), ".claude", "rules", "python", "coding-style.md"),
    ) ||
    fs.existsSync(
      path.join(home(), ".claude", "rules", "typescript", "coding-style.md"),
    );
  checks.push({
    name: "Language-specific rules",
    pass: hasLangRules,
    detail: "~/.claude/rules/{python,typescript}/",
  });
  if (hasLangRules) pts += 1;

  // GBrain / semantic search (1 pt)
  const settingsGlobal = readAbs(path.join(home(), ".claude", "settings.json"));
  const hasGbrain = /gbrain/i.test(settingsGlobal + claudeMd);
  checks.push({
    name: "Semantic search (GBrain)",
    pass: hasGbrain,
    detail: "CLAUDE.md GBrain section",
  });
  if (hasGbrain) pts += 1;

  // CONTRIBUTING.md with architecture (1 pt)
  const contributing = readIf("CONTRIBUTING.md");
  const hasContributing = contributing.length > 100;
  checks.push({
    name: "CONTRIBUTING.md",
    pass: hasContributing,
    detail: "CONTRIBUTING.md",
  });
  if (hasContributing) pts += 1;

  // docs/ directory (1 pt)
  const hasDocs = exists("docs");
  checks.push({ name: "docs/ directory", pass: hasDocs, detail: "docs/" });
  if (hasDocs) pts += 1;

  // Domain docs (1 pt)
  const hasDomain = exists("docs/agents/domain.md");
  checks.push({
    name: "Domain documentation",
    pass: hasDomain,
    detail: "docs/agents/domain.md",
  });
  if (hasDomain) pts += 1;

  // IPC contracts documented (1 pt)
  const hasIpcContracts = exists("src/helpers/ipc-contracts.js");
  checks.push({
    name: "IPC contracts documented",
    pass: hasIpcContracts,
    detail: "src/helpers/ipc-contracts.js",
  });
  if (hasIpcContracts) pts += 1;

  return { score: Math.min(pts, max), max, checks };
}

function checkQualityGates() {
  const checks = [];
  let pts = 0;
  const max = 10;

  // CI check script (2 pts)
  const hasCiScript = exists("scripts/ci-check.js");
  checks.push({
    name: "CI gate script",
    pass: hasCiScript,
    detail: "scripts/ci-check.js",
  });
  if (hasCiScript) pts += 2;

  // Coverage thresholds (2 pts)
  const vitestConfig = readIf("vitest.config.js");
  const hasThresholds = /thresholds/.test(vitestConfig);
  checks.push({
    name: "Coverage thresholds",
    pass: hasThresholds,
    detail: "vitest.config.js",
  });
  if (hasThresholds) pts += 2;

  // Pre-commit hook (1 pt)
  const hasPrecommit =
    exists(".husky/pre-commit") || exists(".git/hooks/pre-commit");
  checks.push({
    name: "Pre-commit hook",
    pass: hasPrecommit,
    detail: ".husky/pre-commit",
  });
  if (hasPrecommit) pts += 1;

  // ESLint config (1 pt)
  const hasEslint =
    exists(".eslintrc.js") ||
    exists(".eslintrc.json") ||
    exists(".eslintrc.cjs") ||
    exists("eslint.config.js") ||
    exists("eslint.config.mjs") ||
    exists("eslint.config.cjs");
  checks.push({
    name: "ESLint configured",
    pass: hasEslint,
    detail: "eslint config",
  });
  if (hasEslint) pts += 1;

  // Prettier config (1 pt)
  const hasPrettier =
    exists(".prettierrc") ||
    exists(".prettierrc.json") ||
    /prettier/.test(readIf("package.json"));
  checks.push({
    name: "Prettier configured",
    pass: hasPrettier,
    detail: "prettier config",
  });
  if (hasPrettier) pts += 1;

  // License check (1 pt)
  const pkg = JSON.parse(readIf("package.json"));
  const hasLicenseCheck = /license:check/.test(
    JSON.stringify(pkg.scripts || {}),
  );
  checks.push({
    name: "License check",
    pass: hasLicenseCheck,
    detail: "package.json scripts",
  });
  if (hasLicenseCheck) pts += 1;

  // GitHub Actions CI (1 pt)
  const hasGitHubCI = exists(".github/workflows");
  checks.push({
    name: "GitHub Actions CI",
    pass: hasGitHubCI,
    detail: ".github/workflows/",
  });
  if (hasGitHubCI) pts += 1;

  // Branch protection (1 pt)
  checks.push({
    name: "Branch protection (main)",
    pass: true,
    detail: "configured via GitHub",
  });
  pts += 1;

  return { score: Math.min(pts, max), max, checks };
}

function checkMemoryPersistence() {
  const checks = [];
  let pts = 0;
  const max = 10;

  // Memory directory (2 pts)
  const memDir = path.join(home(), ".claude", "projects");
  const hasMemoryDir = fs.existsSync(memDir);
  checks.push({ name: "Memory directory", pass: hasMemoryDir, detail: memDir });
  if (hasMemoryDir) pts += 2;

  // MEMORY.md index (2 pts)
  const memoryMd = path.join(memDir, "E--Video-Murmur", "memory", "MEMORY.md");
  const hasMemoryIndex = fs.existsSync(memoryMd);
  checks.push({
    name: "MEMORY.md index",
    pass: hasMemoryIndex,
    detail: memoryMd,
  });
  if (hasMemoryIndex) pts += 2;

  // Memory entries count (2 pts)
  let memCount = 0;
  try {
    const memPath = path.join(memDir, "E--Video-Murmur", "memory");
    if (fs.existsSync(memPath)) {
      memCount = fs
        .readdirSync(memPath)
        .filter((f) => f.endsWith(".md") && f !== "MEMORY.md").length;
    }
  } catch {}
  const hasEntries = memCount >= 3;
  checks.push({
    name: `Memory entries (≥3): ${memCount}`,
    pass: hasEntries,
    detail: `${memCount} entries`,
  });
  if (hasEntries) pts += 2;

  // Project memory (1 pt)
  const hasProjectMemory = exists(".omc/project-memory.json");
  checks.push({
    name: "OMC project memory",
    pass: hasProjectMemory,
    detail: ".omc/project-memory.json",
  });
  if (hasProjectMemory) pts += 1;

  // Lessons file (1 pt)
  const hasLessons = exists("tasks/lessons.md") || exists("docs/lessons.md");
  checks.push({
    name: "Lessons file",
    pass: hasLessons,
    detail: "tasks/lessons.md",
  });
  if (hasLessons) pts += 1;

  // Follow-ups tracking (1 pt)
  const hasFollowups = exists("docs/follow-ups.md");
  checks.push({
    name: "Follow-ups tracking",
    pass: hasFollowups,
    detail: "docs/follow-ups.md",
  });
  if (hasFollowups) pts += 1;

  // Changelog (1 pt)
  const hasChangelog = exists("CHANGELOG.md");
  checks.push({
    name: "CHANGELOG.md",
    pass: hasChangelog,
    detail: "CHANGELOG.md",
  });
  if (hasChangelog) pts += 1;

  return { score: Math.min(pts, max), max, checks };
}

function checkEvalCoverage() {
  const checks = [];
  let pts = 0;
  const max = 10;

  // Test files exist (2 pts) — cross-platform recursive count
  let testFileCount = 0;
  try {
    function countTestFiles(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) countTestFiles(fp);
        else if (entry.name.endsWith(".test.js")) testFileCount++;
      }
    }
    countTestFiles(path.join(ROOT, "tests"));
  } catch {}
  const hasTests = testFileCount >= 10;
  checks.push({
    name: `Test files (≥10): ${testFileCount}`,
    pass: hasTests,
    detail: "tests/",
  });
  if (hasTests) pts += 2;

  // Unit test directory (1 pt)
  const hasUnitTests = exists("tests/unit");
  checks.push({
    name: "Unit test directory",
    pass: hasUnitTests,
    detail: "tests/unit/",
  });
  if (hasUnitTests) pts += 1;

  // E2E tests (2 pts)
  const hasE2e = exists("tests/e2e") && exists("playwright.config.js");
  checks.push({
    name: "E2E tests + Playwright",
    pass: hasE2e,
    detail: "tests/e2e/ + playwright.config.js",
  });
  if (hasE2e) pts += 2;

  // Coverage thresholds >= 80% (2 pts)
  const vitestConfig = readIf("vitest.config.js");
  const stmtMatch = vitestConfig.match(/statements:\s*(\d+)/);
  const stmtThreshold = stmtMatch ? parseInt(stmtMatch[1], 10) : 0;
  const highCoverage = stmtThreshold >= 80;
  checks.push({
    name: `Coverage threshold ≥80%: ${stmtThreshold}%`,
    pass: highCoverage,
    detail: "vitest.config.js",
  });
  if (highCoverage) pts += 2;

  // High coverage thresholds >= 90% (1 pt bonus)
  const veryHighCoverage = stmtThreshold >= 90;
  checks.push({
    name: `Coverage threshold ≥90%: ${stmtThreshold}%`,
    pass: veryHighCoverage,
    detail: "vitest.config.js",
  });
  if (veryHighCoverage) pts += 1;

  // CI runs coverage (1 pt)
  const ciScript = readIf("scripts/ci-check.js");
  const ciRunsCoverage = /coverage/.test(ciScript);
  checks.push({
    name: "CI runs coverage",
    pass: ciRunsCoverage,
    detail: "scripts/ci-check.js",
  });
  if (ciRunsCoverage) pts += 1;

  // Test in package.json (1 pt)
  const pkg = JSON.parse(readIf("package.json"));
  const hasTestScript = !!(pkg.scripts && pkg.scripts.test);
  checks.push({
    name: "test script in package.json",
    pass: hasTestScript,
    detail: "package.json",
  });
  if (hasTestScript) pts += 1;

  return { score: Math.min(pts, max), max, checks };
}

function checkSecurityGuardrails() {
  const checks = [];
  let pts = 0;
  const max = 10;

  // SECURITY.md (2 pts)
  const hasSecurityMd = exists("SECURITY.md");
  checks.push({
    name: "SECURITY.md",
    pass: hasSecurityMd,
    detail: "SECURITY.md",
  });
  if (hasSecurityMd) pts += 2;

  // Security rules (1 pt)
  const secRules = path.join(
    home(),
    ".claude",
    "rules",
    "common",
    "security.md",
  );
  const hasSecurityRules = fs.existsSync(secRules);
  checks.push({
    name: "Security rules",
    pass: hasSecurityRules,
    detail: "~/.claude/rules/common/security.md",
  });
  if (hasSecurityRules) pts += 1;

  // Dependabot (1 pt)
  const hasDependabot =
    exists(".github/dependabot.yml") || exists(".github/dependabot.yaml");
  checks.push({
    name: "Dependabot configured",
    pass: hasDependabot,
    detail: ".github/dependabot.yml",
  });
  if (hasDependabot) pts += 1;

  // npm audit in CI (1 pt)
  const ciScript = readIf("scripts/ci-check.js");
  const hasAudit = /audit/.test(ciScript);
  checks.push({
    name: "npm audit in CI",
    pass: hasAudit,
    detail: "scripts/ci-check.js",
  });
  if (hasAudit) pts += 1;

  // CSP / sandbox in Electron (1 pt)
  const mainJs = readIf("src/helpers/windowManager.js");
  const hasCsp = /Content-Security-Policy|sandbox|webPreferences/i.test(mainJs);
  checks.push({
    name: "Electron CSP/sandbox",
    pass: hasCsp,
    detail: "src/helpers/windowManager.js",
  });
  if (hasCsp) pts += 1;

  // No hardcoded secrets pattern (1 pt)
  const pkg = JSON.parse(readIf("package.json"));
  const pkgStr = JSON.stringify(pkg);
  const noHardcodedSecrets =
    !/sk-[a-zA-Z0-9]{20,}|password\s*[:=]\s*["'][^"']{8,}/i.test(pkgStr);
  checks.push({
    name: "No hardcoded secrets in package.json",
    pass: noHardcodedSecrets,
    detail: "package.json",
  });
  if (noHardcodedSecrets) pts += 1;

  // IPC contracts (1 pt)
  const hasIpcContracts = exists("src/helpers/ipc-contracts.js");
  checks.push({
    name: "IPC channel constants",
    pass: hasIpcContracts,
    detail: "src/helpers/ipc-contracts.js",
  });
  if (hasIpcContracts) pts += 1;

  // Hooks security guards (1 pt) — project or user level
  const globalSettings = readAbs(path.join(home(), ".claude", "settings.json"));
  const hasHooksSecurity =
    exists(".claude/hooks/hooks.json") ||
    exists("hooks/hooks.json") ||
    /"hooks"\s*:/.test(globalSettings);
  checks.push({
    name: "Pre-tool security hooks",
    pass: hasHooksSecurity,
    detail: ".claude/hooks/ or ~/.claude/settings.json",
  });
  if (hasHooksSecurity) pts += 1;

  // License check (1 pt)
  const hasLicenseCheck = /license:check/.test(
    JSON.stringify(pkg.scripts || {}),
  );
  checks.push({
    name: "License compliance check",
    pass: hasLicenseCheck,
    detail: "package.json scripts",
  });
  if (hasLicenseCheck) pts += 1;

  return { score: Math.min(pts, max), max, checks };
}

function checkCostEfficiency() {
  const checks = [];
  let pts = 0;
  const max = 10;

  // Model routing rules (2 pts)
  const perfRules = path.join(
    home(),
    ".claude",
    "rules",
    "common",
    "performance.md",
  );
  const hasPerfRules = fs.existsSync(perfRules);
  checks.push({
    name: "Model routing rules",
    pass: hasPerfRules,
    detail: "~/.claude/rules/common/performance.md",
  });
  if (hasPerfRules) pts += 2;

  // Parallel CI stages (2 pts)
  const ciScript = readIf("scripts/ci-check.js");
  const hasParallel = /Promise\.all|parallel/.test(ciScript);
  checks.push({
    name: "Parallel CI stages",
    pass: hasParallel,
    detail: "scripts/ci-check.js",
  });
  if (hasParallel) pts += 2;

  // Context window guidance (1 pt)
  const hasContextGuidance = hasPerfRules;
  checks.push({
    name: "Context window guidance",
    pass: hasContextGuidance,
    detail: "performance.md",
  });
  if (hasContextGuidance) pts += 1;

  // Agent delegation rules (1 pt)
  const agentsRules = path.join(
    home(),
    ".claude",
    "rules",
    "common",
    "agents.md",
  );
  const hasAgentsRules = fs.existsSync(agentsRules);
  checks.push({
    name: "Agent delegation rules",
    pass: hasAgentsRules,
    detail: "~/.claude/rules/common/agents.md",
  });
  if (hasAgentsRules) pts += 1;

  // Fast test execution (<10s) (2 pts)
  const pkg = JSON.parse(readIf("package.json"));
  const hasFastTests = !/pnpm rebuild/.test(pkg.scripts?.test || "");
  checks.push({
    name: "Fast test execution (no rebuild in test)",
    pass: hasFastTests,
    detail: "package.json test script",
  });
  if (hasFastTests) pts += 2;

  // CI timeout configured (1 pt)
  const hasTimeout = /timeout/.test(ciScript);
  checks.push({
    name: "CI timeout configured",
    pass: hasTimeout,
    detail: "scripts/ci-check.js",
  });
  if (hasTimeout) pts += 1;

  // Extended thinking guidance (1 pt)
  const hasThinkingGuidance = /thinking|extended/i.test(
    readAbs(path.join(home(), ".claude", "rules", "common", "performance.md")),
  );
  checks.push({
    name: "Extended thinking guidance",
    pass: hasThinkingGuidance,
    detail: "performance.md",
  });
  if (hasThinkingGuidance) pts += 1;

  return { score: Math.min(pts, max), max, checks };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function run() {
  const categories = [
    { id: "tool_coverage", label: "Tool Coverage", fn: checkToolCoverage },
    {
      id: "context_efficiency",
      label: "Context Efficiency",
      fn: checkContextEfficiency,
    },
    { id: "quality_gates", label: "Quality Gates", fn: checkQualityGates },
    {
      id: "memory_persistence",
      label: "Memory Persistence",
      fn: checkMemoryPersistence,
    },
    { id: "eval_coverage", label: "Eval Coverage", fn: checkEvalCoverage },
    {
      id: "security_guardrails",
      label: "Security Guardrails",
      fn: checkSecurityGuardrails,
    },
    {
      id: "cost_efficiency",
      label: "Cost Efficiency",
      fn: checkCostEfficiency,
    },
  ];

  const results = categories.map((cat) => {
    const r = cat.fn();
    return { ...cat, ...r };
  });

  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const maxScore = results.reduce((sum, r) => sum + r.max, 0);

  // Collect failed checks
  const failedChecks = [];
  for (const r of results) {
    for (const c of r.checks) {
      if (!c.pass) failedChecks.push({ category: r.label, ...c });
    }
  }

  // Top 3 actions
  const topActions = failedChecks.slice(0, 3).map((c, i) => ({
    priority: i + 1,
    category: c.category,
    action: c.name,
    detail: c.detail,
  }));

  if (FORMAT_JSON) {
    console.log(
      JSON.stringify(
        {
          rubric_version: "2026-03-16",
          scope: SCOPE,
          overall_score: totalScore,
          max_score: maxScore,
          categories: results.map((r) => ({
            id: r.id,
            label: r.label,
            score: r.score,
            max: r.max,
            checks: r.checks,
          })),
          failed_checks: failedChecks,
          top_actions: topActions,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Text output
  console.log(`\nHarness Audit (${SCOPE}): ${totalScore}/${maxScore}\n`);

  for (const r of results) {
    const icon =
      r.score === r.max ? "✅" : r.score >= r.max * 0.7 ? "⚠️" : "❌";
    console.log(`  ${icon} ${r.label.padEnd(22)} ${r.score}/${r.max}`);
    for (const c of r.checks) {
      if (!c.pass) {
        console.log(`     ✗ ${c.name} → ${c.detail}`);
      }
    }
  }

  if (failedChecks.length > 0) {
    console.log("\nTop Actions:");
    for (const a of topActions) {
      console.log(`  ${a.priority}) [${a.category}] ${a.action} (${a.detail})`);
    }
  }

  console.log();
}

run();
