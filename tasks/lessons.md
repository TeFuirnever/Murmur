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
