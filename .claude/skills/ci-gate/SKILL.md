---
name: ci-gate
description: AI-assisted CI gate analysis and fix for Murmur. Diagnoses and repairs lint, format, test, coverage, build, and license failures using project-specific domain knowledge. Use this skill whenever CI fails, when a gate check doesn't pass, when the user says "fix CI", "修复门禁", "gate check", "lint failed", "test failed", "coverage dropped", or mentions any CI quality gate issue — even if they don't explicitly ask for help with the CI pipeline. Also trigger when the user asks about improving test coverage or fixing build errors in this Electron project.
---

# CI Gate Analysis & Fix

You are a CI gate diagnostician for the Murmur Electron desktop app. Your job is to run the gate checks, analyze failures with domain expertise, propose targeted fixes, and verify the result.

## Step 1: Run Gate Checks

Run the CI gate check script in JSON mode to get structured results:

```bash
node scripts/ci-check.js --json
```

Parse the JSON output. If `"failed": 0`, report success and stop. Otherwise, proceed to analyze each failed step.

## Step 2: Analyze Failures

For each step where `"ok": false`, apply the domain-specific analysis below.

### Format Failures (`format:check`)

Format failures are always auto-fixable.

1. Show the user which files have formatting issues.
2. Run `pnpm format` to fix.
3. No manual intervention needed — re-run the check to confirm.

### Lint Failures (`lint`)

1. Run `pnpm lint` to see the full error output.
2. Classify each error:
   - **Mechanical** (unused vars, missing semicolons, import order): run `pnpm lint --fix` or fix directly.
   - **Semantic** (missing error handling, incorrect hook usage): read the file, understand the context, and propose a specific code change. Explain what was wrong and why the fix is correct.
3. Apply fixes and re-run.

### Test Failures (`test + coverage`)

This is where domain knowledge matters most. Follow this diagnostic flow:

1. Run `pnpm test` to see which tests fail and their error messages.
2. For each failing test:
   - Read the test file to understand what it asserts.
   - Trace the code path it tests (the function/module under test).
   - Identify the root cause: was it a code change, a missing export, a path issue, or a test that's out of date?
3. Common failure patterns in this project:

   **IPC contract mismatches** — Tests in `tests/unit/ipc-contracts.test.js` and `tests/unit/ipc-contracts-orphans.test.js` verify that every channel in `src/helpers/ipc-contracts.js` is registered in `src/helpers/ipc/index.js`. If these fail, check for recently added or renamed channels.

   **Module resolution** — Tests in `tests/unit/main-process-module-resolution.test.js` verify all `require()` paths in `src/` resolve. If this fails, a relative import path is wrong (see the `updateManager.js` `../ipc-contracts` vs `./ipc-contracts` bug pattern).

   **CI config consistency** — Tests in `tests/unit/phase1-ci-config.test.js` verify `.nvmrc` and workflow files. If these fail after a CI config change, the test may need updating too.

4. For coverage threshold failures (statements < 97%, branches < 90%, functions < 100%, lines < 98%):
   - Run `pnpm test -- --coverage` and look at the coverage summary.
   - Identify which files have low coverage.
   - Suggest where to add tests, focusing on uncovered branches or functions.

### Build Failures (`build:preload` or `build:renderer`)

1. Read the build error output from the JSON.
2. Common causes:
   - Import path errors in `preload.js` (can only use `electron` as external).
   - Missing or circular dependencies in the renderer (`src/`).
   - Vite config errors in `src/vite.config.js`.
3. Fix the root cause and re-build.

### License Failures (`license:check`)

1. Run `pnpm license:check` to see which dependency has a GPL/AGPL license.
2. Find a replacement package with a permissive license (MIT, Apache-2.0, BSD).
3. If no replacement exists, flag it for manual review.

## Step 3: High-Risk Module Awareness

When fixes touch any of these files, apply extra scrutiny:

| Module                         | Risk                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| `main.js`                      | Main process entry, IPC bridge setup                         |
| `preload.js`                   | Restricted context — cannot `require()` non-electron modules |
| `src/helpers/funasrManager.js` | Python subprocess lifecycle                                  |
| `src/helpers/windowManager.js` | Sandbox, CSP, window creation                                |
| `src/helpers/database.js`      | safeStorage encryption, schema                               |
| `src/helpers/ipc-contracts.js` | Central IPC channel registry                                 |

For preload.js specifically: never add a `require()` call for anything other than `electron`. Use `contextBridge.exposeInMainWorld` to expose APIs.

## Step 4: Present & Fix

1. Summarize all failures and proposed fixes in a table:

```
| Step | Issue | Fix | Confidence |
|------|-------|-----|------------|
| lint | unused var in x.js:12 | remove the variable | high |
| test | ipc-contracts-orphans: missing channel | register in ipc/index.js | high |
```

2. On user approval, apply all fixes.
3. Re-run `node scripts/ci-check.js` to verify all gates pass.
4. If any gate still fails, loop back to Step 2.

## Step 5: Final Report

After all gates pass, report:

- What was broken and what was fixed.
- Any risks or follow-ups the user should be aware of.
- Suggest a commit message if the user wants to commit.
