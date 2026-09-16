# Bloub Bot Integration Survey (2026-09-04)

Fact-finding for porting the bloub bot engine (`/Users/guanxueliang/Desktop/oh-my-ai/bloub/src/bot/`, framework-free pure functions, `sample(t) -> BotFrame`) into Murmur's main window as a recording/transcription-state mascot React shell.

All paths are repo-relative to `/Users/guanxueliang/Desktop/oh-my-ai/Murmur` unless prefixed `bloub:` (that repo's `src/`). No product code was changed for this survey.

---

## 1. State Sources

### 1.1 Recording / processing / optimizing / error — `useRecording`

- Carried by `src/hooks/useRecording.ts`, declared at lines 30-33 (`isRecording`, `isProcessing`, `isOptimizing`, `error`); returned at lines 531-541.
- Instantiated once, in `App` only: `src/App.tsx:67-84` (aliased `isProcessing` -> `isRecordingProcessing`, `error` -> `recordingError`).
- State-machine transition points:
  - `setIsRecording(true)` — useRecording.ts:159 (after `mediaRecorder.start(1000)` at 158).
  - `onstop` handler — useRecording.ts:126-128: `setIsRecording(false)` + `setIsProcessing(true)`; `finally` at 143 sets `setIsProcessing(false)`.
  - `onerror` — useRecording.ts:147-155: sets `error`, clears both flags.
  - Start failure — useRecording.ts:160-163: `setError`, `setIsRecording(false)`.
  - `setIsOptimizing(true)` — useRecording.ts:232 (right after successful FunASR transcription, inside a 100 ms `setTimeout` at 233); `setIsOptimizing(false)` in its `finally` at 377.
  - Transcription/optimization errors — useRecording.ts:373-375 (`setError`).
  - `cancelRecording` — useRecording.ts:496-516: clears all three flags + error.
- **Not safe to re-instantiate**: the hook owns `MediaRecorder`/`MediaStream` refs (useRecording.ts:36-38). A mascot calling `useRecording()` itself would create a parallel recorder, not observe the app's. Reuse must go through props lifted from `App`, or a new context.

### 1.2 Derived app state machine — `micState` in App

- `src/App.tsx:404-413` (`getMicState` + `const micState = getMicState()`): the single derivation of `recording | processing | optimizing | hover | idle`. This is the natural mirror source for the mascot: one already-computed enum.
- It is consumed at App.tsx:432-469 (`getMicButtonProps` tooltips/labels) and the icon switch at App.tsx:627-641 (`SoundWaveIcon` / `VoiceWaveIndicator` / `LoadingDots` per state) — the mascot can be driven by the same value in parallel without touching any of those branches.
- Error surfacing for recording: App.tsx:397-401 (toast on `recordingError`).

### 1.3 FunASR / model stage — `useModelStatus` (context, directly reusable)

- `src/hooks/useModelStatus.tsx`: `ModelStatus` interface lines 11-26 (`isLoading`, `isReady`, `isUnloaded`, `isDownloading`, `error`, `downloadProgress`, `stage`, ...). Initial `stage: "checking"` at line 61.
- `stage` transition points: `need_download` :144, `ready` :156, `loading` :168, `unloaded` :182 (T12 idle-unload), `error` :194/:207/:253/:268, `downloading` :223 and :334 (push event), `loading` post-download :235, `ready`/`loading` via `onProcessingUpdate` :356-364. Polling loop at 282-296.
- Exposed via React Context: provider wraps `<App/>` in `src/main.tsx:204-207`; `useModelStatus()` (useModelStatus.tsx:392-399) is callable from **any component under the provider — the mascot can call it directly, zero plumbing**.
- Model-download progress push subscription: useModelStatus.tsx:298-341 (`downloadProgress`, per-model `modelProgress`).

### 1.4 File transcription (with progress) — `useFileTranscription`

- `src/hooks/useFileTranscription.ts`: explicit union `TranscriptionState = idle | selected | transcribing | done | error | cancelled` (lines 3-9); `state` at line 40; `progress` (with `progress_pct`, line 23) at 42-44.
- Transitions: `selected` :81 and :116; `transcribing` :133; `done` :178; `error` :63, :71, :87, :93, :106, :122, :129, :141, :226, :231; `cancelled` :246; reset-to-`idle` :250-257. Progress subscription via `window.electronAPI.onFileTranscriptionProgress` at 144-153.
- **Gap**: this hook is consumed only inside `src/components/FileImport.tsx:18` — the state never leaves that component. `App` only knows `appMode === "file-import"` (App.tsx:51, :579, :717-730). A global mascot cannot see file-transcription state today; either lift `useFileTranscription` into `App`/a context (a real refactor of FileImport), or accept that the mascot only reflects mic-mode states initially.

### 1.5 Summary for the mascot

| Mascot input                                  | Source                                           | Reusable as-is?                                   |
| --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| idle / recording / transcribing / optimizing  | `micState`, App.tsx:404-413                      | Yes — pass as prop from App (already computed)    |
| model stage (download/loading/error/unloaded) | `useModelStatus()` context                       | Yes — call directly under provider (main.tsx:204) |
| download % / model progress                   | `modelStatus.downloadProgress` / `modelProgress` | Yes — same context                                |
| file transcription state + %                  | `useFileTranscription` inside FileImport.tsx:18  | No — needs lifting or a context first             |
| recording error text                          | `recordingError`, App.tsx:73/:397-401            | Yes — as prop                                     |

---

## 2. Mount Points

### 2.1 Window + layout

- Main window is 520x640, **frameless** (`frame: false`): `src/helpers/windowManager.ts:84-86`. Title bar dragging is CSS `-webkit-app-region: drag` (`.draggable` / `.non-draggable`, `src/index.css:212-219`), applied to the title bar row (App.tsx:479-484); the right-side control cluster opts out via `.non-draggable` (App.tsx:488).
- `App` JSX hierarchy (App.tsx:474-733): root `div.min-h-screen p-4` (:475) -> `div.max-w-2xl mx-auto min-h-screen flex flex-col` (:477) -> [title bar :479-554] -> [mode tabs :557-589] -> [recording section :592-714: mic control block :595-676, model download progress :679-687, transcription result :689-712] -> [file-import section :717-730].
- `src/index.css`: `#root { height: 100%; background: transparent }` (:92-95) — the root fills the window, so an absolutely positioned child of the root covers window coordinates; content is single-column, `max-w-2xl` (= 448 px, narrower than the 520 px window), leaving ~36 px gutters.

### 2.2 Floating-layer precedent

- **No `position: fixed` exists anywhere in `src/`.** The only overlay precedent is `src/components/Tooltip.tsx:17-23, 40-49`: `absolute` Tailwind classes (`absolute top-full left-1/2 ... z-50`) inside a `relative inline-block` wrapper. `z-50` + `backdrop-blur` + `bg-black/80` styling there is the visual language to copy.
- A corner mascot would therefore be the codebase's first `fixed`/root-`absolute` layer — no existing CSS conflicts with it (root has no `overflow: hidden`).

### 2.3 Candidate positions

1. **Beside the mic button / status paragraph** (App.tsx:595-676) — the block already re-renders per state (:627-641); an avatar here mirrors `micState` with zero new wiring. Trade-off: competes for vertical space in a 640 px window when results are shown.
2. **Title bar, left of the `Murmur` h1** (App.tsx:485-487) — the row is `flex justify-between` with ~6 buttons on the right; a ~48-64 px avatar fits, but the row is `-webkit-app-region: drag`, so any interactive mascot element must add `.non-draggable` (index.css:217-219).
3. **Corner overlay** (bottom-left/bottom-right, sibling of the :477 column inside the :475 root, rendered unconditionally so it survives mode switches) — best "always visible" option; ~80-120 px is 15-23% of the window's 520 px width, so size toward the lower end or make it collapsible.

- Render tech: the bloub engine emits SVG path strings (`bloub:bot/engine.ts:23-38` `BotFrame.bodyPath`, `eyes[].d`, dots/arcs), rendered as plain `<svg><path/></svg>` in `bloub:components/BloubBot.vue:486-582`. A React shell needs no canvas, no animation library.

---

## 3. i18n Status Quo

- **Setup**: `src/i18n/index.ts:3-6` imports `i18next` + `initReactI18next` + two JSON resources; `init` at :11-21 with `lng: savedLanguage || navigator.language || "zh-CN"` and `fallbackLng: "zh-CN"`; `savedLanguage` read from `localStorage["language"]` (:8-9). The init module is imported **only** by the main-window entry: `src/main.tsx:5` (`import "./i18n"`).
- **Locales**: `src/i18n/locales/zh-CN.json` and `en.json` only; top-level namespaces `app`, `settings`, `history`, `recording`, `common` (both files).
- **Usage pattern** (settings window, the compliant code): `const { t } = useTranslation()` plus an inline Chinese default on every call, e.g. `t("settings.loadFailed", "加载设置失败")` (`src/settings/useSettings.ts:103, :168`), `t("settings.recognition.alwaysOnTop", ...)` (`src/settings/sections/GeneralSection.tsx:14, :24`). Files using `useTranslation`: `src/settings.tsx:7`, `src/settings/SettingsSidebar.tsx:3`, all four `src/settings/sections/*.tsx`, `src/settings/useSettings.ts:5`. Language switcher: GeneralSection.tsx:136-152 (`i18n.changeLanguage` + `localStorage.setItem("language", ...)` + `document.documentElement.lang`).
- **Gap**: the main window does not use i18n at all — `App.tsx` hardcodes Chinese for every user-visible string (stage texts :35-44, toasts :114/:152/:173/:226-263, tooltips :436-466, buttons :576/:586/:707, status paragraph :647-667). `history.tsx` likewise. So the _existing pattern to imitate_ is the settings-window one, not App's.
- **bloub side**: bloub's i18n is app-level and separate from the engine — `bloub:i18n/` (`langues.ts`, `locales/`, `i18n.test.ts`); a grep over `bloub:src/bot/*.ts` (excluding tests) finds **zero** i18n/`t()` references. Verdict: **the French i18n layer can be dropped wholesale; the engine ports clean.**
- **Bot tooltip / a11y labels**: add a `bot` namespace (or keys under `common`) to both `src/i18n/locales/{zh-CN,en}.json`, and in the mascot component use `const { t } = useTranslation(); ... aria-label={t("bot.label.recording", "录音中")}` — i.e. the GeneralSection pattern with inline defaults, which also survives being rendered in an entry that forgot to import the init module (settings.tsx never does, and every `t()` there still resolves via its fallback argument).

---

## 4. Settings: the "4-places" Pattern (exact lines)

For a hypothetical new key `bot_appearance`:

| Place                                                               | File:line                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `SettingsState` interface (add field)                            | `src/settings/useSettings.ts:14-30` (current keys :15-27)                                                                                                                                                                                            |
| 2. `DEFAULT_SETTINGS` (add default)                                 | `src/settings/useSettings.ts:71-86`                                                                                                                                                                                                                  |
| 3. `loadSettings` builder (add mapping to `loadedSettings` literal) | `src/settings/useSettings.ts:130-172` — the literal is :135-156 (hotwords example :152-155)                                                                                                                                                          |
| 4. `ALLOWED_SETTING_KEYS` allowlist (add key)                       | `src/helpers/ipc/settingsHandlers.ts:21-43`; enforced by `validateSetting` at :57-63 (`if (!ALLOWED_SETTING_KEYS.has(key)) return false;` :59); value length cap `MAX_VALUE_LENGTH = 10000` :45                                                      |
| (no 5th place) `saveSettings`                                       | `src/settings/useSettings.ts:183-212` — since tag `[20260815_Refactor_SaveSettingsLoop]` (:177-183) it loops `Object.keys(settings)` (:193-199), so new keys persist automatically; `handleInputChange` (:221-226) also persists any key immediately |

- **UI surface**: a control goes in a settings section — `src/settings/sections/GeneralSection.tsx` is the template (select/checkbox bound to `handleInputChange`, e.g. :60-90); sections are registered in `src/settings.tsx:15-24, :66`.
- **Cross-window propagation is free**: main-process `broadcastSettingsUpdate` (`src/helpers/ipc/settingsHandlers.ts:70-75`, called on SET :90) -> `onSettingsUpdate` subscribers (App.tsx:349-353 caches; useModelStatus.tsx:371-378 re-checks). The mascot can subscribe the same way to hot-reload shape/color/expression.
- **Cost verdict**: exposing shape/color/expression selection is mechanical — ~4 one-line edits + one section control + 2 locale files + validation tests. The heavy part is UI/UX, not plumbing. Note the main window reads settings via `window.electronAPI.getSetting` (App.tsx:333-341) rather than `useSettings` (which lives in the settings window) — the mascot should do the same `getSetting` + `onSettingsUpdate` dance.

---

## 5. Test Net

- **Config**: standalone `/Users/guanxueliang/Desktop/oh-my-ai/Murmur/vitest.config.ts` (vitest ^4.1.6, `@vitest/coverage-v8` ^4.1.6, jsdom ^30 — package.json devDependencies).
  - `test.environment: "node"`, `test.include: ["tests/**/*.test.{js,ts,jsx,tsx}"]`, `test.exclude: ["tests/e2e/**", "node_modules/**"]`, `globals: true` (lines 5-9).
  - `coverage.include: ["src/**/*.{js,ts,tsx}"]` with a large `exclude` list; `thresholds: { statements: 96, branches: 92, functions: 94, lines: 96 }` (same file, coverage block; the `[20260729_Gate_FullSrcCoverage]` / `[20260729_Gate_FullSrcThresholds]` comments document 96.6/92.8/94.5/97.1 actuals).
- **Will `src/bot/*.test.ts` be collected?** **No.** `test.include` only scans `tests/`. Repo convention is all tests under `tests/unit/*.test.ts(x)` importing `../../src/...` (e.g. `tests/unit/app.test.tsx:12` imports `../../src/hooks/useRecording`). So: put bot tests in `tests/unit/bot/` (no config change needed), or extend `test.include` (config change + CI implications). Recommended: follow the convention.
- **Environment**: default `node` is exactly right for pure engine tests (`sample(t)` needs no DOM); renderer-shell tests opt into jsdom per-file via a `// @vitest-environment jsdom` docblock plus `import "../setup/react"` (`tests/unit/app.test.tsx:1-2`; setup at `tests/setup/react.ts`). Both bloub's pure test style (`bloub:bot/engine.test.ts` — anchor/footprint assertions on generated path `d` strings, no DOM) and Murmur's component-test style have a place.
- **Typecheck**: `tsconfig.test.json` `include` = `["src/**/*", "main.ts", "preload.ts", "tests/**/*.ts", "tests/**/*.tsx"]` — `pnpm typecheck:tests` will typecheck `src/bot/` automatically even if its tests live in `tests/`.
- **Coverage-gate risk (important)**: Murmur is on Vitest 4, which **removed `coverage.all`**; with `coverage.include` matching `src/**`, files matching the pattern are counted against thresholds even when no test imports them (Vitest 4 migration guide). Consequence: dropping ported engine files into `src/bot/` will **immediately drag the 96/92/94/96 global thresholds** unless the ported tests land in the same change. Mitigation: port bloub's existing 9 spec files (`engine/cycles/expressions/face/shape/skins/...test.ts`) to `tests/unit/bot/` in the same PR, or temporarily add `src/bot/**` to `coverage.exclude` with a tracked removal ticket.

---

## 6. Rendering Precedents

- **`requestAnimationFrame`: none in `src/`** (grep over `*.ts`/`*.tsx` = 0 hits). The bloub engine itself is clock-less and pure — `sample(t)` is "une fonction pure du temps" (`bloub:bot/engine.ts:123`), `BotEngine.sample(now): BotFrame` at `bloub:bot/engine.ts:424`, `setState(id, now)` at :408; the rAF loop lives in the Vue shell (`bloub:components/BloubBot.vue:321, :456`). The React mascot will introduce Murmur's **first** rAF loop (one `useEffect` + cancel on unmount; no competing loops exist).
- **`prefers-reduced-motion`**: handled at CSS level only — `src/index.css:234-240` disables `.fade-in/.recording-pulse/.wave-bar`, and :366-372 disables the loading-dots animation. No JS `matchMedia("(prefers-reduced-motion...)")` anywhere in `src/` (the only `matchMedia` uses are `prefers-color-scheme`: `src/main.tsx:179`, `src/settings/useSettings.ts:95-97`). A JS-side engine-pause would be new; a CSS-class kill-switch follows precedent.
- **CSS animations**: rich precedent — `@keyframes pulse-recording` + `.recording-pulse` (index.css:119-133; used App.tsx:447), `@keyframes wave` + `.wave-bar` (index.css:136-161; used `src/components/SoundWaveIcon.tsx:18`), `fadeIn` (:164-177), model status animations (:286-336), `loading-dots` (:348-363); Tailwind `animate-pulse` in `src/components/VoiceWaveIndicator.tsx:11` and App.tsx:722.
- **SVG output shape**: `BotFrame` (`bloub:bot/engine.ts:23-38`) = `bodyPath`, `eyes[] {d, matrix, alpha}`, `dots[]`, `arcs[]`, `notif/notch` — all SVG-attribute-ready strings, proven renderable as plain `<svg>` (`bloub:components/BloubBot.vue:486-582`). Engine constructor: `new BotEngine(scale=100, initial='idle', shape=null, expression=null)` (`bloub:bot/engine.ts:166-173`), plus `setExpression(expr, now)` (:180-184) and `setState(id, now)` (:408) — the whole API a React shell needs. Available `StateId`s for mapping (`bloub:bot/states.ts:208-569`): `idle, thinking, wink, wide, alert, notify, exclaim, sleep, egg, hexagon, play, orbit, swirl, burst, comet`.

---

## Bottom Line

- **Feasible with minimal intrusion**: mascot = one new component fed by (a) `micState` prop from App.tsx:413, (b) direct `useModelStatus()` context, (c) SVG render of `BotFrame`. Mount beside the mic block or as a root-level corner layer (first `fixed` in the codebase, Tooltip's `absolute z-50` being the styling precedent).
- **Two real integration gaps**: file-transcription state is trapped inside `FileImport.tsx:18` (needs lifting to be mascot-visible), and `useRecording` must not be instantiated twice.
- **Two hard gates**: i18n — use the settings-window `t(key, "中文默认")` pattern with new `bot.*` keys in both locales (App's hardcoded-Chinese style violates AGENTS.md MUST DO #4; don't copy it); coverage — Vitest 4 counts `src/bot/**` against 96/92/94/96 the moment it lands, so port bloub's test suite in the same PR.
