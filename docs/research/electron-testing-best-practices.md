# Electron E2E Testing: Industry Best Practices

> Research note | Date: 2026-07-24 | Scope: testing pyramid, IPC contract testing, functional regression for Electron desktop apps
>
> Companion to `comprehensive-test-strategy.md` (project-specific). This doc captures industry standards with citations, mapped to Murmur's stack (Electron + Vite + React + better-sqlite3 + Python/FunASR + Vitest + Playwright).

## Primary sources

- **Playwright Electron API** — https://playwright.dev/docs/api/class-electron
- **Electron official testing tutorial** — https://www.electronjs.org/docs/latest/tutorial/automated-testing
- **VS Code test structure** — https://github.com/microsoft/vscode/tree/main/test (`unit/`, `integration/electron/`, `integration/browser/`, `smoke/`, `automation/`)
- **VS Code Playwright Electron driver** — https://github.com/microsoft/vscode/blob/main/test/automation/src/playwrightElectron.ts
- **vitest** — https://vitest.dev/
- **electron-playwright-helpers** — https://github.com/spaceageturtles/electron-playwright-helpers

---

## 1. Testing pyramid for Electron apps

### 1.1 Standard layers

Electron's process split (main / preload / renderer) makes the classic pyramid bend into a **diamond-shaped middle** because integration testing across the IPC boundary is where the highest-value, lowest-cost coverage lives.

```
              E2E (Playwright _electron.launch)
             ── few, slow, full app, real Electron runtime
            /----------------------------------\
          Integration / Contract (Vitest + mocked electron)
         ── IPC contract tests, preload bridge tests, handler unit tests
        /----------------------------------------------\
       Unit (Vitest, pure logic, zero Electron deps)
      ── utils, formatters, DB (in-memory), reducers, pure helpers
```

| Layer                  | Tool                           | What it covers                                                           | Speed      | Target share       |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------------ | ---------- | ------------------ |
| Unit                   | Vitest                         | Pure logic: formatters, DB queries (in-memory SQLite), i18n, type guards | <10ms/test | ~70% of test count |
| Integration / Contract | Vitest + `vi.mock('electron')` | IPC handler logic, preload bridge surface, contract registry             | <50ms/test | ~20%               |
| E2E                    | Playwright `_electron`         | Full user journeys through real Electron                                 | 1–10s/test | ~10%               |

### 1.2 How leading apps structure tests

**VS Code** (`microsoft/vscode`, the reference architecture) splits tests into four top-level directories under `test/`:

- `test/unit/` — Node + browser unit tests, run via custom reporters (`test/unit/node/`, `test/unit/browser/`, `test/unit/electron/` with a preload + renderer harness). This is the bulk of the suite.
- `test/integration/electron/` — integration tests that run inside a real Electron renderer against the actual workbench, launched via a `testrunner.js` harness.
- `test/integration/browser/` — the same integration surface but against the web (browser) workbench.
- `test/smoke/` + `test/automation/` — end-to-end smoke tests driving the full app through a Playwright-based driver (`playwrightElectron.ts`, `playwrightDriver.ts`). The `automation/` package is a reusable Application/Workbench/Editor object model used by smoke, sanity, and remote tests.

Key takeaways from VS Code's structure:

1. **Process-targeted runners**: unit tests have separate `node/`, `browser/`, `electron/` entry points because the same code runs in different runtimes. Murmur's `vitest.config.js` `environment: "node"` plus `tests/unit/components/*.test.tsx` (jsdom via Testing Library) mirrors this idea.
2. **A driver layer between tests and Playwright**: VS Code's `automation/` package wraps Playwright calls in domain objects (`Editor`, `Explorer`, `Search`). Murmur already does a lighter version with `tests/e2e/helpers/electron-launch.js` + `ipc-mock.js` + `fixtures.js`.
3. **Smoke tests are first-class**: `test/smoke/src/areas/` organizes by feature area. Murmur's `tests/e2e/suites/00-ftue.test.js` through `10-errors.test.js` is the same pattern.

**Slack / Discord / 1Password** are closed-source, but their public engineering posts and the broader Electron community converge on:

- Playwright (or WebdriverIO) for E2E — Spectron is deprecated and no one recommends it for new work.
- Vitest or Jest for unit/integration, with `vi.mock('electron', ...)` as the standard mocking seam.
- A typed IPC channel registry (like Murmur's `src/helpers/ipc-contracts.ts`) as the contract source of truth, with a test that asserts every channel has both a handler and a preload binding.

### 1.3 Recommended ratio

Industry consensus (Google testing blog + community adaptations for desktop):

- **Unit ~70%, Integration ~20%, E2E ~10%** by test count.
- By _time spent_: invert it — E2E dominates wall-clock, so keep the E2E suite ruthlessly small (only critical user journeys).
- Murmur's current shape (674 unit tests, 39 e2e) is already pyramid-correct in count; the gap is that E2E is not yet passing in CI (see §8).

### 1.4 Spectron is dead — use Playwright

The Electron testing tutorial explicitly lists **Playwright** and **WebdriverIO** as the supported paths and no longer mentions Spectron. Playwright's `_electron.launch()` is the de facto standard for new Electron E2E work in 2024–2026.

---

## 2. IPC contract testing

This is the single most important layer for an Electron app, because the IPC boundary is where main↔renderer contracts silently break during refactors. Murmur already implements the industry pattern; the notes below generalize it.

### 2.1 Central channel registry as the contract source of truth

**Best practice**: define every IPC channel name as a typed constant in one module, imported by both the preload bridge and the main-process handlers. Never use string literals in `ipcRenderer.invoke(...)` or `ipcMain.handle(...)`.

Murmur does this with `src/helpers/ipc-contracts.ts` (`export const FUNASR = {...} as const`, etc.). The `as const` + named-export pattern is the correct TypeScript approach (the file header explicitly warns against `export default` because esbuild CJS wrapping breaks `C.AI` access).

### 2.2 Contract registry tests (what to assert)

A contract test suite should verify, at minimum:

1. **Shape**: every domain object is defined; every channel value is a non-empty string. (Murmur: `ipc-contracts.test.js` "every channel name is a non-empty string".)
2. **Uniqueness**: no two channels share a name across all domains — duplicate names cause silent handler overwrites (`ipcMain.handle` throws on duplicate, but `ipcRenderer.on` does not). (Murmur: "has no duplicate channel names across all domains".)
3. **No orphans (bidirectional)**:
   - Every channel constant is _referenced_ by at least one `ipcMain.handle`/`ipcMain.on` registration (otherwise the channel is dead).
   - Every channel constant is _referenced_ by the preload bridge (otherwise the renderer can't reach it).
   - Murmur's `ipc-contracts-orphans.test.js` implements this by scanning source text for `C.DOMAIN.KEY` references across `src/helpers/`, `preload.ts`, and `main.ts`, with an explicit `KNOWN_ORPHANS` allowlist for non-channel arrays like `AUDIO_EXTENSIONS`. This is a strong, if slightly brittle, pattern. A more robust variant parses the AST rather than grepping text, but text-scan is acceptable and cheap.
4. **Round-trip type safety**: with TypeScript, assert that the handler's parameter and return types match the preload's invoke signature. This is enforced at compile time by `tsc --noEmit` if the preload and handlers share imported types — Murmur's `typecheck` script covers this.

### 2.3 Preload↔handler surface equality

**Best practice**: assert that the set of methods `contextBridge.exposeInWorld('electronAPI', {...})` exposes is exactly the set the renderer expects, and that each maps to a registered channel.

Murmur's e2e suite 1.2 does a runtime version of this: it launches the app, reads `Object.keys(window.electronAPI)`, and asserts required methods are present. The unit-level complement is to import the preload module with a mocked `electron` and assert the exposed key set (see §4).

### 2.4 Testing main↔renderer communication without full E2E

There are three levels, cheapest first:

1. **Handler unit tests** (no Electron): extract handler logic into pure functions (`handleFileOpen(dir): Promise<File[]>`) and test them directly. The thin `ipcMain.handle('file-open', (_e, dir) => handleFileOpen(dir))` wrapper is then trivial. This is the single most important decoupling for testability.
2. **Handler registration tests** (mocked `electron`): `vi.mock('electron')` with an `ipcMain.handle` spy, import the handler module, and assert `ipcMain.handle` was called with each channel constant and a function. Then invoke the captured handler function with mock args and assert the return. This verifies wiring without launching Electron.
3. **Contract round-trip in a real renderer** (Playwright, but lighter than full E2E): launch the app, call `window.electronAPI.someMethod(args)` via `window.evaluate`, and assert the resolved value — with the real handler short-circuited via `ipcMain.removeHandler` + a mock if you want to isolate the bridge. Murmur's `ipc-mock.js` (`mockIpcHandler`) does exactly this `removeHandler`→`handle` swap.

Murmur's `windowHandlers.test.js`, `aiHandlers.test.js`, etc. sit at level 2. The `ipcRateLimitIntegration.test.js` is a good example of level 2 with cross-cutting behavior.

---

## 3. Main process testing

### 3.1 The core problem

Main-process modules (`BrowserWindow`, `Tray`, `globalShortcut`, `app`, `Menu`, `dialog`) only exist inside a running Electron process. Vitest runs in plain Node, so `require('electron')` fails or returns an incomplete object. Two strategies, in order of preference:

### 3.2 Strategy A — Decouple logic from Electron APIs (preferred)

Extract the _decision logic_ out of modules that touch Electron, leaving a thin shell that calls `BrowserWindow`/`Tray`. Test the extracted pure logic directly. Example:

```ts
// windowManager.ts — pure, testable
export function resolveWindowConfig(opts: WindowOptions): BrowserWindowConstructorOptions { ... }
// windowManager.ts — thin Electron shell (untested or integration-tested)
const win = new BrowserWindow(resolveWindowConfig(opts));
```

This is what VS Code does aggressively (`vs/platform` vs `vs/code`), and it's why VS Code can unit-test most of its windowing logic in Node.

### 3.3 Strategy B — Mock the `electron` module with `vi.mock`

For modules where the Electron coupling is intrinsic (Tray, globalShortcut), mock at the module level:

```ts
// __mocks__/electron.ts (or inline vi.mock factory)
import { vi } from "vitest";
const listeners: Record<string, Function> = {};
export const app = {
  whenReady: vi.fn(() => Promise.resolve()),
  getPath: vi.fn((name: string) => `/mock/${name}`),
  on: vi.fn((e: string, cb: Function) => {
    listeners[e] = cb;
  }),
  quit: vi.fn(),
  isReady: vi.fn(() => true),
};
export const BrowserWindow = vi.fn().mockImplementation(() => ({
  loadURL: vi.fn(),
  on: vi.fn(),
  show: vi.fn(),
  close: vi.fn(),
  webContents: { send: vi.fn(), on: vi.fn() },
  setSkipTaskbar: vi.fn(),
  isVisible: vi.fn(() => true),
}));
export const Tray = vi.fn().mockImplementation(() => ({
  setToolTip: vi.fn(),
  setContextMenu: vi.fn(),
  on: vi.fn(),
  popUpContextMenu: vi.fn(),
}));
export const globalShortcut = {
  register: vi.fn(() => true),
  unregister: vi.fn(),
  unregisterAll: vi.fn(),
};
export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
  removeAllListeners: vi.fn(),
};
export const Menu = {
  buildFromTemplate: vi.fn((t) => t),
  setApplicationMenu: vi.fn(),
};
export const dialog = {
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn(),
  showSaveDialog: vi.fn(),
};
```

Then in tests: `vi.mock('electron', () => mockElectron)`; import the manager; assert on `Tray.mock.instances[0].setContextMenu` calls, etc.

**Keep mocks minimal** — only include methods the code under test actually calls, or the mock grows unmaintainable.

### 3.4 Murmur-specific notes

Murmur's `vitest.config.js` currently _excludes_ the Electron-dependent helpers from coverage (`clipboard.ts`, `tray.ts`, `hotkeyManager.ts`, `windowManager.ts`, etc.) with the comment "require runtime IPC/BrowserWindow/app and cannot be unit-tested." That's a pragmatic call, but Strategy B above would let several of these gain real unit coverage. The highest-value targets to convert from "excluded" to "mocked + tested" are `hotkeyManager.ts` (register/unregister logic is pure decision logic around `globalShortcut`) and `windowManager.ts` (window-state decisions are pure). `tray.ts` and `pythonInstaller.ts` have more intrinsic platform coupling and are better left to integration/E2E.

### 3.5 globalShortcut testing specifics

`globalShortcut.register` returns a boolean (success/failure — accelerator may be taken by another app). Test the retry/fallback logic by having the mock return `false` for a primary combo and `true` for a fallback. Assert the manager registers the fallback and surfaces a status event.

---

## 4. Preload script testing

### 4.1 The challenge

`contextBridge.exposeInWorld(apiKey, apiObject)` runs in an isolated world that only exists in a real Electron renderer with `contextIsolation: true`. Vitest in Node has no `contextBridge`.

### 4.2 The standard pattern — capture the exposed API

Mock `electron` so `contextBridge.exposeInWorld` captures its argument, then assert on the captured object:

```ts
import { describe, it, expect, vi, beforeAll } from "vitest";

let exposedApi: Record<string, unknown>;
vi.mock("electron", () => ({
  contextBridge: {
    exposeInWorld: vi.fn((_key: string, api: Record<string, unknown>) => {
      exposedApi = api;
    }),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
}));

beforeAll(async () => {
  await import("../preload");
}); // side-effect: calls exposeInWorld

describe("preload bridge", () => {
  it("exposes exactly the expected method set", () => {
    expect(Object.keys(exposedApi).sort()).toMatchSnapshot();
  });
  it("each method maps to an ipcRenderer.invoke with a registered channel", async () => {
    const { ipcRenderer } = await import("electron");
    exposedApi.hideWindow();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith("hide-window"); // matches C.WINDOW.HIDE
  });
});
```

### 4.3 What to assert

1. **Surface completeness**: every method the renderer needs exists. Use a snapshot or an explicit list — and cross-check against the IPC contract registry (§2.2) so a new channel that's added to the registry but forgotten in the preload (or vice versa) fails the test.
2. **Channel binding**: each method calls `ipcRenderer.invoke` with the correct channel constant (not a string literal).
3. **No node leakage**: the exposed API must not contain `require`, `process`, `fs`, `ipcRenderer` itself, or any function that returns a raw `ipcRenderer` event. `contextBridge` strips these, but a test catches accidental exposure before runtime.
4. **Event unsubscribe hygiene**: methods that register `ipcRenderer.on` listeners (e.g. `onToggleDictation`) must return an unsubscribe function that calls `removeListener`. Assert the returned function removes the handler.

### 4.4 E2E-level preload verification

Murmur's e2e suite 1.1–1.2 already verifies the preload at runtime (`!!window.electronAPI` + `Object.keys(window.electronAPI)` contains required methods). This is the strongest check because it exercises the real `contextBridge`. Keep it. The unit-level capture test (§4.2) is a faster feedback loop for surface changes; the e2e check is the safety net.

### 4.5 contextIsolation must be on

Assert in a test (or in `main.ts`/`BrowserWindow` construction) that `webPreferences.contextIsolation === true` and `nodeIntegration === false`. This is mandatory security posture for Electron in 2024+. A unit test that imports the window config and asserts these booleans prevents a regression that silently re-enables node access.

---

## 5. E2E testing with Playwright `_electron`

### 5.1 Launch fundamentals

```js
const { _electron: electron } = require("@playwright/test");
const app = await electron.launch({
  args: [appRoot],
  env: { ...process.env, NODE_ENV: "test", MURMUR_DB_PATH: ":memory:" },
});
const window = await app.firstWindow();
await window.waitForLoadState("domcontentloaded");
// ... interact ...
await app.close();
```

- **Launch with the project root, not the bundle path.** Murmur's `electron-launch.js` documents a real bug here: passing `dist-main/main.js` as `args` made `app.getAppPath()` return `dist-main/`, breaking renderer/preload path resolution. Launching with `.` (the package.json dir) makes Electron read the `main` field correctly. This is a generalizable gotcha.
- **`firstWindow()` vs `windows()`**: `firstWindow()` waits for the first window; for multi-window apps use `app.windows()` and/or `app.waitForEvent('window')`. VS Code's driver checks `electron.windows()[0]` first, then falls back to `waitForEvent('window')` with a timeout — robust against races.

### 5.2 App lifecycle (ready/quit)

- Launch implicitly waits for `app.whenReady()`. To assert readiness, `await app.evaluate(({ app }) => app.isReady())`.
- Always close in `afterAll`/`afterEach`. Wrap in try/catch because the app may have already exited (Murmur's `closeElectronApp` does this).
- For quit-behavior tests, mock the close-behavior setting and assert the process exits: `await app.evaluate(({ app }) => app.quit())` then `await expect(app.process()).toBeNull()` or wait for the `close` event.

### 5.3 Multi-window management

- `app.windows()` returns all current `Page` objects (each BrowserWindow = a Page).
- To target a specific window (settings, history), match by URL or title:
  ```js
  const historyWindow =
    app.windows().find((w) => w.url().includes("history")) ??
    (await app.waitForEvent("window"));
  ```
- VS Code's driver attaches logging listeners (`window.on('console')`, `pageerror`, `crash`, `close`) to every window — adopt this for debugging flaky CI failures; route them to the Playwright trace.

### 5.4 Async operations (model download)

Long async flows (download) should be **mocked at the IPC boundary** rather than waited on for real. Murmur's `02-model-download.test.js` mocks `check-model-files` to return `stage: 'ready'` and reloads the window — this is the right approach. For testing the progress UI itself, mock the progress _event_ (`webContents.send(MODEL_DOWNLOAD_PROGRESS, {progress: 50})`) via `app.evaluate` and assert the progress bar updates. Never depend on a real network download in E2E — it's the #1 source of CI flakiness.

### 5.5 Native modules (better-sqlite3)

better-sqlite3 is a N-API native addon and the most common CI failure point for Electron apps that use it.

- **Rebuild against Electron's ABI**, not Node's. In dev/CI run `electron-builder install-app-deps` (Murmur's `postinstall` does this) or `@electron/rebuild -f -w better-sqlite3`. Murmur's `predev` runs `electron-rebuild`; the build workflow's test job runs `pnpm rebuild better-sqlite3`.
- **ABI mismatch symptom**: `Error: The module '.../better_sqlite3.node' was compiled against a different Node.js version` / `NODE_MODULE_VERSION mismatch`. Fix is always the rebuild.
- **asarUnpack**: when packaging, the `.node` binary must be unpacked from asar (`asarUnpack: ["**/node_modules/better-sqlite3/**"]`). electron-builder handles this; if you roll your own, don't forget it.
- **For unit tests**: better-sqlite3 works fine in plain Node (it's N-API), so Murmur's `database.test.js` can use a real temp-dir SQLite without mocking. The e2e suite uses `MURMUR_DB_PATH=:memory:` to get isolation without file cleanup. Both are valid; `:memory:` is faster and leaves no temp files.

### 5.6 Platform-specific behavior (macOS/Windows)

- **macOS**: `close_behavior: 'hide'` keeps the app alive with no visible window. Tray interactions differ (menu bar vs system tray). `app.dock.hide()`/`show()` is macOS-only — guard tests with `process.platform === 'darwin'`.
- **Windows**: tray is bottom-right; `globalShortcut` behavior around lock screen differs. Test the _decision logic_ (which platform branch is taken) in unit tests, and run platform-specific e2e on the matching CI runner.
- **CI matrix**: run E2E on `macos-latest` and `windows-latest` (and `ubuntu-latest` with xvfb — see §8). Tag platform-specific tests with `test.fixme`/`test.skip` guards.

### 5.7 Mocking native dialogs (showOpenDialog, showMessageBox)

Use `app.evaluate` to stub the dialog module — this avoids OS-level modal blocking:

```js
await app.evaluate(
  ({ dialog }, paths) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: paths });
  },
  ["/test/audio.wav"],
);
```

This is the pattern from the Playwright docs and what `electron-playwright-helpers.stubDialog` wraps. **Always stub dialogs in CI** — a real modal will hang the test until timeout.

### 5.8 The `ipc-mock.js` pattern (removeHandler → handle)

Murmur's `mockIpcHandler` is a generalizable, correct solution to a real Electron constraint: since Electron 20, `ipcMain.handle` throws if a handler is already registered for that channel. The mock does `ipcMain.removeHandler(channel)` then `ipcMain.handle(channel, () => response)`. This lets e2e tests short-circuit any handler with a canned response without touching the renderer. Keep it. One improvement: add a `mockIpcHandlerDynamic(app, channel, fn)` that accepts a function (not just a static object) so tests can vary the response by input args — currently only static responses are supported.

---

## 6. Regression testing strategy (post JS→TS migration)

Murmur is mid JS→TS "BigBang" migration. The risk surface is: type regressions, runtime behavior changes from `any`/casts, broken `require`/`import` resolution, and IPC contract drift. Industry guidance for refactor regressions:

### 6.1 Characterization / golden-master tests

Before a risky refactor, capture current behavior as baselines:

- **Snapshot tests** (Vitest `toMatchSnapshot`) for stable outputs: IPC handler return shapes, DB query results, export-formatter output. Murmur has `export-formatters.test.js` — extend snapshots to cover all formatters.
- **Approval testing** for complex transformations (transcription pipeline output) where exact assertions are brittle.

### 6.2 Critical paths that MUST be verified after the migration

For a speech-to-text app, the non-negotiable critical paths:

1. **App launch → FTUE → main window renders** (Suite 00, 01) — if this breaks, nothing else matters.
2. **Preload bridge exposes the full expected API** (Suite 1.2) — a TS migration that changes export shape can silently drop methods.
3. **IPC contract integrity** — every channel still has a handler and a preload binding (unit-level orphan test). The migration renamed `.js`→`.ts` and switched to named exports; the orphan test was explicitly updated to walk `.ts` files and read `preload.ts`/`main.ts`. This test is the migration's safety net — keep it green at all times.
4. **Settings round-trip** — get/set/reset (Suite 07) — settings drive all behavior; a serialization regression here cascades.
5. **DB CRUD** — save/get/delete/search transcriptions (unit `database.test.js`) — the persistence layer.
6. **Hotkey → recording → transcription → AI optimize → clipboard paste** — the full happy path (Suite 03 + 06). This is the product's reason to exist.
7. **File import → transcribe → export** (Suite 05) — the secondary flow.
8. **Close behavior** (hide vs quit, per platform) — Suite 09.

### 6.3 Tag by criticality

Tag tests `@critical` / `@smoke` / `@full` so CI can run critical-path regressions on every PR and the full suite nightly. Murmur's suite numbering (00–10) is an implicit priority ordering — formalize it with Playwright tags.

### 6.4 Watch out for source-text assertions

A subtle migration trap: tests that read source file _text_ and `toContain`/`toMatch` against it. These are not behavior tests — they pass/fail on source formatting, not behavior, so they give false confidence during a refactor (they can go "green" while behavior is broken, or "red" from a benign rename). Murmur's `comprehensive-test-strategy.md` flags 6 such files (117 assertions). Industry guidance: **convert these to behavior tests** that exercise the actual function. Where a text assertion is unavoidable (e.g., asserting a config file contains a required field), narrow it to the minimal load-bearing string.

---

## 7. Test data management (SQLite, Python/FunASR, audio)

### 7.1 SQLite

- **Unit tests**: real better-sqlite3 against a temp dir (`fs.mkdtempSync`) or `:memory:`. Murmur's `database.test.js` uses temp dirs with `beforeEach`/`afterEach` cleanup — this is correct and fast. `:memory:` is even faster and leaves no FS state; use it when you don't need to test file-path behavior.
- **E2E**: `MURMUR_DB_PATH=:memory:` env var (Murmur's `electron-launch.js`) gives each e2e run a clean DB with zero cleanup. This is the right default.
- **Fixtures**: keep seed data in a fixtures module (Murmur's `fixtures.js` `HISTORY_RECORDS`) and insert via the real `saveTranscription` IPC or direct DB call in `beforeEach`. Never ship real user data.

### 7.2 Python subprocess (FunASR)

FunASR is a heavyweight Python process (torch, modelscope). Never start it in unit tests; rarely in e2e.

- **Unit/integration**: mock the `child_process.spawn`/`funasrManager` boundary. Test the _process lifecycle logic_ (start, health-check, crash-restart, stop) with a fake subprocess that emits canned stdout/stderr and exits on cue. Murmur's `funasrServer-crash-restart.test.js` is this pattern.
- **E2E**: mock the transcription IPC channel (`mockIpcHandler(app, 'transcribe-audio', {...})`) to return canned text — never depend on a real Python runtime in e2e. Murmur's `03-recording.test.js` does this. A real-FunASR integration test belongs in a separate, opt-in suite (`test:python` / a nightly job), not the per-PR e2e.
- **Audio files**: commit small fixture `.wav` files (a few KB) under `tests/fixtures/audio/`. Generate them programmatically (`AudioContext` → wav, as Murmur's MediaRecorder mock already does with an oscillator) if you need deterministic silence/tone. Never commit large audio.

### 7.3 Fixture hygiene

- All fake credentials clearly marked (`FAKE_API_KEY = "sk-test-FAKE-..."` — Murmur's `fixtures.js` does this).
- No real API keys, ever. A pre-commit secret-scan guard is worth adding.

---

## 8. CI vs local testing

### 8.1 What runs where

| Suite                     | Local (developer) | CI (per PR)          | CI (nightly/release) |
| ------------------------- | ----------------- | -------------------- | -------------------- |
| Lint / typecheck / format | yes               | yes                  | yes                  |
| Unit + coverage           | yes               | yes                  | yes                  |
| IPC contract tests        | yes               | yes                  | yes                  |
| E2E (critical paths)      | yes               | yes (if fast enough) | yes                  |
| E2E (full suite)          | optional          | nightly              | yes                  |
| Real-FunASR integration   | manual            | no                   | yes (opt-in)         |
| Build per platform        | no                | no                   | yes (on tag)         |

### 8.2 Headless GUI in CI

Electron (Chromium) **needs a display** — it can't run truly headless like a browser.

- **Linux CI** (`ubuntu-latest`): wrap with `xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" npm run test:e2e`. `xvfb` is preinstalled on GitHub's Ubuntu runners. Also install Chromium deps (`libgbm1 libnss3 libatk-bridge2.0-0` — `npx playwright install --with-deps` covers most). Add `--no-sandbox` / `app.disableHardwareAcceleration()` if sandbox fails.
- **macOS CI** (`macos-latest`): runs GUI tests natively (no xvfb needed) — this is why Murmur's `ci.yml` uses `macos-latest`. The known issue is `firstWindow()` timeout in headless-ish runner environments. Mitigations: (a) explicit `timeout` in playwright.config (Murmur: 45000ms), (b) `app.disableHardwareAcceleration()` in a test-mode branch of `main.ts`, (c) `waitForEvent('window')` fallback like VS Code's driver.
- **Windows CI** (`windows-latest`): runs natively; watch for path-separator and case-sensitivity issues in fixtures.

### 8.3 Murmur's current CI gap

`comprehensive-test-strategy.md` notes e2e is 0/39 in CI due to `firstWindow()` timeout on macOS runners. Recommended fixes, in order:

1. Add `app.disableHardwareAcceleration()` when `NODE_ENV === 'test'` in `main.ts`.
2. Increase `firstWindow` tolerance and add the `waitForEvent('window')` fallback (VS Code pattern).
3. If still flaky, run e2e under `xvfb` on Linux instead of macOS — Linux runners are cheaper and xvfb is reliable.
4. Cache `~/.cache/ms-playwright` and the built bundles (`dist-main/`, `dist-preload/`, `src/dist/`) between jobs. Murmur's `global-setup.js` rebuilds every run — fine for correctness, slow for CI.

### 8.4 Parallelism

Playwright's default is parallel workers, but **Electron can't parallelize** on a single machine (resource contention, single app instance). Murmur correctly sets `workers: 1`. Keep it. To speed up, shard across CI matrix jobs (each job runs a subset of suites) rather than parallelizing within a job.

---

## 9. Coverage strategy

### 9.1 Realistic thresholds

Industry starting points for Electron apps are typically 50–70% for unit-only coverage, because main-process and preload code is hard to unit-test. Murmur has pushed this much higher than typical — its `vitest.config.js` sets `statements: 94, branches: 88, functions: 95, lines: 94` — by excluding Electron-dependent modules from the coverage _include_ and testing the rest thoroughly. That's an aggressive but defensible posture.

### 9.2 What to exclude

Always exclude from coverage:

- `node_modules/**`
- Native addon bindings (`**/*.node`, `**/build/Release/**`)
- Type declarations (`**/*.d.ts`)
- Electron runtime entry shims
- Build output (`dist*/**`, `src/dist/**`)
- IPC handler _registration_ wrappers that require a live `ipcMain` — unless you mock `electron` (§3.3), in which case include them.

Murmur's exclude list (`clipboard.ts`, `tray.ts`, `hotkeyManager.ts`, `pythonEnvironment.ts`, `pythonInstaller.ts`, `funasrManager.ts`, `funasrServer.ts`, `modelManager.ts`, `updateManager.ts`, `windowManager.ts`, `logManager.ts`, `src/helpers/ipc/**`) is the "can't easily unit-test" set. As noted in §3.4, several of these (`hotkeyManager`, `windowManager`) are convertible to mocked unit tests, which would let you move them back into coverage.

### 9.3 Branch coverage is the weak spot

`comprehensive-test-strategy.md` reports branches at 75.19% vs an 88% threshold — the migration's biggest coverage gap. Branches are hard in Electron code because error/edge paths often live inside `try/catch` around Electron calls that are mocked-out. Fix: in the `vi.mock('electron')` factories, make the mock methods _throw_ on demand (e.g. `BrowserWindow` constructor throws to test window-creation failure paths) so the error branches are reachable.

### 9.4 Don't chase 100%

Coverage measures _executed lines_, not _correct behavior_. A 95%-covered module with no assertions on its outputs is less valuable than a 70%-covered module with strong assertions. Murmur's high thresholds are good only because the tests assert behavior (DB queries return expected rows, formatters produce expected strings). Keep behavior > line coverage as the priority.

---

## 10. Performance testing

### 10.1 Startup time

- **Instrument lifecycle events**: in `main.ts`, record `performance.now()` at module load, at `app.whenReady()` resolve, at first `BrowserWindow` `ready-to-show`, and at `did-finish-load`. Emit them via `app.evaluate` in a Playwright test.
- **Cold vs warm**: cold = first launch (no OS file cache); warm = subsequent. CI only reliably measures warm. Measure cold locally.
- **Budget**: set a startup budget (e.g. < 2s to first paint on a dev machine) and fail the test if exceeded. VS Code tracks this in its smoke/sanity suites.
- **Common culprits**: synchronous `require()` chains in main (Murmur bundles with esbuild — good, this collapses the require tree), heavy preload scripts, eager Python/DB init. Defer non-critical init to after `ready-to-show`.

### 10.2 Window creation time

- Measure `new BrowserWindow()` → `ready-to-show`. Profile preload script execution separately (`--inspect-brk` on the preload).
- `webPreferences.backgroundThrottling = false` during perf tests so throttling doesn't skew numbers.

### 10.3 IPC latency

- Round-trip a no-op `ipcRenderer.invoke('__ping')` → `ipcMain.handle('__ping', () => null)` and measure wall-clock in the renderer. Typical Electron IPC latency: 0.1–5ms for small payloads; grows with serialization size.
- `invoke`/`handle` (promise-based) adds microtask overhead vs `send`/`on` — usually negligible, but measure if IPC is on a hot path.
- Watch for **excessive IPC chatter** (many small messages where one batched message would do) — a perf test that counts messages per user action catches this.

### 10.4 Memory / leak detection

- Run a long e2e (loop a recording→transcribe cycle N times) and assert `process.getProcessMemoryInfo()` in the main process doesn't grow unboundedly. VS Code's smoke suite does leak checks across repeated actions.

### 10.5 Tools

- `contentTracing` (Electron built-in) for production-grade trace capture.
- Chrome DevTools Performance panel (via `--inspect`) for renderer profiling.
- `clinic.js` for main-process Node profiling.
- `benchmark.js` for repeatable micro-benchmarks (e.g. DB query throughput).

---

## Appendix A: Murmur's current test architecture (mapped to industry layers)

| Industry layer                          | Murmur location                                                     | Tool                             | Status                           |
| --------------------------------------- | ------------------------------------------------------------------- | -------------------------------- | -------------------------------- |
| Unit (pure logic)                       | `tests/unit/` (formatters, db, i18n, type guards, utils)            | Vitest                           | Strong; 674 tests, 100% pass     |
| Unit (React components)                 | `tests/unit/components/*.test.tsx`                                  | Vitest + Testing Library + jsdom | Present                          |
| Contract (IPC registry)                 | `tests/unit/ipc-contracts.test.js`, `ipc-contracts-orphans.test.js` | Vitest                           | Strong; the migration safety net |
| Integration (handlers, mocked electron) | `tests/unit/*Handlers.test.js`, `ipcRateLimitIntegration.test.js`   | Vitest + `vi.mock`               | Present for some handlers        |
| E2E (full app)                          | `tests/e2e/suites/00–10`                                            | Playwright `_electron`           | 39 tests, local 15/39, CI 0/39   |
| E2E helpers                             | `tests/e2e/helpers/{electron-launch,ipc-mock,fixtures}.js`          | Playwright                       | Well-factored                    |
| E2E (legacy)                            | `tests/e2e/legacy/`                                                 | Playwright                       | Superseded by suites/            |

## Appendix B: Priority recommendations (ranked)

1. **Fix e2e in CI** — add `app.disableHardwareAcceleration()` in test mode + `waitForEvent('window')` fallback (§8.3). Biggest unblock.
2. **Convert source-text assertions to behavior tests** — 6 files, 117 assertions risk false greens during the TS migration (§6.4).
3. **Add a preload bridge unit test** (§4.2) — fast feedback loop for surface changes, complementing the e2e runtime check.
4. **Add `mockIpcHandlerDynamic`** (function-based mock) to `ipc-mock.js` (§5.8) — enables input-dependent e2e mocks.
5. **Mock `electron` to unit-test `hotkeyManager` and `windowManager`** (§3.3–3.4) — moves two modules from excluded to covered, lifts branch coverage.
6. **Formalize critical-path tags** (`@critical`/`@smoke`) on suites 00–03 (§6.3) — enables fast PR-time e2e subset.
7. **Add a startup-time perf test** (§10.1) — guard against the migration introducing startup regressions.

---

## References

- Playwright Electron API — https://playwright.dev/docs/api/class-electron
- Electron automated testing tutorial — https://www.electronjs.org/docs/latest/tutorial/automated-testing
- VS Code test directory (`unit/`, `integration/`, `smoke/`, `automation/`) — https://github.com/microsoft/vscode/tree/main/test
- VS Code Playwright Electron driver (`playwrightElectron.ts`, `playwrightDriver.ts`) — https://github.com/microsoft/vscode/blob/main/test/automation/src/playwrightElectron.ts
- Vitest — https://vitest.dev/
- electron-playwright-helpers — https://github.com/spaceageturtles/electron-playwright-helpers
- `@electron/rebuild` (native module rebuild) — https://github.com/electron/rebuild
- Electron security (contextIsolation, nodeIntegration) — https://www.electronjs.org/docs/latest/tutorial/security
