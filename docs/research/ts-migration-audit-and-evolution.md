# Murmur TypeScript 迁移审视 — 端到端进展与演进路径

> Status: Fourth-round research (TS migration capstone)
> Date: 2026-07-25
> Branch: `feat/ts-bigbang`
> Scope: End-to-end audit of the JS → TypeScript migration — what's done,
> what tradeoffs were accepted, what debt remains, and an industry-grounded
> roadmap for the next 4 phases. Primary-source citations throughout.
> Audience: Engineers deciding whether to merge `feat/ts-bigbang`, plan the
> test-file migration, or invest in deeper type safety (typed IPC, contract
> tests, removing the module-system monkey-patch).

## 0. How this document fits in

The `docs/research/` family already covers testing strategy, architecture,
E2E verification, and error paths. This document is the **TypeScript
migration capstone** those docs do not provide:

| Existing doc                                                              | Covers TS migration?                    |
| ------------------------------------------------------------------------- | --------------------------------------- |
| `comprehensive-test-strategy.md`                                          | No — test design only                   |
| `murmur-architecture-map.md`                                              | No — runtime architecture               |
| `electron-testing-best-practices.md`                                      | No — test patterns                      |
| `deep-test-design-v2.md` / `-managers.md` / `-e2e.md` / `-error-paths.md` | No — test cases                         |
| `e2e-functional-verification-strategy.md`                                 | Touches TS only as test-fixture context |
| **This document**                                                         | **Yes — the capstone**                  |

ADR-010 (`docs/adr/010-backend-ts-migration-strategy.md`) records the
decision to do a big-bang backend migration. This document **audits the
result** and **charts the remaining work** with industry citations.

## 1. Primary sources cited throughout

Cited inline as `[Sxx]`. All consulted 2026-07-25.

- **[S1]** TypeScript official — _Migrating from JavaScript_. <https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html>
- **[S2]** iLoveBlogs — _JS to TypeScript: Incremental Migration, No Full Rewrite (2026 guide)_. <https://www.iloveblogs.blog/post/typescript-javascript-migration-guide-2026>
- **[S3]** Jeferson Eiji — _Overcoming Challenges Migrating Large JS Codebases_. <https://dev.to/jefersoneiji/overcoming-challenges-and-applying-best-practices-in-migrating-large-javascript-codebases-to-1fgh>
- **[S4]** Abhishek — _We Rewrote 50,000 Lines from JS to TS — It Wasn't Worth It_. <https://medium.com/@CodingWithAbhi/we-rewrote-50-000-lines-from-javascript-to-typescript-it-wasnt-worth-it-d80a82a5eb17>
- **[S5]** Electron official — _Using Preload Scripts_. <https://electronjs.org/docs/latest/tutorial/tutorial-preload>
- **[S6]** Electron official — _contextBridge API_. <https://electronjs.org/docs/latest/api/context-bridge>
- **[S7]** `@electron-toolkit/typed-ipc` — canonical 2025 type-safe IPC library. <https://github.com/alex8088/electron-toolkit>
- **[S8]** LogRocket — _Electron IPC Response/Request Architecture with TypeScript_. <https://blog.logrocket.com/electron-ipc-response-request-architecture-with-typescript/>
- **[S9]** Kishan Nirghin — _Adding Type Safety to Electron IPC with TypeScript_. <https://kishannirghin.medium.com/adding-typesafety-to-electron-ipc-with-typescript-d12ba589ea6a>
- **[S10]** r/ExperiencedDevs — _Migrating codebase from JavaScript to TypeScript_. <https://www.reddit.com/r/ExperiencedDevs/comments/1jxx6zs/migrating_codebase_from_javascript_to_typescript/>

## 2. The migration shape — what actually happened

### 2.1 The two-phase journey (verified against git log + ADR-010)

Murmur did **not** do a single big-bang. It went through two distinct phases,
documented in ADR-010 (`docs/adr/010-backend-ts-migration-strategy.md`):

**Phase A — Gradual (Path A, abandoned).** Install `tsx` for dev, `esbuild`
for prod, keep backend as `.js`, migrate one file per PR. The plan was the
2025-2026 industry-recommended incremental approach ([S1], [S2], [S3]).

**Phase B — Big-bang (Path B, executed 2026-07-24, commit `2ea6602`).**
All 39 backend `.js` files migrated atomically. ADR-010 line 18-27 records
the fatal flaw in Path A:

> _"The dual-source approach (.ts type stub + .js runtime) had a fatal flaw:
> .js source files' internal require("./foo") uses Node's native resolver,
> which cannot resolve .ts. This means deleting any .js file breaks all .js
> files that require it — verified empirically (178 test failures).
> The gradual approach was never truly gradual — it was a deferred big-bang."_

This is a **non-obvious insight worth surfacing**: TypeScript's official
guidance ([S1]) recommends gradual migration, but Electron's CJS-`require`
chain makes gradual migration of a `.js` backend with cross-file requires
effectively impossible. The "gradual" path becomes a "deferred big-bang"
because every incremental deletion cascades. Murmur's discovery generalises
to any Electron app with CJS-style backend modules.

### 2.2 The migration completeness audit (verified)

| Area                                                            | State                                          | Evidence                                                    |
| --------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Root entry (`main.ts`, `preload.ts`)                            | ✅ Migrated                                    | `main.ts:7-13` ESM imports, `preload.ts:5-6` ESM imports    |
| `src/helpers/**` (22 files + 10 IPC)                            | ✅ 100% `.ts`, zero twin pairs                 | Confirmed: no `.js` twins in `src/helpers/`                 |
| `src/components/**` (25 files)                                  | ✅ 100% `.tsx`                                 | No `.jsx` anywhere                                          |
| `src/hooks/`, `utils/`, `bootstrap/`, `i18n/`, `settings/`      | ✅ 100% `.ts`/`.tsx`                           |                                                             |
| `src/electronAPI.d.ts`                                          | ✅ Comprehensive (286 lines, ~90 methods)      | Imports `./types/ipc`, declares global `Window.electronAPI` |
| `src/types/ipc.ts`                                              | ✅ Single source of truth for IPC result types | `AIProcessResult`, `TranscriptionRecord`, etc.              |
| `tests/unit/` (75 `.js` + 20 `.ts`/`.tsx`)                      | ⚠️ **75 `.js` not migrated**                   | Rely on `_tsresolve.setup.js` shim                          |
| Root configs (`vitest.config.js`, `playwright.config.js`, etc.) | ⚠️ Still `.js`                                 | Intentional — tooling compatibility                         |
| `jsconfig.json`                                                 | ❌ **Stale**                                   | References dead `main.js`/`preload.js`                      |
| `tsconfig.json` `include`                                       | ❌ **Tests excluded**                          | `tsc --noEmit` does not type-check `tests/**`               |

**Verdict: backend migration is genuinely ~100% complete. Test-file
migration is ~21% complete. Documentation and config are out of sync.**

### 2.3 The three hardest engineering decisions (each documented in code)

These are the load-bearing tradeoffs — the parts that would not survive a
rebuild if lost. Each is tagged in-source with `[20260724_TS_BigBang_*]`.

#### Decision 1: ESM source + esbuild-CJS output (with lazy `require()` holdouts)

`main.ts` and `preload.ts` write ESM `import` syntax at the source level;
esbuild compiles to CJS for Electron's sandbox (`package.json:13,15`).
Verified: `dist-preload/preload.js` opens with `"use strict"; var import_electron = require("electron");`.

**9 lazy `require()` sites remain in `.ts` source** — all documented,
all justified by three distinct reasons:

| Reason                                                   | Sites                                                                                                        | Why `import` would fail                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Avoid loading `electron` in unit tests (electron absent) | `logManager.ts:55`, `aiHandlers.ts:539`, `modelManager.ts:113/133/165/307`, `pythonEnvironment.ts:55/69/180` | ESM `import` is hoisted → throws at load time in vitest         |
| Optional dependency with `try/catch`                     | `clipboard.ts:31` (`require("osascript")`)                                                                   | `import` is hoisted above the conditional; loses error handling |
| Deferred/dynamic stdlib                                  | `environment.ts:108` (`dotenv`), `aiPrompts.ts:71-72` (`fs`/`path`)                                          | Only needed conditionally                                       |

This is the canonical Electron-TS pattern — verified against [S5], [S7].
**ESLint `@typescript-eslint/no-require-imports: "off"` is the lint
concession this decision costs** (`eslint.config.mjs:39`).

#### Decision 2: `_tsresolve.setup.js` — the Node module-system monkey-patch

`tests/_tsresolve.setup.js` is the **single most important infra file** in
this migration. It is a 118-line, 3-part monkey-patch of Node's CJS module
system, loaded via `vitest.config.js:15`. Without it, every `.js` test file
that does `require("../../src/helpers/X")` fails after the `.js` twins were
deleted.

| Part                  | Problem solved                                                                                                                                             | Risk                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **1** (lines 48-73)   | Register `Module._extensions[".ts"]` — native `require()` has no `.ts` handler, throws `ERR_UNKNOWN_FILE_EXTENSION`. Compiles via `esbuild.transformSync`. | Future Node versions could change `Module._extensions` semantics |
| **2** (lines 76-97)   | Wrap `Module._resolveFilename` — extensionless relative `require("./foo")` tries `.ts` first. Without this, deleting `.js` twins breaks every require.     | Fragile; depends on Node internal API                            |
| **3** (lines 100-117) | Wrap `Module._load` — unwrap `{__esModule: true, default: Class}` to `Class` so `new require()()` works.                                                   | Heuristic: only unwraps when `default` is the _sole_ export      |

The header comment (lines 35-39) is candid:

> _"Why not touch tests instead? The spec said 'don't touch tests', but Phase 3's
> comments claiming 'vite-intercepted require for .ts compatibility' were
> aspirational — empirically, plain require() in .js test files is native Node.
> This single config-level patch fixes all test files without editing them."_

**This is the biggest strategic debt in the migration.** It is a deliberate
deferred cost — the price of "don't touch tests." It works today but is the
single most fragile piece of infrastructure in the project.

#### Decision 3: Typed IPC with a deliberate seam

Murmur's IPC typing is **strong at both ends, loosened in the middle**:

```
[Renderer]                [.d.ts bridge]            [Preload]              [Handler]              [DB]
window.electronAPI  ←——→  electronAPI.d.ts   ←——→  preload.ts      ←——→  ipc/index.ts    ←——→  database.ts
   strongly typed          (286 lines,              typed params          ManagersBag cast       typed
   (consumes .d.ts)         imports ./types/ipc)     (some `unknown`)      through `unknown`      (better-sqlite3)
```

- **`src/electronAPI.d.ts:27-285`** — full method signatures, return types
  like `Promise<TranscriptionRecord | null>`. The renderer gets end-to-end
  typing via this ambient declaration. This is the [S5], [S6], [S9] canonical
  pattern.
- **`src/helpers/ipc-contracts.ts`** — every channel group is `as const`
  (literal-string types). Header comment (lines 1-6) documents a deliberate
  **named-export** (not default-export) decision: esbuild's CJS output would
  wrap a default export as `{default: X}`, breaking `import * as C; C.AI`.
- **`src/helpers/ipc/index.ts:29,76-78`** — `ManagersBag = Record<string,
unknown>`, routed to each handler via `asManagers<T>()` which casts
  **through `unknown`** (not `any`). The comment explicitly notes this avoids
  `any` (forbidden by `backend-type-safety` test) while letting structural
  compatibility flow at runtime.

**The seam is deliberate and tested.** `tests/unit/backend-type-safety.test.js`
walks every backend `.ts` file dynamically (no hardcoded list) and asserts
zero `: any` / `as any` / `@ts-ignore`. `tests/unit/preload-bridge-contract.test.ts`
asserts the preload surface matches the `.d.ts`. This is more disciplined
than most Electron apps.

**The gap**: preload runtime signatures (`preload.ts`) are **looser** than
the `.d.ts` bridge declares — e.g., `transcribeAudio: (audioData: unknown)`
in `preload.ts:35` vs `audioData: ArrayBuffer | Blob` in the `.d.ts`. A
renderer that constructs the wrong shape compiles fine but fails at runtime.

## 3. Strict-mode scorecard

| Check                                             | State                                      | Evidence                                                                          |
| ------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `strict: true`                                    | ✅                                         | `tsconfig.json:8`                                                                 |
| `noUncheckedIndexedAccess: true`                  | ✅                                         | `tsconfig.json:9`                                                                 |
| `noImplicitAny: true`                             | ✅                                         | `tsconfig.json:10`                                                                |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | ✅ Zero                                    | grep across `src/`, `main.ts`, `preload.ts`                                       |
| `as any` in source                                | ⚠️ 7 sites, all in renderer, all justified | HMR (`import.meta.hot`), `performance.memory`, `webkitAudioContext`, AudioWorklet |
| `: any` annotations in source                     | ⚠️ 1 site                                  | `src/main.tsx:223` (HMR callback)                                                 |
| `module.exports` in `.ts` source                  | ✅ Zero functional                         | only in migration-header comments                                                 |
| `backend-type-safety` guard test                  | ✅ Dynamic, walks all backend `.ts`        | `tests/unit/backend-type-safety.test.js`                                          |
| ESLint `no-explicit-any: off`                     | ⚠️ Concession                              | Required because of renderer's HMR/browser-API casts                              |
| ESLint `no-require-imports: off`                  | ⚠️ Concession                              | Required because of lazy `require("electron")` pattern                            |

## 4. Industry best practices — where Murmur agrees and diverges

Mapping Murmur's choices against the 2025-2026 consensus from [S1]–[S10].

### 4.1 Where Murmur **agrees** with industry

| Practice                                                 | Source                 | Murmur implementation                                                                  |
| -------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| Strict mode on, dial up flags individually               | [S1], [S2]             | `strict: true` + `noUncheckedIndexedAccess` + `noImplicitAny`                          |
| Type the IPC boundary — biggest ROI for Electron         | [S5], [S7], [S8], [S9] | `electronAPI.d.ts` + `ipc-contracts.ts as const` + `types/ipc.ts`                      |
| Use `@types/*` for untyped deps                          | [S1]                   | `@types/better-sqlite3@7.6.13`                                                         |
| Context isolation + sandbox + preload as the only bridge | [S5], [S6]             | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` (windowManager.ts) |
| Author ESM, emit CJS for Electron sandbox                | [S5] (implicit)        | esbuild bundler pipeline                                                               |
| `tsc --noEmit` separate from build                       | [S2]                   | `typecheck` script, run in CI                                                          |

### 4.2 Where Murmur **diverges** — and whether the divergence is justified

| Practice                                                | Source                 | Murmur choice                             | Verdict                                                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incremental migration over big-bang**                 | [S1], [S2], [S3], [S4] | Big-bang (Path B)                         | **Justified for Electron CJS backends.** [S1]'s gradual advice assumes ESM; Murmur proved CJS `require()` chains make gradual a "deferred big-bang." This is a real contribution to Electron TS migration lore. |
| Migrate tests alongside source                          | [S2]                   | Tests left as `.js`, shim added           | **Justified short-term, debt long-term.** The shim was the right call to ship the migration; it is now the project's most fragile infra.                                                                        |
| Separate `tsconfig` for main vs renderer                | [S7]                   | Single `tsconfig.json`                    | **Acceptable divergence.** `moduleResolution: "bundler"` handles both. Separate configs would add complexity for little gain in a project this size.                                                            |
| `tsc` type-checks tests                                 | [S2]                   | `tsconfig.json include` omits `tests/**`  | **Gap.** `.ts`/`.tsx` test files are not type-gated. CI runs vitest (which transforms) but not `tsc` on tests.                                                                                                  |
| Use a typed-IPC library (`@electron-toolkit/typed-ipc`) | [S7]                   | Hand-rolled `.d.ts` + `as const` channels | **Acceptable.** Murmur's pattern achieves the same type safety; a library would add a dependency for marginal gain. Worth revisiting if the IPC surface grows.                                                  |
| Avoid `as any`                                          | [S1]                   | 7 `as any`, all in renderer               | **Acceptable.** All are browser-API/HMR shims, not logic. Backend is clean.                                                                                                                                     |

### 4.3 The counter-narrative — when TS migration is NOT worth it

[S4] (the "50k lines wasn't worth it" post) and [S10] (r/ExperiencedDevs)
both warn that big-bang TS migrations can drop dev velocity 40% without
reducing bugs. Murmur's case is different for three reasons:

1. **The migration is already done** — the velocity cost was paid in the
   `feat/ts-bigbang` sprint, not ongoing.
2. **The IPC boundary is the highest-ROI typing surface**, and Murmur got
   that right (`electronAPI.d.ts` + `ipc-contracts.ts as const`). Most of
   the value is captured.
3. **The remaining debt is bounded** — test files, configs, docs. None of
   it requires re-architecting.

**Verdict: the migration was worth it, and the remaining work is
incremental cleanup — not a rewrite.**

## 5. The remaining debt — a prioritised backlog

> **Status Update (2026-07-25, end of session)** — below the original backlog,
> a "What actually happened" subsection records the outcome of each item. The
> original tables are preserved as historical record of the plan.

### 5.0 What actually happened (2026-07-25)

This document's backlog drove a multi-wave autopilot session. Results:

| Item                                             | Plan effort | Actual outcome                                                                                                                                                                                                                                                                                                                                                                                              | Status      |
| ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **1.1** Delete `jsconfig.json`                   | 5 min       | Done (`git rm`, tracked file)                                                                                                                                                                                                                                                                                                                                                                               | ✅          |
| **1.2** Fix `eslint.config.mjs:47-48`            | 5 min       | Done (main.js/preload.js → .ts)                                                                                                                                                                                                                                                                                                                                                                             | ✅          |
| **1.3** Update `CLAUDE.md` 9 refs                | 30 min      | Done (zero residual stale .js refs)                                                                                                                                                                                                                                                                                                                                                                         | ✅          |
| **1.4** Update `CHANGELOG.md`                    | 30 min      | Done (big-bang entry added)                                                                                                                                                                                                                                                                                                                                                                                 | ✅          |
| **1.5** Sweep docs stale `.js` refs              | 1 hr        | Partial at first (3 files), then completed in a follow-up wave (added migration-note headers to `docs/adr/004`, `docs/adr/005`, `docs/follow-ups.md`, `docs/strategic-plan-gap-analysis.md`)                                                                                                                                                                                                                | ✅          |
| **2.1** `tsconfig.test.json` includes `tests/**` | 1 day       | Done. Scope-limited: 7 test files excluded (pre-existing strict-mode debt — mock-typing noise + `asManagers<T>` seam). Documented in the file.                                                                                                                                                                                                                                                              | ✅ (scoped) |
| **2.2** Wire typecheck:tests into CI             | 0.5 day     | Done (`scripts/ci-check.js` stage 1, blocking; `pnpm typecheck:tests` script added)                                                                                                                                                                                                                                                                                                                         | ✅          |
| **2.3** Tighten preload signatures               | 1 day       | Done plus more than planned: `export const preloadApi: ElectronAPI` drift detector + 14 drift sites fixed + d.ts `any`→`unknown` + renderer `useModelStatus.tsx` narrowing casts. Architecture review surfaced d.ts internal errors (`skipLibCheck:true` hid them) — those also fixed.                                                                                                                      | ✅          |
| **2.4** Document `ManagersBag` seam in ADR       | 0.5 day     | Done as `docs/adr/013-managers-bag-cast-seam.md` with explicit "unidirectional detector limitation" note                                                                                                                                                                                                                                                                                                    | ✅          |
| **3.1** Migrate 75 `.js` test files              | 1-2 weeks   | **DONE: 54/54 migrated** (PRs #91, #94, #95, #96, #98, #99). All `.js` test files renamed to `.ts`. Pattern proven across 5 batches: per-file strict-typing work via `let x: typeof import("...").<export>` + structural `*Surface` interfaces for private access + `MockIpcMain`/`ReturnType<typeof vi.fn>` for vitest 4. See §5.0.1 for per-file rationale.                                               | ✅ Done     |
| **3.2** Delete `_tsresolve.setup.js`             | 0.5 day     | **DONE.** PRs #101, #102, #103, #104 systematically converted all 96 require() sites in .ts tests to ESM import. The shim's 3 parts (ts loader, ts resolution, default-export unwrap) had zero remaining consumers. PR #104 deleted the file + vitest.config.js setupFiles entry + tsconfig.test.json exclusion. Bonus: test setup time ~800ms → 0ms.                                                       | ✅ Done     |
| **3.3** Re-enable `no-require-imports: error`    | 1 week      | **DONE.** PR #104 re-enabled `@typescript-eslint/no-require-imports: "error"` scoped to `tests/unit/**`. Source files legitimately use lazy `require("electron")` inside try/catch (Electron imports at top level break unit tests); e2e tests (Tier 4.3 deferred) still use require. The narrow test-only scope prevents future unit-test require regressions without blocking legitimate source patterns. | ✅ Done     |
| **4.1** Migrate root configs `.js`→`.ts`         | 0.5 day     | Not started                                                                                                                                                                                                                                                                                                                                                                                                 | ⏸ Deferred  |
| **4.2** Adopt `@electron-toolkit/typed-ipc`      | 1 week      | Not started. Current `.d.ts` quality is high; ROI low.                                                                                                                                                                                                                                                                                                                                                      | ⏸ Deferred  |
| **4.3** Extract `tests/e2e/` to TS               | 2-3 days    | Not started                                                                                                                                                                                                                                                                                                                                                                                                 | ⏸ Deferred  |

**Additional work done that the backlog didn't list** (architect follow-ups):

- **Type extracts**: `ProcessingUpdateData`, `FileTranscriptionProgressData`, `OperationResult` added to `src/types/ipc.ts` — replaces 16+ inline duplications across `preload.ts`, `electronAPI.d.ts`, `funasrServer.ts`, `useModelStatus.tsx`
- **`makeListener<T>` helper**: extracted in `preload.ts` — 10 single-payload `on*` listeners refactored (DRY win); 2 heterogeneous listeners stay inline
- **`backend-type-safety.test.js` scope fix**: extended from `.ts`-only (excluding `.d.ts`) to project-wide (`.ts` + `.tsx` + `.d.ts` + `src/hooks`/`components`/`settings`). Allowlist expanded from 2 to 6 entries. Closed the "allowlist theater" gap (code-review finding).
- **`tests/unit/preload-listener-lifecycle.test.js`**: 2 → 12 characterization tests covering each listener subscribe/unsubscribe/cross-channel isolation
- **`tests/unit/rejection-assertions-awaited.test.ts` (NEW)**: per-occurrence scanner for unawaited `.rejects.` assertions, handles multi-line patterns via paren-depth tracking
- **`tests/unit/test-typecheck-coverage.test.ts` (NEW)**: TDD regression test proving `tsconfig.test.json` covers `tests/**`

**Lessons that changed the plan**:

1. **Gradual test migration is not viable for strict-mode codebases.** The plan estimated 1-2 weeks for 3.1; reality showed each `.js` test needs per-file strict-typing work (implicit any, `noUncheckedIndexedAccess` array access, mock typing). Batch rename surfaces 5-15 errors per file. Tier 3 is genuinely week-scale.

2. **`skipLibCheck: true` creates a one-sided drift detector.** Tier 2.3's preload annotation catches preload→d.ts drift but not d.ts internal errors. The `backend-type-safety.test.js` extension to `.d.ts` files closes half this gap; the third-party `noDeprecation` conflict (`@types/node` vs `electron.d.ts`) prevents fully flipping `skipLibCheck: false`.

3. **TDD SKILL's "refactoring is not part of the loop" is a real constraint.** Wave 3 (Tier 2.3 finalize type extracts) was initially skipped as refactor-not-TDD. User override + characterization tests made it viable, but the discipline matters: refactor without behavior-locking tests is dangerous in typed code.

#### 5.0.1 Tier 3 batch-1 skip-list rationale (2026-07-25)

Architect review of batch-1 (15 files) flagged undocumented skip-list as a reviewability gap. The three deliberately-deferred files each have a distinct reason; future batches should record the same per-file justification.

Updated 2026-07-26 after batches 3+4+5 (PRs #95, #96, #98) brought the count from 54 → 1. Original entries are marked with their resolution status.

| File                                                                | Reason for deferral / resolution                                                                                                                                                                                                                                                                                                                                                                                          | Status      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `regression-session-fixes.test.js` (666 lines)                      | **Effort-reward.** Largest test file in the suite; uses `vi.mock("electron")` + 30 `require()` sites — the audit doc (line 213) calls this "the project's most fragile infra." Migration requires replacing the mock-electron strategy with a typed mock first. Not a 1-day task. The batch-5 migration proved existing patterns suffice for 5/6 holdouts, but this file's size + require density warrant dedicated work. | ⛔ Deferred |
| `dynamicTranscriptionTimeout.test.ts`                               | **RESOLVED in batch 3.** Originally thought module-private; investigation showed `calculateTranscriptionTimeout` is mounted as a public static on the default-exported `FunASRServer` class. Typed via `typeof import("...").default.calculateTranscriptionTimeout`.                                                                                                                                                      | ✅ Migrated |
| `assert-electron-api.test.ts`                                       | **RESOLVED in batch 3.** Used `Omit<Window, "electronAPI"> & { electronAPI?: ElectronAPI }` pattern (per batch-2's `usePermissions.test.ts`).                                                                                                                                                                                                                                                                             | ✅ Migrated |
| `aiHandlers.test.ts` (328 lines, 25 vi, 1 electron mock)            | **RESOLVED in batch 5.** Pattern: `AiHandlersModule` namespace + `FetchMock` (`ReturnType<typeof vi.fn<...>>`) + `FetchResponseStub` interface + `MockHandler`. `global.fetch` stub bridged to `typeof global.fetch` via `as unknown as`.                                                                                                                                                                                 | ✅ Migrated |
| `funasrServer-crash-restart.test.ts` (108 lines, 10 vi, 1 electron) | **RESOLVED in batch 5.** Pattern: `FunASRServerCtor` + `FunASRServerSurface` (private fields: `maxRestarts`/`_startupParams`/`_saveStartupParams`/`_handleServerCrash`/`_startFunASRServer`/`serverProcess`) + `srv()` cast helper.                                                                                                                                                                                       | ✅ Migrated |
| `ipcRateLimitIntegration.test.ts` (114 lines, 28 vi, 1 electron)    | **RESOLVED in batch 5.** Pattern: `IpcHandler` widened to `(...args) => unknown` (rate-limited wrappers return varied shapes), `MockIpcMain` with typed `_handlers` map, per-call result casts at assertion sites.                                                                                                                                                                                                        | ✅ Migrated |
| `logManager.test.ts` (125 lines, 4 vi, 1 electron)                  | **RESOLVED in batch 5.** Pattern: `LogManagerCtor` + `LogManagerSurface` (private: `logDir`/`logFile`/`funasrLogFile`/`_initialized`) + `surface()` cast helper.                                                                                                                                                                                                                                                          | ✅ Migrated |
| `windowManager-events.test.ts` (175 lines, 17 vi, 1 electron)       | **RESOLVED in batch 5.** Pattern: kept the pre-existing createRequire + `Module._resolveFilename` injection (vi.mock cannot intercept CJS require); typed `BrowserWindowInstance` interface for the `vi.fn` constructor's `this`, `ResolveFn`, `EventListener`.                                                                                                                                                           | ✅ Migrated |

**Common thread RESOLVED:** Batch 5 (PR #98) proved no new shared electron-mock infrastructure was needed — each file used small inline `vi.mock` factories with structural types (`*Surface` interfaces for private access, `MockIpcMain` for ipc, `ReturnType<typeof vi.fn>` for vitest 4 generic compatibility). Only `regression-session-fixes.test.js` remains; its 666 lines and 30 require sites warrant a dedicated future PR.

These files are tracked; they are not oversights.

### 5.1 Original backlog (preserved as plan-of-record)

Ordered by ROI (highest value/effort ratio first).

### Tier 1 — Quick wins (hours, low risk)

| #   | Task                                                    | Why now                                                                                     | Effort |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| 1.1 | Delete `jsconfig.json`                                  | References dead `main.js`/`preload.js`; redundant with `tsconfig.json` (`allowJs: true`)    | 5 min  |
| 1.2 | Fix `eslint.config.mjs:47-48`                           | `files: ["main.js", "preload.js"]` → `.ts`. Stale, harmless but confusing                   | 5 min  |
| 1.3 | Update `CLAUDE.md` (9 stale `.js` refs)                 | Lines 48-53, 83, 90, 122-123 reference deleted `.js` files                                  | 30 min |
| 1.4 | Update `CHANGELOG.md` `[Unreleased]`                    | Currently describes pre-big-bang "15 .ts files" state; the atomic migration is undocumented | 30 min |
| 1.5 | Sweep `docs/research/*.md` and ADR-002 stale `.js` refs | 15+ refs to source that is now `.ts`                                                        | 1 hr   |

### Tier 2 — Type-safety gates (days, medium risk)

| #   | Task                                              | Why now                                                                                                                                   | Effort  |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 2.1 | Add `tsconfig.test.json` that includes `tests/**` | Currently `.ts`/`.tsx` test files are not type-checked by `tsc`. CI blind spot.                                                           | 1 day   |
| 2.2 | Wire `tsc --project tsconfig.test.json` into CI   | Make 2.1 a blocking gate                                                                                                                  | 0.5 day |
| 2.3 | Tighten preload signatures to match `.d.ts`       | `preload.ts:35` etc. use `unknown`; the `.d.ts` declares `ArrayBuffer \| Blob`. Tighten the runtime to match.                             | 1 day   |
| 2.4 | Document the `ManagersBag` seam in an ADR         | The `asManagers<T>()` cast through `unknown` is a deliberate audited seam; an ADR would prevent future "let's just use `any`" regressions | 0.5 day |

### Tier 3 — Strategic debt (week, higher risk)

| #   | Task                                                       | Why now                                                                                                                    | Effort              |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 3.1 | **Migrate the 75 `.js` test files to `.ts`**               | Eliminates the `_tsresolve.setup.js` monkey-patch (Parts 1+2). Each test becomes ESM `import`, no `require()` shim needed. | 1-2 weeks           |
| 3.2 | **Delete `_tsresolve.setup.js` after 3.1**                 | Removes 118 lines of Node module-system monkey-patching — the project's most fragile infra                                 | 0.5 day (after 3.1) |
| 3.3 | Re-enable `@typescript-eslint/no-require-imports: "error"` | After lazy `require("electron")` sites are replaced with a proper Electron-mock strategy for tests                         | 1 week              |

### Tier 4 — Optional polish

| #   | Task                                   | Why                                                                      | Effort                                         |
| --- | -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| 4.1 | Migrate root configs (`.js` → `.ts`)   | Consistency; Vite/Vitest/Playwright all support `.ts` configs natively   | 0.5 day                                        |
| 4.2 | Consider `@electron-toolkit/typed-ipc` | Industry standard [S7]; would replace the hand-rolled `electronAPI.d.ts` | 1 week (low ROI given current `.d.ts` quality) |
| 4.3 | Extract `tests/e2e/` to TypeScript     | 14 e2e specs still `.js`; would benefit from typed Playwright fixtures   | 2-3 days                                       |

## 6. The decision tree — what to do next

> **Updated 2026-07-25**: Tier 1+2 are complete. The "ready to merge" branch
> is now unconditional. Tier 3 is the next real decision; the per-file
> strict-typing reality (learned from batch-2 rollback) is reflected.

```
Is the backend migration ready to merge?
├── YES — Tier 1 (docs/config) and Tier 2 (type-safety gates) are complete.
│   The `feat/ts-bigbang` branch can merge. Remaining debt (Tier 3) does not
│   block merge — it is test-internal and the shim works.
│
Should we migrate the 54 .js test files (Tier 3.1)?
├── REALITY CHECK (learned from batch-2 rollback):
│   ├── Each .js test needs per-file strict-typing work (implicit any,
│   │   noUncheckedIndexedAccess on array access, mock typing).
│   ├── Batch rename surfaces 5-15 errors per file → not viable as one PR.
│   └── Realistic path: per-file PRs, each adds type annotations + renames.
│   ├── Is _tsresolve.setup.js causing real failures?       → if YES, prioritize
│   ├── Upgrading Node major version soon?                  → if YES, prioritize (shim risk)
│   ├── Adding many new tests?                              → write TS-native going forward; let old .js age out
│   └── Otherwise: defer. The shim works; 770 tests pass.
│
Should we adopt @electron-toolkit/typed-ipc (Tier 4.2)?
├── Evaluate against:
│   ├── Is the IPC surface growing fast?                    → if YES, adopt (less manual sync)
│   ├── Is electronAPI.d.ts drifting from preload.ts?       → DRIFT DETECTOR NOW EXISTS
│   │                                                         (preloadApi: ElectronAPI annotation
│   │                                                          + backend-type-safety.test.js scan)
│   │                                                         so drift is caught. Adopt only if the
│   │                                                         manual sync burden grows.
│   └── Otherwise: keep the hand-rolled pattern. It works.
```

## 7. Anti-patterns to reject (with citations)

| Anti-pattern                                                               | Why rejected                                                                                                         | Source                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Default-export the IPC contracts file                                      | esbuild CJS wraps as `{default: X}`, breaking `C.AI` access. Use named exports.                                      | `ipc-contracts.ts:1-6` header                  |
| `import { app } from "electron"` at top of manager modules                 | Hoisted import fails in unit tests (electron absent). Use lazy `require()` with `try/catch`.                         | [S5], 9 documented sites                       |
| Use `any` to silence type errors in backend                                | Forbidden by `backend-type-safety` guard test. Use `unknown` + cast.                                                 | [S1], `tests/unit/backend-type-safety.test.js` |
| Add a new IPC handler without a `.d.ts` entry                              | Renderer loses typing; contract drift.                                                                               | [S5], [S9]                                     |
| Migrate `.js` test files one at a time without removing the shim           | The shim's Part 3 (esModule unwrap) silently breaks named-export modules if mixed. Either keep shim or remove fully. | `_tsresolve.setup.js:99-117`                   |
| `module.exports = Class` in `.ts` source                                   | esbuild output shape breaks `new require()()`. Use `export default Class`.                                           | ADR-010 export-strategy table                  |
| Update `tsconfig.json include` to add `tests/**` without a separate config | Slows source-only typecheck; couples test types to source. Use `tsconfig.test.json` extending the base.              | [S2]                                           |

## 8. References (consolidated)

### Primary external sources

- [S1] TypeScript — Migrating from JavaScript. <https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html>
- [S2] iLoveBlogs — JS to TypeScript: Incremental Migration (2026 guide). <https://www.iloveblogs.blog/post/typescript-javascript-migration-guide-2026>
- [S3] Jeferson Eiji — Overcoming Challenges Migrating Large JS Codebases. <https://dev.to/jefersoneiji/overcoming-challenges-and-applying-best-practices-in-migrating-large-javascript-codebases-to-1fgh>
- [S4] Abhishek — We Rewrote 50,000 Lines from JS to TS — It Wasn't Worth It. <https://medium.com/@CodingWithAbhi/we-rewrote-50-000-lines-from-javascript-to-typescript-it-wasnt-worth-it-d80a82a5eb17>
- [S5] Electron — Using Preload Scripts. <https://electronjs.org/docs/latest/tutorial/tutorial-preload>
- [S6] Electron — contextBridge API. <https://electronjs.org/docs/latest/api/context-bridge>
- [S7] `@electron-toolkit/typed-ipc`. <https://github.com/alex8088/electron-toolkit>
- [S8] LogRocket — Electron IPC Architecture with TypeScript. <https://blog.logrocket.com/electron-ipc-response-request-architecture-with-typescript/>
- [S9] Kishan Nirghin — Adding Type Safety to Electron IPC with TypeScript. <https://kishannirghin.medium.com/adding-typesafety-to-electron-ipc-with-typescript-d12ba589ea6a>
- [S10] r/ExperiencedDevs — Migrating codebase from JS to TS. <https://www.reddit.com/r/ExperiencedDevs/comments/1jxx6zs/migrating_codebase_from_javascript_to_typescript/>

### In-repo primary sources (verified 2026-07-25)

- `docs/adr/010-backend-ts-migration-strategy.md` — the big-bang decision
- `main.ts:7-13` — ESM imports (entry point)
- `preload.ts:5-6` — ESM imports (preload bridge)
- `src/helpers/ipc-contracts.ts:1-16` — `as const` channels + named-export rationale
- `src/helpers/ipc/index.ts:29,73-78` — `ManagersBag` + `asManagers<T>` seam
- `src/electronAPI.d.ts:1-285` — comprehensive renderer-side typing
- `tests/_tsresolve.setup.js:1-118` — the 3-part Node module monkey-patch
- `tests/unit/backend-type-safety.test.js` — dynamic `any` guard
- `tsconfig.json:8-25` — strict mode + include scope
- `eslint.config.mjs:38-40` — three rule concessions
- `package.json:12-15` — tsx (dev) vs esbuild (prod) dual path

### Companion research docs

- `docs/research/README.md` — index of the research base
- `docs/research/e2e-functional-verification-strategy.md` — testing capstone (companion to this doc)
- `docs/adr/008-strict-mode-typescript.md` — original strict-mode decision
- `docs/adr/012-known-limitations-tradeoffs.md` — v1 tech debt registry
