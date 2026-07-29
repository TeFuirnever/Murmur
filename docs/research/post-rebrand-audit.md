# Post-Rebrand Audit — Fox Mascot Icons + react-bits Effects

**Date:** 2026-07-29
**Scope:** End-to-end verification of two feature commits on top of v1.0.3:

1. `5481653` — `feat: rebrand app icon to fox mascot (kawaii style)`
2. `a9b35bf` — `feat: add react-bits visual effects (opt-in, History window)`

**Method:** Every checklist item verified against source with `file:line` evidence. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm license:check`, and `node scripts/check-effects-isolation.js` were executed.

**Executive summary:** The feature work is high quality and the settings-persistence 5-touch trap, license attribution, WebGL gating, and chunk isolation are all correctly implemented. **Two issues need attention**, one of them blocking: `pnpm lint` fails (exit 1) because `EffectsLayer.tsx` violates `react-refresh/only-export-components` under `--max-warnings 0`, which breaks the AGENTS.md build gate. A secondary debt item is `THIRD-PARTY-LICENSES` being stale (missing ogl/motion).

---

## A. Icon references consistency

### A.1 — All icon references across source/config/docs

**Status:** Correct
**Evidence:** Every live code/config reference points to an existing file:

- `package.json:178` → `assets/icon.icns` (mac) — exists (2.0 MB)
- `package.json:185` → `assets/icon.ico` (win) — exists (129 KB)
- `package.json:188` → `assets/icon.png` (linux) — exists (1024×1024, 1.1 MB)
- `src/helpers/tray.ts:91,93` → `assets/tray-icon-16.png` (macOS tray) — exists (16×16, 892 B)
- `src/helpers/tray.ts:98,102` → `assets/icon.png` (win/linux tray) — exists
- `README.md:3` → `<img src="assets/icon.png" ...>` — exists
- `website/public/favicon.svg`, `website/public/og-image.png` — both exist, updated 2026-07-28

Doc references (`docs/research/murmur-architecture-map.md:197`, `docs/research/deep-test-design-managers.md:448,456`) still describe the **old** tray behavior ("resized to 16x16 + template image", `assets/icon.png`) and are now stale, but they are historical research notes, not active specs — low priority.

### A.2 — `build.files` includes `assets/**/*`

**Status:** Correct
**Evidence:** `package.json:171` → `"assets/**/*",` is present in `build.files`, so `tray-icon-16.png` will be bundled into `process.resourcesPath/assets/` in production. This matches the prod path resolved by `tray.ts:93`.

### A.3 — mac/win/linux icon paths exist

**Status:** Correct
**Evidence:** All three paths in `package.json` (`assets/icon.icns`, `assets/icon.ico`, `assets/icon.png`) resolve to existing files (verified via `ls -la assets/`). `icon.png` confirmed 1024×1024 via `sips`.

### A.4 — `design/icon-rebrand/` committed (6.7 MB)

**Status:** Needs attention
**Evidence:** `git ls-files design/` shows 13 files tracked (5 candidates + 8 exported PNGs), totalling 6.7 MB (`du -sh`). `candidates/` alone is 5.2 MB of master source PNGs. `.gitignore` does **not** exclude `design/`.
**Action needed:** Decide policy. The `exported-png/` set (1.6 MB) is the source of truth that regenerates `assets/`, so keeping it tracked is defensible for reproducibility. The `candidates/` dir (5.2 MB) is exploratory WIP and is a candidate for `.gitignore`-ing or moving to Git LFS. Recommendation: add `design/icon-rebrand/candidates/` to `.gitignore` and keep `exported-png/` tracked. At minimum, document the decision.

---

## B. Tray icon path correctness

### B.1 — `getTrayIconPath()` dev/prod + macOS vs other

**Status:** Correct
**Evidence:** `src/helpers/tray.ts:78-104`:

- macOS dev → `app.getAppPath()/assets/tray-icon-16.png` (line 91)
- macOS prod → `process.resourcesPath/assets/tray-icon-16.png` (line 93)
- win/linux dev → `app.getAppPath()/assets/icon.png` (line 98)
- win/linux prod → `process.resourcesPath/assets/icon.png` (line 102)

Branching is correct: `isDev` is derived from `NODE_ENV === "development"` (line 79), and platform split is `darwin` first (line 89). The comment block (lines 81-88) accurately documents the rationale.

### B.2 — `assets/tray-icon-16.png` exists and is 16×16

**Status:** Correct
**Evidence:** `sips -g pixelWidth -g pixelHeight assets/tray-icon-16.png` → 16×16. File is 892 bytes (appropriately tiny).

### B.3 — `setTemplateImage` / `resize` removal left no dead code

**Status:** Correct
**Evidence:** `grep` of `tray.ts` finds no `setTemplateImage`, no `.resize(`, no `nativeImage.createFromPath(...).resize(...)`. The `nativeImage` import (line 3) is still used by `createFromPath` (line 37) and `createEmpty` (line 47). The rebrand rationale is captured in a comment block (lines 38-44) rather than dead code. Clean.

### B.4 — `design/.../icon-16.png` redundant with `assets/tray-icon-16.png`

**Status:** Needs attention (minor / acceptable duplication)
**Evidence:** `md5 -q assets/tray-icon-16.png` and `md5 -q design/icon-rebrand/exported-png/icon-16.png` return **identical** hashes (`add5b7f58baabbc3fe27eb26d2c3f387`). The two files are byte-for-byte identical.
**Action needed:** This is intentional duplication (design source → shipped asset) and is acceptable, but the `tray.ts:84-85` comment already documents that the asset was "copied from `design/icon-rebrand/exported-png/icon-16.png`". No action required beyond awareness; if a regeneration step is ever scripted, it should copy rather than symlink so prod bundling stays deterministic.

---

## C. Effects code completeness

### C.1 — Imports/exports correct per file

**Status:** Correct
**Evidence:**

- `src/components/effects/Aurora.tsx:11` → `import { Renderer, Program, Mesh, Color, Triangle } from "ogl";`; `Aurora.tsx:127` → `export default function Aurora`. Default export present.
- `src/components/effects/BlurText.tsx:9` → `import { motion, Transition, Easing } from "motion/react";`; `BlurText.tsx:143` → `export default BlurText`. Default export present.
- `src/components/effects/detectWebGL.ts:33` → `export function detectWebGL(): WebGLDetectResult`. Named export present, returns `{ supported, reason? }`.
- `src/components/effects/EffectsLayer.tsx:29` → `export const AURORA_COLOR_STOPS = [...]`; `EffectsLayer.tsx:35` → `export function EffectsLayer(...)`. Both named exports present.

### C.2 — `ogl.d.ts` covers all used ogl APIs

**Status:** Correct
**Evidence:** `src/types/ogl.d.ts` declares `Renderer` (with `gl`, `setSize`, `render`), `Program` (with `uniforms`), `Mesh`, `Color` (with `r,g,b`), `Triangle` (with `attributes`). Cross-checked against `Aurora.tsx` usage:

- `new Renderer({alpha, premultipliedAlpha, antialias})` → covered (constructor options)
- `renderer.gl`, `renderer.setSize`, `renderer.render({scene})` → covered
- `new Triangle(gl)`, `geometry.attributes.uv` → covered
- `new Color(hex)`, `c.r/.g/.b` → covered
- `new Program(gl, {vertex, fragment, uniforms})`, `program.uniforms.*.value` → covered
- `new Mesh(gl, {geometry, program})` → covered

All surface area used by Aurora is declared. The `ProgramUniforms` index signature uses `any` deliberately (documented at `ogl.d.ts:16-21`) to avoid `noUncheckedIndexedAccess` polluting consumers — this is the allowlisted exception.

### C.3 — `history.tsx` lazy-imports and uses BlurText + EffectsLayer

**Status:** Correct
**Evidence:**

- `src/history.tsx:8` → `import { EffectsLayer } from "./components/effects/EffectsLayer";` (eager — correct, EffectsLayer itself is cheap and gates the lazy Aurora)
- `src/history.tsx:11-13` → `const BlurText = React.lazy(() => import("./components/effects/BlurText").then((m) => ({ default: m.default })));` (lazy — correct)
- Usage: `<EffectsLayer enabled={effectsEnabled} />` (`history.tsx:91`); `<BlurText .../>` wrapped in `<React.Suspense>` (`history.tsx:103-110`).

### C.4 — No TypeScript errors in effects files

**Status:** Correct
**Evidence:** `pnpm typecheck` (`tsc --noEmit`) exits 0 with no output. `grep` for `: any`, `as any`, `@ts-ignore`, `@ts-expect-error` across `src/components/effects/*.tsx` and `*.ts` returns **nothing**. The only `any` is inside `src/types/ogl.d.ts:20` (`{ value: any }`), which is the documented allowlist for ambient ogl declarations.

---

## D. Settings persistence chain (the 5-touch trap)

### D.1 — `effects_enabled` in `ALLOWED_SETTING_KEYS`

**Status:** Correct
**Evidence:** `src/helpers/ipc/settingsHandlers.ts:48` → `"effects_enabled",` is the last entry in the `ALLOWED_SETTING_KEYS` set (lines 30-49). `validateSetting` (line 63-69) will therefore accept it.

### D.2 — All 4 touches in `useSettings.ts`

**Status:** Correct
**Evidence:**

1. **SettingsState interface** — `src/settings/useSettings.ts:28` → `effects_enabled: boolean;`
2. **DEFAULT_SETTINGS** — `src/settings/useSettings.ts:68` → `effects_enabled: false,`
3. **loadSettings builder** — `src/settings/useSettings.ts:134` → `effects_enabled: allSettings.effects_enabled === true,` (explicit `=== true` so legacy users with no row default off)
4. **saveSettings body** — `src/settings/useSettings.ts:196-199` → `await window.electronAPI.setSetting("effects_enabled", settings.effects_enabled);`

All four touches present. The reviewer "M3" finding (omitting the saveSettings line silently drops the value) is explicitly called out in the comment at lines 192-195 — good defensive documentation.

### D.3 — Toggle in GeneralSection binds to `effects_enabled`

**Status:** Correct
**Evidence:** `src/settings/sections/GeneralSection.tsx:56-93` — a full switch (copy of the always-on-top pattern) with `aria-checked={settings.effects_enabled}` (line 76) and `onClick={() => onInputChange("effects_enabled", !settings.effects_enabled)}` (lines 77-79). Labels use `t("settings.effects.enableEffects", ...)` and `t("settings.effects.enableEffectsDesc", ...)`.

### D.4 — `history.tsx` reads `effects_enabled` on mount

**Status:** Correct
**Evidence:** `src/history.tsx:26-31` — `useEffect` calls `window.electronAPI.getAllSettings()` and sets `effectsEnabled` from `settings.effects_enabled === true`. The comment (lines 22-24) explains why History reads directly: it is a separate renderer entry that does not share state with the main App.

---

## E. i18n symmetry

### E.1 — `settings.effects.*` keys exist in BOTH locales

**Status:** Correct
**Evidence:** Identical key sets in both files:

- `src/i18n/locales/zh-CN.json:99-107` → `enableEffects`, `enableEffectsDesc`, `toggleOnToast`, `toggleOffToast`, `toggleOn`, `toggleOff`, `toggleAriaLabel` (7 keys)
- `src/i18n/locales/en.json:99-107` → same 7 keys

### E.2 — Same key set, no missing keys

**Status:** Correct
**Evidence:** Both objects contain exactly the same 7 keys (verified by side-by-side read). No key exists in one but not the other.

### E.3 — New hardcoded Chinese in `history.tsx`

**Status:** Needs attention (pre-existing debt, not new violation)
**Evidence:** `history.tsx` still hardcodes several Chinese strings: `"Murmur - 转录历史"` (lines 103, 106, 113), `"关闭窗口"` (line 144), `"文本已复制到剪贴板"` (line 40), `"搜索转录内容..."` (line 269), `"共 N 条记录"` (line 277), `"导出全部"` (line 287), `"加载中..."` (line 300), etc.
**Assessment:** Per the task scope, strings like `"关闭窗口"` and `"Murmur - 转录历史"` are **pre-existing** debt (the file predates the effects work). However, the effects commit **added new code** that also bypasses i18n: the BlurText `text="Murmur - 转录历史"` (line 106) and the Suspense fallback `"Murmur - 转录历史"` (line 103) are new hardcoded strings introduced by `a9b35bf`. The `t()` calls added for the toggle (lines 69-77, 121-130) are correctly i18n'd. **Action:** the new BlurText title string should ideally go through `t("history.title", ...)` for consistency, though it is a pre-existing pattern in this file.

### E.4 — `t()` fallback strings match zh-CN values

**Status:** Correct
**Evidence:** Spot-checked the `t()` fallbacks in `history.tsx` and `GeneralSection.tsx` against `zh-CN.json`:

- `history.tsx:71` fallback `"✨ 特效已开启 — 请到设置中保存以持久化"` == `zh-CN.json:102` `toggleOnToast` ✓
- `history.tsx:75` fallback `"特效已关闭（本次）— 请到设置中保存以持久化"` == `zh-CN.json:103` `toggleOffToast` ✓
- `history.tsx:122` fallback `"✨ 开启特效"` == `zh-CN.json:104` `toggleOn` ✓
- `history.tsx:121` fallback `"关闭特效"` == `zh-CN.json:105` `toggleOff` ✓
- `history.tsx:129` fallback `"切换视觉特效"` == `zh-CN.json:106` `toggleAriaLabel` ✓
- `GeneralSection.tsx:64` fallback `"启用视觉特效"` == `zh-CN.json:100` `enableEffects` ✓
- `GeneralSection.tsx:69` fallback `"在历史记录窗口显示动画背景（需要 WebGL 支持）"` == `zh-CN.json:101` `enableEffectsDesc` ✓

All fallbacks match the zh-CN canonical values, so the app renders correctly even if i18n resources fail to load.

---

## F. CI / build integration

### F.1 — `check-effects-isolation.js` checks correct dir + entry chunks

**Status:** Correct
**Evidence:** `scripts/check-effects-isolation.js`:

- `DIST_DIR` = `src/dist/assets` (line 20) — matches Vite `build.assetsDir` (`src/vite.config.js:20`)
- `ISOLATED_PACKAGES` = `["ogl", "motion"]` (line 23)
- `ENTRY_PREFIXES` = `["main", "history", "settings"]` (line 27) — matches the three Rollup inputs in `vite.config.js:26-28`
- Detection: scans only entry chunks (line 55-57) for the package name substring (line 64)

### F.2 — `ci-check.js` stage3b runs isolation check AFTER renderer build

**Status:** Correct
**Evidence:** `scripts/ci-check.js:182-191` — `stage3` (`build:renderer`) runs first (line 182), then `stage3b` (`node scripts/check-effects-isolation.js`) runs (lines 187-190). Ordering is correct: the isolation check requires the built output to exist.

### F.3 — `pnpm lint` / `typecheck` / `test` results

**Status:** lint BROKEN; typecheck + test pass
**Evidence:**

- `pnpm lint` → **FAIL (exit 1)**. `EffectsLayer.tsx:29` triggers `react-refresh/only-export-components` (exporting `AURORA_COLOR_STOPS` alongside the `EffectsLayer` component). With `--max-warnings 0` (`package.json` lint script), this single warning fails the gate.
- `pnpm typecheck` → **PASS** (exit 0, no output)
- `pnpm test` → **PASS** (81 files, 783 tests, 0 failures)
- `node scripts/check-effects-isolation.js` → **PASS** ("ogl/motion absent from entry chunks")

**Action needed (blocking):** Fix the lint failure. Either (a) move `AURORA_COLOR_STOPS` to a separate non-component module (e.g. `src/components/effects/aurora-theme.ts`) and import it into both `EffectsLayer.tsx` and the test, or (b) add an inline `// eslint-disable-next-line react-refresh/only-export-components` on line 29 with a justification comment. Option (a) is cleaner and aligns with the rule's intent; option (b) is the surgical fix. This **breaks the AGENTS.md build gate** (`AGENTS.md:124` requires `./build.sh` exit 0, and `pnpm lint` is a basic gate per line 125).

---

## G. License / NOTICE completeness

### G.1 — NOTICE attributes react-bits, ogl, motion

**Status:** Correct
**Evidence:** `NOTICE:20-29`:

- react-bits (MIT + Commons Clause) — attributed with source URL, Copyright `(c) 2026 David Haz`, and the "embedded as part of an application" clause. Lists both vendored files (`Aurora.tsx`, `BlurText.tsx`).
- ogl (Unlicense) — attributed at `NOTICE:28`
- motion (MIT) — attributed at `NOTICE:29`

Additionally, both vendored source files carry inline SPDX headers (`Aurora.tsx:1-8`, `BlurText.tsx:1-7`) repeating the license and source.

### G.2 — `pnpm license:check` passes (no GPL/AGPL)

**Status:** Correct
**Evidence:** `pnpm license:check` exits 0. The `--failOn "GPL-*;AGPL-*"` flag (`package.json` license:check script) did not trigger. ogl (Unlicense) and motion (MIT) both pass the gate.

### G.3 — `THIRD-PARTY-LICENSES` stale

**Status:** Needs attention
**Evidence:** `THIRD-PARTY-LICENSES:5` is dated `Generated: 2026-05-20` (pre-dates both feature commits). It lists neither `ogl` nor `motion` (verified by reading the full file — entries jump from `next-themes` to `node-gyp` to `osascript`, no `ogl`/`motion` entries). The file appears manually maintained rather than auto-generated.
**Action needed:** Add entries for `ogl@1.0.11` (Unlicense) and `motion@12.42.2` (MIT) to keep the file accurate. If the file is intended to be auto-generated, add a generation step to the build/CI; otherwise manually append the two entries. Low priority (NOTICE is the authoritative attribution and is correct).

---

## H. Package.json hygiene

### H.1 — `ogl` and `motion` in `dependencies`

**Status:** Correct
**Evidence:** `package.json` `dependencies` block contains `"motion": "^12.42.2"` and `"ogl": "^1.0.11"` (both present in the dependencies object, NOT devDependencies). Correct — they ship to end users.

### H.2 — No leftover temp icon deps

**Status:** Correct
**Evidence:** `grep -nE "resvg|to-ico|sharp|png-to-ico|jimp" package.json` → no matches. The icon-generation toolchain (used transiently to produce icns/ico) was correctly removed from the manifest. The `design/icon-rebrand/exported-png/` artifacts are committed instead of being regenerated at build time.

### H.3 — No leftover `scripts.icons` / generate-icons

**Status:** Correct
**Evidence:** `grep -nE "scripts.icons|generate-icons|\"icons\"" package.json` → no matches. No icon-generation npm script remains.

---

## I. Cleanup / debt

### I.1 — `src/dist/` stale old icons

**Status:** Needs attention (local only, not tracked)
**Evidence:** `src/dist/` contains stale icons from a 2026-07-28 build: `icon.png` (181 KB — the OLD icon, current is 1.1 MB), `icon.ico` (183 KB — old, current is 129 KB), `icon.icns` (1.5 MB — old, current is 2.0 MB). These are copied by Vite's `publicDir: "../assets"` (`src/vite.config.js:100`).
**Assessment:** `src/dist/` is NOT git-tracked (`git ls-files src/dist/` is empty) and NOT in `.gitignore`, so this is local build output only — it does not pollute the repo. A fresh `pnpm build:renderer` will overwrite them. No action strictly required, but adding `src/dist/` to `.gitignore` would prevent accidental commits of build artifacts (currently they could be `git add`ed).

### I.2 — `dist-main/`, `dist/` stale artifacts

**Status:** Correct (gitignored)
**Evidence:** `dist-main/` contains `main.js` (957 KB, 2026-07-28). Both `dist-main/` and `dist/` are in `.gitignore` (lines `dist-main/` and `dist/` respectively). `dist/` holds old packaging output (`Murmur-1.0.0-*` and `Murmur-1.0.3-*`). These are correctly ignored and will regenerate on build.

### I.3 — Old temp files (`icon-reference.png`, `tray-icon.svg`, `tray-icon.png`)

**Status:** Correct (deleted)
**Evidence:** `ls assets/icon-reference.png assets/tray-icon.svg assets/tray-icon.png` → all three "No such file or directory". The transient hand-drawn tray experiments referenced in `.omc/notepad.md:33` were correctly removed before commit.

### I.4 — `.gitignore` excludes `backups/` and `candidates/`

**Status:** backups excluded; candidates NOT excluded
**Evidence:** `.gitignore` last line → `backups/` is excluded. `design/icon-rebrand/candidates/` is NOT excluded (5.2 MB tracked, see A.4).
**Action needed:** Consider adding `design/icon-rebrand/candidates/` to `.gitignore` (see A.4 recommendation).

---

## J. Best practices check

### J.1 — Lazy-loading prevents ogl/motion bundle bloat

**Status:** Correct
**Evidence:** The only `import ... from "ogl"` / `from "motion/react"` statements in `src/` are inside the effects files themselves (`Aurora.tsx:11`, `BlurText.tsx:9`). Both files are reached exclusively via `React.lazy()`:

- `EffectsLayer.tsx:23` → `const Aurora = lazy(() => import("./Aurora"));`
- `history.tsx:11-13` → `const BlurText = React.lazy(() => import("./components/effects/BlurText")...)`

`EffectsLayer` itself is imported eagerly (`history.tsx:8`) but it only references `Aurora` via the lazy wrapper, so Vite splits ogl into a separate chunk. Verified empirically: `check-effects-isolation.js` confirms ogl/motion are absent from all three entry chunks (main/history/settings).

### J.2 — `prefers-reduced-motion` handled

**Status:** Correct
**Evidence:** `EffectsLayer.tsx:48-53` subscribes to `window.matchMedia("(prefers-reduced-motion: reduce)")`, updates `reducedMotion` state, and line 70 returns `null` when `reducedMotion` is true. The listener is properly cleaned up (line 52).

### J.3 — WebGL detection (SwiftShader rejection)

**Status:** Correct
**Evidence:** `detectWebGL.ts:16-22` defines `SOFTWARE_RENDERER_PATTERNS` = `["swiftshader", "llvmpipe", "software", "microsoft basic", "apple software"]`. Lines 43-57 query `WEBGL_debug_renderer_info` and reject matches. Covered by `tests/unit/detectWebGL.test.ts` (6 tests, passing).

### J.4 — History root transparency conditional

**Status:** Correct
**Evidence:** `history.tsx:84-86` → `rootClassName` is `"min-h-screen bg-transparent relative"` when `effectsEnabled`, else the original `"min-h-screen bg-[#f5f5f7] dark:bg-[#1c1c1e]"`. The Aurora layer sits at `-z-10` (`EffectsLayer.tsx:73`) and content cards keep solid `bg-white`, preserving readability.

### J.5 — AGENTS.md rule compliance

**Status:** Mostly correct; two deviations
**Evidence:**

- **i18n (rule 6, line 89):** The toggle UI text is fully i18n'd. **Deviation:** the new BlurText `text="Murmur - 转录历史"` (`history.tsx:106`) is a new hardcoded string (see E.3).
- **No `any` (rule, line 114):** Clean in all effects source. Only `ogl.d.ts` uses `any` (allowlisted ambient declaration).
- **Surgical changes:** All edits are tagged with `[20260729_...]` comments (rule, lines 141-151) — e.g. `tray.ts:38`, `EffectsLayer.tsx:1`, `useSettings.ts:25,132,192`, `settingsHandlers.ts:47`, `history.tsx:9,21,60,80,98,117`. Compliant.
- **Build gate (rule, line 124/125):** **BROKEN** — `pnpm lint` fails (see F.3). This is the most significant deviation.

---

## Summary table

| ID  | Item                                               | Status                                 |
| --- | -------------------------------------------------- | -------------------------------------- |
| A.1 | Icon references correct                            | Correct                                |
| A.2 | `build.files` includes `assets/**/*`               | Correct                                |
| A.3 | mac/win/linux icon paths exist                     | Correct                                |
| A.4 | `design/icon-rebrand/` committed (6.7 MB)          | Needs attention                        |
| B.1 | `getTrayIconPath()` dev/prod + platform            | Correct                                |
| B.2 | `tray-icon-16.png` is 16×16                        | Correct                                |
| B.3 | No dead code from setTemplateImage/resize removal  | Correct                                |
| B.4 | `icon-16.png` duplication (byte-identical)         | Needs attention (acceptable)           |
| C.1 | Effects imports/exports correct                    | Correct                                |
| C.2 | `ogl.d.ts` covers all used APIs                    | Correct                                |
| C.3 | `history.tsx` lazy-imports BlurText + EffectsLayer | Correct                                |
| C.4 | No TS errors in effects files                      | Correct                                |
| D.1 | `effects_enabled` in `ALLOWED_SETTING_KEYS`        | Correct                                |
| D.2 | All 4 useSettings touches                          | Correct                                |
| D.3 | GeneralSection toggle binds `effects_enabled`      | Correct                                |
| D.4 | `history.tsx` reads `effects_enabled` on mount     | Correct                                |
| E.1 | `settings.effects.*` in both locales               | Correct                                |
| E.2 | Symmetric key sets                                 | Correct                                |
| E.3 | New hardcoded Chinese in history.tsx               | Needs attention                        |
| E.4 | `t()` fallbacks match zh-CN                        | Correct                                |
| F.1 | Isolation script dir + entry chunks correct        | Correct                                |
| F.2 | ci-check stage3b after renderer build              | Correct                                |
| F.3 | lint / typecheck / test                            | **lint BROKEN**; typecheck + test pass |
| G.1 | NOTICE attributes react-bits/ogl/motion            | Correct                                |
| G.2 | `license:check` passes                             | Correct                                |
| G.3 | THIRD-PARTY-LICENSES stale (no ogl/motion)         | Needs attention                        |
| H.1 | ogl/motion in dependencies                         | Correct                                |
| H.2 | No leftover temp icon deps                         | Correct                                |
| H.3 | No leftover scripts.icons                          | Correct                                |
| I.1 | `src/dist/` stale icons (local, untracked)         | Needs attention (low)                  |
| I.2 | dist-main/dist gitignored                          | Correct                                |
| I.3 | Old temp files deleted                             | Correct                                |
| I.4 | `.gitignore` backups yes; candidates no            | Needs attention                        |
| J.1 | Lazy-loading prevents bloat                        | Correct                                |
| J.2 | `prefers-reduced-motion` handled                   | Correct                                |
| J.3 | SwiftShader rejection implemented                  | Correct                                |
| J.4 | Root transparency conditional                      | Correct                                |
| J.5 | AGENTS.md compliance                               | Mostly (lint gate broken)              |

---

## Prioritized fix list

### P0 — Blocking (breaks build gate)

1. **Fix `pnpm lint` failure.** `src/components/effects/EffectsLayer.tsx:29` exports `AURORA_COLOR_STOPS` alongside the `EffectsLayer` component, triggering `react-refresh/only-export-components` under `--max-warnings 0`. This fails `pnpm lint` (exit 1) and therefore the AGENTS.md build gate (`AGENTS.md:124-125`).
   - **Preferred fix:** extract `AURORA_COLOR_STOPS` into a new `src/components/effects/aurora-theme.ts` (non-component module), import it into both `EffectsLayer.tsx` and `tests/unit/effects-layer.test.ts`. This satisfies the rule's intent (fast-refresh only tracks component-only files).
   - **Surgical fix:** add `// eslint-disable-next-line react-refresh/only-export-components` on `EffectsLayer.tsx:29` with a justification comment. Faster but propagates the disable.

### P1 — Should fix (correctness / consistency)

2. **Update `THIRD-PARTY-LICENSES`** to add `ogl@1.0.11` (Unlicense) and `motion@12.42.2` (MIT) entries, or add a generation step. The file is dated 2026-05-20 and is now stale. NOTICE is authoritative and correct, so this is lower-risk but should not be left indefinitely.

### P2 — Nice to have (debt / hygiene)

3. **i18n the new BlurText title.** `history.tsx:106` (`text="Murmur - 转录历史"`) and the Suspense fallback (`history.tsx:103`) are new hardcoded strings introduced by the effects commit; route them through `t("history.title", "Murmur - 转录历史")`. (Pre-existing hardcoded strings in the same file are out of scope.)
4. **`.gitignore` policy for `design/icon-rebrand/candidates/`.** 5.2 MB of exploratory master PNGs is tracked. Add to `.gitignore` (keeping `exported-png/` as the reproducible source) or move to Git LFS.
5. **Add `src/dist/` to `.gitignore`.** Currently untracked and not ignored — a stray `git add .` could commit build artifacts.
6. **Refresh stale doc references.** `docs/research/murmur-architecture-map.md:197` and `docs/research/deep-test-design-managers.md:448,456` still describe the old tray behavior (`assets/icon.png` + resize + `setTemplateImage`). Low priority (historical research notes).

---

## Verification commands run

| Command                                   | Result                                                 |
| ----------------------------------------- | ------------------------------------------------------ |
| `pnpm typecheck`                          | PASS (exit 0)                                          |
| `pnpm lint`                               | **FAIL (exit 1)** — EffectsLayer react-refresh warning |
| `pnpm test`                               | PASS (81 files, 783 tests)                             |
| `pnpm license:check`                      | PASS (exit 0, no GPL/AGPL)                             |
| `node scripts/check-effects-isolation.js` | PASS (ogl/motion absent from entry chunks)             |
