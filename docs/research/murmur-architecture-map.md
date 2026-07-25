# Murmur Architecture Map — Test Strategy Foundation

A complete map of the Murmur Electron app architecture. For each subsystem: what it does, its dependencies, its public interface (the testing seam), and testing challenges. Source paths are absolute.

Murmur is a Chinese-optimized speech-to-text desktop app. Electron main process manages a Python FunASR subprocess for ASR, persists transcriptions to encrypted SQLite, optionally post-processes text through a configurable AI provider, and pastes results via simulated OS keystrokes. The renderer is a React 19 SPA that talks to main exclusively through a `contextBridge`-exposed `window.electronAPI`.

> Migration note (ADR-010): the backend recently migrated from `.js` to `.ts` ("big-bang"). All `.js` twins are deleted. `tests/_tsresolve.setup.js` monkey-patches Node's loader so legacy `.js` tests can `require("../../src/helpers/X")` and resolve `.ts`, and unwraps `{__esModule, default}` to the class so `new require()()` works.

---

## 0. Test Infrastructure Overview (read first)

| Layer | Runner                | Config                 | Root                  | What it covers                                                    |
| ----- | --------------------- | ---------------------- | --------------------- | ----------------------------------------------------------------- |
| Unit  | Vitest                | `vitest.config.js`     | `tests/unit/**`       | Pure logic + Electron-dependent classes via source-text / require |
| E2E   | Playwright (electron) | `playwright.config.js` | `tests/e2e/suites/**` | Full app via bundled `dist-main/main.js`                          |

Key fixtures:

- `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/_tsresolve.setup.js` — Vitest setup; PART1 registers `.ts` extension handler (esbuild transform to CJS), PART2 resolves extensionless require to `.ts`, PART3 unwraps ESM default-export to the class. This is the linchpin that lets `.js` unit tests require `.ts` source.
- `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/e2e/helpers/electron-launch.js` — `launchElectronApp()` launches Electron with `args:[appRoot]` (so `app.getAppPath()` is the project root, not `dist-main/`), `NODE_ENV=test`, `MURMUR_DB_PATH=:memory:` (in-memory SQLite), and injects a `getUserMedia` mock.
- `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/e2e/helpers/global-setup.js` — builds `dist-main`, `dist-preload`, `src/dist` once before all e2e suites.
- `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/e2e/helpers/ipc-mock.js` — `mockIpcHandler(app, channel, response)` uses `app.evaluate` to `removeHandler` then re-register a static mock. Works around Electron 20+ "cannot register a second handler".
- `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/e2e/helpers/fixtures.js` — shared test fixtures.

Vitest coverage (`vitest.config.js` `coverage`):

- Includes `src/helpers/**`, `src/utils/**`, `src/bootstrap/**`.
- **Excludes** (Electron-runtime-dependent, can't unit-test): `clipboard.ts`, `environment.ts`, `tray.ts`, `hotkeyManager.ts`, `pythonEnvironment.ts`, `pythonInstaller.ts`, `funasrManager.ts`, `funasrServer.ts`, `modelManager.ts`, `updateManager.ts`, `windowManager.ts`, `logManager.ts`, and all of `src/helpers/ipc/**`.
- Thresholds: statements 94%, branches 88%, functions 95%, lines 94%.

Critical: many managers use lazy `require("electron")` inside try/catch (hoisting-safe) precisely so unit tests can load the source without Electron present. The `_tsresolve.setup.js` unwrap returns the class directly so `new require("../../src/helpers/X")()` works.

---

## 1. Entry Points

### 1.1 `main.ts` — Main process entry

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/main.ts`

**What it does (startup sequence):**

1. Constructs `LogManager`, installs `uncaughtException`/`unhandledRejection` handlers (EPIPE ignored).
2. `setupProductionPath()` — extends `process.env.PATH` with platform-specific Python locations (Homebrew, python.org framework paths on macOS; `LOCALAPPDATA\Programs\Python` on Windows). Only in production.
3. Sets `process.env.ELECTRON_USER_DATA = app.getPath("userData")`.
4. Instantiates all managers: `EnvironmentManager`, `WindowManager`, `DatabaseManager(logger?)` — actually `new DatabaseManager()` (no logger passed here), `ClipboardManager(logger)`, `FunASRManager(logger)`, `TrayManager()` (no logger), `HotkeyManager()` (no logger).
5. `environmentManager.ensureDataDirectory()` → `databaseManager.initialize(dir)` → `setFileConfigPath(path.join(dir, "murmur.json"))`.
6. `registerIPCHandlers(ipcMain, { environmentManager, databaseManager, clipboardManager, funasrManager, windowManager, hotkeyManager, logger })` — the managers bag.
7. `app.whenReady()`:
   - If `safeStorage.isEncryptionAvailable()` → `databaseManager.setSafeStorage(safeStorage)` (triggers settings migration to encrypt `ai_api_key`).
   - `startApp()`: logs system info; in dev waits 2s for Vite; shows macOS dock; `funasrManager.initializeAtStartup()` (fire-and-forget, non-blocking); `_setupCSP()`; reads `window_always_on_top` setting; `createMainWindow()`; `trayManager.setWindows(mainWindow)` + `createTray()`.
8. Event handlers: `window-all-closed` (quit unless macOS), `activate` (recreate window), `will-quit` (preventDefault → `globalShortcut.unregisterAll()` → `funasrManager.gracefulShutdown()` with 5s race → `databaseManager.close()` → `app.exit()`).
9. ESM exports all manager singletons (no consumer imports main.ts as a module).

**Dependencies:** `electron` (app, globalShortcut, BrowserWindow, safeStorage, ipcMain), all 7 managers, `EnvironmentManager` for data dir, `registerAll` from `src/helpers/ipc`.

**Public interface / testing seam:**

- E2E only — e2e launches the bundled `dist-main/main.js`. The startup sequence is exercised by suite `01-lifecycle`.
- `will-quit` graceful shutdown is a critical path to test (FunASR shutdown race, DB close).
- The managers bag shape (`{ environmentManager, databaseManager, clipboardManager, funasrManager, windowManager, hotkeyManager, logger }`) is the contract that `registerAll` consumes; tests that mock IPC can construct this bag.

**Testing challenges:**

- Whole-process startup; can't unit test the `app.whenReady` flow.
- `setupProductionPath` mutates `process.env.PATH` — platform-specific, hard to test in isolation.
- FunASR init is fire-and-forget; race conditions between server startup and first transcription.
- `will-quit`'s 5s shutdown race + `app.exit()` — timing-sensitive.

**Critical paths:** window creation, DB initialization, IPC registration, safeStorage wiring, tray setup, graceful quit.

---

### 1.2 `preload.ts` — Preload bridge

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/preload.ts`

**What it does:** Calls `contextBridge.exposeInMainWorld("electronAPI", {...})` mapping ~70 methods to `ipcRenderer.invoke(C.CHANNEL, ...args)` and `ipcRenderer.on(C.EVENTS.X, handler)` listeners. Also exposes `constants` (app name, supported formats, default hotkey, limits) and, in dev, a `debug` object.

**Complete `electronAPI` method inventory** (grouped by subsystem, all return Promises from `invoke`; listeners return an unsubscribe function):

- **Window:** `hideWindow`, `showWindow`, `minimizeWindow`, `maximizeWindow`, `isWindowMaximized`, `closeWindow`, `closeApp`, `setAlwaysOnTop(bool)`, `onWindowMaximizeChange(cb)`, `openHistoryWindow`, `closeHistoryWindow`, `hideHistoryWindow`, `openSettingsWindow`, `closeSettingsWindow`, `hideSettingsWindow`.
- **Dictation event:** `onToggleDictation(cb)`.
- **FunASR:** `transcribeAudio(data)`, `checkFunASRStatus()`, `installFunASR()`, `restartFunasrServer()`.
- **Models:** `checkModelFiles()`, `getDownloadProgress()`, `downloadModels()`, `downloadModel(name)`, `getAvailableModels()`, `getCurrentModel()`, `switchModel(name)`, `onModelDownloadProgress(cb)`.
- **AI:** `processText(text, mode, timeout?)`, `checkAIStatus(testConfig?)`, `getAIModes()`, `getAIProviderPresets()`, `detectLocalModels()`.
- **Clipboard:** `pasteText(text)`, `copyText(text)`, `readClipboard()`, `writeClipboard(text)`.
- **Transcription DB:** `saveTranscription(data)`, `getTranscriptions(limit, offset)`, `getTranscription(id)`, `searchTranscriptions(query, limit)`, `getTranscriptionStats()`, `deleteTranscription(id)`, `clearAllTranscriptions()`, `diarizeAudio(id)`.
- **File transcription:** `importAudioFile()`, `validateAudioFile(path)`, `transcribeFile(path, options)`, `cancelFileTranscription()`, `onFileTranscriptionProgress(cb)`.
- **Export / AI review:** `exportTranscription(id, format, options)`, `exportTranscriptions(format)`, `aiReviewTranscription(id, template)`.
- **Settings:** `getSettings()` (legacy), `getAllSettings()`, `getSetting(key, default?)`, `setSetting(key, value)`, `saveSetting(key, value)`, `resetSettings()`, `importSettings()`, `exportSettings()`, `onSettingsUpdate(cb)`.
- **Hotkey:** `registerHotkey(hotkey)`, `unregisterHotkey(hotkey)`, `getCurrentHotkey()`, `registerF2Hotkey()`, `unregisterF2Hotkey()`, `setRecordingState(bool)`, `getRecordingState()`, `onF2DoubleClick(cb)`, `onHotkeyTriggered(cb)`.
- **System:** `getSystemInfo()`, `checkPermissions()`, `requestPermissions()`, `testAccessibilityPermission()`, `openSystemPermissions()`, `getAppVersion()`, `openExternal(url)`, `log(level, message)`.
- **Update:** `checkForUpdates()`, `downloadUpdate(info)`, `cancelUpdateDownload()`, `installUpdate(filePath)`, `onUpdateDownloadProgress(cb)`, `onUpdateDownloadComplete(cb)`, `onUpdateDownloadError(cb)`.
- **Events:** `onTranscriptionUpdate(cb)`, `onProcessingUpdate(cb)`, `onError(cb)`.

`constants`: `APP_NAME`, `VERSION`, `SUPPORTED_AUDIO_FORMATS` (wav/mp3/m4a/flac/ogg/wma/aac), `SUPPORTED_EXPORT_FORMATS` (txt/docx/srt/vtt/md), `DEFAULT_HOTKEY`, `MAX_RECORDING_DURATION` (300000), `MAX_TEXT_LENGTH` (10000), `CHINESE_LANGUAGE_CODES`.

**Dependencies:** `electron` (contextBridge, ipcRenderer), `./src/helpers/ipc-contracts` (all channel name constants).

**Public interface / testing seam:**

- The TypeScript declaration `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/electronAPI.d.ts` is the typed contract the renderer imports; `src/bootstrap/assertElectronAPI.ts` asserts preload exposure at runtime.
- Unit tests: `tests/unit/preload-loadable.test.js` (loads source), `tests/unit/preload-listener-lifecycle.test.js` (listener unsubscribe), `tests/unit/assert-electron-api.test.js`.
- E2E: `01-lifecycle` test "electronAPI exposes core methods" enumerates `Object.keys(window.electronAPI)`.
- Channel-name contracts are centralized in `ipc-contracts.ts` — `tests/unit/ipc-contracts.test.js` and `ipc-contracts-orphans.test.js` guard that every channel constant is referenced by preload and handlers.

**Testing challenges:**

- `contextBridge.exposeInMainWorld` requires Electron; can't run in pure node. Tests load source as text or assert shape.
- Every listener must return an unsubscribe that calls `removeListener` (leak guard). The lifecycle test covers this.
- Renderer type-safety: `electronAPI.d.ts` must stay in sync with `preload.ts` — drift is a silent bug.

**Critical paths:** every method the renderer calls is a seam; the channel constants must line up exactly between preload, handlers, and the `.d.ts`.

---

## 2. Managers (`src/helpers/`)

All managers follow a pattern: class with `constructor(logger?)`, `Logger` interface accepting `console` or `LogManager`, lazy `require("electron")` inside methods where needed (hoisting-safe for unit tests).

### 2.1 WindowManager

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/windowManager.ts`

**What it does:** Creates and manages three `BrowserWindow` instances — `mainWindow` (520x640, frameless, transparent, always-on-top, skipTaskbar), `historyWindow` (1000x700), `settingsWindow` (700x600). Sets CSP via `session.defaultSession.webRequest.onHeadersReceived` (strict prod CSP, permissive dev CSP with `unsafe-eval` + localhost). All windows: `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, preload at `app.getAppPath()/dist-preload/preload.js`. Dev loads `http://localhost:5173`; prod loads `src/dist/{index,history,settings}.html`. Tracks `_preMaximizeBounds` (Windows transparent-window maximize workaround). Guards against duplicate creation (`_creatingMainWindow` flag).

**Dependencies:** `electron` (BrowserWindow, session, app), `path`, `ipc-contracts` (EVENTS.WINDOW_MAXIMIZE_CHANGE).

**Public interface:** `setDefaultAlwaysOnTop(bool)`, `_setupCSP()`, `createMainWindow()`, `createHistoryWindow()`, `createSettingsWindow()`, `show/hide/closeHistoryWindow()`, `show/hide/closeSettingsWindow()`, `closeAllWindows()`. Properties: `mainWindow`, `historyWindow`, `settingsWindow`, `_preMaximizeBounds`.

**Testing seam:** Unit-testable for path logic and CSP string construction only — `BrowserWindow`/`session` require Electron. `tests/unit/windowManager-events.test.js` tests event wiring. E2E `09-window` covers maximize/restore/hide.

**Testing challenges:**

- Real `BrowserWindow` creation needs a display + Electron runtime.
- CSP header rewriting via `webRequest` is hard to assert without an actual renderer request.
- Windows transparent-window maximize quirk (`_preMaximizeBounds`) is platform-specific.
- `app.getAppPath()` must resolve correctly — e2e launch passes `args:[appRoot]` specifically to keep `getAppPath()` at the project root.

**Critical paths:** CSP setup (security), main window creation, maximize toggle (Windows bug fix), preload path resolution.

---

### 2.2 DatabaseManager

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/database.ts`

**What it does:** SQLite via `better-sqlite3`. Creates `transcriptions` and `settings` tables, an FTS5 virtual table (`transcriptions_fts`, trigram tokenizer) with insert/delete/update triggers, and indexes. Runs schema migrations (`source_type`, `source_file_path`, `segments` columns) and settings migration (encrypt plaintext `ai_api_key` on first safeStorage availability). Encryption: `_encryptedKeys` Set (currently `ai_api_key`); `_encryptValue`/`_decryptValue` wrap `safeStorage.encryptString`/`decryptString` with base64 + `{_enc}` JSON envelope. FTS search falls back to LIKE for queries <3 chars or if FTS5 unavailable. File-config cache (`murmur.json`) for `FILE_CONFIGURABLE_KEYS` (set by `setFileConfigPath`); `getSetting` falls back to file config when DB has no row. WAL journal mode, `busy_timeout=5000`, integrity check on init. `backup()` async. Env override `MURMUR_DB_PATH` (supports `:memory:` for tests).

**Dependencies:** `better-sqlite3` (native, must be electron-rebuilt), `path`, `fs`, `fileConfig` (`loadFileConfig`, `saveFileConfig`, `FILE_CONFIGURABLE_KEYS`). Optional `safeStorage` injected via `setSafeStorage`.

**Public interface:** `initialize(dir)`, `setSafeStorage(ss)`, `setFileConfigPath(p)`, `createTables()`, `saveTranscription(data)`, `getTranscriptions(limit, offset)`, `getTranscriptionById(id)`, `getTranscriptionWithSegments(id)`, `deleteTranscription(id)`, `clearAllTranscriptions()`, `searchTranscriptions(query, limit)`, `getTranscriptionStats()`, `setSetting(key, value)`, `getSetting(key, default?)`, `getAllSettings()`, `resetSettings()`, `syncToFileConfig()`, `backup(path)`, `close()`. `TranscriptionRecord` interface exported.

**Testing seam:** **Best-unit-tested manager.** `MURMUR_DB_PATH=:memory:` enables in-memory SQLite without Electron. `tests/unit/database.test.js`, `database-fts.test.js`, `database-coverage.test.js`. SafeStorage can be mocked with a plain `{encryptString, decryptString, isEncryptionAvailable}` stub. No Electron dependency in the class itself.

**Testing challenges:**

- `better-sqlite3` is a native module — needs `electron-rebuild` for the right `NODE_MODULE_VERSION`. Error message in `initialize` explicitly detects mismatch and instructs `npx electron-rebuild`.
- FTS5 availability varies by SQLite build; tests must cover LIKE fallback.
- Encryption migration is irreversible — test with throwaway DBs.
- File-config cache is read once at `setFileConfigPath`; cache staleness if file changes externally.

**Critical paths:** schema creation, FTS trigger correctness, encrypted settings round-trip, search (FTS + LIKE fallback), migration idempotency, WAL/integrity on init.

---

### 2.3 ClipboardManager

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/clipboard.ts`

**What it does:** Clipboard read/write via `electron.clipboard` and cross-platform paste via simulated keystrokes. `pasteText(text)`: saves original clipboard, writes text, then platform branch — macOS: `checkAccessibilityPermissions()` then `pasteMacOS()` (spawns `osascript -e 'tell application "System Events" to keystroke "v" using command down'` with 3s timeout, restores clipboard 100ms later); Windows: `pasteWindows()` (PowerShell `SendKeys "^v"`); Linux: `pasteLinux()` (`xdotool key ctrl+v`). `enableMacOSAccessibility`/`checkAccessibilityPermissions` probe via `osascript` and, on failure, `showAccessibilityDialog` (distinguishes "stuck permission" errors -1719/-25006) which spawns a dialog and `openSystemSettings` (tries `x-apple.systempreferences:...` URL, then bundle id, then prefpane path, then `open -a`). Optional `osascript` npm module loaded via `require()` in try/catch (macOS only).

**Dependencies:** `electron` (clipboard), `child_process.spawn`, optional `osascript` package (macOS).

**Public interface:** `pasteText(text)`, `copyText(text)`, `readClipboard()`, `writeClipboard(text)`, `enableMacOSAccessibility()`, `insertTextDirectly(text)`, `checkAccessibilityPermissions()`, `showAccessibilityDialog(err)`, `openSystemSettings()`, `safeLog(msg, data?)`.

**Testing seam:** Excluded from coverage — Electron `clipboard` + `spawn` + osascript dependency. E2E `06-clipboard` covers paste. The `safeLog` and platform branches could be unit-tested by mocking `clipboard` and `spawn`, but the class is coverage-excluded.

**Testing challenges:**

- Native OS paste requires real accessibility permissions and a focused target app — not automatable in CI.
- `osascript` spawn timing (3s timeout, 100ms restore delay) is flaky.
- Permission dialog spawns a modal — blocks tests.
- Cross-platform: each branch only runs on its OS.
- Clipboard restore race: if paste fails, original clipboard is lost.

**Critical paths:** paste flow (save → write → keystroke → restore), accessibility permission detection, graceful degradation (text always copied to clipboard even if paste fails).

---

### 2.4 TrayManager

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/tray.ts`

**What it does:** Creates a `Tray` with icon (`assets/icon.png`, resized to 16x16 + template image on macOS; empty image fallback). Context menu: show main window, About (dialog with versions + repo URL), Quit. Click toggles main window visibility; right-click pops context menu. `setStatus(status)` updates tooltip ("recording"/"processing"/"ready"). Icon path: dev `app.getAppPath()/assets/icon.png`; prod `process.resourcesPath/assets/icon.png`.

**Dependencies:** `electron` (Tray, Menu, nativeImage, dialog, app), `path`, `fs`.

**Public interface:** `setWindows(mainWindow)`, `createTray()`, `getTrayIconPath()`, `updateContextMenu()`, `destroy()`, `setStatus(status)`.

**Testing seam:** Coverage-excluded. E2E doesn't directly assert tray (hard to access). Logic like `getTrayIconPath` platform branching could be unit-tested but isn't.

**Testing challenges:**

- `Tray`/`Menu`/`nativeImage` need a real desktop environment.
- Tray interactions aren't accessible via Playwright (OS-level UI).
- Icon path resolution differs dev/prod.

**Critical paths:** tray creation (app must be minimizable to tray), quit menu, click-to-toggle.

---

### 2.5 HotkeyManager

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/hotkeyManager.ts`

**What it does:** Wraps `electron.globalShortcut`. Two modes: (1) traditional hotkey (`registerHotkey(hotkey, cb)`) with 200ms debounce per hotkey; (2) F2 double-click (`registerF2DoubleClick(cb)`) — registers F2, tracks click timestamps within 500ms window, fires callback with `{action: start|stop, currentState}` based on `isRecording`. Tracks `registeredHotkeys` Map, `lastHotkeyTrigger` Map for debounce. `setRecordingState`/`getRecordingState` for external sync.

**Dependencies:** `electron` (globalShortcut).

**Public interface:** `registerF2DoubleClick(cb)`, `handleF2Click()`, `handleF2DoubleClick()`, `registerHotkey(hotkey, cb)`, `unregisterHotkey(hotkey)`, `unregisterAllHotkeys()`, `getRegisteredHotkeys()`, `isHotkeyRegistered(hotkey)`, `setRecordingState(bool)`, `getRecordingState()`.

**Testing seam:** Coverage-excluded (`globalShortcut` needs Electron). But the **debounce and double-click timing logic is pure** and could be extracted/tested. Currently not unit-tested. E2E `04-hotkey` covers F2 flow.

**Testing challenges:**

- `globalShortcut.register` needs a real OS window manager; can't register system-wide hotkeys in headless CI.
- F2 double-click timing (500ms window) is timing-sensitive.
- Hotkey collisions with other apps.
- Debounce correctness hard to assert without real triggers.

**Critical paths:** F2 double-click detection, recording-state toggling, unregister on will-quit (done in main.ts), per-sender dedup (in `hotkeyHandlers`).

---

### 2.6 FunASRManager (orchestrator/facade)

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/funasrManager.ts`

**What it does:** Facade composing `PythonEnvironment` + `ModelManager` + `FunASRServer`. Delegates Python discovery, model checks, and transcription to each. Property accessors (`pythonCmd`, `funasrInstalled`, `modelsInitialized`, `serverReady`, `modelsDownloaded`, `initializationPromise`) proxy to sub-managers. `initializeAtStartup()` — finds Python, checks FunASR install, sets `isInitialized`, calls `preInitializeModels()`. `preInitializeModels()` — if not already initializing, starts the server (guarded by `initializationPromise`). `restartServer()` — awaits current init, stops server, resets state, clears caches, re-checks models, restarts. `checkStatus()` — if server ready, pings; else aggregates install + model status into a status object with `status_message`-ready fields.

**Dependencies:** `PythonEnvironment`, `ModelManager`, `FunASRServer` (all default imports).

**Public interface:** all delegation methods above + `initializeAtStartup()`, `preInitializeModels()`, `checkStatus()`, `restartServer()`. Getters for sub-manager state.

**Testing seam:** Coverage-excluded (sub-managers need Electron/spawn). `tests/unit/funasrManager-init-race.test.js` tests the init race (source-text or mocked subs). The facade pattern means sub-managers can be mocked to test orchestration logic (restart sequence, status aggregation).

**Testing challenges:**

- Three-level composition (PythonEnv → ModelManager → Server); mocking all three is heavy.
- `initializeAtStartup` is fire-and-forget — race between it and first user action.
- `restartServer` touches private `serverProcess`/`restartCount` via casts.
- Server lifecycle (start/stop/restart) state machine is complex.

**Critical paths:** `initializeAtStartup` non-blocking, `preInitializeModels` idempotency (guarded by `initializationPromise`), `restartServer` clean stop-then-start, `checkStatus` accurate status_message.

---

### 2.7 FunASRServer (Python subprocess lifecycle)

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/funasrServer.ts`

**What it does:** Spawns `python funasr_server.py --damo-root <cachePath>` with `stdio:['pipe','pipe','pipe']`, `windowsHide:true`, the built Python env. Waits for first JSON line on stdout (`{success:true}`) → sets `serverReady`/`modelsInitialized`, starts health monitor (30s interval pings with 5s timeout), attaches `ServerMessageRouter` to the process. On process `close`: stops health monitor, detaches router, clears state; if not stopping and not init-rejecting, calls `_handleServerCrash`. `_handleServerCrash` — increments `restartCount`, gives up after `maxRestarts=3`, restarts via saved `_startupParams`. `transcribeAudio(blob, opts)` — creates temp wav file, sends `{action:"transcribe", audio_path, options}`, cleans up temp. `transcribeFile(path, opts)` — validates ext/size (500MB cap, `C.AUDIO_EXTENSIONS`), waits for ready, uses **dynamic timeout** `calculateTranscriptionTimeout(size)` (5min min, 60min max, 6s/MB) via `messageRouter.sendCommand("transcribe_file", ..., {onProgress})`. `diarizeAudio`, `cancelTranscription` via router. `gracefulShutdown()` — writes `{action:"exit"}`, waits 5s, then SIGKILL (Windows: `taskkill /T /F /PID` to kill the tree). `resetState()`. Static `calculateTranscriptionTimeout` exported for tests.

**Dependencies:** `child_process` (spawn, spawnSync), `fs`, `path`, `ServerMessageRouter`, `audioFileHelpers` (createTempAudioFile, cleanupTempFile), `ipc-contracts` (AUDIO_EXTENSIONS).

**Public interface:** `_startFunASRServer(env, cmd, path, cache)`, `_startHealthMonitor()`, `_stopHealthMonitor()`, `_handleServerCrash()`, `_sendServerCommand(cmd)`, `_stopFunASRServer()`, `gracefulShutdown()`, `resetState()`, `transcribeAudio(blob, opts)`, `transcribeFile(path, opts)`, `diarizeAudio(path, segments)`, `cancelTranscription()`. Static `calculateTranscriptionTimeout`. Properties: `serverProcess`, `serverReady`, `modelsInitialized`, `initializationPromise`, `messageRouter`, `restartCount`, `maxRestarts`.

**Testing seam:** Coverage-excluded (spawn + Electron-adjacent). `tests/unit/funasrServer-crash-restart.test.js` tests crash/restart logic. `calculateTranscriptionTimeout` is a pure function — `tests/unit/dynamicTranscriptionTimeout.test.js`. The message protocol is testable via `ServerMessageRouter` mocks.

**Testing challenges:**

- Real Python subprocess + model loading is slow (minutes) and needs the embedded Python env.
- Crash/restart simulation needs a fake `ChildProcess` with controllable `close`/`error` events.
- Health monitor setInterval + 5s ping timeout — timing in tests.
- Windows `taskkill /T /F` tree-kill — platform-specific.
- 120s startup timeout — tests must not hit it.

**Critical paths:** startup handshake (first JSON line), health monitor ping/pong, crash auto-restart (≤3), graceful shutdown (exit cmd → SIGKILL), dynamic transcription timeout, temp file cleanup in `finally`.

---

### 2.8 ModelManager

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/modelManager.ts`

**What it does:** Manages three FunASR models (asr paraformer-large 840MB required, vad fsmn 1.6MB required, punc ct-transformer 278MB optional). `getModelCachePath()` — searches candidates: dev `app.getAppPath()/models`, `userData/models`, `~/.cache/modelscope/hub/models`; picks first with a `damo` subdir or expected model files; else `findDamoRoot` recursive search (depth 5); fallback creates `userData/models`. `checkModelFiles()` — 2s global cache (`globalModelCheckCache`); for each model checks existence + `_verifyModel` (directory: has `model.pt`/`pytorch_model.bin`/`configuration.json`/`config.yaml`; file: size ≥ 90% expected). `getDownloadProgress()` — sums actual vs expected sizes. `downloadModels(cb, pythonCmd)` — skips if already downloaded; spawns `python download_models.py --output <cachePath>`, parses JSON stdout lines (`{stage, percentage, success, error}`), 10min timeout, calls progress callback. `clearCache()`.

**Dependencies:** `fs`, `path`, `child_process.spawn`, `os`, lazy `require("electron")` (app.getPath/app.getAppPath).

**Public interface:** `findDamoRoot(dir, depth, maxDepth)`, `getModelCachePath()`, `checkModelFiles()`, `_verifyModel(file, config)`, `getDownloadProgress()`, `getDownloadScriptPath()`, `downloadModels(cb, pythonCmd)`, `clearCache()`. Property `modelConfigs`, `modelsDownloaded`.

**Testing seam:** Coverage-excluded. `tests/unit/modelManager-shape.test.js` (shape), `tests/unit/model-download-guards.test.js`. `findDamoRoot`, `_verifyModel`, and path logic are pure-ish (fs only) and could be unit-tested with temp dirs. `downloadModels` needs spawn mock.

**Testing challenges:**

- Model files are huge (GB) — can't ship in tests; use fake files/sizes.
- `getModelCachePath` probes multiple real filesystem locations + recursive search — needs temp-dir fixtures.
- Download is a long Python subprocess — mock `spawn` with controllable stdout.
- 2s global cache can cause test interference if not cleared (`clearCache`).
- Platform path differences (`os.homedir`, modelscope cache).

**Critical paths:** model presence/verification (asr+vad required = `minimum_ready`), download progress JSON parsing, cache path resolution, partial-download resume detection.

---

### 2.9 PythonEnvironment

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/pythonEnvironment.ts`

**What it does:** Locates a Python 3.8+ executable. `findPythonExecutable()` — checks embedded Python (`python/bin/python3.11`), verifies version; dev falls back to system Python (`.venv`, homebrew, /usr/bin, etc.); prod throws if embedded missing. `setupIsolatedEnvironment()` — sets `PYTHONHOME`/`PYTHONPATH` for embedded Python. `buildPythonEnvironment()` — cached env copy with `PYTHONUTF8=1` (critical for Chinese paths on Windows), embedded python `PATH`/`PYTHONHOME`/`PYTHONPATH`/`MPLBACKEND=Agg`, deletes `TERM`. `getPythonVersion(path)` — spawns `--version`, regex parses. `checkFunASRInstallation()` — cached; spawns `python -c 'import funasr; print("OK")'`. `installFunASR(cb)` — upgrades pip (with `--user` fallback), `pip install -U funasr librosa` (with `--user` fallback on permission denied), maps errors to user messages (MSVC build tools, Python version). `installPython(cb)` delegates to `PythonInstaller`.

**Dependencies:** `child_process.spawn`, `fs`, `path`, `PythonInstaller`, `src/utils/process` (runCommand, TIMEOUTS), lazy `require("electron")`.

**Public interface:** `getFunASRServerPath()`, `getEmbeddedPythonPath()`, `setupIsolatedEnvironment()`, `buildPythonEnvironment()`, `findPythonExecutable()`, `findPythonExecutableWithFallback()`, `getPythonVersion(path)`, `isPythonVersionSupported(v)`, `installPython(cb)`, `checkPythonInstallation()`, `checkFunASRInstallation()`, `upgradePip(cmd)`, `installFunASR(cb)`, `clearFunASRInstallCache()`. Properties: `pythonCmd`, `funasrInstalled`.

**Testing seam:** Coverage-excluded. The version-parse regex, `isPythonVersionSupported`, and env-building logic (UTF-8, PATH construction) are pure and could be extracted. `tests/unit/windows-compat.test.js` covers some path logic. `spawn`-based methods need process mocks.

**Testing challenges:**

- Real Python discovery depends on the host having Python — not reproducible.
- `buildPythonEnvironment` mutates `process.env` copy; cache (`_cachedPythonEnv`) must be invalidated when embedded-ness changes.
- `PYTHONUTF8=1` is a Windows-critical fix — test the env shape.
- Install flows shell out to pip/brew/sudo — can't run in CI.

**Critical paths:** embedded Python detection, version validation (3.8+), UTF-8 env (Windows Chinese paths), FunASR install check caching, pip `--user` fallback.

---

### 2.10 PythonInstaller

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/pythonInstaller.ts`

**What it does:** Platform-specific Python 3.11.9 installation. macOS: tries Homebrew `brew install python@3.11`, falls back to downloading python.org `.pkg` + `sudo installer`. Windows: downloads `.exe`, checks admin via `reg query HKU\S-1-5-19`, silent install with `InstallAllUsers`/`PrependPath`. Linux: apt → yum → pacman fallback chain. `downloadFile(url, path, cb)` via `https.get` with progress. `isPythonInstalled()` probes `python3.11`/`python3`/`python` + macOS absolute paths.

**Dependencies:** `fs`, `path`, `https`, `os`, `src/utils/process` (runCommand, TIMEOUTS). **No electron dependency.**

**Public interface:** `downloadFile(url, path, cb)`, `installPythonMacOS(cb)`, `installPythonWindows(cb)`, `installPythonLinux(cb)`, `installPython(cb)`, `isPythonInstalled()`, `checkWindowsAdmin()`. Property `pythonVersion`.

**Testing seam:** Coverage-excluded (network + sudo + installer). **No Electron dependency** — the cleanest to unit-test if `https`/`runCommand` are mocked. `isPythonInstalled` probing logic and URL construction are pure-ish.

**Testing challenges:**

- Network downloads (python.org) — mock `https` or use nock.
- `sudo`/`installer`/`reg` — platform-specific shell commands.
- Side effects (actually installs Python) — must mock `runCommand`.
- Admin detection via registry is Windows-only.

**Critical paths:** platform dispatch, Homebrew-first macOS strategy, admin-aware Windows silent install, package-manager fallback chain on Linux.

---

### 2.11 UpdateManager

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/updateManager.ts`

**What it does:** Custom GitHub-releases-based updater (not electron-updater — the task description was inaccurate; this is hand-rolled). `UPDATE.CHECK` — `net.fetch` GitHub releases/latest, `semverGt(latest, current)`, returns `{hasUpdate, currentVersion, latestVersion, releaseUrl, releaseNotes, downloadUrl, downloadSize, checksumsUrl}`. `UPDATE.DOWNLOAD` — downloads checksums file, finds expected SHA256, streams installer to temp dir with progress events (`UPDATE_DOWNLOAD_PROGRESS`), verifies SHA256, sends `UPDATE_DOWNLOAD_COMPLETE`, shows `Notification`. `UPDATE.CANCEL` — sets `currentDownload.cancelled` flag (checked in download loop). `UPDATE.INSTALL` — validates path is in `app.getPath("temp")`, `shell.openPath` + `app.quit()`. Pure helpers: `semverGt`, `getPlatformAsset`, `getChecksumsAsset`, `parseChecksums`, `verifySHA256`.

**Dependencies:** `electron` (app, shell, net, BrowserWindow, Notification), `fs`, `path`, `crypto`, `ipc-contracts`.

**Public interface:** `register(ipcMain, managers)`. Named exports: `semverGt(a,b)`, `getPlatformAsset(release, platform)`, `getChecksumsAsset(release)`, `parseChecksums(content)`, `verifySHA256(filePath, expectedHash)`.

**Testing seam:** Coverage-excluded (Electron net/shell). **The pure helpers (`semverGt`, `getPlatformAsset`, `getChecksumsAsset`, `parseChecksums`, `verifySHA256`) are unit-testable** with fs mocks. `tests/unit/updateManager-require-resolution.test.js` (require resolution), `tests/unit/phase3-semi-auto-update.test.js`.

**Testing challenges:**

- `net.fetch` is Electron's fetch — needs Electron or global fetch mock.
- Real GitHub API rate limits + network.
- SHA256 verification needs real file reads.
- Download streaming + progress + cancel race.
- `Notification` needs a desktop.

**Critical paths:** semver compare, platform asset selection (.dmg/.exe), checksums parsing, SHA256 verify (security-critical), temp-path validation before install (path traversal guard), cancel flag check in loop.

---

### 2.12 LogManager

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/logManager.ts`

**What it does:** JSON-line file logger to `userData/logs/app.log` and a separate `funasr.log` (via `logFunASR`). Lazy init (`_ensureInitialized`); falls back to `os.tmpdir()/murmur-logs` if Electron unavailable (test-safe). Levels: info/error/warn/debug — each writes to console + appends JSON `{timestamp, level, message, data, pid}`. `getRecentLogs(lines)`/`getFunASRLogs(lines)` read + parse last N lines. `cleanOldLogs(daysToKeep=7)` unlinks old files by mtime. `getSystemInfo()` gathers platform/arch/versions/env (requires electron — throws if missing). `getLogFilePath`/`getFunASRLogFilePath`.

**Dependencies:** `fs`, `path`, `os`, lazy `require("electron")` (app.getPath/app.getVersion in `getSystemInfo` only).

**Public interface:** `log(level, msg, data?)`, `info`/`error`/`warn`/`debug(msg, data?)`, `logFunASR(level, msg, data?)`, `getRecentLogs(lines)`, `getFunASRLogs(lines)`, `cleanOldLogs(days)`, `getLogFilePath()`, `getFunASRLogFilePath()`, `getSystemInfo()`, `getLogDirectory()`, `ensureLogDirectory()`.

**Testing seam:** **Unit-tested** (`tests/unit/logManager.test.js`) despite being coverage-excluded — the tmpdir fallback makes it test-safe. The lazy electron require means `getSystemInfo()` throws outside Electron; everything else works.

**Testing challenges:**

- `getSystemInfo` requires Electron — skip in unit tests.
- File appends — use temp log dir; concurrent appends (WAL-like) not an issue for append-only.
- `cleanOldLogs` mtime check — manipulate fs.statSync mocks or real old files.

**Critical paths:** lazy init (don't create dirs until first log), dual log files (app vs FunASR), tmpdir fallback for tests, JSON-line format parseable by `getRecentLogs`.

---

### 2.13 EnvironmentManager

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/environment.ts`

**What it does:** Loads `.env` from `process.cwd()` (lazy `require("dotenv")`). Provides typed config getters reading `process.env` with defaults: `getAIConfig` (placeholder — real config via settings), `getAudioConfig` (16000/1/wav), `getFunASRConfig`, `getAppConfig` (hotkey default `CommandOrControl+Shift+Space`), `getDatabaseConfig`, `getProxyConfig`, `getPerformanceConfig`. Platform `getDataDirectory()` (macOS `~/Library/Application Support/Murmur`, Windows `%APPDATA%\Murmur`, Linux `~/.config/Murmur`). `ensureDataDirectory`/`getLogDirectory`/`getCacheDirectory`/`getModelsDirectory` create dirs. `validateEnvironment()` (Node 18+ check). `exportConfig()` aggregates all. `getSystemInfo()` (os module).

**Dependencies:** `path`, `fs`, `os`, lazy `require("dotenv")`. **No direct electron dependency** (uses `process.env`/`os`).

**Public interface:** all getters above + `loadEnvironmentVariables()`, `isDevelopment()`, `isProduction()`, `validateEnvironment()`, `exportConfig()`.

**Testing seam:** Coverage-excluded but **fully unit-testable** — no Electron, only `os`/`fs`/`process.env`. Set env vars + temp dirs. Platform branching testable by stubbing `process.platform`.

**Testing challenges:**

- `getDataDirectory` platform branching — stub `process.platform`.
- `.env` loading from `process.cwd()` — chdir or mock.
- Dir creation side effects — use temp base.

**Critical paths:** `ensureDataDirectory` (called by main.ts before DB init), platform data dir, Node version validation.

---

## 3. IPC Handlers (`src/helpers/ipc/`)

All handlers export `register(ipcMain, managers)`. Each declares its own `Managers` interface (the fields it needs); `ipc/index.ts` casts the opaque bag through `unknown`. `ipc/index.ts` also wraps `ipcMain.handle` with a rate-limiting layer (`wrapWithRateLimits`) for specific channels.

**Rate limits** (in `registerAll`): `AI.PROCESS` 20/min, `AI.CHECK_STATUS` 30/min, `TRANSCRIPTION.SAVE` 30/min, `MODELS.DOWNLOAD` 3/5min, `FUNASR.INSTALL` 3/5min.

### 3.1 `index.ts` — registrar

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/index.ts`

`registerAll(ipcMain, managers)` wraps ipcMain with rate limits, then calls each handler's `register`. Special: `transcriptionHandlers.register` receives `{...managers, processTextWithAI: aiHandlers.processTextWithAI}` (cross-handler dependency). `asManagers<T>` helper casts bag through `unknown` to avoid `any` (satisfies `backend-type-safety` guard).

**Testing seam:** `tests/unit/main-process-module-resolution.test.js`, `static-import-audit.test.js`. The rate-limit wrapping is testable with a fake `ipcMain` capturing `handle` calls.

---

### 3.2 `aiHandlers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/aiHandlers.ts`

**Channels registered:** `AI.PROCESS`, `AI.CHECK_STATUS`, `AI.GET_MODES`, `AI.GET_PROVIDER_PRESETS`, `AI.DETECT_LOCAL_MODELS`.

**What it does:** `processTextWithAI(text, mode, db, logger, opts)` — reads `ai_api_key`/`ai_base_url`/`ai_model`/`ai_temperature`/`ai_max_tokens` from DB; `validateAIBaseUrl` SSRF guard (https-only, blocks localhost/private networks unless `allowLocalhost` for local providers); builds prompt via `buildPrompt(mode, text, {customTemplates})` or uses passed `systemPrompt`/`userPrompt`; `fetch` to `{baseUrl}/chat/completions` with AbortController timeout (180s local, 150s remote). `checkAIStatus(testConfig?)` — same flow, max 50 tokens test message, maps HTTP errors (401/403/429/500). `getAIModes(templatesDir)` — 10 built-in modes (optimize/optimize_long/format/correct/summarize/enhance/xiaohongshu/zhihu/douyin/de-ai) + custom templates (30s cache). `getProviderPresets`/`detectLocalModels` delegate.

**Dependencies:** `path`, `ipc-contracts`, `aiPrompts` (buildPrompt, loadCustomTemplates), `providerPresets`, `detectLocalModels`. Lazy `require("electron")` for `app.getPath("userData")/templates`. `DatabaseManager` (getSetting), `Logger`.

**Public interface (named exports):** `processTextWithAI`, `checkAIStatus`, `getAIModes`, `register`. `validateAIBaseUrl` exported.

**Testing seam:** **Unit-tested** (`tests/unit/aiHandlers.test.js`). `fetch` is mockable (global). `DatabaseManager` mockable. `validateAIBaseUrl` is pure. The handler functions are exported and callable directly without ipcMain.

**Testing challenges:**

- `fetch` network — mock global fetch.
- SSRF guard correctness — pure, testable.
- Template cache (30s TTL) — test cache hit/miss.
- Timeout/abort behavior.
- Lazy `require("electron")` in `register` — only matters when registering, not when calling exported fns.

**Critical paths:** SSRF validation (security), API key handling, timeout/abort, error mapping (401/403/429), prompt building.

---

### 3.3 `transcriptionHandlers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/transcriptionHandlers.ts`

**Channels registered:** `TRANSCRIPTION.AUDIO`, `IMPORT_FILE`, `VALIDATE_FILE`, `TRANSCRIBE_FILE`, `CANCEL`, `SAVE`, `GET`, `GET_ALL`, `DELETE`, `SEARCH`, `STATS`, `CLEAR`, `EXPORT`, `EXPORT_ALL`, `AI_REVIEW`, `DIARIZE`.

**What it does:** Audio transcription delegates to `funasrManager.transcribeAudio/File`. `IMPORT_FILE`/`EXPORT`/`EXPORT_ALL` use `dialog.showOpenDialog`/`showSaveDialog`. `VALIDATE_FILE`/`TRANSCRIBE_FILE` use `validateAudioPath`. `TRANSCRIBE_FILE` sends progress via `event.sender.send(FILE_TRANSCRIPTION_PROGRESS)` and saves result to DB. `EXPORT` uses `exportFormatters.getFormatInfo` + writes Buffer/string. `AI_REVIEW` uses `processTextWithAI` (injected) with `buildPrompt`. DB CRUD delegates to `databaseManager`.

**Dependencies:** `path`, `fs`, `electron` (dialog), `ipc-contracts`, `exportFormatters`, `aiPrompts` (buildPrompt), `audioPathValidator`. `FunasrManager`, `DatabaseManager`, `Logger`, injected `processTextWithAI`.

**Testing seam:** Coverage-excluded (ipc dir). But the handler functions are pure-ish given mocked managers + dialog. `dialog` needs Electron. `validateAudioPath` is unit-tested separately.

**Testing challenges:**

- `dialog` native prompts — mock or e2e.
- `TRANSCRIBE_FILE` chains validation → funasr → DB save → progress events.
- `EXPORT_ALL` docx quirk (passes array to single-record formatter — preserved bug).
- Progress event emission via `event.sender.send`.

**Critical paths:** file transcription pipeline (validate → transcribe → save → progress), export format dispatch, AI review, DB CRUD.

---

### 3.4 `settingsHandlers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/settingsHandlers.ts`

**Channels registered:** `SETTINGS.GET`, `SET`, `GET_ALL`, `GET_LEGACY`, `SAVE`, `RESET`, `IMPORT`, `EXPORT`.

**What it does:** `validateSetting(key, value)` — allowlist (`ALLOWED_SETTING_KEYS`: 15 keys), key length ≤100, value length ≤10000. `SET`/`SAVE` validate then `setSetting` + `syncToFileConfig` (SET only) + broadcast `SETTINGS_UPDATE` event to mainWindow. `GET_ALL`/`GET_LEGACY` mask API key (`****` + last 4). `IMPORT`/`EXPORT` via dialog + fs.

**Dependencies:** `fs`, `electron` (dialog), `ipc-contracts`. `DatabaseManager`, `Logger`, `WindowManager` (mainWindow for broadcast).

**Testing seam:** **Unit-tested** (`tests/unit/settingsHandlers.test.js`, `settings-refactor.test.js`). `validateSetting` is pure and exported. `maskApiKey` testable. Dialog/windowManager mockable.

**Testing challenges:**

- Broadcast to mainWindow — mock `webContents.send`.
- Allowlist evolution — test must track.
- Import validation (skip invalid keys silently).

**Critical paths:** setting allowlist (security — prevents arbitrary key writes), API key masking, file-config sync, settings-change broadcast.

---

### 3.5 `windowHandlers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/windowHandlers.ts`

**Channels registered:** `WINDOW.HIDE`, `SHOW`, `MINIMIZE`, `MAXIMIZE`, `IS_MAX`, `CLOSE`, `SET_TOP`, `CLOSE_APP`, `OPEN_HISTORY`, `CLOSE_HISTORY`, `HIDE_HISTORY`, `OPEN_SETTINGS`, `CLOSE_SETTINGS`, `HIDE_SETTINGS`.

**What it does:** Delegates to `windowManager` methods. `MAXIMIZE` implements the Windows transparent-window toggle via `_preMaximizeBounds` (save bounds → maximize; or restore). `SET_TOP` applies to all three windows. `CLOSE_APP` → `app.quit()`.

**Dependencies:** `electron` (app), `ipc-contracts`, `WindowManager`.

**Testing seam:** **Unit-tested** (`tests/unit/windowHandlers.test.js`). WindowManager mockable. The maximize-toggle logic is the interesting test target.

**Testing challenges:**

- Real BrowserWindow methods — mock.
- Maximize toggle state machine (bounds save/restore).

**Critical paths:** maximize toggle (Windows fix), always-on-top propagation to all windows, app quit.

---

### 3.6 `hotkeyHandlers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/hotkeyHandlers.ts`

**Channels registered:** `HOTKEY.REGISTER`, `UNREGISTER`, `GET_CURRENT`, `REGISTER_F2`, `UNREGISTER_F2`, `SET_STATE`, `GET_STATE`.

**What it does:** Per-sender dedup via `hotkeyRegisteredSenders`/`f2RegisteredSenders` Sets (by `event.sender.id`). `REGISTER` registers via `hotkeyManager.registerHotkey` with callback that sends `HOTKEY_TRIGGERED` to mainWindow; cleans up on sender `destroyed`. `REGISTER_F2` — first sender registers F2 double-click; callback broadcasts `F2_DOUBLE_CLICK` to all registered senders' windows (via `BrowserWindow.getAllWindows` lookup); when last sender unregisters, unregisters F2. `GET_CURRENT` returns first non-F2 hotkey or default.

**Dependencies:** `electron` (BrowserWindow), `ipc-contracts`. `HotkeyManager`, `WindowManager`, `Logger`.

**Testing seam:** Not directly unit-tested (Electron BrowserWindow). The per-sender dedup logic and F2 broadcast are testable with mocks. E2E `04-hotkey`.

**Testing challenges:**

- `event.sender.id` + `destroyed` lifecycle — mock webContents.
- F2 broadcast iterates all windows — mock `BrowserWindow.getAllWindows`.
- Multi-window F2 registration sharing.

**Critical paths:** per-sender dedup (prevent double-register), F2 fan-out to all registered windows, cleanup on window destroy.

---

### 3.7 `clipboardHandlers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/clipboardHandlers.ts`

**Channels registered:** `CLIPBOARD.COPY`, `PASTE`, `READ`, `WRITE`.

**What it does:** Thin wrappers around `clipboardManager.copyText/pasteText/readClipboard/writeClipboard` with try/catch → `{success:false, error}`.

**Dependencies:** `ipc-contracts`. `ClipboardManager`, `Logger`.

**Testing seam:** Coverage-excluded (ipc dir) but trivially mockable. E2E `06-clipboard`.

**Testing challenges:** delegates entirely to ClipboardManager (see 2.3).

**Critical paths:** paste (accessibility-dependent), error surfacing.

---

### 3.8 `systemHandlers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/systemHandlers.ts`

**Channels registered:** `SYSTEM.OPEN_EXTERNAL`, `INFO`, `PERMISSIONS`, `REQUEST_PERMS`, `TEST_A11Y`, `OPEN_PERMS`, `VERSION`, `LOG`, `DEBUG_INFO`. Dev-only: `WINDOW.OPEN_DEV_TOOLS`, `WINDOW.RELOAD`.

**What it does:** `OPEN_EXTERNAL` — https-only guard then `shell.openExternal`. `PERMISSIONS` — `clipboardManager.checkAccessibilityPermissions` (microphone hardcoded true). `TEST_A11Y` — calls `pasteText("Murmur权限测试")` (actually attempts paste). `LOG` — dynamic log-level dispatch via logger index signature. `DEBUG_INFO` — aggregates system/env/funasr status. Dev-only devtools/reload.

**Dependencies:** `electron` (app, shell, BrowserWindow), `ipc-contracts`. `Logger`, `FunasrManager`, `ClipboardManager`.

**Testing seam:** **Unit-tested** (`tests/unit/systemHandlers-channels.test.js`). The https guard is pure. `OPEN_EXTERNAL` URL validation is a good unit target.

**Testing challenges:**

- `shell.openExternal` side effect.
- `TEST_A11Y` actually pastes — dangerous in tests.
- Dev-only handler registration (conditional).

**Critical paths:** https-only openExternal (security), permission check, log dispatch.

---

### 3.9 `modelHandlers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/modelHandlers.ts`

**Channels registered:** `MODELS.CHECK`, `PROGRESS`, `DOWNLOAD`, `DOWNLOAD_MODEL`, `AVAILABLE`, `CURRENT`, `SWITCH`.

**What it does:** Delegates to `funasrManager.checkModelFiles/getDownloadProgress/downloadModels/checkStatus`. `DOWNLOAD`/`DOWNLOAD_MODEL` send `MODEL_DOWNLOAD_PROGRESS` events. `AVAILABLE` returns hardcoded 3-model list. `SWITCH` returns not-supported error (fixed model combo).

**Dependencies:** `ipc-contracts`. `FunasrManager`.

**Testing seam:** **Unit-tested** (`tests/unit/modelHandlers.test.js`). FunasrManager mockable. The hardcoded model list and progress event emission are testable.

**Testing challenges:** progress event via `event.sender.send`.

**Critical paths:** model check, download progress streaming, switch-not-supported contract.

---

### 3.10 `environmentHandlers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/environmentHandlers.ts`

**Channels registered:** `FUNASR.STATUS`, `INSTALL`, `RESTART`.

**What it does:** `STATUS` — aggregates `funasrManager.checkStatus()` + `modelsInitialized`/`serverReady`/`initializationPromise` into a `status_message` enum (`ready`/`initializing`/`models_not_downloaded`/`python_not_installed`/`funasr_not_installed`/`not_ready`). `INSTALL` — `installFunASR` with `FUNASR_INSTALL_PROGRESS` events. `RESTART` — `restartServer`.

**Dependencies:** `ipc-contracts`. `FunasrManager`, `Logger`.

**Testing seam:** **Unit-tested** (`tests/unit/environmentHandlers.test.js`). The `status_message` derivation logic is the key test target (pure given mocked status).

**Testing challenges:** status_message state machine correctness.

**Critical paths:** status_message derivation (drives UI), install progress, restart.

---

## 4. Engines (`src/helpers/engines/`)

### 4.1 `asrEngine.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/engines/asrEngine.ts`

**What it does:** Defines a pluggable ASR engine abstraction — currently a **registry/interface only, no concrete FunASR implementation**. `ASREngine` interface: `transcribeAudio`, `transcribeFile`, `cancelTranscription`, `checkStatus`, `shutdown`. `ASREngineRegistry`: `register/get/list/setDefault/getDefault/setActive/getActive`. `validateASREngine(engine)` — duck-types the 5 required methods. `createASREngineRegistry()` — factory returning a closure-backed registry; first registered becomes default+active.

**How it interfaces with FunASR:** It doesn't directly — `FunASRManager`/`FunASRServer` are the concrete ASR path today. This is a future-extensibility seam (e.g., for Whisper, cloud ASR). Not wired into main.ts or handlers.

**Dependencies:** `../../types/ipc` (type-only imports: FileTranscriptionResult, FunASRStatusResult).

**Public interface:** `validateASREngine`, `createASREngineRegistry`, `ASREngine`/`ASREngineRegistry` interfaces.

**Testing seam:** **Unit-tested** (`tests/unit/engines/asrEngine.test.js`). Pure, no Electron, no side effects. Ideal unit-test target.

**Testing challenges:** none significant — pure registry pattern.

**Critical paths:** validation (must reject engines missing methods), first-registered-becomes-default, active/default fallback.

---

## 5. Helpers (`src/helpers/`)

### 5.1 `ipc-contracts.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc-contracts.ts`

**What it does:** Single source of truth for all IPC channel names. Named exports (NOT default — esbuild CJS would wrap default): `FUNASR`, `MODELS`, `TRANSCRIPTION`, `AI`, `SETTINGS`, `WINDOW`, `HOTKEY`, `CLIPBOARD`, `UPDATE`, `SYSTEM`, `EVENTS`, `AUDIO_EXTENSIONS`. All `as const`.

**Testing seam:** **Unit-tested** (`tests/unit/ipc-contracts.test.js`, `ipc-contracts-orphans.test.js` — orphans test ensures every constant is referenced by preload/handlers, catching dead channels).

**Testing challenges:** keeping in sync with preload + handlers + `.d.ts`. The orphans test is the guard.

**Critical paths:** every channel name (typo = silent IPC failure).

---

### 5.2 `ipcRateLimiter.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipcRateLimiter.ts`

**What it does:** `createRateLimitedHandler(handler, {maxCalls=30, windowMs=60000})` — sliding-window rate limiter. Pushes timestamps, evicts old, rejects with `{success:false, error:"Rate limit exceeded"}` when at capacity.

**Dependencies:** none (pure).

**Testing seam:** **Unit-tested** (`tests/unit/ipcRateLimiter.test.js`, `ipcRateLimitIntegration.test.js`). Pure — ideal.

**Critical paths:** window eviction, capacity rejection, default limits.

---

### 5.3 `audioPathValidator.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/audioPathValidator.ts`

**What it does:** `validateAudioPath(filePath)` — checks ext in `C.AUDIO_EXTENSIONS`, resolves path, ensures within allowed dirs: `os.homedir()`, `os.tmpdir()`, `/Volumes/`, or a Windows drive root (`^[A-Za-z]:\\`). Returns discriminated union `{valid:true, ext, resolved}` | `{valid:false, error}`.

**Dependencies:** `path`, `os`, `ipc-contracts` (AUDIO_EXTENSIONS).

**Testing seam:** **Unit-testable** (pure-ish, fs-free — only path/os). Currently covered indirectly via transcriptionHandlers tests. Good candidate for dedicated tests.

**Testing challenges:** Windows drive-root regex on non-Windows; `/Volumes/` macOS-only.

**Critical paths:** extension allowlist, directory allowlist (path-traversal guard — security).

---

### 5.4 `audioFileHelpers.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/audioFileHelpers.ts`

**What it does:** `createTempAudioFile(logger, blob)` — writes ArrayBuffer/Uint8Array/base64-string/{buffer} to `os.tmpdir()/funasr_audio_<uuid>.wav`; validates non-empty. `cleanupTempFile(path)` — unlink (swallow errors). `convertAudioFile(logger, inputPath)` — ffmpeg conversion (mp3/m4a → 16k mono wav); `getFFmpegPath()` caches `which/where ffmpeg`; `_setFFmpegDetector`/`_resetFFmpegCache` for test injection.

**Dependencies:** `child_process` (spawn, execSync), `fs`, `path`, `crypto`, `os`.

**Testing seam:** **Unit-tested** (`tests/unit/audioFileHelpers.test.js`). `_setFFmpegDetector` is the test seam for ffmpeg detection. Temp files use real tmpdir.

**Testing challenges:**

- ffmpeg presence varies — detector injection seam handles this.
- Real ffmpeg conversion is slow — mock spawn.
- Temp file cleanup.

**Critical paths:** blob → Buffer coercion (4 input types), temp file write + non-empty check, ffmpeg detection caching, conversion arg construction (16k mono).

---

### 5.5 `serverMessageRouter.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/serverMessageRouter.ts`

**What it does:** stdin/stdout JSON line protocol to the FunASR Python process. `attach(process)` — buffers stdout by newline, parses JSON, `_dispatch(msg)` by `request_id`; on process close/error `_rejectAll`. `sendCommand(action, params, {timeout, timeoutError, onProgress})` — generates `request_id` (or uses passed), writes JSON+newline to stdin, tracks pending with timer. Progress messages (`{type:"progress"}`) extend the timeout (5min from last progress). `sendRaw(command)` — same without action wrapping. Background `_purgeExpired` every 60s (absolute age 1h, progress age 5min). `detach()` rejects all + clears interval.

**Dependencies:** `crypto` (randomUUID), `child_process` type only.

**Testing seam:** **Unit-tested** (`tests/unit/server-message-router.test.js`, `server-message-router-coverage.test.js`). Pure logic given a fake `ChildProcess` with controllable `stdout`/`stdin`/events. No Electron.

**Testing challenges:**

- Simulating a fake child process with emit-able stdout/close/error.
- Timer/timeout behavior — use fake timers.
- Progress timeout extension logic.
- Buffer partial-line handling.

**Critical paths:** request/response matching by `request_id`, timeout + progress extension, reject-all on process exit, newline buffer framing.

---

### 5.6 `providerPresets.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/providerPresets.ts`

**What it does:** Static data: 11 AI provider presets (OpenAI, DeepSeek, Qwen, GLM, SiliconFlow, Groq, Moonshot, OpenRouter, MiniMax, Ollama, LM Studio) with `base_url`, `models`, `requires_api_key`, `registration.url`. `getProviderPresets()`, `getProviderByName(name)`.

**Dependencies:** none (pure data).

**Testing seam:** **Unit-tested** (`tests/unit/providerPresets.test.js`). Pure.

**Critical paths:** data correctness (URLs, models), Ollama/LM Studio `requires_api_key:false` (local).

---

### 5.7 `aiPrompts.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/aiPrompts.ts`

**What it does:** Prompt templates for text optimization modes. `buildPrompt(mode, text, {customTemplates})` returns `{system, user}`. `loadCustomTemplates(dir)` reads template files from `userData/templates`. 10 built-in modes matching `aiHandlers.BUILT_IN_MODES`.

**Dependencies:** `fs`, `path` (for loadCustomTemplates).

**Testing seam:** **Unit-tested** (`tests/unit/aiPrompts.test.js`, `aiPrompts-few-shot.test.js`). `buildPrompt` is pure. `loadCustomTemplates` needs temp dir.

**Testing challenges:** custom template file parsing; few-shot prompt construction.

**Critical paths:** mode → prompt mapping, custom template loading + override.

---

### 5.8 `exportFormatters.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/exportFormatters.ts`

**What it does:** Export transcriptions to txt/docx/srt/vtt/md. `getFormatInfo(format)` returns `{ext, label, formatter}`. `formatTXT`/`formatMD`/`formatSRT`/`formatVTT` return strings; `formatDOCX` returns Buffer (via `docx` package). `TranscriptionForExport` type.

**Dependencies:** `docx` (for docx), otherwise pure.

**Testing seam:** **Unit-tested** (`tests/unit/export-formatters.test.js`, `export-formatters-coverage.test.js`). Pure given a `TranscriptionForExport`. docx generation needs the `docx` lib.

**Testing challenges:** segment timestamp formatting (SRT/VTT); docx Buffer output.

**Critical paths:** format dispatch, segment → timestamp conversion, docx binary.

---

### 5.9 `fileConfig.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/fileConfig.ts`

**What it does:** `loadFileConfig(path)` — reads JSON, filters to `FILE_CONFIGURABLE_KEYS` (11 keys), returns `{}` on any error. `saveFileConfig(path, settings)` — filters + writes JSON (mkdir recursive). `FILE_CONFIGURABLE_KEYS` exported readonly.

**Dependencies:** `fs`, `path`.

**Testing seam:** **Unit-tested** (`tests/unit/fileConfig.test.js`). Pure fs — use temp files.

**Critical paths:** allowlist filtering (security — only safe keys persist to `murmur.json`), mkdir before write, error-tolerant load.

---

### 5.10 `detectLocalModels.ts`

Path: `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/detectLocalModels.ts`

**What it does:** Probes local AI endpoints (Ollama `localhost:11434/api/tags`, LM Studio `localhost:1234/v1/models`) with 2s AbortController timeout. `LOCAL_PROBES` config with `extractModels` functions. Returns `DetectedModel[]` (non-null results).

**Dependencies:** global `fetch` (Node 18+).

**Testing seam:** **Unit-tested** (`tests/unit/detectLocalModels.test.js`). Mock global fetch. Pure logic.

**Testing challenges:** fetch mocking; timeout behavior.

**Critical paths:** probe + extract, timeout, null filtering.

---

### 5.11 `environment.ts` — see 2.13.

---

## 6. Renderer (`src/`)

### 6.1 Structure

- `src/main.tsx` — React 19 entry. `ErrorBoundary` class component, `initializeApp()` (theme apply from setting + system listener, drag/drop prevention, contextmenu prevention in prod, global error handlers → `electronAPI.log`), `assertElectronAPI()` guard (renders fallback if preload missing), mounts `ModelStatusProvider > App + Toaster`.
- `src/App.tsx` — main UI (27KB). URL `?page=settings` routes to lazy `SettingsPage`. Recording mode / file-import mode toggle. Uses hooks: `useHotkey`, `useWindowDrag`, `useRecording` (with `determineProcessingMode`), `useModelStatus`. Caches settings in `settingsRef`. Paste debounce (1s same-text).
- `src/history.tsx`, `src/settings.tsx` — separate window entry points (history.html, settings.html). `SettingsSidebar`, `useSettings`, sections: `AIConfigSection`, `AboutSection`, `GeneralSection`, `PermissionsSection`.
- `src/hooks/` — `useRecording`, `useHotkey`, `useFileTranscription`, `useWindowDrag`, `usePermissions`, `useModelStatus`.
- `src/components/` — UI components (SettingsPanel, FileImport, TranscriptionResult, VoiceWaveIndicator, ExportPanel, etc.) + `ui/` shadcn primitives (button, card, tabs, input, dialog, etc.).
- `src/i18n/` — i18next localization.
- `src/bootstrap/assertElectronAPI.ts` — runtime preload assertion.
- `src/types/ipc.ts` — shared IPC type definitions.
- `src/lib/utils.ts` — `cn` class merge helper.

### 6.2 Renderer → Main communication

Exclusively via `window.electronAPI.<method>()` (the preload bridge). Every call is `ipcRenderer.invoke` (Promise) or `ipcRenderer.on` (event subscription returning unsubscribe). No direct `require("electron")` in renderer (sandboxed, contextIsolation). `App.tsx` calls: `getAllSettings`, `setSetting` (many keys), `checkAIStatus`, `checkForUpdates`, `getAppVersion`, `onUpdateDownloadProgress/Complete/Error`, `closeApp`, `hideWindow`, `minimizeWindow`, `maximizeWindow`, `onWindowMaximizeChange`, `getSetting`, `copyText`, `pasteText`, `processText`. Hooks add: recording (`transcribeAudio`, `saveTranscription`), hotkey (`registerHotkey`, `registerF2Hotkey`, `onHotkeyTriggered`, `onF2DoubleClick`), file transcription (`importAudioFile`, `transcribeFile`, `onFileTranscriptionProgress`), model status (`checkFunASRStatus`, `checkModelFiles`, `onModelDownloadProgress`), permissions (`checkPermissions`).

### 6.3 Testing seam

- **Component unit tests** (`tests/unit/components/*.test.tsx`): FileDropZone, SoundWaveIcon, TranscriptionResult, ModelDownloadProgress, VoiceWaveIndicator, LoadingIndicator, TextDisplay, TranscriptionProgress, Tooltip. Use `@testing-library/react` + `happy-dom` (per devDeps). Mock `window.electronAPI`.
- **Hook tests**: `tests/unit/usePermissions.test.js`.
- **E2E**: full app via Playwright. Renderer tested through real IPC.

**Testing challenges:**

- `window.electronAPI` must be mocked in component tests (happy-dom doesn't have it). `assertElectronAPI` gate.
- MediaRecorder/getUserMedia — e2e injects mock.
- Theme/system-matchMedia — mock `matchMedia`.
- Lazy-loaded `SettingsPage` — Suspense.
- i18n — locale loading.

**Critical paths:** recording flow (start → transcribe → AI optimize → paste → save), settings persistence, model status display, file import + progress, update flow.

---

## 7. Build Pipeline

### 7.1 esbuild — main + preload

- `build:main`: `esbuild main.ts --bundle --platform=node --format=cjs --external:electron --external:better-sqlite3 --outfile=dist-main/main.js`. `better-sqlite3` external (native, electron-rebuilt). `electron` external (runtime).
- `build:preload`: `esbuild preload.ts --bundle --platform=node --format=cjs --external:electron --outfile=dist-preload/preload.js`.
- Dev: `dev:main` runs `electron --import tsx/esm main.ts --dev` (tsx transforms TS on the fly, no bundle). `dev:renderer` runs Vite dev server.

**Key implication:** `__dirname` in bundled output becomes `dist-main/`, so all path resolution uses `app.getAppPath()` (project root in dev, asar root in prod). This is the `[20260724_TS_BigBang_DirnameFix]` recurring comment.

### 7.2 Vite — renderer

- `build:renderer` / `dev:renderer`: `cd src && vite`. Outputs `src/dist/` (index.html, history.html, settings.html + assets). `vite.config.js` uses `@vitejs/plugin-react`, `@tailwindcss/vite`. Path alias `@` → `./src`.

### 7.3 electron-builder — packaging

- `build`/`dist`: runs `prepare:python:embedded` (downloads/sets up embedded Python via `scripts/prepare-embedded-python.js`) → build main/preload/renderer → `electron-builder`.
- `package.json` `build` config: appId `com.murmur.app`, asar unpack for `funasr_server.py`, `download_models.py`, `python/**`, `better-sqlite3`/`bindings` native modules. Mac (hardenedRuntime, entitlements), Win, Linux targets.
- `postinstall`: `electron-builder install-app-deps && pnpm rebuild better-sqlite3` (rebuild native for Electron's Node).

### 7.4 Testing the build

- E2E `global-setup.js` builds all three bundles before suites.
- `tests/unit/main-process-module-resolution.test.js` / `static-import-audit.test.js` guard import paths survive bundling.
- `prebuild:*` scripts ensure Python env is prepared before platform builds.

**Testing challenges:**

- Native module rebuild (`better-sqlite3`) must match Electron's Node ABI — `electron-rebuild`.
- Embedded Python preparation (`scripts/prepare-embedded-python.js`) is a build-time step; without it, prod can't find Python.
- asar unpacking correctness for native + Python files.
- Path resolution dev (`app.getAppPath()` = project root) vs prod (= asar) — `DirnameFix` comments show this was a recurring bug source.

**Critical paths:** esbuild externals (electron, better-sqlite3), `app.getAppPath()`-based paths, native rebuild, embedded Python packaging, asar unpack list.

---

## 8. Cross-Cutting Concerns

### 8.1 Security seams (high-value test targets)

- **CSP** (WindowManager.\_setupCSP): prod strict, dev permissive. Test the strings.
- **SSRF guard** (aiHandlers.validateAIBaseUrl): https-only, blocks localhost/private nets unless allowLocalhost. Pure, unit-tested.
- **safeStorage encryption** (DatabaseManager): `ai_api_key` encrypted; migration from plaintext. Unit-testable with mock safeStorage.
- **Settings allowlist** (settingsHandlers.validateSetting): prevents arbitrary key writes. Pure, unit-tested.
- **Audio path allowlist** (audioPathValidator): path-traversal guard. Pure-ish.
- **openExternal https-only** (systemHandlers). Pure guard.
- **Update SHA256 verification + temp-path validation** (updateManager). `verifySHA256` pure.
- **File-config allowlist** (fileConfig.FILE_CONFIGURABLE_KEYS). Pure.
- **Sandbox + contextIsolation** (all windows): `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`. Assert in windowManager tests.

### 8.2 Native/platform dependencies (hardest to test)

- `better-sqlite3` (native, electron-rebuild)
- `osascript` (macOS npm package, optional)
- Python subprocess (funasr_server.py, download_models.py)
- Embedded Python (`python/bin/python3.11`)
- ffmpeg (`which`/`where`)
- `osascript`/`powershell`/`xdotool` for paste
- `globalShortcut` (OS window manager)
- `Tray`/`Menu`/`Notification` (desktop)
- `safeStorage` (OS keychain)
- `taskkill /T /F` (Windows process tree)

### 8.3 Existing test coverage gaps (per vitest exclude list)

These managers are **excluded from coverage** and thus likely undertested at unit level (relying on e2e):
`clipboard.ts`, `environment.ts`, `tray.ts`, `hotkeyManager.ts`, `pythonEnvironment.ts`, `pythonInstaller.ts`, `funasrManager.ts`, `funasrServer.ts`, `modelManager.ts`, `updateManager.ts`, `windowManager.ts`, `logManager.ts`, all `ipc/**`.

Of these, **pure-logic extractions worth unit-testing**:

- `hotkeyManager` debounce + F2 double-click timing (extract to pure fn)
- `funasrServer.calculateTranscriptionTimeout` (already tested)
- `updateManager` semverGt/getPlatformAsset/parseChecksums/verifySHA256 (already tested)
- `pythonEnvironment.isPythonVersionSupported` + env-building (UTF-8, PATH)
- `modelManager.findDamoRoot`/`_verifyModel` (fs-only)
- `environment` all getters (no Electron)

### 8.4 E2E suites (11 + legacy)

`tests/e2e/suites/`: `00-ftue`, `01-lifecycle`, `02-model-download`, `03-recording`, `04-hotkey`, `05-file-import`, `06-clipboard`, `07-settings`, `08-history`, `09-window`, `10-errors`. Legacy: `launch`, `settings`, `ipc`. All use `launchElectronApp` (in-memory DB, getUserMedia mock). `ipc-mock.js` enables handler-level mocking for isolated renderer testing.

---

## 9. Critical Path Summary (what must work)

1. **Startup**: app.whenReady → safeStorage → DB init → IPC register → window + tray + FunASR init (non-blocking).
2. **Recording flow**: F2/hotkey → MediaRecorder → `transcribeAudio` → temp wav → FunASR server stdin → stdout JSON → text → optional AI `processText` → `pasteText` (osascript) → `saveTranscription`.
3. **File transcription**: `importAudioFile` (dialog) → `validateAudioPath` → `transcribeFile` (dynamic timeout) → progress events → DB save.
4. **FunASR server lifecycle**: spawn → first JSON handshake → health monitor (30s ping) → crash auto-restart (≤3) → graceful shutdown (exit cmd → SIGKILL/taskkill).
5. **Settings**: `setSetting` (allowlist) → encrypt api_key → DB → `syncToFileConfig` → broadcast `SETTINGS_UPDATE`.
6. **Search**: FTS5 trigram (≥3 chars) → LIKE fallback.
7. **Update**: GitHub check → semver compare → download + SHA256 verify → install (temp-path validated).
8. **Graceful quit**: will-quit → unregister hotkeys → FunASR shutdown (5s race) → DB close → exit.

## 10. Key Files Reference

| Subsystem           | Path                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| Main entry          | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/main.ts`                              |
| Preload             | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/preload.ts`                           |
| Preload types       | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/electronAPI.d.ts`                 |
| IPC contracts       | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc-contracts.ts`         |
| IPC registrar       | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipc/index.ts`             |
| WindowManager       | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/windowManager.ts`         |
| DatabaseManager     | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/database.ts`              |
| ClipboardManager    | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/clipboard.ts`             |
| TrayManager         | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/tray.ts`                  |
| HotkeyManager       | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/hotkeyManager.ts`         |
| FunASRManager       | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/funasrManager.ts`         |
| FunASRServer        | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/funasrServer.ts`          |
| ModelManager        | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/modelManager.ts`          |
| PythonEnvironment   | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/pythonEnvironment.ts`     |
| PythonInstaller     | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/pythonInstaller.ts`       |
| UpdateManager       | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/updateManager.ts`         |
| LogManager          | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/logManager.ts`            |
| EnvironmentManager  | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/environment.ts`           |
| asrEngine           | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/engines/asrEngine.ts`     |
| ServerMessageRouter | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/serverMessageRouter.ts`   |
| audioPathValidator  | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/audioPathValidator.ts`    |
| audioFileHelpers    | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/audioFileHelpers.ts`      |
| ipcRateLimiter      | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/ipcRateLimiter.ts`        |
| providerPresets     | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/providerPresets.ts`       |
| aiPrompts           | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/aiPrompts.ts`             |
| exportFormatters    | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/exportFormatters.ts`      |
| fileConfig          | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/fileConfig.ts`            |
| detectLocalModels   | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/helpers/detectLocalModels.ts`     |
| Renderer entry      | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/main.tsx`                         |
| App                 | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/src/App.tsx`                          |
| Vitest config       | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/vitest.config.js`                     |
| Vitest setup        | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/_tsresolve.setup.js`            |
| Playwright config   | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/playwright.config.js`                 |
| E2E launch helper   | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/e2e/helpers/electron-launch.js` |
| E2E global setup    | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/e2e/helpers/global-setup.js`    |
| E2E IPC mock        | `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/tests/e2e/helpers/ipc-mock.js`        |
