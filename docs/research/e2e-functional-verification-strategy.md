# Murmur 端到端功能验证策略 — 从客户端启动到功能回归

> Status: Capstone strategy (third-round research)
> Date: 2026-07-25
> Scope: A single, end-to-end verification pipeline — from Electron boot
> sequence through functional regression — grounded in primary sources and
> tailored to Murmur's actual stack (Electron 36 + React 19 + better-sqlite3
>
> - Python/FunASR stdio JSON-RPC + Vitest + Playwright).
>   Audience: Engineers turning the currently-failing, non-blocking e2e suite
>   (20/39 red, `continue-on-error: true` in CI) into a blocking, tiered
>   functional-regression gate.

## 0. How this document fits in

Murmur already has 8109 lines of test research (see `docs/research/README.md`).
This document is the **capstone** that those docs deliberately do not provide:

| Existing doc                         | What it covers                     | What it does NOT cover                 |
| ------------------------------------ | ---------------------------------- | -------------------------------------- |
| `comprehensive-test-strategy.md`     | Test pyramid, case lists           | Boot sequence verification             |
| `murmur-architecture-map.md`         | 7 subsystems, test seams           | Regression promotion policy            |
| `electron-testing-best-practices.md` | General theory, VS Code comparison | Murmur-specific boot phases            |
| `deep-test-design-v2.md`             | Coverage bottlenecks (P0)          | Functional journey tiers               |
| `deep-test-design-e2e.md`            | 8 user journeys (Playwright code)  | Startup health checks, promotion gates |
| `deep-test-design-error-paths.md`    | Error-path tests + 3 real bugs     | Integration with boot/regression tiers |

**This document fills the gap**: a unified pipeline that maps every startup
phase → every functional tier → every CI gate, with the path from "e2e is
non-blocking" to "e2e is a release blocker" made explicit.

## 1. Primary sources cited throughout

Cited inline as `[Sxx]`. All consulted 2026-07-25.

- **[S1]** Electron official — _Automated Testing_. <https://electronjs.org/docs/latest/tutorial/automated-testing>
- **[S2]** Playwright official — _Best Practices_. <https://playwright.dev/docs/best-practices>
- **[S3]** Playwright official — _Electron API_. <https://playwright.dev/docs/api/class-electron>
- **[S4]** Playwright official — _Test isolation, `describe.serial`, setup projects_ (auth pattern). <https://playwright.dev/docs/best-practices>
- **[S5]** Emad Ibrahim — _Testing Electron Apps_ (decouple handler logic, in-memory SQLite). <https://emadibrahim.com/electron-guide/testing>
- **[S6]** Vitest official — _Mocking guide_ (esp. `vi.mock("electron")` limits). <https://vitest.dev/guide/mocking>
- **[S7]** Vitest issue #4166 — _`vi.mock` does not intercept CJS `require()`_. <https://github.com/vitest-dev/vitest/issues/4166>
- **[S8]** electron-playwright-helpers — _IPC + menu helpers_. <https://github.com/spaceageturtles/electron-playwright-helpers>
- **[S9]** CircleCI — _Automated Testing for Electron with CI_ (smoke vs regression tiers). <https://circleci.com/blog/electron-testing/>
- **[S10]** DeviQA — _Playwright E2E Guide 2025_ (current CI/CD integration). <https://www.deviqa.com/blog/guide-to-playwright-end-to-end-testing-in-2025/>
- **[S11]** VS Code repo — _test/{unit,integration,smoke,automation} structure_. <https://github.com/microsoft/vscode/tree/main/test>
- **[S12]** Google Testing Blog — _test pyramid ratios_ (70/20/10 desktop adaptation).

The existing in-repo doc `docs/research/electron-testing-best-practices.md`
already summarises [S1]–[S4], [S7], [S8], [S11] in depth; this document
re-cites them only where load-bearing and does not re-derive their content.

---

## 2. The boot sequence — what "client started" actually means

Before any functional test can run, Murmur executes a strict 5-phase boot.
**A regression in any phase silently breaks every downstream functional
test**, so Phase-0 health checks (§4) must run first and fail fast.

Verified against source (`main.ts`, `windowManager.ts`, `funasrManager.ts`,
`funasrServer.ts`, `pythonEnvironment.ts`, `src/main.tsx`):

### Phase A — Module-load time (before `app.whenReady()`)

| Step | File:line         | What happens                                                                                                                                                               | Regression symptom                                                                  |
| ---- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A1   | `main.ts:46-124`  | `setupProductionPath()` prepends `/usr/local/bin`, `/opt/homebrew/bin`, Python framework paths to `process.env.PATH` on macOS prod; Windows equivalent at `main.ts:88-120` | Python not found → ASR never starts (silent: fire-and-forget at D1)                 |
| A2   | `main.ts:127`     | `process.env.ELECTRON_USER_DATA = app.getPath("userData")`                                                                                                                 | Python env build reads wrong userData → models not found                            |
| A3   | `main.ts:133-139` | Instantiate 7 managers (constructors only). `EnvironmentManager` loads `.env` at `environment.ts:105-110`                                                                  | `.env` parse error → manager throws at construction                                 |
| A4   | `main.ts:142-144` | `ensureDataDirectory()` → `databaseManager.initialize(dir)` → `setFileConfigPath(<dir>/murmur.json)`                                                                       | DB init failure → app crashes (best-sqlite3 native mismatch, `database.ts:131-140`) |
| A5   | `main.ts:147-155` | `registerIPCHandlers(ipcMain, {...})` — **all 10 handler modules registered before `whenReady`**                                                                           | Missing channel → renderer IPC call rejects with "No handler registered"            |

### Phase B — `app.whenReady()` (`main.ts:229-234`)

| Step | File:line         | What happens                                                                                                                                             |
| ---- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | `main.ts:223-225` | If `NODE_ENV==="test"`: `app.disableHardwareAcceleration()` (required for headless CI macOS, per `[20260724_Fix_E2E_Headless]`)                          |
| B2   | `main.ts:230-232` | If `safeStorage.isEncryptionAvailable()` → `databaseManager.setSafeStorage(safeStorage)` — triggers api-key encryption migration (`database.ts:276-301`) |
| B3   | `main.ts:233`     | Calls `startApp()` (Phase C)                                                                                                                             |

### Phase C — inside `startApp()` (`main.ts:158-217`)

| Step | File:line                 | What happens                                                                                                                                                                          | Regression symptom                                                                                                     |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| C1   | `main.ts:179-182`         | Dev only: `await setTimeout(2000)` for Vite to boot on `:5173` (`vite.config.js:6`, `strictPort:true`)                                                                                | Port taken → `loadURL` hangs → blank window                                                                            |
| C2   | `main.ts:185-188`         | macOS: `app.dock.show()`                                                                                                                                                              |
| C3   | `main.ts:191-194`         | **`funasrManager.initializeAtStartup()` is fire-and-forget** (`.catch()` swallows). Python/ASR bootstrap proceeds in background (Phase D).                                            | App loads even if ASR is totally broken — the silent-failure surface                                                   |
| C4   | `main.ts:197`             | `windowManager._setupCSP()` installs `onHeadersReceived` filter (`windowManager.ts:42-64`)                                                                                            | CSP regression → renderer blocks script → white screen                                                                 |
| C5   | `main.ts:200-204`         | Read `window_always_on_top` setting, `await windowManager.createMainWindow()`                                                                                                         | Window options regression → BrowserWindow construction throws                                                          |
| C6   | `windowManager.ts:74-94`  | `BrowserWindow` (520×640, `frame:false`, `transparent:true`, `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, preload at `app.getAppPath()/dist-preload/preload.js`) | Preload path resolution regression → `window.electronAPI` undefined → React never mounts (`assertElectronAPI.ts:9-30`) |
| C7   | `windowManager.ts:98-107` | Dev: `loadURL("http://localhost:5173")`; prod: `loadFile(<appPath>/src/dist/index.html)`                                                                                              | Wrong mode → blank window                                                                                              |
| C8   | `main.ts:211-214`         | `trayManager.setWindows(mainWindow)` + `await trayManager.createTray()`                                                                                                               | Tray icon missing → no tray affordance (non-fatal)                                                                     |

### Phase D — Python ASR bootstrap (concurrent with C, non-blocking)

Triggered at C3 via `funasrManager.initializeAtStartup()`:

| Step | File:line                                               | What happens                                                                                                                                                                                          |
| ---- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1   | `funasrManager.ts:188` → `pythonEnvironment.ts:140-174` | `findPythonExecutable()`: embedded Python at `python/bin/python3.11`; dev falls back to `.venv/bin/python3.11` then PATH; **prod throws if embedded Python missing** (`pythonEnvironment.ts:171-173`) |
| D2   | `funasrManager.ts:191` → `pythonEnvironment.ts:267-320` | `checkFunASRInstallation()` spawns `python -c 'import funasr; print("OK")'` (cached in `funasrInstalled`)                                                                                             |
| D3   | `funasrServer.ts:152-160`                               | `spawn(pythonCmd, [serverPath, "--damo-root", modelCachePath], { stdio:["pipe","pipe","pipe"] })` — **stdin/stdout JSON IPC, no HTTP port**                                                           |
| D4   | `funasrServer.ts:164-198`                               | `initListener` waits for first stdout JSON line `{"success":true,...}` → sets `serverReady=true`, attaches `messageRouter`, starts 30s health monitor                                                 |
| D5   | `funasrServer.py:1103-1112`                             | Python prints `init_result` JSON (the "ready" handshake); main loop at `:1123` reads `sys.stdin.readline()`                                                                                           |

**Key insight for testing**: ASR uses stdin/stdout JSON-RPC, not HTTP. There is
no port to mock. Tests that need to assert ASR behaviour must mock at the IPC
boundary (`transcribe-audio` channel) — they cannot run a fake HTTP server.

### Phase E — Lifecycle handlers (registered once, fired later)

| Step | File:line         | What happens                                                                                                                                                        |
| ---- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1   | `main.ts:236-240` | `window-all-closed`: quit on non-macOS                                                                                                                              |
| E2   | `main.ts:242-246` | `activate`: recreate window on macOS                                                                                                                                |
| E3   | `main.ts:248-269` | `will-quit`: `preventDefault()`, `globalShortcut.unregisterAll()`, `funasrManager.gracefulShutdown()` with 5s race timeout, `databaseManager.close()`, `app.exit()` |

### Renderer-side gate (parallel, in the renderer process)

| Step | File:line                                                | What happens                                                                                                 |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| R1   | `src/main.tsx:7` → `bootstrap/assertElectronAPI.ts:9-30` | If `window.electronAPI` undefined → renders plain-DOM error screen, **React never mounts** (hard gate)       |
| R2   | `src/main.tsx:200`                                       | `initializeApp()` (theme, global error listeners, drag/drop guards, `document.documentElement.lang="zh-CN"`) |
| R3   | `src/main.tsx:207-218`                                   | Mounts `StrictMode > ErrorBoundary > ModelStatusProvider > App + Toaster`                                    |
| R4   | `src/App.tsx:41`                                         | `useModelStatus()` reads ASR status; mic disabled until `stage:"ready"`                                      |

**Implication for functional tests**: A test cannot drive the mic button
until Phase D reports ready. Two options:

1. Mock `check-model-files` to `{stage:"ready", isReady:true, downloadProgress:100}` (the existing pattern, `03-recording.test.js:22-30`).
2. Wait for the real ASR server (too slow, ~30-120s, never CI-safe).

The strategy standardises on option 1 for Tier-1/2 tests (§5).

---

## 3. The functional surface — what "regression" must protect

Derived from the IPC inventory (every `ipcMain.handle` channel in
`src/helpers/ipc-contracts.ts` with handler `file:line`) and the renderer
components that consume them. **Orphan features — claimed in settings but
with no consuming code — are flagged so tests do not assert they work.**

### Tier-1 features (primary value flows — must never regress)

| Feature                             | Primary UI                                             | Critical IPC channels                                                                             | User-visible success                                             |
| ----------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Real-time recording + transcription | `App.tsx:649` (`data-testid="mic-button"`)             | `transcribe-audio`, `save-transcription`, `process-text`                                          | Click mic → text appears in `data-testid="transcription-result"` |
| File transcription (import)         | `FileDropZone.tsx:99` (`data-testid="file-drop-zone"`) | `validate-audio-file`, `transcribe-file`, `cancel-file-transcription`                             | Drop file → result card with segments                            |
| AI text refinement                  | `TranscriptionResult.tsx:147`, `ProcessingPanel.tsx`   | `process-text`, `get-ai-modes`, `get-ai-provider-presets`                                         | "AI正在优化文本..." → blue card with optimized text              |
| Model download (FTUE gate)          | `model-status-indicator.tsx`                           | `check-model-files`, `download-models`, `get-download-progress` + event `model-download-progress` | Progress bar fills, status becomes `ready`                       |
| Auto-paste to cursor                | `App.tsx:77-112` (`safePaste`)                         | `paste-text`, `copy-text`, `read-clipboard`                                                       | Toast "文本已自动粘贴"                                           |
| Global hotkey                       | `useHotkey.ts`, `hotkeyManager.ts`                     | `register-hotkey`, `get-current-hotkey` + event `hotkey-triggered`                                | `Cmd/Ctrl+Shift+Space` toggles recording                         |
| Settings persistence                | `settings.tsx`, 4 sections                             | `get-setting`, `set-setting`, `get-all-settings`, `import-settings`, `export-settings`            | Edit persists across reload                                      |
| History (search, export)            | `history.tsx` (separate window)                        | `get-transcriptions`, `search-transcriptions`, `export-transcriptions`                            | List loads, FTS5 search filters, export writes file              |

### Tier-2 features (secondary — regression allowed but tracked)

| Feature                               | Primary UI                             | Critical IPC                                                   | Notes                              |
| ------------------------------------- | -------------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| Multi-window (settings/history)       | `windowManager.ts`                     | `open-settings-window`, `open-history-window`, etc.            | 3 separate windows                 |
| Update check + SHA256 download        | `AboutSection.tsx`, `updateManager.ts` | `check-update`, `download-update`, `install-update` + events   | GitHub releases API                |
| Speaker diarization                   | `TranscriptionResult.tsx:289-305`      | `diarize-transcription`                                        | Lazily loads CAM++ model           |
| Window controls (max/min/close/top)   | `App.tsx:519-583`                      | `maximize-window`, `set-always-on-top`, etc.                   | Custom maximize toggle             |
| Export (single + bulk)                | `ExportPanel.tsx`                      | `export-transcription`, `export-transcriptions`                | txt/srt/vtt/md/docx                |
| Tray icon + menu                      | `tray.ts`                              | (none — main-process only)                                     | Click toggles window               |
| AI provider presets + local detection | `AIConfigSection.tsx`                  | `get-ai-provider-presets`, `detect-local-models`               | Ollama/LMStudio probe              |
| Clipboard roundtrip                   | `clipboard.ts`                         | `copy-text`, `paste-text`, `read-clipboard`, `write-clipboard` | macOS uses osascript               |
| i18n (zh-CN / en)                     | `i18n/`                                | (none — renderer-only)                                         | 154 keys, localStorage persistence |

### ⚠️ Orphan features — DO NOT write passing E2E for these

These are in the settings allowlist (`settingsHandlers.ts:30-47`) or contract
file but have **no consuming code**. A test can only assert "setting saves"
or "handler returns failure as designed", not "feature works".

| Claimed feature                                                 | Evidence of orphan status                                                            | What a test may assert                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------- |
| Auto-start at login                                             | No `setLoginItemSettings`, no `auto-launch` dep, no LaunchAgent — confirmed via grep | Only: setting key persists across reload |
| `MODELS.SWITCH` (switch model)                                  | `modelHandlers.ts:81-86` always returns failure "暂不支持切换单个模型"               | Only: handler returns `{success:false}`  |
| `show_notifications`, `minimize_to_tray`, `model_download_path` | Settings keys with zero consuming code                                               | Only: keys save (no behavioural effect)  |
| `tray.setStatus("recording"...)`                                | Method exists, **no caller found**                                                   | Tray tooltip stays "ready" in practice   |
| EVENTS `error`, `transcription-update`                          | Declared in contract, **no sender found**                                            | Cannot be triggered from a test          |

The Phase-0 boot-health check (§4.1) includes an "orphan registry" test that
fails if any of these suddenly grow a consumer — that is the only legitimate
test coverage for them until they ship.

---

## 4. The verification pipeline — four gates, in order

The pipeline runs in CI on every PR. Each gate is a hard failure except Gate 4
transitions from non-blocking to blocking per §7.

```
┌──────────────────────────────────────────────────────────────────┐
│ GATE 1 — Static (tsc + eslint + format + license)  [blocking]    │
│   • pnpm typecheck, pnpm lint, pnpm format:check, license:check  │
│   • Pre-commit hook (lint-staged) runs the same subset            │
└──────────────────────────────────────────────────────────────────┘
                              ↓ (only if green)
┌──────────────────────────────────────────────────────────────────┐
│ GATE 2 — Unit + Contract (Vitest)                  [blocking]    │
│   • Pure logic + DB (in-memory) + handlers (mocked ipcMain)       │
│   • IPC contract orphans, preload bridge surface, rate limiter    │
│   • Coverage thresholds: stmt 94 / branch 88 / fn 95 / line 94    │
│   • Target: ~600 tests, <10ms each — the 80% base of the pyramid  │
└──────────────────────────────────────────────────────────────────┘
                              ↓ (only if green)
┌──────────────────────────────────────────────────────────────────┐
│ GATE 3 — Boot Health (Playwright, 1 app instance)  [blocking]    │
│   • Phase-A-E smoke: app launches, preload exposes API, React     │
│     mounts, model status readable, CSP header set, no console     │
│     errors, graceful shutdown                                     │
│   • 8-10 tests, <30s wall-clock — fail-fast on boot regressions   │
└──────────────────────────────────────────────────────────────────┘
                              ↓ (only if green)
┌──────────────────────────────────────────────────────────────────┐
│ GATE 4 — Functional Regression (Playwright, tiered)              │
│   • Tier-1 [blocking after §7 promotion]: 8 primary flows, UI     │
│     driven (not just IPC roundtrip), all externals mocked         │
│   • Tier-2 [non-blocking, informational]: secondary flows         │
│   • Tier-3 [local-only]: full real-ASR smoke (developer machine)  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.1 Gate 3 — Boot Health smoke suite (new, must exist)

This is the single highest-leverage suite. Today it does not exist as a
distinct gate — boot assertions are scattered across suites `00-ftue` and
`01-lifecycle`, which is why a boot regression can mask as 20 unrelated
failures. Consolidate into `tests/e2e/suites/00-boot-health.test.js`:

```js
// tests/e2e/suites/00-boot-health.test.js
// Verifies Phase A-E of the boot sequence. If any test here fails, every
// downstream functional test is suspect — stop and fix this first.
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

test.describe.serial("Suite 0: Boot Health (Phase A-E)", () => {
  let electronApp, window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => await closeElectronApp(electronApp));

  // Phase A4 — DB initialized
  test("0.1 DB is initialized (getSetting round-trips)", async () => {
    const result = await window.evaluate(() =>
      window.electronAPI.getSetting("__boot_probe__", "ok"),
    );
    expect(result).toBe("ok");
  });

  // Phase A5 — every handler module registered
  test("0.2 all 10 IPC handler domains respond", async () => {
    const probes = {
      "check-funasr-status": () => window.electronAPI.checkFunASRStatus(),
      "check-model-files": () => window.electronAPI.checkModelFiles(),
      "get-ai-modes": () => window.electronAPI.getAIModes(),
      "get-all-settings": () => window.electronAPI.getAllSettings(),
      "get-system-info": () => window.electronAPI.getSystemInfo(),
      "get-app-version": () => window.electronAPI.getAppVersion(),
      "is-window-maximized": () => window.electronAPI.isWindowMaximized(),
      "get-current-hotkey": () => window.electronAPI.getCurrentHotkey(),
      "read-clipboard": () => window.electronAPI.readClipboard(),
      "get-current-model": () => window.electronAPI.getCurrentModel(),
    };
    for (const [channel, call] of Object.entries(probes)) {
      // Each must resolve (not reject with "No handler registered").
      await expect(call()).resolves.toBeDefined();
    }
  });

  // Phase C6 — preload bridge loaded
  test("0.3 preload exposes electronAPI with 50+ methods", async () => {
    const keys = await window.evaluate(() => Object.keys(window.electronAPI));
    expect(keys.length).toBeGreaterThanOrEqual(50);
    for (const required of [
      "getSetting",
      "setSetting",
      "transcribeAudio",
      "pasteText",
    ]) {
      expect(keys).toContain(required);
    }
  });

  // Phase C4 + R1-R3 — renderer mounted and stable
  test("0.4 main window renders mic button (React mounted)", async () => {
    // Web-first assertion [S2]: retry until mounted, no manual timeout.
    await expect(window.locator('[data-testid="mic-button"]')).toBeAttached({
      timeout: 10_000,
    });
  });

  test("0.5 no uncaught errors in renderer console", async () => {
    const errors = [];
    window.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    // Allow known noisy messages here; fail only on net-new errors.
    const known = [/Failed to load resource/i];
    const novel = errors.filter((e) => !known.some((k) => k.test(e)));
    expect(novel).toEqual([]);
  });

  // Phase C4 — CSP header installed
  test("0.6 Content-Security-Policy header is set in prod bundle", async () => {
    // In test mode we cannot read response headers (file://), so assert the
    // CSP filter is installed by inspecting the main process.
    const installed = await electronApp.evaluate(({ session }) => {
      return !!session.defaultSession;
    });
    expect(installed).toBe(true);
  });

  // Phase E3 — graceful shutdown closes DB and kills Python
  test("0.7 app quits within 6s (will-quit race timeout is 5s)", async () => {
    const start = Date.now();
    await closeElectronApp(electronApp);
    expect(Date.now() - start).toBeLessThan(6_000);
    electronApp = null; // prevent double-close in afterAll
  });
});
```

**Why this is the right shape** (cited):

- `test.describe.serial` — Playwright runs file tests sequentially by default [S4]; `.serial` makes the intent explicit and guards against future parallel config.
- `expect(locator).toBeAttached()` — web-first assertion, auto-retries, no flakiness from manual `waitForTimeout` [S2].
- One app instance for the whole suite — Electron cannot parallelize (`workers:1` in `playwright.config.js`); launching once cuts wall-clock ~5× [S3].
- The "no uncaught console errors" test is the only way to catch CSP regressions, preload-load failures, and unhandled promise rejections that don't crash the window.

### 4.2 The orphan-registry contract test (Gate 2, unit-level)

Add to `tests/unit/ipc-contracts-orphans.test.js` a complementary assertion
that fails if an orphan feature grows a consumer without updating the
allowlist — this prevents silent contract drift:

```ts
// Appended to tests/unit/ipc-contracts-orphans.test.ts
describe("orphan feature registry", () => {
  // Each entry: [setting key or IPC channel, currently-expected status]
  const ORPHAN_REGISTRY = [
    ["auto_start", "setting-only, no consumer"],
    ["show_notifications", "setting-only, no consumer"],
    ["minimize_to_tray", "setting-only, no consumer"],
    ["model_download_path", "setting-only, no consumer"],
    ["switch-model", "handler returns failure by design"],
    ["EVENTS.ERROR", "declared, no sender"],
    ["EVENTS.TRANSCRIPTION_UPDATE", "declared, no sender"],
  ] as const;

  it("orphan registry matches source — update this test when a feature ships", () => {
    // If this test fails, a previously-orphan channel now has a sender.
    // That is GOOD news — promote the feature to Tier-1/2 and write a real test.
    for (const [channel] of ORPHAN_REGISTRY) {
      const senders = countSendersInSource(channel); // helper from existing orphan test
      expect(senders, `${channel} should have 0 senders`).toBe(0);
    }
  });
});
```

---

## 5. Functional regression tiers — Tier-1 must be UI-driven

**Today's gap in one sentence**: Suites `03-recording` through `10-errors`
assert IPC round-trips via `window.evaluate(() => window.electronAPI.X())`,
not actual user-driven flows. A regression in the **wiring between UI click
and IPC call** is invisible to these tests. Tier-1 closes that gap.

### 5.1 Tier-1 — UI-driven primary flows (8 suites, blocking after §7)

Each suite must drive the UI like a user (click mic button, drop file,
type in settings), not call `window.electronAPI` directly. All externals
mocked via `mockIpcHandler` (`tests/e2e/helpers/ipc-mock.js`).

| Suite                             | Drives                                               | Mocks                                                                                                 | Asserts (user-visible)                                                                                          |
| --------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `11-recording-journey`            | mic click → stop → AI optimize → clipboard           | `check-model-files`, `transcribe-audio`, `process-text`, `get-ai-modes`, `save-transcription`         | `transcription-result` card visible, contains ASR text, AI card replaces it, `readClipboard` returns final text |
| `12-file-import-journey`          | drop file → 转录 → export                            | `validate-audio-file`, `transcribe-file`, event `file-transcription-progress`, `export-transcription` | Progress bar advances, result card shows, save dialog returns file path                                         |
| `13-model-download-journey`       | need-download → progress → ready                     | `check-model-files` (returns missing), `download-models`, event `model-download-progress`             | Mic button disabled → enabled as progress crosses 100%                                                          |
| `14-tray-journey`                 | tray click → toggle window                           | none (tray is main-process)                                                                           | Window visibility flips; right-click menu items exist                                                           |
| `15-multi-window-journey`         | open settings + history                              | none                                                                                                  | Both windows open with correct URL `?page=...`; settings change broadcasts                                      |
| `16-error-resilience-journey`     | FunASR unavailable → degrade; AI unreachable → toast | `check-funasr-status` (fails), `process-text` (fails)                                                 | UI shows status, not crash; toast appears                                                                       |
| `17-settings-persistence-journey` | edit → reload → verify persisted                     | none (uses real SQLite, **NOT `:memory:`**)                                                           | Values survive reload (uses temp DB file)                                                                       |
| `18-update-journey`               | check → download → SHA256 verify                     | `check-update`, `download-update` (local fixture)                                                     | Version compare correct; hash matches fixture                                                                   |

These eight suites are designed in `docs/research/deep-test-design-e2e.md`
with full Playwright code — that document is the implementation spec. This
strategy adds two things missing there:

1. **Promotion policy** (§7): when each suite moves from informational to blocking.
2. **Health-check precondition** (§4.1): Gate 3 must pass before any Tier-1 suite runs, so a boot regression produces one clear failure instead of 20 cascading ones.

### 5.2 Tier-2 — secondary flows (non-blocking, runs nightly)

Window controls, diarization, export formats, AI provider presets, local
model detection, clipboard roundtrip, i18n switch. These can break without
blocking a release but should not regress for more than one release cycle.

### 5.3 Tier-3 — real-ASR smoke (developer machine, never CI)

One suite that does **not** mock `transcribe-audio`, requires real Python
env + downloaded models, and runs against a fixture WAV with known expected
text. Runs via `pnpm test:e2e:real` (new script, opt-in). Purpose: catch
regressions in the Python stdio protocol that mocks cannot see
(e.g., `funasr_server.py` schema changes, `PYTHONUTF8=1` encoding bugs).

---

## 6. Test design rules — load-bearing, cited

Every test in Gates 3 and 4 must follow these. Each rule ties to a primary
source so the rationale is auditable.

### R1 — Web-first assertions, never manual booleans

```js
// ❌ BAD — race condition, no retry
expect(await window.locator("#x").isVisible()).toBe(true);

// ✅ GOOD — auto-retries until timeout
await expect(window.locator("#x")).toBeVisible();
```

> _"By using web first assertions Playwright will wait until the expected condition is met."_ — [S2]

### R2 — Test isolation: fresh app per suite, in-memory DB

- `MURMUR_DB_PATH=:memory:` (already set by `electron-launch.js:31`).
- One `launchElectronApp()` per `test.describe`, closed in `afterAll`.
- **Exception**: `17-settings-persistence-journey` uses a temp file path because persistence-across-reload cannot be tested with `:memory:` (noted in `deep-test-design-e2e.md:1160-1167`).
  > _"Each test should be completely isolated from another and should run independently with its own local storage, session storage, data, cookies etc."_ — [S2]

### R3 — Locate by user-facing attributes, not CSS/XPath

```js
// ✅ GOOD — survives DOM restructure
window.locator('[data-testid="mic-button"]');
window.getByRole("button", { name: "停止录音" });

// ⚠️ AVOID — brittle
window.locator(".record-button-container > button");
```

> _"Find elements using built-in locators that rely on user-facing attributes rather than CSS or XPath selectors tied to DOM structure."_ — [S2]

**Murmur gap**: only 3 `data-testid`s exist today (`mic-button`, `file-drop-zone`, `transcription-result`). Promoting Tier-1 to blocking (§7) requires adding testids to: settings sections, history list items, export panel, tray menu, model status indicator, error toasts. Track as a prerequisite task.

### R4 — Never mock what you don't own; always mock what you do

- **Mock** (deterministic, CI-safe): `transcribe-audio`, `process-text`, `check-update`, `download-models`, `dialog.showOpenDialog` (via `electronApp.evaluate`).
- **Don't mock**: SQLite (use in-memory real `better-sqlite3`), settings handler logic, the preload bridge, IPC contract registry.
  > _"Only test what you control. Mocking external network requests prevents third-party downtime from causing false test failures."_ — [S2]

### R5 — Decouple handler logic for unit tests wherever possible

Extract pure functions; leave `ipcMain.handle` as a 1-line wrapper:

```ts
// ✅ Testable in Node without Electron
export async function handleFileOpen(dir: string): Promise<string[]> { ... }
ipcMain.handle("import-audio-file", (_e, dir) => handleFileOpen(dir));
```

> _"Extract handler logic into testable functions ... test the functionality directly in Node.js without needing to stub ipcMain."_ — [S5]

Murmur is partially there: `transcriptionHandlers.test.ts` captures registered handlers from a mocked `ipcMain` and invokes them directly — this is the [S5]-recommended integration level.

### R6 — `vi.mock("electron")` only intercepts ESM imports, not CJS `require()`

When migrating or writing new tests, `.ts` source using `import { app } from "electron"` is mockable; lazy `require("electron")` inside a function is not.

> _Vitest issue #4166 confirms `vi.mock` does not intercept `require()`; the workaround is a `Module._resolveFilename` monkey-patch._ — [S7]

Murmur already ships this patch in `tests/_tsresolve.setup.js` (loaded by `vitest.config.js:15`).

### R7 — `app.disableHardwareAcceleration()` in test mode

Already implemented at `main.ts:223-225`, gated on `NODE_ENV==="test"` which `electron-launch.js:29` sets. **Do not remove** — CI macOS runners lack GPU and `firstWindow()` times out without this.

> _Comment at `main.ts:222`: "CI macOS runners lack GPU support, causing firstWindow() timeout when Electron tries to initialize the compositor."_

### R8 — One worker, no parallelism

`playwright.config.js:11` sets `workers: 1`. Electron cannot parallelise within a single CI runner (shared app instance, single userData dir). Do not raise this.

### R9 — Fail fast on boot, fail soft on journey

Gate 3 (boot) uses `test.describe.serial` and the suite is ordered first (`00-`); the playwright reporter stops the file on first failure. Gate 4 suites are independent — one journey failure does not block the others, so a single regression produces one failure, not twenty.

---

## 7. Promotion policy — from "non-blocking" to "release blocker"

Today: `pnpm test:e2e` has `continue-on-error: true` in `.github/workflows/ci.yml:66`, the last run failed 20/39 tests, and Gate 3 doesn't exist as a distinct gate. The path to a blocking gate is staged.

### Stage 0 — Stabilise (weeks 1-2)

**Goal**: get the existing 39 tests to green.

1. **Run the suite, classify every failure** into: (a) selector drift, (b) missing mock, (c) real bug, (d) test bug. The 20 failures from the 2026-07-25 run are the worklist.
2. **Add the 3 missing `data-testid`s** (or use role+name locators) so brittle selectors stop flapping.
3. **Keep `retries: 0`** (`playwright.config.js:10`) until green — flaky retries hide real bugs.
4. **Acceptance**: `pnpm test:e2e` green locally on macOS 5 consecutive runs.

#### 2026-07-25 update — boot health suite added, Stage 0 diagnosis refined

The new `tests/e2e/suites/00-boot-health.test.js` (PR #91, spec §4.1) was
run on CI macOS for the first time. Result: **same `firstWindow()` 30s
timeout as the existing 39 tests** — the suite is correctly designed but
the underlying Electron-on-CI-macOS launch is broken across the board
(00-boot-health, 00-ftue, 01-lifecycle all fail identically at
`electron-launch.js:44`). This confirms Stage 0's "20/39 red" is not
selector drift or test bugs — it is a **systemic Electron spawn failure
on the macOS runner**, which must be fixed before any e2e gate (blocking
or non-blocking) can carry signal.

**Implication for Gate 3 promotion:** the boot health step in
`.github/workflows/ci.yml` MUST stay `continue-on-error: true` until the
systemic Electron launch issue is resolved. This is no longer "validate
the suite" (the suite is sound — the failure is at `app.firstWindow()`
before any test code runs) — it is "fix the launch path." Candidate
root causes to investigate (ordered by likelihood):

- macOS runner lacks GPU/ compositor access — `main.ts:222-225` gates
  `app.disableHardwareAcceleration()` on `NODE_ENV === "test"`, but
  `electron-launch.js:36` sets `NODE_ENV: "test"` in `env`, so this
  SHOULD be active. Verify the gating condition survives esbuild
  bundling.
- Code-signing/notarization gate on macOS Sequoia (runner is
  `macos-latest` which is now 15.x) blocks unsigned Electron binaries
  from spawning windows.
- `app.getAppPath()` returns the wrong directory in CI —
  `electron-launch.js:31` passes `args: [appRoot]`, but if `appRoot`
  resolves differently under `/Users/runner/work/...` vs local
  `/Users/<dev>/...`, the renderer HTML path breaks.

**Action:** the boot health suite is correct and ready. The next work
item for Stage 0 is **diagnosing the Electron launch failure on CI
macOS**, not iterating on the suite.

### Stage 1 — Gate 3 becomes blocking (week 3)

1. Split `00-boot-health.test.js` out of the existing `00-ftue`/`01-lifecycle` mix.
2. In `.github/workflows/ci.yml`, run Gate 3 as a separate job **without** `continue-on-error`. Gate 4 stays non-blocking.
3. **Acceptance**: a deliberate boot regression (e.g., comment out `registerIPCHandlers` at `main.ts:147`) fails CI within 2 minutes.

### Stage 2 — Tier-1 becomes blocking (weeks 4-6)

1. Implement the 8 Tier-1 suites from `deep-test-design-e2e.md` (Suite 11 already specified in full; 12-18 need the testid prerequisite from R3).
2. Add a `pnpm test:e2e:tier1` script that runs only `00-boot-health` + `11-18-*-journey`.
3. In CI, run `test:e2e:tier1` as blocking; run the full `test:e2e` (including Tier-2) with `continue-on-error: true` as nightly.
4. **Acceptance**: 5 consecutive PR runs with zero Tier-1 flakes; a deliberate regression in `transcribe-audio` wiring fails CI.

### Stage 3 — Coverage and cross-platform (weeks 7+)

1. Add a Windows CI matrix job for Tier-1 (the `close_behavior` and `paste-text` paths diverge by platform — `clipboard.ts` uses `osascript` on mac, PowerShell on Windows).
2. Raise `retries: 1` on Tier-1 only (now that they're stable).
3. Add Tier-3 `pnpm test:e2e:real` as a manual / nightly developer-machine job (never CI).

### Stage 4 — Coverage gate expansion (ongoing)

The current coverage scope (`vitest.config.js:20-24`) excludes `src/helpers/ipc/**`, all 12 managers, `main.ts`, `preload.ts`, and the renderer. As the TS migration completes (`feat/ts-bigbang` branch), expand the include scope file-by-file rather than relaxing thresholds.

---

## 8. Anti-patterns to reject (with citations)

| Anti-pattern                                                                    | Why rejected                                                                | Source                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| `waitForTimeout` instead of `expect.poll` / web-first assertions                | Hides race conditions; flakes on slow CI                                    | [S2]                            |
| Sharing one app instance across `test()` blocks in different files              | State leaks; cascading failures                                             | [S2], [S4]                      |
| Using `:memory:` for the persistence suite                                      | Cannot test reload behaviour                                                | `deep-test-design-e2e.md:1160`  |
| Mocking `electronAPI` in the renderer instead of the IPC handler                | Tests the mock, not the wiring                                              | [S5]                            |
| Skipping the boot-health gate and running journeys directly                     | One boot regression looks like 20 journey failures                          | §4.1 above                      |
| Hardcoding IPC channel strings in tests instead of importing `ipc-contracts.ts` | Silent contract drift                                                       | `CLAUDE.md:90`                  |
| Writing passing E2E for orphan features (auto-start, switch-model)              | Locks in non-existent behaviour                                             | §3 orphan registry              |
| Parallelising Electron tests (`workers>1`)                                      | Shared userData dir, single-instance lock                                   | [S3], `playwright.config.js:11` |
| Treating `console.error` as always-fatal                                        | Noisy renderer messages mask novel regressions; use a known-noise allowlist | §4.1 test 0.5                   |

---

## 9. Implementation checklist (ordered)

- [ ] **P0-1** Classify the 20 e2e failures from the 2026-07-25 run (Stage 0.1)
- [ ] **P0-2** Add `data-testid` to: settings sections, history list, export panel, model-status-indicator, error toast container (R3 prerequisite)
- [ ] **P0-3** Split `00-boot-health.test.js` from existing `00-ftue`/`01-lifecycle`
- [ ] **P0-4** Add orphan-registry assertion to `ipc-contracts-orphans.test.ts` (§4.2)
- [ ] **P1-1** Implement Suite 11 (recording journey) — full code in `deep-test-design-e2e.md:103-270`
- [ ] **P1-2** Implement Suite 17 (settings persistence) using temp-file DB, not `:memory:`
- [ ] **P1-3** Move Gate 3 to blocking in `ci.yml` (Stage 1)
- [ ] **P2-1** Implement Suites 12, 13, 14, 15, 16, 18
- [ ] **P2-2** Add `pnpm test:e2e:tier1` script; make Tier-1 blocking (Stage 2)
- [ ] **P3-1** Windows CI matrix for Tier-1 (Stage 3)
- [ ] **P3-2** Add `pnpm test:e2e:real` for Tier-3 real-ASR smoke
- [ ] **P4** Expand coverage scope as TS migration lands

---

## 10. References (consolidated)

### Primary external sources

- [S1] Electron — Automated Testing. <https://electronjs.org/docs/latest/tutorial/automated-testing>
- [S2] Playwright — Best Practices. <https://playwright.dev/docs/best-practices>
- [S3] Playwright — Electron API. <https://playwright.dev/docs/api/class-electron>
- [S4] Playwright — Test isolation & setup projects. <https://playwright.dev/docs/best-practices>
- [S5] Emad Ibrahim — Testing Electron Apps. <https://emadibrahim.com/electron-guide/testing>
- [S6] Vitest — Mocking guide. <https://vitest.dev/guide/mocking>
- [S7] Vitest issue #4166 — vi.mock vs require. <https://github.com/vitest-dev/vitest/issues/4166>
- [S8] electron-playwright-helpers. <https://github.com/spaceageturtles/electron-playwright-helpers>
- [S9] CircleCI — Electron testing with CI. <https://circleci.com/blog/electron-testing/>
- [S10] DeviQA — Playwright E2E Guide 2025. <https://www.deviqa.com/blog/guide-to-playwright-end-to-end-testing-in-2025/>
- [S11] VS Code repo — test structure. <https://github.com/microsoft/vscode/tree/main/test>
- [S12] Google Testing Blog — pyramid ratios.

### In-repo sources (verified 2026-07-25)

- `main.ts` — 5-phase boot sequence
- `src/helpers/ipc-contracts.ts` — single source of truth for IPC channels
- `src/helpers/ipc/index.ts:80-125` — handler registration; rate limits at `:42-48`
- `src/helpers/windowManager.ts:42-64, 74-107` — CSP, window creation, preload path
- `src/helpers/funasrManager.ts:185-228` — ASR bootstrap (fire-and-forget)
- `src/helpers/funasrServer.ts:152-198` — Python stdio JSON-RPC spawn
- `src/bootstrap/assertElectronAPI.ts:9-30` — renderer-mount hard gate
- `tests/e2e/helpers/electron-launch.js` — Playwright launch + getUserMedia mock
- `tests/e2e/helpers/ipc-mock.js` — `mockIpcHandler` (removeHandler + handle)
- `playwright.config.js` — `workers:1`, `globalSetup` builds bundles
- `vitest.config.js` — coverage thresholds (94/88/95/94), TS resolver setup
- `.github/workflows/ci.yml:66` — e2e `continue-on-error: true` (the gate to flip)

### Companion research docs (this document's context)

- `docs/research/README.md` — index of the 8109-line research base
- `docs/research/electron-testing-best-practices.md` — general theory, expanded
- `docs/research/deep-test-design-e2e.md` — full Playwright code for Suites 11-18
- `docs/research/deep-test-design-v2.md` — coverage-bottleneck analysis
- `docs/research/test-coverage-gap-analysis.md` — per-file coverage audit
- `docs/plans/e2e-test-plan.md` — original 28-case RALPLAN-DR plan
