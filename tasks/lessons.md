# Lessons Learned

Reusable policies, failure modes, and workflow corrections discovered during development.

---

## L1: vi.mock does not intercept CJS require()

**Date:** 2026-06-07
**Context:** `audioFileHelpers.test.js` — trying to mock `child_process.spawn` with `vi.mock`

`vi.mock("child_process", factory)` mocks ES `import` in test files but does **NOT** intercept `require()` in CJS source modules. The source gets the real module, making spawn/execSync mocks useless.

**Rule:** For CJS source files, test with real executables (e.g., `process.execPath` as fake binary) or refactor source to ESM. Don't waste time on `vi.mock` for CJS require.

---

## L2: Native module rebuild belongs in postinstall, not test scripts

**Date:** 2026-06-07
**Context:** `better-sqlite3` rebuild taking 30s+ on every test run

`pnpm rebuild better-sqlite3` in the `test` script caused every `vitest run` to trigger a full native compilation (~30s on Windows with Node 24, no prebuilt binaries). Moving to `postinstall` dropped test time from 42s to 3.5s.

**Rule:** Keep native module compilation in `postinstall` or `electron-builder install-app-deps`. Never put `pnpm rebuild` in test/watch scripts.

---

## L3: Electron performance stalling — trace the full path before proposing fixes

**Date:** (referenced from CLAUDE.md)
**Context:** General Electron debugging

When debugging "entire client is slow" issues, trace the FULL execution path from user trigger to observable symptom, step by step. Do not propose architectural solutions based on assumptions. Check wrong execution order and missing input validation first.

**Rule:** Trace before fix. Simplest explanation first.

---

## L4: Chinese file path encoding on Windows

**Date:** 2026-05-21
**Context:** Node→Python subprocess IPC

Node.js spawns Python with `PYTHONUTF8=1` to prevent GBK corruption for Chinese file paths. Without this env var, Python 3 on Windows defaults to GBK encoding, corrupting paths passed via subprocess args.

**Rule:** Always set `PYTHONUTF8=1` when spawning Python from Node on Windows.

---

_Add new lessons as `[date] [summary]` entries with Rule/Context sections._

---

## L5: Settings persistence is a 4-touch + allowlist operation

**Date:** 2026-07-29
**Context:** Adding `effects_enabled` setting for visual effects

Adding a new setting to Murmur requires touching **5 places**, and missing any one causes a **silent** failure — no error, no crash, just data that doesn't persist or a save that's silently rejected:

1. `SettingsState` interface (`useSettings.ts`)
2. `DEFAULT_SETTINGS` (`useSettings.ts`)
3. `loadSettings` builder (`useSettings.ts`) — reading from DB
4. `saveSettings` body (`useSettings.ts`) — **hardcoded per-key**, not auto-iterating SettingsState
5. `ALLOWED_SETTING_KEYS` set (`settingsHandlers.ts`) — `validateSetting` rejects unknown keys; the IPC returns `{success: false}` but `setSetting` doesn't throw, so the UI shows "saved" while nothing was written

**Rule:** When adding any setting, grep for an existing setting key (e.g. `window_always_on_top`) and update every place it appears. The saveSettings hardcoded list is the most-missed.

---

## L6: Electron tray icons need a purpose-built small-size asset

**Date:** 2026-07-29
**Context:** Fox mascot icon unreadable at 16×16 in macOS menu bar

Downscaling a 1024px full-color app icon to 16×16 tray size produces an unreadable blob — the kawaii detail collapses. macOS tray also forces `setTemplateImage(true)` which strips color to a monochrome silhouette.

**Rule:** Ship a dedicated `tray-icon-16.png` (manually optimized for tiny sizes) rather than reusing the app icon. For colored brand tray icons (Discord/Slack style), remove `setTemplateImage(true)`. See `tray.ts` `getTrayIconPath()` for the platform-conditional resolution.

---

## L7: Build green ≠ artifact works — gate releases on installing and booting the packaged app

**Date:** 2026-08-16
**Context:** The v1.3.x release cycle (v1.2.0 → v1.3.2). Every installer the pipeline ever produced was broken in some way while all workflow jobs stayed green.

Three stacked root causes, each invisible to "did the build finish" checks:

1. **electron-builder's `files` glob silently skips missing paths.** The build jobs never ran `build:preload`, so `dist-preload/preload.js` simply wasn't in the asar — for every release ≤ v1.3.1. The app booted, then the renderer showed 「Electron API 不可用」 with zero functionality. Nothing failed because nothing looked.
2. **`electron-builder install-app-deps` can silently no-op (~0.2s "finished").** With pnpm's `onlyBuiltDependencies` allowlist, better-sqlite3's own install script fetches a system-Node-ABI prebuild (ABI 137); the "rebuild" never replaced it, so the v1.3.0 macOS dmg crashed on first `new Database()`. Local builds survived by luck (warm pnpm store held an Electron-ABI build), which is why local verification passed while CI shipped broken.
3. **pnpm only links `node_modules/.bin` shims for direct dependencies.** electron-builder 26 pulled `@electron/rebuild` in transitively; `npx` then found the package locally without its bin shim → "'electron-rebuild' is not recognized" on Windows CI.

**Rule:** The release pipeline's acceptance object is "the installed app", not "files in dist/". Five gates now enforce this in `build.yml` (see `CONTRIBUTING.md` → Release Gates): native-ABI gate (open a real in-memory DB under `ELECTRON_RUN_AS_NODE` Electron), preload-presence gate (`test -f dist-preload/preload.js`), Python packaging gate (hard embedded-Python prep step that must really import numpy/soundfile/funasr before packaging), mac packaged boot smoke (mount the DMG, launch, assert 主窗口创建成功 / 应用启动完成 / 热键注册成功 — the last is renderer→preload→IPC, proving the bridge), and the Windows NSIS silent-install counterpart. When verifying locally, remember `require('better-sqlite3')` alone proves nothing — the addon loads lazily inside `new Database()`. And never run `asar extract-file` from the repo root: it writes the file's basename into the CWD (this clobbered package.json once).
