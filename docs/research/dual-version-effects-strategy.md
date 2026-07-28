# Research: Dual-Version (Lite vs Effects/Pro) Strategy for react-bits Integration

> Date: 2026-07-28 | Scope: Should Murmur ship as two editions (Lite vs Effects/Pro) to add react-bits visual effects?
> Method: Primary sources only (electron-builder docs, Vite docs, react-bits repo source, npm/Bundlephobia, Electron GPU issues). Code references are to the Murmur repo at repo root `/Users/guanxueliang/Desktop/oh-my-ai/Murmur`.

---

## TL;DR

**Do NOT build two editions. Ship a single build with a runtime "Effects" toggle backed by lazy (`React.lazy` / dynamic `import()`) loading of any heavy effect.** Murmur's main window is a 520×640 frameless, transparent, always-on-top panel (`src/helpers/windowManager.ts:74-94`) that the user summons via hotkey for a few seconds of dictation — its core job is instant response, not visual spectacle. The react-bits dependency cost is real but **per-component, not monolithic** (verified by reading source: light text effects need only `motion` ~0.4MB unpacked; shader backgrounds use `ogl` ~131KB/34KB gzip, NOT three.js; only a minority of components pull `three` 674KB/169KB gzip + `@react-three/fiber` 154KB/48KB gzip). Dynamic import makes those costs invisible to users who keep effects off, and Murmur already uses `React.lazy` for SettingsPage (`src/App.tsx:20-22`) plus Vite `manualChunks` (`src/vite.config.js:30-40`), so the pattern is already in place. The Commons Clause on react-bits is compatible with embedding in an Apache-2.0 app **as long as you copy-paste (not re-publish the components as a library)**, which is exactly the shadcn-style install react-bits is designed for. Verdict: **one build, one codebase, runtime toggle + code-splitting**. Two installers would double maintenance and packaging complexity for zero user benefit.

---

## Findings

### A. Electron build/packaging: how to ship two editions

#### What electron-builder natively supports (from the official CLI docs)

From `https://www.electron.build/docs/cli`, the relevant flags:

- `-c, --config` — "The path to an electron-builder config. Defaults to `electron-builder.yml` (or `json`, or `json5`, or `js`, or `ts`)". So you can point at different config files per edition.
- `-c.<path>=<value>` inline override — e.g. `electron-builder -c.extraMetadata.foo=bar` sets `package.json` property `foo` to `bar`; `--config.nsis.unicode=false` overrides nested config. This means `appId`, `productName`, `extraResources`, `files`, `directories.output` can be overridden **without editing files**.
- `--projectDir, --project` — build from a different project dir.
- `-p, --publish` — `onTag | onTagOrDraft | always | never`. Supports release channels (see electron-builder "Release Using Channels" tutorial).
- `extends` (config-level) — one config file can inherit from another, enabling base + per-edition overrides.

So electron-builder gives three legitimate mechanisms for "two editions":

1. **Two config files** (`electron-builder.lite.yml`, `electron-builder.effects.yml`) selected via `--config`, with `extends` sharing a base. Lowest-friction way to produce two installers if you truly want two binaries.
2. **Inline overrides** at build time: `electron-builder --config -c.extraMetadata.name=murmur-effects -c.productName="Murmur Effects"`. Useful for CI matrix builds.
3. **Two publish channels** (e.g. `latest` vs `effects`) so auto-update segregates user populations.

#### The four strategies compared

| Strategy                           | Mechanism                              | Maintenance | Code-fork risk                 | Lite bundle                  | Startup perf |
| ---------------------------------- | -------------------------------------- | ----------- | ------------------------------ | ---------------------------- | ------------ |
| **Runtime feature flag**           | one build, setting toggles render      | lowest      | none                           | depends on import discipline | best if lazy |
| **Build-time flag (`define`/env)** | two builds, dead-code elimination      | medium      | low (branching in source)      | smallest                     | best         |
| **Dynamic import / code split**    | one build, heavy chunks load on demand | low         | none                           | small first paint, lazy rest | best         |
| **Two published installers**       | two electron-builder targets/channels  | highest     | medium (drift between configs) | smallest                     | best         |

#### How real Electron apps actually do "free vs pro"

The consistent pattern reported across Electron community discussions (Reddit r/electronjs "Building Electron Apps - How do big companies do it?") and Stack Overflow ("Dynamic imports in Electron CommonJS with TypeScript and Webpack"): **single codebase + runtime license/feature flag + dynamic imports for heavy pro-only modules**. Producing two binaries is rare and usually reserved for genuinely different products (different appId), not "same app, more visuals." electron-builder issue #3575 ("Dynamic import support") documents the main gotcha: when lazy-loading on the **main** (Node) side, you must configure the bundler to emit chunks rather than inline them — but on the **renderer** side (where Murmur's effects would live), Vite handles this automatically.

#### Tradeoffs specific to Murmur

Murmur's `package.json` build config (`build` block, lines 143-189) is simple: one `appId`, one `productName`, three platform blocks, `asarUnpack` for native `better-sqlite3`. Adding a second edition would mean a second appId (or a second `productName`), a second CI matrix leg per platform (mac/win/linux × 2 = 6 builds instead of 3), double code-signing/notarization cost/time, and two auto-update channels to maintain. For a solo-maintained Apache-2.0 tool, that overhead is hard to justify for what is essentially a coat of paint.

---

### B. Performance impact of heavy animation deps in Electron

This is the crux: Murmur is invoked via hotkey and users expect the panel to appear and respond immediately (`main.ts` registers global shortcuts; `windowManager.createMainWindow` builds a transparent always-on-top panel). The question is whether effects deps hurt the hot path.

#### Real footprint (verified, not guessed)

Sources: Bundlephobia API (`/api/size?package=...`) for min/gzip; npm registry `dist.unpackedSize` for installed footprint.

| Package                    | Min        | Gzip       | npm unpacked                                                   | Used by                                                     |
| -------------------------- | ---------- | ---------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| `three` 0.167.1            | **674 KB** | **169 KB** | —                                                              | minority of react-bits Backgrounds (e.g. those needing R3F) |
| `@react-three/fiber` 9.3.0 | 154 KB     | 48 KB      | — (pulls `react-reconciler` ~258KB, `zustand`, `scheduler`...) | R3F components only                                         |
| `@react-three/drei` 10.7.4 | —          | —          | **1.74 MB**                                                    | R3F helpers                                                 |
| `gsap` 3.13.0              | —          | —          | **6.1 MB** (178 files)                                         | a handful of animation components                           |
| `motion` 12.23.12          | —          | —          | **405 KB**                                                     | BlurText and most text effects                              |
| `ogl` 1.0.11               | **131 KB** | **34 KB**  | —                                                              | Aurora, Iridescence, and many shader backgrounds            |
| `lenis` 1.3.13             | 16 KB      | 4.8 KB     | —                                                              | smooth scroll (irrelevant to a dictation panel)             |
| `matter-js` 0.20.0         | 83 KB      | 26 KB      | —                                                              | physics components                                          |

Key nuance the prompt got slightly wrong: **`three` is NOT used by most react-bits backgrounds.** Reading actual source confirms `Aurora.tsx` and `Iridescence.tsx` both `import { Renderer, Program, Mesh, Color, Triangle } from 'ogl'` — a lightweight WebGL wrapper, not three.js. three.js + R3F appear in a smaller subset (e.g. physics/3D-scene components like `@react-three/rapier`-based ones). So "react-bits = three.js" is inaccurate; the cost is **per-component-class**.

#### Eager vs lazy impact (renderer process)

- **Eager**: importing any R3F/three component at the top of `App.tsx` would add 674KB+ (three) + 154KB (fiber) + reconciler to the initial chunk, inflate the main window's parse/eval time, and raise the renderer's baseline memory (three holds GPU buffers; R3F runs a custom reconciler). On a frameless transparent window that must paint instantly on hotkey, this is a direct regression.
- **Lazy**: `React.lazy(() => import('./effects/Aurora'))` makes Vite emit a separate chunk (Vite docs, "Build Optimizations → CSS Code Splitting" + dynamic-import behavior: "Matched files are by default lazy-loaded via dynamic import and will be split into separate chunks during build"). The heavy module is only fetched/parsed when the user enables effects. First paint of the dictation panel is unaffected.

#### Does lazy-loading fully isolate the cost in Electron?

Yes, with two caveats specific to Murmur's config:

1. **`sandbox: true` + `contextIsolation: true`** (`windowManager.ts:86-88`): these affect the **preload/main** boundary, not the renderer's module graph. Renderer-side `import()` works exactly as in a browser; the preload boundary is irrelevant to UI chunks.
2. **Production CSP** (`windowManager.ts:51-52`): `prodCsp = "default-src 'self'; script-src 'self'; ..."`. Vite's lazy chunks are same-origin files under `src/dist/assets/`, so `script-src 'self'` permits them. No CSP relaxation needed. (Note: this CSP already disallows inline scripts, so any react-bits component that injects `<script>` would break — but the ones I read use inline `<canvas>` + shaders, not inline scripts.)
3. **`base: "./"`** (`vite.config.js:97`): relative asset paths. Lazy chunks resolve correctly under `loadFile` in production. Already proven by the existing `SettingsPage` lazy import.

So Murmur's existing architecture is already compatible with lazy effects chunks. No sandbox/preload gotchas.

#### WebGL/GPU risks inside Electron (real, documented)

- Chromium maintains a **GPU blocklist** for buggy drivers. WebGL (three.js/ogl) silently falls back to SwiftShader (software) on blacklisted GPUs → choppy animation and high CPU. electron/electron#15339 and #17641 confirm `--ignore-gpu-blocklist` exists but is "mainly viable for yourself or a few technically savvy users rather than a general deployment solution."
- Murmur already calls `app.disableHardwareAcceleration()` in test mode (`main.ts:243-245`) — for CI. Enabling WebGL effects in production means accepting that some users (older Intel iGPUs, certain Linux setups, headless/VM cases) will get software-rendered effects that burn CPU.
- **WebGL context loss** on backgrounded/minimized windows is a known Electron issue; effects running in a hidden dictation panel can lose their GL context and need explicit restoration (the react-bits components I read do call `gl.getExtension('WEBGL_lose_context')?.loseContext()` on cleanup, which helps).

Implication: effects should be **opt-in and isolated to a non-critical surface** (e.g. a decorative background layer), never on the critical recording/transcription path, and must degrade gracefully (detect WebGL availability, fall back to CSS animation).

---

### C. react-bits integration realities

#### It is copy-paste / shadcn-registry, NOT an npm dependency

Confirmed from `README.md` and `package.json` of `DavidHDev/react-bits`:

- Install is via `npx shadcn@latest add @react-bits/BlurText-TS-TW` or `jsrepo` — components are **copied into your source tree**, not pulled from npm at runtime.
- The huge `dependencies` list in react-bits' own `package.json` (three, gsap, R3F, lenis, matter-js, face-api.js...) is the dependency set for **the react-bits website/demo**, not a hard requirement for every consumer. You only add the libs your chosen components actually import.
- Verified by reading component source: `BlurText.tsx` imports only `motion/react`; `Aurora.tsx` and `Iridescence.tsx` import only `ogl`. **Per-component deps, not a monolithic peer-dep blob.**

#### Upgrade story

Because it's source-copy (shadcn model), "upgrading" means re-running `shadcn add`/re-copying a component and re-applying your local edits. There is no `npm update react-bits`. This is the same tradeoff as shadcn/ui itself — acceptable for most teams, painful if you heavily customize. Mitigation: keep react-bits components in an isolated folder (e.g. `src/components/effects/`) and minimize edits to the originals (customize via props/wrappers).

#### License: MIT + Commons Clause in an Apache-2.0 project

From `LICENSE.md` (verbatim): "Permission is hereby granted... to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**" — explicitly allowed for embedding. The Commons Clause restriction: "you do not sell, sublicense, or redistribute the components themselves—whether alone, in a bundle, or as a ported version."

What this means for Murmur (Apache-2.0):

- **Embedding react-bits components inside the Murmur app binary**: clearly permitted ("as part of an application"). Murmur is an application, not a component library.
- **Re-publishing react-bits as a standalone library / port**: forbidden. Murmur does not do this.
- **The Apache-2.0 NOTICE requirement**: Murmur already maintains `NOTICE` and `THIRD-PARTY-LICENSES` (both listed in `package.json` `build.files`, lines 156-157). react-bits components copied in must be attributed there. The Commons Clause travels with the copied code, but since Murmur isn't selling/re-licensing the components as a product, there is no conflict. (General caution from secondary legal analysis — Finnegan / commonsclause.com: Apache-2.0 + Commons Clause "still allows distribution and modification... but removes the right to sell the software as a product." Murmur is free/open-source, so this is a non-issue. The only friction would arise if Murmur ever became a paid commercial product — then the components themselves could not be resold as a library, which Murmur has no plans to do.)

Caveat to flag honestly: I am not a lawyer; this is an engineering read of the license text. The maintainer should confirm, but the embedding use-case is the explicitly-intended one.

#### The 4 variants — which fits Murmur?

Confirmed from repo structure: `src/content/` (JS variants), `src/ts-default/` (TS-CSS), `src/ts-tailwind/` (TS-TW), plus `src/css/` for CSS files. The four variants are JS-CSS / JS-TW / TS-CSS / TS-TW.

**Murmur should use TS-TW** (`src/ts-tailwind/...`): React 19 + TypeScript (strict mode per ADR-008) + Tailwind v4 (`@tailwindcss/vite` 4.1.10, `postcss.config.ts`). Verified: the `ts-tailwind/Backgrounds/Aurora/Aurora.tsx` and `TextAnimations/BlurText/BlurText.tsx` files are real TypeScript + Tailwind className components — drop-in for Murmur's stack. No variant requires a framework other than React; all are React 19-compatible (react-bits itself depends on `react ^19.0.0`).

---

### D. Product/market angle: does a "full effects" dictation tool make sense?

#### Honest assessment

A "lite vs flashy" split is **unusual for utility/productivity tools** and rare for hotkey-invoked dictation assistants. Comparable tools (macOS built-in dictation, Windows voice typing, Superwhisper, Whispering, MacWhisper) compete on **accuracy, latency, and footprint** — none market on visual effects. The main window is on screen for the duration of an utterance (seconds); users are looking at the app they're dictating into, not at Murmur's panel.

#### Real user value of animated 3D backgrounds here

Low for the core dictation flow. The dictation panel is small (520×640), transparent, and often overlaid on the target text field. A full-screen animated 3D background behind a transparent panel would either (a) be invisible because the panel is small and over another app, or (b) actively obstruct the user's work. Effects make more sense in **non-critical surfaces**: the History window (`createHistoryWindow`, 1000×700), the Settings window, an onboarding/empty-state, or marketing screenshots.

#### Risk: gimmick / bloat perception

Real. For a tool whose pitch is "Chinese-optimized, fast, accurate speech-to-text," shipping a 3D-shader-laden edition risks signaling misplaced priorities. Users who care about effects in a utility are a small segment; users who care about startup time and RAM are the majority. Counterpoint (the legitimate case for effects): differentiation, "wow" factor for screenshots/demo videos, and a personality that plain-but-functional competitors lack. This argues for effects as an **opt-in accent**, not a separate product.

#### Verdict on the dual-version product strategy

The product case for two editions is weak. The case for **optional, tasteful effects in a single edition** is reasonable. Effects should enhance marketing surfaces and delight settings, not gate the core dictation experience behind a heavier binary.

---

## Recommendation

**Single build + runtime "Effects" toggle + lazy loading. Do not ship two editions.**

### Why single build dominates

1. Murmur already has the machinery: `React.lazy` (`App.tsx:20`), Vite `manualChunks` (`vite.config.js:30-40`), relative `base` for `loadFile`, and a CSP that permits same-origin lazy chunks.
2. react-bits costs are per-component and can be fully isolated via dynamic import — Lite users never pay for three.js/ogl/motion.
3. One appId, one CI matrix, one code-signing/notarization pipeline, one auto-update channel. Half the maintenance of two editions.
4. Users get the choice at runtime (a Setting) instead of having to pick and install a different binary.

### Concrete technical approach

**1. Isolate effects code.** Put every react-bits component under `src/components/effects/`. Add only the npm deps each component needs (e.g. `motion`, `ogl`) as regular `dependencies`. Do NOT add `three`/`gsap`/`@react-three/*` unless a specific chosen component requires them — and if one does, gate it behind its own lazy import.

**2. Gate rendering with a setting + lazy import.** Add a `effects_enabled` (or `ui_effects`) boolean to the settings store (Murmur already has `databaseManager.getSetting/setSetting` and a settings panel). Then:

```tsx
// src/components/effects/EffectsLayer.tsx
import { lazy, Suspense } from "react";
// Aurora is only parsed when this chunk loads
const Aurora = lazy(() => import("./Aurora")); // copied from react-bits ts-tailwind

export function EffectsLayer({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <Aurora />
    </Suspense>
  );
}
```

Vite emits `Aurora` (and its `ogl` dep) as a separate chunk; users with effects off never fetch it.

**3. Optional build-time escape hatch (not required, but available).** If you ever want a truly effects-stripped Lite binary, Vite's `define` (`vite.config.js:90-94` already uses it) can expose `__EFFECTS_ENABLED__` and a tree-shakeable `if (!__EFFECTS_ENABLED__)` guard. Combined with electron-builder `--config` + two config files you could produce two installers later **without forking code**. But this is a future option, not the day-1 plan.

**4. Electron main: keep effects off the hot path.** Effects live only in the renderer. No changes to `main.ts`'s window-creation flow needed. If you later add WebGL to the main panel, add a WebGL-availability check and a CSS fallback so blocklisted GPUs degrade gracefully. Do **not** add `app.commandLine.appendSwitch('ignore-gpu-blocklist')` globally — it masks driver bugs and can crash on unstable GPUs.

**5. electron-builder config: unchanged.** Keep the single `build` block in `package.json`. The `files` list already includes `src/dist/**/*` which will contain the lazy chunks; no `extraResources` needed.

**6. License/notice.** Append react-bits (MIT + Commons Clause) and any added deps (motion = MIT, ogl = MIT) to `THIRD-PARTY-LICENSES`. No `LICENSE` change to Murmur's Apache-2.0.

### When the two-edition path would become justified

Only if: (a) effects deps grow large enough that even lazy chunks bloat the installer meaningfully (not true today — `motion`+`ogl` are ~1MB unpacked combined), or (b) a "Pro" edition becomes a genuinely different paid product requiring a distinct appId and auto-update channel. Neither applies now.

---

## Risks & open questions

- **WebGL on low-end machines**: a subset of users (old iGPUs, some Linux, VMs) will get software-rendered effects via SwiftShader. Mitigation: detect `WebGLRenderingContext` availability and a low-end heuristic before mounting effect components; offer the toggle but default it **off** on first run.
- **Context loss on hidden windows**: the dictation panel is shown/hidden frequently. If effects mount in the main panel, ensure the GL context is torn down on hide (`windowManager` hide handlers) or the component handles `webglcontextlost`. Safest: keep effects in the History/Settings windows, which are long-lived when open.
- **Transparent window + WebGL**: `createMainWindow` sets `transparent: true`. WebGL canvases behind a transparent window can render inconsistently across platforms (especially Windows). Untested in Murmur — needs a spike before committing effects to the main panel.
- **react-bits upgrade drift**: re-copying a component overwrites local edits. Mitigation: wrapper components in `src/components/effects/` that pass props to the unedited react-bits source; keep local customization in the wrapper.
- **Commons Clause long-term**: if Murmur ever goes commercial/paid, reconfirm the react-bits embedding is still within the Clause (it should be — "as part of an application" — but paid distribution of an app containing the components is the gray area worth a legal check at that point).
- **Bundle size of three.js subset**: if a chosen component genuinely needs R3F, the `three` (674KB min) + `fiber` (154KB) + `react-reconciler` cost is non-trivial even when lazy (it still ships in the installer). Prefer `ogl`-based backgrounds (Aurora, Iridescence, etc.) which give strong visuals at 131KB min / 34KB gzip.
- **Open question for maintainer**: which specific effects are actually desired? The recommendation assumes a handful of backgrounds/text animations. If the intent is the full 110+ component catalog including physics (`rapier`) and face tracking (`face-api.js`), the cost analysis changes — but those are clearly out of scope for a dictation tool.

---

## Sources

Primary (consulted directly):

- Murmur repo (this codebase): `package.json`, `main.ts`, `src/App.tsx`, `src/helpers/windowManager.ts`, `src/vite.config.js`, `docs/research/README.md`, `docs/adr/009-*`.
- electron-builder CLI docs — https://www.electron.build/docs/cli (flags `-c/--config`, `-c.key=value`, `--projectDir`, `--publish`)
- electron-builder configuration (via search index of https://www.electron.build/docs/configuration/) — `appId`, `productName`, `files`, `extraResources`, `extends`, multi-file config
- Vite Features docs (Dynamic Import, Glob Import, Build Optimizations, CSP) — https://vite.dev/guide/features
- react-bits repo — https://github.com/DavidHDev/react-bits : `LICENSE.md` (MIT + Commons Clause, verbatim), `package.json`, `README.md`, `src/ts-tailwind/Backgrounds/Aurora/Aurora.tsx`, `src/ts-tailwind/Backgrounds/Iridescence/Iridescence.tsx`, `src/ts-tailwind/TextAnimations/BlurText/BlurText.tsx`, `src/content/` + `src/ts-tailwind/` structure (4 variants)
- Bundlephobia API — `three@0.167.1` (674KB/169KB gzip), `@react-three/fiber@9.3.0` (154KB/48KB gzip), `ogl@1.0.11` (131KB/34KB gzip), `lenis@1.3.13` (16KB/4.8KB), `matter-js@0.20.0` (83KB/26KB)
- npm registry `dist.unpackedSize` — `gsap@3.13.0` (6.1MB), `motion@12.23.12` (405KB), `@react-three/drei@10.7.4` (1.74MB)
- Electron GPU/WebGL — electron/electron#15339 (ignore-gpu-blacklist), electron/electron#17641 (degraded GPU performance), Electron offscreen-rendering docs
- Commons Clause — https://commonsclause.com/ ; Apache 2.0 — https://www.apache.org/licenses/LICENSE-2.0

Secondary (context only, not load-bearing):

- Finnegan IP law analysis (Apache + Commons Clause), Stack Exchange / Reddit discussions on Electron dual-edition builds and Commons Clause interaction. These informed framing but no claim rests solely on them.
