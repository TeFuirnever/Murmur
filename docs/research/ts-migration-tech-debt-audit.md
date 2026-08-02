# TypeScript Migration — Technical Debt Audit

Date: 2026-07-26
Scope: ADR-010 big-bang + Tier 1-4 cleanup
Auditor: automated grep + manual review of every dimension
Companion to: `docs/research/ts-migration-audit-and-evolution.md` (the plan-of-record)

---

## Executive summary

The TypeScript migration is **substantially complete**. The high-criticality
work (source strict-mode, test typecheck gate, deletion of the
`_tsresolve.setup.js` shim, Tier 3.3 lint ban) is done and verified. What
remains is a long tail of low-severity polish, three pieces of "won't fix
because it's deliberate" debt documented in ADRs, and one piece of **truly
unresolved** debt (the e2e macOS launch hang) that is not the migration's
fault but blocks promotion of the e2e gate.

### Counts by severity

| Severity | Count | Headline                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | 1     | E2E CI macOS launch hangs — every e2e step is non-blocking (ADR-014)                                                                                                                                                                                                                                                                                                             |
| High     | 2     | (1) `tar@7.5.15` critical CVE not yet bumped. (2) `tsconfig.test.json` excludes 7 .ts unit test files from the typecheck gate                                                                                                                                                                                                                                                    |
| Medium   | 7     | Structural `as` casts in source (34 sites), `no-explicit-any: off` global lint concession, `no-require-imports` global off (only on in `tests/unit/**`), `skipLibCheck: true` one-sided detector, stale `.js` references in 5 docs/ADRs, `tsconfig.e2e.json` `noImplicitAny: false`, root config files still `.js`                                                               |
| Low      | 8     | `_resolveFilename` injection in 2 preload tests, `createRequire` pattern, `electronAPI.d.ts` 16 `unknown` return types, `Module._resolve` cast seam, `modelStatus as any` allowlist theater, `_tsresolve.setup.js` historical narrative in deep-test-design docs, root `cleanup.js`/`postcss.config.js`/`tailwind.config.js`, `vi.resetModules` residual in 3 holdout test files |

**Total: 18 distinct debt items.**

### What is NOT blocking

- The backend is fully strict-typed (`strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitAny: true` in `tsconfig.json`).
- The source has **zero** `@ts-ignore`, **zero** `@ts-expect-error`. The 6
  `as any` sites are all in the renderer (HMR / `performance.memory` /
  `webkitAudioContext`) and are pinned to an explicit allowlist enforced by
  `tests/unit/backend-type-safety.test.ts`.
- 100% of unit tests are `.ts` (86 `.ts` vs 0 `.js` in `tests/unit/`).
- 100% of e2e suites are `.ts` (13 `.ts` vs 0 `.js` in `tests/e2e/suites/`).
- `pnpm typecheck` and `pnpm typecheck:tests` both pass clean.

---

## Dimension 1 — Source code type-safety

### 1.1 Structural casts (`as unknown as`, `as Record`, `as {`) — MEDIUM

34 occurrences across 13 source files. Top offenders:

| File                                                              | Count             | Notes                                                                                                                                                  |
| ----------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/helpers/database.ts:100,104,108,225,229,284,446,447,448,465` | 10                | `better-sqlite3` row casts (`as { cnt: number }`, `as { value: string \| undefined }`). Acceptable: `better-sqlite3` returns `unknown` rows by design. |
| `src/helpers/funasrManager.ts` (7 sites)                          | 7                 | HTTP response body casts — see 1.2.                                                                                                                    |
| `src/helpers/ipc/transcriptionHandlers.ts:239,401,414`            | 3                 | `transcriptions as unknown as TranscriptionForExport` — see 1.3.                                                                                       |
| `src/helpers/ipc/index.ts:76`                                     | 1 (×9 call sites) | `asManagers<T>` — **deliberate seam, ADR-013**. Not debt.                                                                                              |

**Impact**: each cast is an unchecked assertion. A misnamed DB column or
shape change produces no compile error.

**Fix path**:

- `database.ts`: introduce `Row<T>` typed helpers wrapping
  `stmt.get() as T`. ~2 hours; eliminates 10 casts at once.
- `funasrManager.ts`: define Zod (or hand-rolled) validators for the
  `getDownloadProgress`/`getCurrentModel` HTTP responses. 0.5 day.
- The `asManagers<T>` seam is **not debt** — see "What is NOT debt" §9.

### 1.2 `as unknown as TranscriptionForExport` — LOW

`src/helpers/ipc/transcriptionHandlers.ts:239,401,414` casts an array of
`TranscriptionRecord` through `unknown` to `TranscriptionForExport`.
`TranscriptionForExport` is a renderer-only type that omits some backend
fields; the double cast bypasses the structural check.

**Impact**: if `TranscriptionRecord` ever loses a field the export
formatter needs, no compile error.

**Fix path**: define `TranscriptionForExport` as `Pick<TranscriptionRecord,
"..." \| "...">` and use a typed projection. 30 min.

### 1.3 Lazy `require()` in TS source — NOT DEBT (deliberate)

14 active `require()` sites across 7 files:

| File                               | Lines              | Subject                                  |
| ---------------------------------- | ------------------ | ---------------------------------------- |
| `src/helpers/modelManager.ts`      | 113, 133, 165, 307 | `require("electron")` for `app`          |
| `src/helpers/pythonEnvironment.ts` | 55, 69, 180        | `require("electron")` for `app`          |
| `src/helpers/logManager.ts`        | 55, 211            | `require("electron")`                    |
| `src/helpers/ipc/aiHandlers.ts`    | 539                | `require("electron")` for `templatesDir` |
| `src/helpers/environment.ts`       | 108                | `require("dotenv")`                      |
| `src/helpers/aiPrompts.ts`         | 71-72              | `require("fs")`, `require("path")`       |
| `src/helpers/clipboard.ts`         | 31                 | `require("osascript")`                   |

**Why deliberate**: ADR-010 §"Export strategy" + the explicit comment in
`eslint.config.mjs:23-32` documents that top-level `import { app } from
"electron"` is hoisted and fails in unit tests (electron absent). The
pattern is `try { const { app } = require("electron") } catch`. This is
**the** standard pattern for Electron backends tested outside the runtime.

**Lint status**: `@typescript-eslint/no-require-imports` is `off` globally,
`error` in `tests/unit/**` only (Tier 3.3). This is the correct scoping;
turning it on for source would require building a typed electron-mock
infrastructure first.

### 1.4 `as any` / `: any` in source — LOW (allowlisted)

6 sites, all in the renderer, all allowlisted in
`tests/unit/backend-type-safety.test.ts:90-117`:

| File:line                       | Pattern                              | Why                                          |
| ------------------------------- | ------------------------------------ | -------------------------------------------- |
| `src/App.tsx:712`               | `modelStatus as any`                 | Type narrowing gap in a prop chain — see 7.2 |
| `src/main.tsx:222-223`          | `(import.meta as any).hot`           | Vite HMR is untyped in this template         |
| `src/main.tsx:256-258`          | `(performance as any).memory`        | Chrome-only API, not in standard lib         |
| `src/hooks/useRecording.ts:304` | `finalData as any`                   | Blob → audio buffer cast                     |
| `src/hooks/useRecording.ts:395` | `(window as any).webkitAudioContext` | Safari-only API                              |

**Impact**: the allowlist is enforced by a dynamic walker (no escape
hatch). Adding a 7th `as any` anywhere fails CI. This is the maximum
achievable without writing `@types/vite-hmr` and
`@types/webkit-audio-context` stubs.

### 1.5 `@ts-ignore` / `@ts-expect-error` — NONE

Zero occurrences. Enforced by
`tests/unit/backend-type-safety.test.ts:145` (`"no project .ts or .d.ts
file uses @ts-ignore or @ts-expect-error"`).

### 1.6 `skipLibCheck: true` — MEDIUM (one-sided detector)

`tsconfig.json:12` sets `skipLibCheck: true`. Documented in ADR-013
§"Note on the preload ↔ d.ts drift detector" as a deliberate concession:
required to suppress the `noDeprecation` modifier conflict between
`@types/node` and `electron.d.ts`.

**Impact**: catches preload runtime → `electronAPI.d.ts` drift (via the
`preloadApi: ElectronAPI` annotation in `preload.ts:46`) but does NOT
catch **internal** d.ts errors (duplicate interface members, missing type
imports, conflicting return types across merged declarations).

**Fix path**: scoped `tsc --skipLibCheck false` over `src/**/*.d.ts`
excluding `node_modules` — ADR-013 calls this "deferred — the third-party
conflicts it would surface make it a separate project to enable safely."
Estimated 1-2 days to triage the conflicts.

### 1.7 `strict` mode holes — NONE in source, 1 in e2e helpers

| Config                            | `strict`     | `noImplicitAny` | `noUncheckedIndexedAccess` |
| --------------------------------- | ------------ | --------------- | -------------------------- |
| `tsconfig.json` (source)          | ✅ true      | ✅ true         | ✅ true                    |
| `tsconfig.test.json` (unit tests) | ✅ inherited | ✅ inherited    | ✅ inherited               |
| `tsconfig.e2e.json` (e2e helpers) | ✅ true      | ❌ **false**    | ❌ not set                 |
| `tsconfig.suites-check.json`      | ✅ true      | ✅ true         | ❌ not set                 |

`tsconfig.e2e.json:13` relaxes `noImplicitAny: false` with the comment:
_"the helpers were migrated from untyped .js and full strict annotation
of every param is out of scope for the helper-rename task. Tighten to
true in a follow-up."_

**Impact**: the e2e helpers (`tests/e2e/helpers/*.ts`, 5 files, ~17KB)
are not under strict implicit-any checking. Since these are test
infrastructure (not shipped code) and the suite is currently non-blocking
on CI anyway, the risk is low.

**Fix path**: annotate the 5 helper files (~150 params). 0.5 day. Blocked
on Tier 4.3 completion — see ADR-014.

---

## Dimension 2 — Test infrastructure debt

### 2.1 Remaining `.js` test files — LOW

4 total, all in `tests/e2e/`:

| File                                | Purpose                                                                                                                                                       | Status                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `tests/e2e/helpers/ci-probe.js`     | Loaded via Electron's `--require` flag **before** the main entry to confirm the Electron process is alive. CJS by necessity — loaded before any TS transform. | **NOT DEBT** — ADR-014 documents this as load-bearing diagnostic infrastructure. |
| `tests/e2e/legacy/launch.test.js`   | Legacy Playwright spec, not in active suite (`playwright.config.ts` points to `tests/e2e/suites/`).                                                           | Dead — candidate for deletion.                                                   |
| `tests/e2e/legacy/settings.test.js` | Same.                                                                                                                                                         | Dead — candidate for deletion.                                                   |
| `tests/e2e/legacy/ipc.test.js`      | Same.                                                                                                                                                         | Dead — candidate for deletion.                                                   |

**Fix path**: `git rm tests/e2e/legacy/`. 5 min. The 3 legacy specs are
not executed by any CI step or npm script.

**Unit tests**: 0 `.js` files remain (86 `.ts`/`.tsx`). Tier 3.1 is
genuinely 100% complete.

### 2.2 Remaining `require()` in tests — NONE (active)

Every `grep` hit for `require(` in `tests/` is either:

- Inside a comment documenting the migration
  (`// [20260726_Tier32_*] Convert require() → ESM import`)
- Inside an assertion string
  (`expect(source).not.toContain('require("../ipc-contracts")')`)
- A `vi.requireActual` call (vitest API, not CJS require)

**Active CJS `require()` in `.ts` test files**: 0.

The Tier 3.3 lint rule
`@typescript-eslint/no-require-imports: "error"` scoped to
`tests/unit/**` (`eslint.config.mjs:67-71`) prevents regression.

### 2.3 `vi.resetModules` calls — LOW (3 holdouts)

Active `vi.resetModules()` in test bodies (not comments):

| File:line                                     | Reason                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/windowManager-events.test.ts:96`  | Per-test module isolation for `vi.mock` + dynamic `import()`. Documented at file:2 as "converted from createRequire + Module.\_resolve" — the pre-migration `_tsresolve` pattern. Still needed because `vi.mock` intercepts `import` but not CJS `require`. |
| `tests/unit/transcriptionHandlers.test.ts:48` | Excluded from `tsconfig.test.json` (see 2.5).                                                                                                                                                                                                               |
| `tests/unit/regression-session-fixes.test.ts` | Multiple `beforeEach` resets — but only in comments now (`// vi.resetModules() removed`). The migration replaced 7 calls with hoisted ESM imports.                                                                                                          |

**Impact**: `vi.resetModules()` is slow and prevents test parallelization
in the affected files. The pattern is documented as a transition step.

**Fix path**: replace the `vi.mock + vi.resetModules + dynamic import`
pattern with a typed mock factory (the batch-5 pattern in
`aiHandlers.test.ts`). 0.5 day per file.

### 2.4 `createRequire` / `Module._resolveFilename` injection — LOW

2 files use the `createRequire(import.meta.url)` + `Module._resolveFilename`
monkey-patch pattern to test that preload/main resolve correctly under
Node's resolver:

| File                                            | Lines               | Cast seam                                                                                           |
| ----------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `tests/unit/preload-loadable.test.ts`           | 13-15, 51-52, 65-66 | `Module._resolveFilename as ResolveFn` + `origResolve as unknown as typeof Module._resolveFilename` |
| `tests/unit/preload-listener-lifecycle.test.ts` | 12-14, 62-63, 80-81 | Same pattern                                                                                        |

Both files are **excluded** from `tsconfig.test.json` (lines 18-24).

**Why deliberate**: `Module._resolveFilename` is an undocumented Node
internal with no `@types/node` entry — it reads as `any`. The cast
through `ResolveFn` is the only way to type it without `any`. The
exclusion from `tsconfig.test.json` is documented inline as a deliberate
deferred-debt item.

**Impact**: these two tests bypass the test typecheck gate. If a future
TS strictness change breaks them, CI won't catch it.

**Fix path**: add a minimal `declare module "module" { function
_resolveFilename(...): string }` ambient stub in a `tests/types.d.ts`,
remove the exclusions. 2 hours.

### 2.5 `tsconfig.test.json` exclusions — HIGH

`tsconfig.test.json:18-24` excludes **7 unit test files** from the
typecheck gate:

```
"exclude": [
  ...
  "tests/unit/clipboardHandlers.test.ts",
  "tests/unit/hotkeyHandlers.test.ts",
  "tests/unit/transcriptionHandlers.test.ts",
  "tests/unit/preload-bridge-contract.test.ts",
  "tests/unit/ipc-contract-completeness.test.ts",
  "tests/unit/database-error-paths.test.ts",
  "tests/unit/rejection-assertions-awaited.test.ts"
]
```

`ts-migration-audit-and-evolution.md:253` documents the rationale:
_"7 test files excluded (pre-existing strict-mode debt — mock-typing
noise + asManagers<T> seam). Documented in the file."_

All 7 files exist (verified — see dimension data).

**Impact**: these 7 tests run under vitest (esbuild-stripped, no type
check) but are invisible to `pnpm typecheck:tests`. They are the
highest-risk regression surface — IPC contract completeness,
database-error paths, and rejection-assertion coverage all live here.

**Fix path**: per-file typing work. The batch-5 pattern (see
`regression-session-fixes.test.ts:1-10`) was proven on 6/7 of these
during Tier 3.1 — the only reason they were excluded is the IPC handler
return-type widening problem documented in ADR-013 §"Consequences":
`asManagers<T>` causes `result: unknown` in mocked-`ipcMain` captures
(~38 TS18046 errors). Fix is either (a) tighten handler return types in
`src/types/ipc.ts`, or (b) assert specific shapes per test. **~2 days**.

### 2.6 Coverage exclusions — NOT DEBT

`vitest.config.js:30-44` excludes 9 helper files from coverage because
they require Electron runtime (`windowManager.ts`, `tray.ts`,
`updateManager.ts`, etc.). This is the documented pre-existing debt
(`[20260724_TS_BigBang_TestFix]` comment). The 4 files removed from the
exclusion list (`environment.ts`, `funasrServer.ts`, `funasrManager.ts`,
`pythonInstaller.ts`) are the post-migration wins.

---

## Dimension 3 — e2e system health

### 3.1 ADR-014 — the macOS Electron launch hang — CRITICAL

`docs/adr/014-e2e-ci-macos-electron-launch-investigation.md` is the most
important unresolved debt in the project. Status: **Investigation —
needs human follow-up**.

**Symptom**: every e2e test in CI macOS fails identically with
`TimeoutError: electronApplication.firstWindow: Timeout 30000ms exceeded`.
The Electron process runs for 30s, then exits with code=0 (clean exit).
During those 30s, **no JavaScript executes** — not even a `--require`'d
CJS probe (`tests/e2e/helpers/ci-probe.js`).

**Root cause not isolated** after PRs #91, #92, #93 (8 CI iterations).
Top hypotheses (ordered by likelihood):

1. Playwright Electron inspector causes silent hang (HIGH)
2. macOS Sequoia sandbox blocks unsigned Electron binary (MEDIUM)
3. Electron 36.x + Node 24 incompatibility (LOW)

**Concrete next steps** (from ADR-014 §"Concrete next-step worklist"):
local repro on a Mac, SSH into a CI runner via `tmate`, manual launch
test, Playwright `executablePath` override, try disabling Playwright
inspector.

**Impact**: every e2e step in CI is `continue-on-error: true`. The boot
health gate (designed to be blocking per
`e2e-functional-verification-strategy.md` §4.1) is permanently
non-blocking until this is resolved. The 13 e2e suites provide zero
CI signal today.

### 3.2 `continue-on-error: true` steps in `ci.yml` — CRITICAL

`.github/workflows/ci.yml` has 4 non-blocking steps:

| Step                                                  | Lines                     | Why non-blocking                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Security audit`                                      | `continue-on-error: true` | Audit endpoint proxy issue (`npmmirror.com` doesn't implement the audit API; `pnpm audit` returns `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS` locally). On CI this is a deliberate soft-pass. |
| `E2E launch diagnosis (non-blocking)`                 | `continue-on-error: true` | Diagnostic only — never intended to block (ADR-014).                                                                                                                                   |
| `E2E boot health (non-blocking — pending validation)` | `continue-on-error: true` | Promotion plan in the comment block: watch on 2-3 PRs, flip to blocking after 3 green runs. Blocked on ADR-014.                                                                        |
| `E2E tests`                                           | `continue-on-error: true` | Blocked on ADR-014.                                                                                                                                                                    |

**Fix path**: resolve ADR-014 first. Then watch boot health for 3 PRs;
flip; expand `KNOWN_RENDERER_NOISE` allowlist in `00-boot-health.test.ts`.

### 3.3 `tests/e2e/legacy/` — LOW

3 dead `.js` specs (see 2.1). Not executed by `playwright.config.ts`
(testDir is `./tests/e2e/suites/`). Candidate for `git rm`.

---

## Dimension 4 — Configuration debt

### 4.1 Root `.js` configs — MEDIUM (Tier 4.1 partial)

4 root `.js` config files remain:

| File                 | Why `.js`                                                                                                             | Migration effort                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `vitest.config.js`   | Vitest supports `.ts` natively. Currently `.js` with ESM `import` syntax — trivial conversion.                        | 5 min. Rename + add `// no-op` types if needed. |
| `postcss.config.js`  | PostCSS supports `.ts` via `ts-node` or native.                                                                       | 10 min.                                         |
| `tailwind.config.js` | Tailwind supports `.ts`.                                                                                              | 10 min.                                         |
| `cleanup.js`         | One-off script, uses `require("fs")` + `require("path")`. No reason to migrate — it's a 30-line script with no types. | **NOT DEBT** — leave as `.js`.                  |

`ts-migration-audit-and-evolution.md:260` Tier 4.1 is marked
"🟡 Partial" — `playwright.config.ts` done (PR #108), the rest deferred.

`scripts/ci-check.js` (95+ lines, blocking CI gate) is also `.js` — uses
`require()`. Migration deferred.

### 4.2 `eslint.config.mjs` rule concessions — MEDIUM

3 rules turned off globally in `eslint.config.mjs:30-41`:

| Rule                                       | Setting                                            | Justification                                                                                                                                                         | Debt?                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-unused-vars`                           | `"off"`                                            | Replaced by `@typescript-eslint/no-unused-vars` with `_`-prefix ignore patterns.                                                                                      | **NOT DEBT** — correct TS pattern.                                                                                                           |
| `@typescript-eslint/no-explicit-any`       | `"off"`                                            | Comment: _"concession for the renderer's HMR/browser-API casts"_. The 6 renderer `as any` sites are pinned to an allowlist enforced by `backend-type-safety.test.ts`. | **MEDIUM** — could be turned back on as `"warn"` for non-renderer files. Renderer would need `// eslint-disable-next-line` per site. 1 hour. |
| `@typescript-eslint/no-require-imports`    | `"off"` (global), `"error"` (`tests/unit/**` only) | Source files legitimately use lazy `require("electron")` inside try/catch.                                                                                            | **NOT DEBT** — Tier 3.3 deliberately scoped the rule to unit tests.                                                                          |
| `@typescript-eslint/no-unused-expressions` | `"off"`                                            | Not commented. Likely a pre-existing concession for some `foo && foo()` pattern.                                                                                      | **LOW** — investigate and re-enable.                                                                                                         |

### 4.3 `vitest.config.js` workarounds — NONE

`vitest.config.js` is clean. The `setupFiles: []` block has a comment
(`[20260726_Tier32_ShimDeleted]`) documenting that the
`_tsresolve.setup.js` shim was deleted and no monkey-patches remain.
The `coverage.exclude` list is documented pre-existing Electron-runtime
dependencies (see 2.6).

### 4.4 Deferred Tier items in audit doc — LOW

`docs/research/ts-migration-audit-and-evolution.md` Tier 4 status:

| Item                                    | Status                                                     |
| --------------------------------------- | ---------------------------------------------------------- |
| 4.1 Migrate root configs `.js`→`.ts`    | 🟡 Partial (see 4.1)                                       |
| 4.2 Adopt `@electron-toolkit/typed-ipc` | ⏸ Deferred — "ROI low given current `.d.ts` quality".      |
| 4.3 Extract `tests/e2e/` to TS          | ✅ Done (PRs #108, #109) — 4 helpers + 13 suites migrated. |

---

## Dimension 5 — Dependency debt

### 5.1 Dependabot remediation plan status — see `docs/research/dependabot-remediation-plan.md`

The plan triages 30 alerts into 6 distinct actions. Status per severity
bucket (no execution evidence in tree as of 2026-07-26):

| Priority | Action                                                                              | Alerts cleared           | Status                                                                                  |
| -------- | ----------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| **P0**   | `tar` → `^7.5.19`, `axios` → `^1.18.0`, `postcss` → `^8.5.18`, `setuptools` upgrade | 1 critical + ~8 high/med | **NOT YET DONE** — `package.json:138` still has `"tar": "^7.4.3"` (resolves to 7.5.15). |
| **P1**   | `Pillow` upgrade (after torch compat check)                                         | 12                       | Deferred pending torchvision compat verification.                                       |
| **P2**   | `electron-builder` → 25.x/26.x                                                      | 3                        | Deferred — needs full packaging smoke test.                                             |
| **P3**   | `astro` 5→7 (website)                                                               | 6                        | Own PR, separate QA cycle.                                                              |

### 5.2 `tar@7.5.15` critical CVE — HIGH

`package.json:138` declares `"tar": "^7.4.3"`; lockfile resolves to
`7.5.15` (3 advisories: 1 critical, 2 medium — all the same install).

**Chain** (from `pnpm why tar`):

```
murmur@1.0.2 (dependencies)        ← DIRECT
  └── tar@7.5.15                    ← CRITICAL
murmur@1.0.2 (devDependencies)
  └── node-gyp@11.4.2
    └── make-fetch-happen@14.0.3
      └── cacache@19.0.1
        └── tar@7.5.15              ← deduped
app-builder-lib@24.13.3 → tar@6.2.1 ← different major, NOT flagged
```

**Impact**: critical CVE in a **direct runtime dependency**. The plan
(§4.3) notes a caveat: verify whether `tar` is actually `require`d at
runtime.

**Verification**:

```
grep -rn "require('tar')\|from 'tar'" src/ main.ts preload.ts
```

returns **zero hits** — `tar` is declared but not directly imported in
source. The runtime exposure is via transitive use in `node-gyp`
(build-time) and `electron-builder` (build-time). The critical label may
overstate runtime risk, but the manifest bump is still the highest-ROI
fix on the board.

**Fix path**: edit `package.json:138` → `"tar": "^7.5.19"`, run `pnpm
install`. 5 min. Clears 3 alerts (1 critical + 2 medium).

### 5.3 `electron-builder@24.13.3` — MEDIUM (P2)

`package.json:88` declares `"electron-builder": "^24.6.4"`. Resolved
`24.13.3` is a 2024 release. 3 high advisories transit through it:

| Package                | Advisory                | Fix                                         |
| ---------------------- | ----------------------- | ------------------------------------------- |
| `app-builder-lib`      | `< 26.15.0` → `26.15.0` | Requires `electron-builder@26.x` major bump |
| `builder-util-runtime` | `< 9.7.0` → `9.7.0`     | Same                                        |
| `brace-expansion`      | `<= 5.0.7` → `5.0.8`    | Same (or independent minimatch bump)        |

**Impact**: build-time only. `electron-builder` runs during packaging,
not at app runtime.

**Fix path**: bump `electron-builder` to latest 26.x, run full
`electron-builder --mac/--win/--linux` smoke test. Medium risk per the
plan §5.4 — major-version bump of the packaging tool.

---

## Dimension 6 — Documentation debt

### 6.1 Stale `.js` references in docs/ADRs — MEDIUM

After Tier 1.5 the source `.js → .ts` refs were swept, but several
**test-infra** stale references remain:

#### ADR-014 references deleted/renamed files

`docs/adr/014-e2e-ci-macos-electron-launch-investigation.md`:

| Line | Stale reference                           | Actual file                                 |
| ---- | ----------------------------------------- | ------------------------------------------- |
| 15   | `at ../helpers/electron-launch.js:205`    | `electron-launch.ts` (migrated in Tier 4.3) |
| 157  | `tests/e2e/helpers/electron-launch.js`    | `.ts`                                       |
| 160  | `tests/e2e/suites/00-launch-only.test.js` | `.ts`                                       |
| 161  | `tests/e2e/suites/00-boot-health.test.js` | `.ts`                                       |

**Impact**: confusing for the eventual macOS debugger — they'll grep for
`.js` and not find the files.

**Fix path**: 4-line edit. 5 min.

#### ADR-013 + audit doc reference `backend-type-safety.test.js`

`backend-type-safety.test.js` was renamed to `.ts` during Tier 3.1.
References in:

- `docs/adr/013-managers-bag-cast-seam.md:27,47`
- `docs/research/ts-migration-audit-and-evolution.md:167,189,268,277,369,381,411`

**Impact**: low — the reader can find the file by stripping `.js`, but
the references are factually wrong post-migration.

**Fix path**: `sed -i '' 's/backend-type-safety\.test\.js/backend-type-safety.test.ts/g'`
across the 2 files. 5 min.

#### `_tsresolve.setup.js` historical narrative

`docs/research/ts-migration-audit-and-evolution.md:119,410` and
`docs/research/test-coverage-gap-analysis.md:13,116,254,321,346` and
`docs/research/murmur-architecture-map.md:7` describe the deleted shim
in the **present tense** ("is the single most important infra file").
The audit doc §5.0 row 3.2 confirms deletion, but the surrounding
narrative was never updated.

**Impact**: a new reader sees a 100-line explanation of a file that no
longer exists.

**Fix path**: either (a) add a "DELETED 2026-07-26 (Tier 3.2)" header to
each section, or (b) collapse the narrative to a one-paragraph
historical note. The audit doc itself is the plan-of-record and
intentionally preserved (§"Original backlog (preserved as
plan-of-record)"). Recommend approach (a).

#### `electron-launch.js` in deep-test-design-e2e.md

`docs/research/deep-test-design-e2e.md` has 9 `from
"../helpers/electron-launch.js"` import statements in code examples
(lines 61, 116, 274, 428, 577, 749, 898, 1055, ...). All should be
`.ts` post-Tier-4.3.

**Impact**: someone copy-pasting from this design doc will get a
"module not found" error.

**Fix path**: `sed -i '' 's/electron-launch\.js/electron-launch.ts/g'`.
5 min.

#### `comprehensive-test-strategy.md` tree diagrams

`docs/research/comprehensive-test-strategy.md:477-483,899-910` lists
helpers as `.js` and shows `_tsresolve.setup.js` as part of the test
tree. Same issue as above.

**Fix path**: update the tree diagrams. 15 min.

### 6.2 `package.json` stale `.js` refs — LOW

`package.json:37-38`:

```
"test:e2e:boot": "... tests/e2e/suites/00-boot-health.test.js",
"test:e2e:diag": "... tests/e2e/suites/00-launch-only.test.js ..."
```

Both files are now `.ts`. Playwright resolves them (the test runner
handles the extension), but the script text is wrong.

**Impact**: copy-pasting the path to `ls` or `grep` fails. Functional
no-op.

**Fix path**: edit 2 paths. 1 min.

### 6.3 ADR-010 historical narrative — NOT DEBT

`docs/adr/010-backend-ts-migration-strategy.md:39` mentions
`tests/_tsresolve.setup.js` as step 7 of the **original** plan. The ADR
is explicitly marked "Status: Superseded — big-bang migration completed
2026-07-24" and the section header reads "Decision (original —
superseded)". This is a historical record, not stale documentation.

### 6.4 ADRs 010-014 accuracy vs current state — generally accurate

| ADR | Accuracy                                      | Notes                                                                                                                   |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 010 | ✅ accurate as a superseded historical record | See 6.3                                                                                                                 |
| 011 | not relevant to migration                     |                                                                                                                         |
| 012 | "Status: Accepted — deferred to post-v1"      | Pre-migration limitations registry; no migration claims                                                                 |
| 013 | ✅ accurate                                   | The "Note on the preload ↔ d.ts drift detector" section correctly describes the current `skipLibCheck: true` limitation |
| 014 | ❌ stale file references                      | See 6.1                                                                                                                 |

### 6.5 Code-level debt markers (`TODO`/`FIXME`/`HACK`/`XXX`) — NONE

`grep -rnE "TODO|FIXME|HACK|XXX" src/ tests/ main.ts preload.ts` returns
only 2 hits, both in **comments** explaining why something was NOT a
TODO:

- `tests/unit/dynamicTranscriptionTimeout.test.ts:13`: _"no `any`, no TODO blocker"_
- `tests/unit/phase7-tier0-fixes.test.ts:16`: _"converting them is out of scope (deferred, see TODO in that test)"_

Zero active `TODO`/`FIXME`/`HACK` markers in code. This is unusually
clean.

---

## Dimension 7 — Type contract debt

### 7.1 `src/electronAPI.d.ts` — 16 `unknown` return types — LOW

The IPC contract surface in `src/electronAPI.d.ts` uses `unknown` for
heterogeneous shapes that span multiple concrete types:

| Line     | API                                                                    | Current type                          | Could be                                               |
| -------- | ---------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| 53       | `transcribeAudio` options                                              | `Record<string, unknown>`             | Define `TranscriptionOptions` interface                |
| 74       | `onModelDownloadProgress` callback arg 1                               | `unknown` (event-or-progress)         | Discriminated union                                    |
| 131-135  | `getSetting`/`setSetting`/`getAllSettings`/`getSettings`/`saveSetting` | `unknown` / `Record<string, unknown>` | Generic `<T>(key: SettingKey, default: T): Promise<T>` |
| 155, 171 | `exportTranscription`/`transcribeFile` options                         | `Record<string, unknown>`             | Define `ExportOptions`, `FileTranscriptionOptions`     |
| 185      | `getSystemInfo`                                                        | `Record<string, unknown>`             | Define `SystemInfo` interface                          |
| 213      | `log` data                                                             | `unknown`                             | `Record<string, unknown> \| Error \| string`           |
| 222      | `onProcessingUpdate` callback arg 1                                    | `unknown` (event-or-data)             | Discriminated union                                    |
| 226      | `onSettingsUpdate` callback                                            | `Record<string, unknown>`             | `Partial<Settings>` if Settings is defined             |

**Impact**: the renderer can call `window.electronAPI.getSetting("foo")`
and get back `unknown`; the consumer must narrow. This is correct for
truly dynamic APIs (settings store) but loses type-safety for typed
fields.

**Fix path**: introduce `SettingKey` literal union and
`SettingValueMap` interface; convert `getSetting` to a generic. The
renderer already has typed `Settings` somewhere — promote it. ~1 day.

**Why this is LOW not MEDIUM**: the existing `unknown` is **correct**
— it forces callers to narrow. The debt is "could be tighter", not
"is wrong".

### 7.2 Preload ↔ d.ts drift detector — comprehensive but one-sided

`preload.ts:46` declares `export const preloadApi: ElectronAPI = {...}`.
Any drift between the preload runtime literal and `electronAPI.d.ts`
fails `pnpm typecheck`.

**Comprehensiveness**: ✅ catches

- Missing preload API (d.ts declares it, preload doesn't implement)
- Wrong preload signature (parameter/return type mismatch)
- Extra preload API (would need a separate check, but unused —
  `backend-type-safety.test.ts` covers `.d.ts` internal errors)

**One-sided limitation**: see 1.6. The detector cannot catch d.ts
**internal** errors because `skipLibCheck: true` is required to
suppress the `@types/node` ↔ `electron.d.ts` `noDeprecation` conflict.

### 7.3 `asManagers<T>` cast seam — NOT DEBT (deliberate)

`src/helpers/ipc/index.ts:76` defines:

```ts
function asManagers<T>(bag: ManagersBag): T {
  return bag as unknown as T;
}
```

Called 9 times in `registerAll()` (lines 87-123) to route the loose
`ManagersBag = Record<string, unknown>` into each handler's typed bag.

**Why deliberate**: see ADR-013. The cast through `unknown` (not `any`)
is the maximum type-safety achievable without a per-handler typed
registry (which would "triple the surface area for no runtime change").
The seam is audited by `backend-type-safety.test.ts`.

**Downstream consequence** (ADR-013 §"Consequences"): IPC handler tests
that capture registered handlers via mocked `ipcMain` see
`result: unknown` return types — the source of the 7 excluded test
files in `tsconfig.test.json` (see 2.5).

---

## Recommended action plan (ordered by ROI)

### This week — clears 1 critical + 1 high

1. **`tar` manifest bump** (5 min, P0 from dependabot plan). Edit
   `package.json:138` `"tar": "^7.5.19"`. Clears the only critical CVE.
2. **Fix stale `.js` refs in ADR-014 + ADR-013 + audit doc** (15 min).
   See 6.1 — `sed` sweep across 3 files.
3. **`git rm tests/e2e/legacy/`** (5 min). 3 dead spec files not run by
   any script.
4. **Update `package.json` `test:e2e:diag`/`test:e2e:boot` paths**
   (1 min). See 6.2.

### Next sprint — clears 1 high + medium polish

5. **Type the 7 excluded unit tests** (~2 days). Lifts the
   `tsconfig.test.json` exclusion (2.5). Pattern proven in batch-5.
   Highest-value debt remaining: IPC contract completeness and
   database-error-path tests regain typecheck coverage.
6. **Bump `axios` and `postcss`** (10 min). P0 from dependabot plan,
   clears 5 more advisories.
7. **`database.ts` typed row helpers** (~2 hours). Eliminates 10 of
   the 34 structural casts in one move (1.1).
8. **Migrate `vitest.config.js`/`postcss.config.js`/`tailwind.config.js`
   to `.ts`** (~30 min). Closes Tier 4.1.

### Separate initiatives — higher effort

9. **Resolve ADR-014** (unknown effort, needs human + Mac access).
   Unblocks promotion of the e2e boot health gate from non-blocking.
   This is the single highest-impact item but cannot be LLM-driven
   (per ADR-014 §"Decision").
10. **`electron-builder` major bump to 26.x** (1 day smoke test). P2
    from dependabot plan, clears 3 high advisories.
11. **Tighten `electronAPI.d.ts` return types** (~1 day). Convert
    `getSetting` to generic, define `SystemInfo`/`TranscriptionOptions`
    interfaces (7.1).
12. **`Pillow` upgrade** (after torchvision compat check). P1 from
    dependabot plan, clears 12 advisories.
13. **Flip `skipLibCheck: false` for `src/**/\*.d.ts`only** (~1-2 days
to triage the`@types/node`↔`electron.d.ts` conflicts, ADR-013).
    Closes the one-sided drift detector gap (1.6).

---

## What is NOT debt (deliberate decisions)

These items look like debt but are audited, documented, deliberate. Do
not "fix" them without reading the cited ADR first.

### 1. Lazy `require("electron")` in source (14 sites)

ADR-010 §"Export strategy". Top-level `import { app } from "electron"`
breaks unit tests because electron is absent. The `try { require(...)
} catch` pattern is the Electron-backend standard. Tier 3.3 deliberately
scoped `no-require-imports: error` to `tests/unit/**` only.

### 2. `asManagers<T>` cast through `unknown` (`src/helpers/ipc/index.ts:76`)

ADR-013. The maximum type-safety achievable without a per-handler typed
registry. Audited by `backend-type-safety.test.ts`. The cast through
`unknown` (not `any`) is the deliberate choice — it satisfies the
no-`any` guard while letting structural compatibility flow at runtime.

### 3. `skipLibCheck: true`

ADR-013 §"Note on the preload ↔ d.ts drift detector". Required to
suppress the `noDeprecation` modifier conflict between `@types/node` and
`electron.d.ts`. The detector is one-sided by design until a scoped
`--skipLibCheck false` over `src/**/*.d.ts` is added (initiative 13
above).

### 4. 6 renderer `as any` sites (allowlisted)

`tests/unit/backend-type-safety.test.ts:90-117`. Vite HMR
(`import.meta.hot`), Chrome-only `performance.memory`, Safari-only
`webkitAudioContext`, and `modelStatus as any` (a prop-narrowing gap
that has a `// allowlist` comment). Each is the minimum-cast escape
hatch for a browser-API typing gap. Adding a 7th fails CI.

### 5. `tests/e2e/helpers/ci-probe.js`

Loaded via Electron's `--require` flag BEFORE any TS transform runs.
Must be plain CJS by construction. ADR-014 documents this.

### 6. `tests/e2e/helpers/electron-launch.ts` using `require()`/`module.exports`

File header comment (lines 12-24): Playwright 1.60 + Node 24 hit
"exports is not defined in ES module scope" (microsoft/playwright #37890)
when a CJS `.js` suite imports an ESM-compiled `.ts` helper. The helper
is deliberately kept CJS-compiled to preserve runtime parity with the
pre-migration state. This is locked behind the Tier 4.3 deferral.

### 7. ADR-010's "Decision (original — superseded)" section

Historical record of the failed gradual-migration attempt. Marked
superseded. Do not rewrite — the failure analysis is load-bearing for
ADR-010's "Why gradual migration failed" section.

### 8. `backend-type-safety.test.js` references in docs

The file was renamed to `.ts` during Tier 3.1. The references in the
audit doc are in the **historical narrative** sections (§2.3, §5.0
table). They are factually stale (see 6.1) but the surrounding text is
the plan-of-record. A `sed` sweep is the right fix; do not rewrite the
narrative.

### 9. `cleanup.js` and `scripts/ci-check.js` remaining `.js`

Both are plain Node scripts using `require()`. No types, no benefit
from migration. Tier 4.1 explicitly deferred these.

### 10. `tests/e2e/legacy/*.test.js` is "dead" not "deferred"

These 3 specs predate the e2e suite redesign. They are not in the
active `playwright.config.ts` testDir. They are not "deferred Tier 4.3
work" — they are candidates for deletion (see 2.1).

---

## Methodology and verification

All findings verified against the current tree state as of
2026-07-26 22:11 PT. Verification commands:

```bash
# Source casts
grep -rE "as unknown as|as Record|as \{" src/ main.ts preload.ts | wc -l   # → 34

# Source any
grep -rnE "// @ts-ignore|// @ts-expect-error|as any|: any" src/ main.ts preload.ts   # → 6 (allowlisted)

# Test .js files
find tests -name "*.js"                                                    # → 4 (3 legacy + 1 ci-probe)

# Test typecheck gate
pnpm typecheck:tests                                                      # → passes clean

# E2E suites
ls tests/e2e/suites/*.ts | wc -l                                          # → 13
ls tests/e2e/suites/*.js                                                  # → 0

# Critical vuln chain
pnpm why tar                                                              # → see 5.2

# Documentation drift
grep -rlE "_tsresolve\.setup\.js|backend-type-safety\.test\.js|electron-launch\.js" docs/   # → 5 files
```

For items marked NOT DEBT, the cited ADR is the primary source. For
items marked debt, the file:line citations are load-bearing and were
verified to exist as quoted.
