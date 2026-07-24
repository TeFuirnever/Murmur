# Murmur Test Coverage Gap Analysis

**Audit date:** 2026-07-24
**Context:** Post JS→TS migration (ADR-010 "TS BigBang"). Preparing a comprehensive test strategy.
**Scope:** `src/helpers/`, `src/utils/`, `src/engines/`, `src/bootstrap/`, `src/i18n/`, root `main.ts`/`preload.ts`, and the IPC layer under `src/helpers/ipc/`.

---

## 1. Executive Summary

The unit-test suite is **large and green** (65 files, 674 tests, all passing in ~1.9s) but the **coverage is narrow in depth**: `vitest.config.js` excludes 12 helper modules and the entire `src/helpers/ipc/` directory from coverage, so the headline 96.83% statement figure applies only to a small set of pure modules. The **E2E suite is entirely broken** — every one of its 39 tests times out at `app.firstWindow()` (30s), so no end-to-end user journey is actually validated. The **branch coverage threshold (88%) is failing** at 75.19%, and function coverage (94.54%) is failing the 95% gate.

The migration introduced a fragile shared shim (`tests/_tsresolve.setup.js`) that monkey-patches Node's module system so `.js` test files can `require()` `.ts` source. This works but couples every test to an esbuild CJS transform and makes "is this test real or source-string-matching?" hard to answer — a significant fraction of tests assert against file contents (`fs.readFileSync` + `toMatch`) rather than behavior.

### Headline numbers

| Metric                         | Value          | Threshold | Status                 |
| ------------------------------ | -------------- | --------- | ---------------------- |
| Unit test files                | 65             | —         | —                      |
| Unit test cases                | 674 (all pass) | —         | —                      |
| Statements                     | 96.83%         | 94%       | PASS                   |
| Branches                       | 75.19%         | 88%       | **FAIL**               |
| Functions                      | 94.54%         | 95%       | **FAIL**               |
| Lines                          | 96.95%         | 94%       | PASS                   |
| E2E tests                      | 39 (11 files)  | —         | **ALL FAIL** (timeout) |
| `pnpm test:coverage` exit code | 1              | 0         | **FAIL**               |

---

## 2. Source File Inventory & Coverage Status

Coverage scope (per `vitest.config.js`): only `src/helpers/**`, `src/utils/**`, `src/bootstrap/**` are measured. **Everything else (main.ts, preload.ts, hooks, components, settings, types, i18n) is excluded from coverage entirely**, though some have unit tests.

### 2.1 Files IN coverage scope (`src/helpers`, `src/utils`, `src/bootstrap`)

| File                                 | Status           | Behavioral tests?                                                             | Notes                                                                                                         |
| ------------------------------------ | ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/helpers/ipc-contracts.ts`       | Fully tested     | Yes (`ipc-contracts.test.js`, `ipc-contracts-orphans.test.js`)                | 100% — the registry itself is well covered.                                                                   |
| `src/helpers/aiPrompts.ts`           | Partially tested | Yes (`aiPrompts.test.js`, `aiPrompts-few-shot.test.js`)                       | 95.65% stmts / 78.57% branches. Line 72 uncovered.                                                            |
| `src/helpers/audioFileHelpers.ts`    | Partially tested | Yes (`audioFileHelpers.test.js`)                                              | 100% stmts but 91.66% funcs; lines 32-40, 107-110, 157 uncovered.                                             |
| `src/helpers/audioPathValidator.ts`  | Partially tested | Indirect (via transcription handlers — which have **no** unit test)           | 90% stmts / 75% branches. Line 31 uncovered.                                                                  |
| `src/helpers/database.ts`            | Partially tested | Yes (`database.test.js`, `database-coverage.test.js`, `database-fts.test.js`) | 93.37% stmts / **67.18% branches** — the weakest branch coverage in-scope. Lines 346-347, 357, 458 uncovered. |
| `src/helpers/detectLocalModels.ts`   | Fully tested     | Yes (`detectLocalModels.test.js`)                                             | 100% stmts / 83.33% branches (line 43).                                                                       |
| `src/helpers/exportFormatters.ts`    | Fully tested     | Yes (`export-formatters.test.js`, `export-formatters-coverage.test.js`)       | 99.25% stmts / 75% branches (line 350).                                                                       |
| `src/helpers/fileConfig.ts`          | Partially tested | Yes (`fileConfig.test.js`)                                                    | 100% stmts / **63.63% branches** (lines 27-49).                                                               |
| `src/helpers/ipcRateLimiter.ts`      | Partially tested | Yes (`ipcRateLimiter.test.js`, `ipcRateLimitIntegration.test.js`)             | 92.85% stmts / **50% functions** (line 29).                                                                   |
| `src/helpers/providerPresets.ts`     | Partially tested | Yes (`providerPresets.test.js`)                                               | **50% stmts / 33.33% funcs** (line 139) — well below threshold.                                               |
| `src/helpers/serverMessageRouter.ts` | Fully tested     | Yes (`server-message-router.test.js`, `-coverage.test.js`)                    | 97.77% stmts / 80.95% branches.                                                                               |
| `src/helpers/engines/asrEngine.ts`   | Fully tested     | Yes (`engines/asrEngine.test.js`)                                             | 100% stmts / 77.77% branches (lines 44-58, 84).                                                               |
| `src/utils/process.ts`               | Fully tested     | Yes (`process.test.js`)                                                       | 100% stmts / 82.35% branches (lines 50-70, 86).                                                               |
| `src/bootstrap/assertElectronAPI.ts` | Fully tested     | Yes (`assert-electron-api.test.js`)                                           | 100% stmts / 83.33% branches (line 9).                                                                        |

### 2.2 Files EXPLICITLY EXCLUDED from coverage (Electron-runtime dependent)

These 12 files are listed in `vitest.config.js` `coverage.exclude` with the comment _"Electron-dependent… cannot be unit-tested"_. This is **the single biggest coverage blind spot**: ~3,800 lines of critical business logic (FunASR orchestration, Python environment, model downloads, update pipeline, window/tray/hotkey management) are excluded from measurement entirely.

| File                               | LOC    | Behavioral test exists? | Test quality                                                                                                                                                                                                                                          |
| ---------------------------------- | ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/helpers/clipboard.ts`         | ~380   | **No**                  | Zero behavioral tests (excluded from coverage AND no test file).                                                                                                                                                                                      |
| `src/helpers/environment.ts`       | ~200   | **No**                  | Referenced by 2 test files but only for module-resolution/static-import audits — not behavior.                                                                                                                                                        |
| `src/helpers/tray.ts`              | ~120   | **No**                  | Zero behavioral tests.                                                                                                                                                                                                                                |
| `src/helpers/hotkeyManager.ts`     | ~160   | **No**                  | Zero behavioral tests — despite `hotkeyHandlers` having many IPC channels.                                                                                                                                                                            |
| `src/helpers/pythonEnvironment.ts` | ~360   | **No**                  | Referenced by 1 test file (module resolution only).                                                                                                                                                                                                   |
| `src/helpers/pythonInstaller.ts`   | ~370   | **No**                  | Zero behavioral tests.                                                                                                                                                                                                                                |
| `src/helpers/funasrManager.ts`     | ~280   | **Yes**                 | `funasrManager-init-race.test.js` (behavioral, good), `asrEngine.test.js` (shape check).                                                                                                                                                              |
| `src/helpers/funasrServer.ts`      | ~480   | **Yes**                 | `funasrServer-crash-restart.test.js` (behavioral, 5 tests).                                                                                                                                                                                           |
| `src/helpers/modelManager.ts`      | ~360   | **Yes**                 | `modelManager-shape.test.js` (behavioral, 3 tests), `model-download-guards.test.js`.                                                                                                                                                                  |
| `src/helpers/updateManager.ts`     | ~310   | **No**                  | Only `updateManager-require-resolution.test.js` (source-string checks) and `phase3-semi-auto-update.test.js` (source-string regex). **No behavioral tests** of `semverGt`, `verifySHA256`, `parseChecksums`, or the download/cancel/install handlers. |
| `src/helpers/windowManager.ts`     | ~240   | **Yes**                 | `windowManager-events.test.js` (behavioral with mocked electron, good), `windowHandlers.test.js`.                                                                                                                                                     |
| `src/helpers/logManager.ts`        | ~170   | **Yes**                 | `logManager.test.js` (9 tests, behavioral), `phase0-security.test.js`.                                                                                                                                                                                |
| `src/helpers/ipc/**` (10 files)    | ~1,200 | **Partial**             | Excluded from coverage. See §4.                                                                                                                                                                                                                       |

### 2.3 Root entry points — NOT in coverage scope

| File         | Behavioral test? | Notes                                                                                                                                                                                                                                                                                                        |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.ts`    | **No**           | Only `main-process-module-resolution.test.js` (source-string). The `setupProductionPath()`, `startApp()`, `will-quit` shutdown sequence, and manager wiring are untested.                                                                                                                                    |
| `preload.ts` | **No**           | `preload-loadable.test.js` and `preload-listener-lifecycle.test.js` are source-string regex checks against `preload.ts` text — they do not execute the preload bridge. No test verifies `contextBridge.exposeInMainWorld` actually exposes the full API surface (the e2e tests that would do this all fail). |

### 2.4 Untested-by-coverage but out-of-scope directories

`src/hooks/`, `src/components/`, `src/settings/`, `src/types/`, `src/i18n/`, `src/App.tsx`, `src/history.tsx` are excluded from coverage. Component tests exist for 9 components under `tests/unit/components/` but hooks (`useRecording`, `useHotkey`, `useModelStatus`, `useFileTranscription`, `useWindowDrag`) have **no tests** except `usePermissions.test.js`. `i18n/index.ts` has only a phase test (`phase4-i18n.test.js`) that checks locale files exist, not runtime behavior.

---

## 3. Existing Test File Analysis

### 3.1 Unit tests (`tests/unit/`, 65 files)

Grouped by what they test and quality:

#### A. Behavioral, well-written (the gold standard)

- `database.test.js` (14 tests) — real better-sqlite3 on tmp dir, exercises CRUD/search/settings/backup. Clean seams.
- `database-coverage.test.js` (31 tests), `database-fts.test.js` (8 tests) — extended DB coverage.
- `aiHandlers.test.js` (19 tests) — mocks `fetch` + db, exercises `processTextWithAI`/`checkAIStatus` including HTTP 401/429/500, empty choices, unsafe URLs. Good error-path coverage.
- `engines/asrEngine.test.js` (16 tests) — registry/validator contract tests, well-structured.
- `funasrServer-crash-restart.test.js` (5 tests), `funasrManager-init-race.test.js` (1 test, but meaningful) — behavioral with stubbed child_process.
- `server-message-router.test.js` (6) + `-coverage.test.js` (18) — process IPC protocol, behavioral.
- `windowManager-events.test.js` — real module execution with mocked electron via `createRequire` + `Module._resolveFilename` patch.
- `providerPresets.test.js` (22), `detectLocalModels.test.js` (8), `audioFileHelpers.test.js`, `export-formatters*.test.js`, `fileConfig.test.js`, `modelManager-shape.test.js`, `model-download-guards.test.js`, `ipcRateLimiter*.test.js`, `windowHandlers.test.js`, `settingsHandlers.test.js`, `modelHandlers.test.js`, `environmentHandlers.test.js`, `logManager.test.js` — behavioral handler/unit tests.

#### B. Source-string / structural tests (weak — assert on file text, not behavior)

These read source files with `fs.readFileSync` and assert regex matches. They catch regressions in _what symbols exist_ but provide **zero behavioral confidence** and are tautological against the migration's own goals:

- `phase3-semi-auto-update.test.js` (22 tests) — every test is `expect(content).toMatch(/.../)`. Does NOT test `semverGt`, `verifySHA256`, or download flow.
- `phase2-type-safety.test.js` (19), `phase1-ci-config.test.js` (16), `phase0-security.test.js` (25), `phase4-i18n.test.js` (17), `phase5-a11y.test.js` (10), `phase6-e2e-infra.test.js` (13), `phase7-tier0-fixes.test.js`, `windows-compat.test.js` (8), `static-import-audit.test.js`, `jsx-extension-guard.test.js`, `backend-type-safety.test.js`, `main-process-module-resolution.test.js`, `updateManager-require-resolution.test.js`, `preload-loadable.test.js`, `preload-listener-lifecycle.test.js`, `assert-electron-api.test.js`, `systemHandlers-channels.test.js`, `settings-refactor.test.js`, `regression-session-fixes.test.js` (large, 21KB), `edge-cases.test.js`, `determineProcessingMode.test.js`, `dynamicTranscriptionTimeout.test.js`, `ci-config.test.js`, `smoke.test.js`.

  **Quality issue:** A large fraction of the 674-test count comes from these structural/regex tests. They inflate the pass count without exercising runtime behavior. The "phaseN-" prefix pattern suggests they were migration-milestone gate tests rather than durable regression suites.

#### C. Quality issues observed

1. **Tautological source-matching** (see B above) — the dominant anti-pattern.
2. **Un-awaited rejection assertions** — `server-message-router*.test.js` logs Vitest warnings: _"Promise returned by `expect(actual).rejects.toThrow(expected)` was not awaited… will cause the test to fail in the next Vitest major."_ (lines 91, 97, 120). Forward-compat debt.
3. **`.js` test files requiring `.ts` via monkey-patched resolver** — all `require("../../src/...")` calls depend on `tests/_tsresolve.setup.js`. This hides type errors (tests run against esbuild-stripped CJS, not type-checked TS).
4. **Component tests are `.tsx` but most unit tests remain `.js`** — inconsistent; the JS→TS migration did not extend to test files.

### 3.2 E2E tests (`tests/e2e/`)

#### Suite inventory (`tests/e2e/suites/`, 11 files, 39 tests)

| Suite                       | Tests | Journey                                                                                   | Status   |
| --------------------------- | ----- | ----------------------------------------------------------------------------------------- | -------- |
| `00-ftue.test.js`           | 3     | First-time UX (download prompt, disabled mic, onboarding)                                 | **FAIL** |
| `01-lifecycle.test.js`      | 5     | Launch, electronAPI exposure, mic button, version, settings route                         | **FAIL** |
| `02-model-download.test.js` | 4     | need_download → ready → download failure → status shape                                   | **FAIL** |
| `03-recording.test.js`      | 6     | Start/stop recording, transcription mock, AI optimize, AI failure, blocked-when-not-ready | **FAIL** |
| `04-hotkey.test.js`         | 3     | Hotkey display, IPC toggle trigger, registration                                          | **FAIL** |
| `05-file-import.test.js`    | 3     | Drop zone, validate supported/unsupported file                                            | **FAIL** |
| `06-clipboard.test.js`      | 3     | Write/read clipboard, auto-paste setting, pasteText IPC                                   | **FAIL** |
| `07-settings.test.js`       | 4     | Set/get, getAllSettings, provider presets, export/import roundtrip                        | **FAIL** |
| `08-history.test.js`        | 3     | getTranscriptions, search, delete                                                         | **FAIL** |
| `09-window.test.js`         | 3     | Minimize, maximize/restore, always-on-top                                                 | **FAIL** |
| `10-errors.test.js`         | 2     | AI service error, invalid save                                                            | **FAIL** |

Plus `tests/e2e/legacy/` (3 files: `ipc.test.js`, `launch.test.js`, `settings.test.js`) — superseded by the suites, also failing.

#### Critical E2E finding

**ALL 39 E2E tests fail at `app.firstWindow()` with a 30s timeout.** The `global-setup.js` builds the bundles, but Electron never opens a window. Symptoms point to the app crashing or hanging during `startApp()` in `main.ts` (FunASR init, window creation, tray setup). Because every suite's first test fails, all subsequent tests in each `describe` are skipped (`-`).

**Implication:** There is currently **zero validated end-to-end coverage** of any user journey. The e2e suites are well-designed (good test names, IPC mocking via `tests/e2e/helpers/ipc-mock.js`, in-memory DB via `MURMUR_DB_PATH=:memory:`, MediaRecorder mock) but non-functional.

#### E2E seam quality (when they run)

- `electron-launch.js` — launches via `.` (package.json main) so `getAppPath()` is correct. Good.
- `ipc-mock.js` — removes + re-registers handlers in main process via `electronApp.evaluate`. Clean approach for Electron 20+ single-handler limit.
- `fixtures.js` — shared data constants (transcription/AI/model/history/settings responses). Good but only used implicitly; not a true fixture injection framework.

---

## 4. Untested IPC Channels

`src/helpers/ipc-contracts.ts` defines **80 channels** across 11 groups (FUNASR, MODELS, TRANSCRIPTION, AI, SETTINGS, WINDOW, HOTKEY, CLIPBOARD, UPDATE, SYSTEM, EVENTS) plus `AUDIO_EXTENSIONS`.

### 4.1 Handler registration → unit-test coverage map

| Handler file                         | Channels registered                                                                                                                                               | Unit test file?                   | Coverage                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ipc/aiHandlers.ts`                  | AI.PROCESS, AI.CHECK_STATUS, AI.GET_MODES, AI.GET_PROVIDER_PRESETS, AI.DETECT_LOCAL_MODELS                                                                        | `aiHandlers.test.js`              | **Good** — register + behavioral for all 5.                                                                                                                                                                 |
| `ipc/settingsHandlers.ts`            | SETTINGS.GET/SET/GET_ALL/GET_LEGACY/SAVE/RESET/IMPORT/EXPORT                                                                                                      | `settingsHandlers.test.js`        | Partial — registration asserted; IMPORT/EXPORT only channel-name-checked.                                                                                                                                   |
| `ipc/windowHandlers.ts`              | WINDOW.HIDE/SHOW/MINIMIZE/MAXIMIZE/IS_MAX/CLOSE/SET_TOP/OPEN_HISTORY/CLOSE_HISTORY/HIDE_HISTORY/OPEN_SETTINGS/CLOSE_SETTINGS/HIDE_SETTINGS/CLOSE_APP              | `windowHandlers.test.js`          | Partial — core channels tested; history/settings window channels untested.                                                                                                                                  |
| `ipc/modelHandlers.ts`               | MODELS.CHECK/PROGRESS/DOWNLOAD/DOWNLOAD_MODEL/AVAILABLE/CURRENT/SWITCH                                                                                            | `modelHandlers.test.js`           | Partial — registration + some behavior.                                                                                                                                                                     |
| `ipc/environmentHandlers.ts`         | FUNASR.STATUS/INSTALL/RESTART                                                                                                                                     | `environmentHandlers.test.js`     | Minimal (2 tests). INSTALL progress event + RESTART untested behaviorally.                                                                                                                                  |
| `ipc/systemHandlers.ts`              | SYSTEM.OPEN_EXTERNAL/INFO/PERMISSIONS/REQUEST_PERMS/TEST_A11Y/OPEN_PERMS/VERSION/LOG/DEBUG_INFO + WINDOW.OPEN_DEV_TOOLS/RELOAD (dev-only)                         | `systemHandlers-channels.test.js` | Minimal (1 test) — channel-name check only. DEBUG_INFO (large aggregation) untested.                                                                                                                        |
| `ipc/hotkeyHandlers.ts`              | HOTKEY.REGISTER/UNREGISTER/GET_CURRENT/REGISTER_F2/UNREGISTER_F2/SET_STATE/GET_STATE                                                                              | **NONE**                          | **Zero unit tests.** F2 double-click logic, hotkey-triggered event relay untested.                                                                                                                          |
| `ipc/clipboardHandlers.ts`           | CLIPBOARD.COPY/PASTE/READ/WRITE                                                                                                                                   | **NONE**                          | **Zero unit tests.** Paste-via-AppleScript/keystroke logic untested.                                                                                                                                        |
| `ipc/transcriptionHandlers.ts`       | TRANSCRIPTION.AUDIO/IMPORT_FILE/VALIDATE_FILE/TRANSCRIBE_FILE/CANCEL/DIARIZE/EXPORT/AI_REVIEW/SAVE/GET/GET_ALL/DELETE/SEARCH/STATS/CLEAR/EXPORT_ALL (16 channels) | **NONE**                          | **Zero unit tests.** The largest handler file (~420 lines) with the most error paths (file validation, 500MB limit, diarize segment parsing, export dialog, AI review) is completely untested behaviorally. |
| `updateManager.ts` (acts as handler) | UPDATE.CHECK/DOWNLOAD/CANCEL/INSTALL                                                                                                                              | source-string only                | **Zero behavioral tests.** SHA256 verify, checksum parse, cancel-during-download, install path-escape guard all untested.                                                                                   |

### 4.2 Channels with NO behavioral test (unit or e2e)

- **All 16 TRANSCRIPTION.\*** channels (no handler unit test; e2e fails).
- **All 7 HOTKEY.\*** channels.
- **All 4 CLIPBOARD.\*** channels.
- **All 4 UPDATE.\*** channels.
- FUNASR.INSTALL, FUNASR.RESTART.
- SYSTEM.DEBUG_INFO, SYSTEM.REQUEST_PERMS, SYSTEM.TEST_A11Y, SYSTEM.OPEN_PERMS, SYSTEM.OPEN_EXTERNAL.
- WINDOW.OPEN_HISTORY/CLOSE_HISTORY/HIDE_HISTORY/OPEN_SETTINGS/CLOSE_SETTINGS/HIDE_SETTINGS/CLOSE_APP/RELOAD/OPEN_DEV_TOOLS.

**Estimate: ~35 of 80 channels lack any behavioral assertion.**

---

## 5. Untested Error Paths

### 5.1 Python/FunASR unavailable

- `funasrManager.initializeAtStartup()` catches and warns (main.ts:192-194) — **untested**.
- `funasrManager.checkStatus()` returns structured error for "FunASR未安装" / "模型文件未下载" — **untested behaviorally** (only init-race is tested).
- `funasrServer` crash/restart IS tested (`funasrServer-crash-restart.test.js`).
- `pythonEnvironment.findPythonExecutable()` failure, `pythonInstaller` download/extract failure — **untested**.

### 5.2 better-sqlite3 fails

- `database.ts` backup failure returns `false` — partially tested (`database.test.js` "returns true or handles backup").
- DB corruption, locked DB (busy_timeout), migration failure — **untested**.
- `databaseManager.close()` error during `will-quit` (main.ts:253-257) — **untested**.

### 5.3 AI API unreachable

- `processTextWithAI` network errors (ENOTFOUND, ECONNREFUSED, timeout/AbortError) — **partially tested** via HTTP 401/429/500 but the fetch-throw branches (lines 259-270) and the catch-block error mapping (ECONNABORTED/ENOTFOUND) are **not exercised** (coverage shows aiHandlers excluded from report, but the test file does cover some).
- `checkAIStatus` timeout (15s AbortController) — **untested**.
- Localhost/private-network URL validation edge cases — partially tested.

### 5.4 Disk full

- `transcriptionHandlers.ts` `fs.writeFileSync` / `fs.promises.writeFile` during export — **untested** (no handler test at all).
- `updateManager.ts` download `fs.createWriteStream` / `fs.unlinkSync` — **untested**.
- Log file write failure (`logManager.ts` `appendFileSync`) — **untested**.
- Model download to cache path write failure — **untested**.

### 5.5 Corrupt audio file

- `audioPathValidator.ts` extension check tested indirectly; but malformed/corrupt audio passed to `funasrManager.transcribeFile` — **untested**.
- `transcriptionHandlers.VALIDATE_FILE` 500MB limit, missing-file branch — **untested** (no handler test).
- FunASR returning empty/transcription failure — e2e mock exists but e2e fails to run.

### 5.6 Other untested error paths

- `updateManager.INSTALL` path-escape guard (`resolved.startsWith(tmpDir)`) — **untested** (security-critical).
- `updateManager.DOWNLOAD` SHA256 mismatch — **untested**.
- `aiHandlers` template cache TTL expiry — **untested**.
- `ipcRateLimiter` rejection path — partially tested but 50% function coverage.
- `main.ts` `uncaughtException` (EPIPE handling) and `unhandledRejection` — **untested**.
- `main.ts` `will-quit` 5s shutdown timeout race — **untested**.

---

## 6. Critical User Journeys Needing E2E Coverage

Mapped against the 8 requested journeys and current status:

| #   | Journey                                                         | E2E suite                    | Actual status                                                                                                                        |
| --- | --------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | App launch → window visible → preload bridge                    | `01-lifecycle`               | Suite exists but **FAILS** at launch. electronAPI method exposure unverified.                                                        |
| 2   | Hotkey → recording → audio capture → transcription → paste      | `03-recording` + `04-hotkey` | **FAILS.** Real audio capture never tested (MediaRecorder mock returns silence). Full hotkey→paste chain never validated end-to-end. |
| 3   | File import → validation → transcription → AI optimize → export | `05-file-import` (partial)   | **FAILS.** No suite covers the full chain. Export, AI review, diarize have **no e2e**.                                               |
| 4   | Settings → AI config → API key test → model selection           | `07-settings` (partial)      | **FAILS.** API key test (checkAIStatus) and model selection not in any suite.                                                        |
| 5   | Model download → progress → completion → ASR ready              | `02-model-download`          | **FAILS.** Progress events, completion→ready transition unvalidated.                                                                 |
| 6   | History → search → delete → export                              | `08-history` (partial)       | **FAILS.** Export and stats not covered.                                                                                             |
| 7   | Tray → show/hide window → quit                                  | none                         | **No e2e suite.** Tray entirely untested.                                                                                            |
| 8   | Update check → download → install                               | none                         | **No e2e suite.** Update flow entirely untested behaviorally.                                                                        |

**Gaps beyond the 8:** diarization, F2 hotkey double-click, multi-window (history/settings windows) lifecycle, close_behavior (hide vs quit), accessibility permission flow, FunASR install flow.

---

## 7. Test Infrastructure Gaps

| Need                      | Present?                     | Notes                                                                                                                                                                                |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared test setup file    | Partial                      | `tests/_tsresolve.setup.js` is a **migration shim** (monkey-patches Node module resolution), not a fixtures/helpers setup. No shared `beforeEach`/`afterEach` for test DBs or mocks. |
| Shared mock factories     | **No**                       | Each test hand-rolls its own `ipcMain`/`db`/`logger`/`fetch` mocks. `aiHandlers.test.js`'s `setupDb()`/`mockFetch()` are local — not extracted.                                      |
| Test database helper      | **No**                       | `database.test.js` creates a tmp dir inline in `beforeEach`. No reusable `createTestDb()` / `seedTranscriptions()` factory.                                                          |
| Test audio file generator | **No**                       | No fixture produces a valid `.wav`/`.mp3`. File-import and transcription tests rely on IPC mocks, never real audio bytes.                                                            |
| Shared fixtures           | Partial                      | `tests/e2e/helpers/fixtures.js` has response constants but is e2e-only and unused by unit tests.                                                                                     |
| IPC mock helper           | Yes (e2e only)               | `tests/e2e/helpers/ipc-mock.js` is good but main-process-only; no unit-test equivalent for handler-level testing.                                                                    |
| Component test setup      | Missing                      | No `setup.ts` with `@testing-library/jest-dom` registration visible in vitest config (tests import it per-file).                                                                     |
| Coverage HTML report      | Configured but not generated | `reporter: ["text", "text-summary"]` — no HTML/JSON output for drill-down.                                                                                                           |
| Type-checking in tests    | **No**                       | Tests are `.js` run via esbuild CJS transform; TypeScript type errors in source are invisible to the test runner.                                                                    |

---

## 8. Coverage Report Analysis (from `pnpm test:coverage`)

### 8.1 Modules below 80% branch coverage (in-scope)

| Module                           | % Branch   | % Funcs    | Issue                                                                                           |
| -------------------------------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `database.ts`                    | **67.18%** | 96.42%     | Weakest. Lines 346-347, 357, 458 — likely error/edge branches in backup, FTS, or settings sync. |
| `fileConfig.ts`                  | **63.63%** | 100%       | Lines 27-49 — config migration/fallback branches.                                               |
| `providerPresets.ts`             | 100%       | **33.33%** | Line 139 — an entire function family untested (only 50% stmts).                                 |
| `ipcRateLimiter.ts`              | 88.88%     | **50%**    | Line 29 — one of two exported functions never called.                                           |
| `exportFormatters.ts`            | 75%        | 100%       | Line 350.                                                                                       |
| `audioPathValidator.ts`          | 75%        | 100%       | Line 31.                                                                                        |
| `audioFileHelpers.ts`            | 86.84%     | 91.66%     | Lines 32-40, 107-110, 157.                                                                      |
| `aiPrompts.ts`                   | 78.57%     | 100%       | Line 72.                                                                                        |
| `asrEngine.ts`                   | 77.77%     | 100%       | Lines 44-58, 84.                                                                                |
| `bootstrap/assertElectronAPI.ts` | 83.33%     | 100%       | Line 9 (the `typeof document` branch).                                                          |

### 8.2 Modules at 0% coverage (excluded but critical)

All 12 Electron-dependent helpers + all 10 IPC handler files (`src/helpers/ipc/**`) are excluded and report nothing. This is ~3,800 + ~1,200 = **~5,000 lines of business logic with no coverage measurement**, including: `transcriptionHandlers.ts` (largest handler), `updateManager.ts` (security-critical), `funasrManager.ts`, `pythonEnvironment.ts`, `pythonInstaller.ts`, `clipboard.ts`, `hotkeyManager.ts`, `tray.ts`.

### 8.3 Threshold failures

`pnpm test:coverage` exits 1 because:

- Branches 75.19% < 88% required.
- Functions 94.54% < 95% required.

**Root cause:** the threshold was set assuming the excluded modules would be tested; the in-scope modules alone can't meet 88% branches because `database.ts` (67%) and `fileConfig.ts` (64%) drag the average down, and `providerPresets.ts`/`ipcRateLimiter.ts` have low function coverage.

---

## 9. Prioritized Recommendations

### P0 — Unblock E2E (critical)

1. **Fix the E2E launch failure.** All 39 e2e tests time out at `firstWindow()`. Debug `startApp()` in `main.ts` under `NODE_ENV=test` — likely FunASR init blocking, tray creation failing, or window `loadURL` pointing at a dev server that isn't running. Until this is fixed, **no user journey is validated**.
2. **Add E2E CI gating** once fixed (currently e2e never runs in CI presumably, since it's all red).

### P1 — Cover the highest-risk untested logic

3. **Unit-test `transcriptionHandlers.ts`** (16 channels, 0 tests). It's the largest handler with the most error paths (validation, 500MB limit, diarize, export, AI review). Use the `aiHandlers.test.js` mock pattern.
4. **Behaviorally test `updateManager.ts`** — `semverGt`, `parseChecksums`, `verifySHA256`, and the install path-escape guard (security-critical). Replace the source-string `phase3`/`updateManager-require-resolution` tests.
5. **Unit-test `hotkeyHandlers.ts`** and `clipboardHandlers.ts` (both 0 tests).

### P2 — Reach coverage thresholds

6. **Close branch gaps in `database.ts`** (67% → 88%+) and `fileConfig.ts` (64% → 88%+). These are the threshold blockers.
7. **Cover `providerPresets.ts` line 139** and `ipcRateLimiter.ts` line 29 (untested exported functions).
8. Either **raise coverage on excluded modules** (by making them testable — inject electron deps) or **lower the thresholds honestly** and document which modules are e2e-only.

### P3 — Infrastructure & quality

9. **Extract shared mock factories** (`createMockIpcMain()`, `createMockDb()`, `createMockLogger()`, `mockFetchResponse()`) into `tests/unit/helpers/`.
10. **Add a test DB factory** (`createTestDb()` returning `{ db, cleanup }`) to replace inline tmp-dir boilerplate.
11. **Migrate test files `.js` → `.ts`** to get type-checking in tests and remove dependence on `tests/_tsresolve.setup.js` monkey-patching.
12. **Convert source-string/regex "phase" tests to behavioral tests** or delete them — they inflate the count without value and are tautological post-migration.
13. **Fix un-awaited `rejects.toThrow`** warnings before the next Vitest major.
14. **Add HTML coverage reporter** for drill-down (`reporter: ["text", "html", "json"]`).

### P4 — Journey & error-path coverage

15. Add e2e suites for **tray**, **update flow**, and **diarization** (currently zero coverage).
16. Add error-path tests for: disk-full on export/download, corrupt audio, AI timeout/unreachable, Python missing, DB locked.
17. Add a **preload bridge contract test** that actually executes `contextBridge.exposeInMainWorld` and asserts the full API surface (currently only source-string checks; the e2e that would do this is broken).

---

## 10. Methodology & Evidence

- **Coverage:** `pnpm test:coverage` (vitest + @vitest/coverage-v8), run 2026-07-24. Full output captured; exit code 1.
- **E2E:** `pnpm exec playwright test --reporter=list` — 39 tests, all fail at `firstWindow()` 30s timeout.
- **IPC channel map:** derived from `grep "ipcMain.handle" src/helpers/ipc/*.ts` and `src/helpers/updateManager.ts` cross-referenced against `src/helpers/ipc-contracts.ts`.
- **Test quality classification:** manual review of representative files from each group (behavioral vs source-string).
- **File inventory:** `find src -name "*.ts*"` and `find tests -type f`.

### Key files referenced

- Config: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/vitest.config.js`, `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/playwright.config.js`
- Coverage exclusions: `vitest.config.js` lines 25-44
- Migration shim: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/_tsresolve.setup.js`
- IPC contracts: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc-contracts.ts`
- Largest untested handler: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/transcriptionHandlers.ts`
- Security-critical untested: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/updateManager.ts`
- E2E launch helper: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/e2e/helpers/electron-launch.js`
- Example behavioral test (gold standard): `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/unit/aiHandlers.test.js`, `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/unit/database.test.js`
- Example source-string test (weak): `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/unit/phase3-semi-auto-update.test.js`
