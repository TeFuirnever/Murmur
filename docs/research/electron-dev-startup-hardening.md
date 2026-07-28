# Murmur Dev-Startup Hardening — tsx/Electron Loader, Native ABI, and the Silent-Hang Trap

> Status: First-round research (dev-startup safety net)
> Date: 2026-07-28
> Branch: `fix/postinstall-better-sqlite3-abi`
> Scope: Audit of the dev-startup test safety net that let a real `dev:main`
> regression (`electron --import tsx/esm main.ts` silently hangs because
> Electron 36 does not forward CLI `--import` to its internal Node ESM loader)
> go undetected for weeks. Industry-grounded recommendations to harden the
> dev path, the better-sqlite3 dev/test ABI mutex, and the build-script
> regression guards. Primary-source citations throughout. **Read-only
> research — no code changes.**
> Audience: Engineers deciding what guard to add so the next `dev:main`
> rewrite cannot ship a silent hang, and whether to keep tsx-direct or
> converge on electron-vite / esbuild-watch.

## 0. How this document fits in

The `docs/research/` family already covers testing strategy, architecture,
E2E verification, and the TS migration. None of them audit the **dev
startup path** as a test surface:

| Existing doc                              | Covers dev-startup hardening?                        |
| ----------------------------------------- | ---------------------------------------------------- |
| `ts-migration-audit-and-evolution.md`     | No — TS migration capstone                           |
| `e2e-functional-verification-strategy.md` | Touches boot sequence, but only the **bundled** path |
| `murmur-architecture-map.md`              | No — runtime architecture                            |
| `electron-testing-best-practices.md`      | No — general test patterns                           |
| `deep-test-design-*.md`                   | No — test cases                                      |
| **This document**                         | **Yes — dev-startup safety net capstone**            |

The recurring bug this doc is built around is recorded in agent memory
(`~/.claude/projects/-Users-guanxueliang-Desktop-oh-my-ai-Murmur/memory/electron-tsx-esm-loader.md`)
and the fix is already on this branch (`package.json:12`). This document
does **not** re-derive the root cause — it audits why the existing guards
missed it and how to close the gap.

## 1. Primary sources cited throughout

Cited inline as `[Sxx]`. All consulted 2026-07-28.

- **[S1]** tsx — _Node CLI_ docs (`node --import tsx` and `NODE_OPTIONS="--import tsx"`). <https://github.com/privatenumber/tsx/blob/master/docs/dev-api/node-cli.md>
- **[S2]** electron-react-boilerplate — Issue #3568 _ERR_UNKNOWN_FILE_EXTENSION_ (ts-node → esbuild-register/tsx; `NODE_OPTIONS="--import tsx"` pattern). <https://github.com/electron-react-boilerplate/electron-react-boilerplate/issues/3568>
- **[S3]** Electron official — _Automated Testing_ (Playwright `electron.launch({ args: ['.'] })`, `firstWindow()`, `electronApp.evaluate` in main process). <https://electronjs.org/docs/latest/tutorial/automated-testing>
- **[S4]** Electron official — _Native Node Modules_ (`@electron/rebuild`, `ELECTRON_RUN_AS_NODE`, ABI mismatch). <https://electronjs.org/docs/latest/tutorial/using-native-node-modules>
- **[S5]** `@electron/rebuild` — README ("rebuilds native Node.js modules against the version of Node.js that your Electron project is using"; Forge uses it automatically; default types = prod+optional, **not** devDependencies; Node v22.12.0+). <https://github.com/electron/rebuild>
- **[S6]** electron-builder — Issue #1906 _[install-app-deps] what does it do?_ ("it is optional command. In any case electron-builder will rebuild production native deps on build."). <https://github.com/electron-builder/electron-builder/issues/1906>
- **[S7]** WiseLibs/better-sqlite3 — Issue #704 _Failed to build in Electron_ (canonical `NODE_MODULE_VERSION X vs Y` symptom; maintainer recommends `electron-builder install-app-deps` as postinstall). <https://github.com/WiseLibs/better-sqlite3/issues/704>
- **[S8]** WiseLibs/better-sqlite3 — Issue #1111 _Unable to use with electron_ (newer versions ship prebuilt Electron binaries). <https://github.com/WiseLibs/better-sqlite3/issues/1111>
- **[S9]** electron/electron — Issue #18128 (maintainer: "Compiling a module against Node will not produce a module that is usable with Electron. The ABIs are not explicitly compatible."). <https://github.com/electron/electron/issues/18128>
- **[S10]** zeromq/zeromq.js — Issue #144 (recommends targeting tests with `ELECTRON_RUN_AS_NODE` so they execute under Electron's bundled Node ABI). <https://github.com/zeromq/zeromq.js/issues/144>
- **[S11]** electron-vite — _Development_ docs (bundles main/preload/renderer via rollup for both dev-watch and prod; does **not** run `electron main.ts` directly). <https://electron-vite.org/guide/dev>
- **[S12]** Electron Forge — _Vite Plugin_ (official bundling path for main+renderer). <https://www.electronforge.io/config/plugins/vite>
- **[S13]** microsoft/playwright — Issue #13297 (Electron smoke-test `firstWindow` timing/diagnosis for VS Code). <https://github.com/microsoft/playwright/issues/13297>
- **[S14]** ts-node — _Usage_ (`NODE_OPTIONS` enables the loader inside child processes / other tools; same model tsx inherits). <https://typestrong.org/ts-node/docs/usage/>

### In-repo primary sources (verified 2026-07-28)

- `package.json:5,8-17,33,46` — scripts (main field, start/prestart/predev/dev/dev:main/build:main/postinstall/test/ci:check)
- `tests/unit/ci-config.test.ts:126-150` — the `dev:main` string guard (the hole)
- `main.ts:8-13` — the `[main:canary]` first-line canary
- `tests/e2e/helpers/electron-launch.ts:228-232,267,94-97` — launch args, `firstWindow()`, stderr capture
- `tests/e2e/suites/00-launch-only.test.ts:41-52` — launch-only assertion
- `playwright.config.ts:9` — e2e `globalSetup` builds bundles
- `vitest.config.ts:9` — e2e excluded from vitest
- agent memory `electron-tsx-esm-loader.md` — empirical 4-form test (the load-bearing root-cause evidence)
- agent memory `electron-native-abi-postinstall.md` — the postinstall/ABI rule and `concurrently` output-swallowing diagnosis

## 2. Executive summary

**The bug.** `dev:main` rewrote Electron's TS loader wiring in a way that
matched the existing string guard but silently failed at runtime:
`electron --import tsx/esm main.ts` makes Electron treat `--import` as a
boolean switch and `tsx/esm` as the app path, so `main.ts` is **never
loaded** — the process stays alive with empty stdout (a "silent hang"). The
correct form is `NODE_OPTIONS='--import tsx' electron main.ts` (already on
this branch, `package.json:12`). Root cause and the 4-form empirical proof
live in agent memory `electron-tsx-esm-loader.md`.

**Why it lurked (the audit thesis).** Three guards were supposed to catch
this and none could:

1. The only `dev:main` test asserts the **script string** matches a regex
   (`ci-config.test.ts:141`), not that `main.ts` actually loads.
2. Every E2E suite launches the **bundled** `dist-main/main.js`
   (`electron-launch.ts:228-232` via `package.json:5`), never the
   `electron main.ts` + tsx dev path.
3. `main.ts:12` emits a `[main:canary]` line precisely to flag "main.ts
   never loaded", but **no test asserts it fires** — it is diagnostic-only.

The structural root cause is **dev/prod asymmetry**: dev loads `main.ts`
through tsx's ESM loader; prod and E2E load an esbuild CJS bundle. They are
different code paths, and only the prod path is tested.

**Top recommendations** (full detail in §5):

- **P0 — add a `dev:main` runtime smoke** that spawns `electron main.ts`
  with `NODE_OPTIONS='--import tsx'` and asserts the `[main:canary]` line
  (or `firstWindow`) appears within a timeout. This is the only guard that
  can catch the silent-hang class. ~1 hour.
- **P0 — add a better-sqlite3 ABI probe + clear-failure preflight**
  (`scripts/check-native-abi.js`) run before `dev` and `test`, so the
  dev/test ABI mutex fails loudly instead of as a "玄学" crash later.
- **P1 — promote the `main.ts` canary to an asserted gate** in the E2E
  launch path (capture stderr, fail if `[main:canary]` absent).
- **P2 — eliminate the dev/prod asymmetry**: either esbuild-watch for dev
  (smallest diff) or migrate to electron-vite (industry-default, removes
  the uncovered dev path structurally).

## 3. Current safety-net audit — where the holes are

Each hole names `file:line`, why it is a hole, and the class of bug that
slips through.

### Hole 1 — `dev:main` guard is string-only, never launches Electron

**Site:** `tests/unit/ci-config.test.ts:135-143`

```ts
it("dev:main registers tsx via NODE_OPTIONS (CLI --import is swallowed by Electron)", () => {
  const devMain = pkg.scripts["dev:main"];
  expect(devMain).toMatch(/NODE_OPTIONS=['"]?.*--import tsx( |['"]|$)/);
  expect(devMain).not.toContain("--require tsx/cjs");
});
```

**Why it is a hole.** The assertion verifies the _text_ of the npm script,
not its _behavior_. "The string contains `NODE_OPTIONS=...--import tsx`" is
a necessary but nowhere near sufficient condition for "`electron main.ts`
loads `main.ts`." A rewrite that preserves the substring while breaking
quoting (`NODE_OPTIONS="--import tsx"` with a stray `--` on Windows
`cross-env`), points at a wrong entry path, relies on an unresolvable
`tsx`, or mishandles the `--dev` arg all pass this guard and hang at
runtime. The stale comment at `ci-config.test.ts:126-130` (it still claims
`--import tsx/esm registers an ESM loader hook` — the exact form that was
broken) shows how string guards drift from reality.

**Bug class that slips through:** any silent-hang regression in the
`electron main.ts` + tsx interaction — i.e. the exact `c875321` class.

### Hole 2 — E2E runs the bundled `dist-main/main.js`, never the tsx dev path

**Sites:** `tests/e2e/helpers/electron-launch.ts:228-232` (launch args),
`package.json:5` (`"main": "dist-main/main.js"`),
`playwright.config.ts:9` (`globalSetup` builds the bundle first).

```ts
args: [
  "--require", path.join(PROJECT_ROOT, "tests/e2e/helpers/ci-probe.js"),
  appRoot,   // = PROJECT_ROOT → Electron reads package.json "main" = dist-main/main.js
],
```

**Why it is a hole.** E2E exercises the **esbuild CJS bundle** that prod
also ships. The dev path — `cross-env NODE_OPTIONS='--import tsx' electron
main.ts --dev` (`package.json:12`) — is a _different runtime mechanism_
(tsx's ESM loader hook transpiling `.ts` on the fly vs. a pre-built CJS
bundle). Nothing automated ever runs the dev path. So a regression that
only breaks the tsx/ESM-loader route (e.g. the `c875321`
`--import tsx/esm` rewrite, a tsx major-version bump, an ESM-only import
added to `main.ts` that esbuild would compile away) is invisible to the
entire E2E tier.

**Bug class that slips through:** dev-only breakage with a working prod
bundle — the silent-hang class, plus any ESM/CJS divergence between `main.ts`
source and its esbuild output.

### Hole 3 — the `main.ts` canary is diagnostic-only, never asserted

**Sites:** `main.ts:8-13` (canary emit), `tests/e2e/helpers/electron-launch.ts:94-97` (stderr → console, no assertion).

```ts
// main.ts:12
console.error("[main:canary] main.ts module-load-started");
```

```ts
// electron-launch.ts:94-97 — captured to console, never checked
proc.stderr?.on("data", (chunk) => {
  const text = chunk.toString().trim();
  if (text) console.log(`${DIAG_PREFIX} [main:${label}] stderr: ${text}`);
});
```

**Why it is a hole.** The canary was added explicitly to answer "did
`main.ts` even load?" (`main.ts:8-12` header comment). The launch helper
pipes it to the CI log — but no test fails when it is absent. The signal
exists and is unused as a gate.

**Bug class that slips through:** any regression where Electron spawns and
a window _might_ still appear via a partial boot, or where `firstWindow`
times out with an ambiguous cause. Asserting the canary turns a 30s
ambiguous timeout into a 0ms binary failure with a precise message.

### Hole 4 — `firstWindow`-only assertion is shallow

**Site:** `tests/e2e/suites/00-launch-only.test.ts:41-52`

```ts
expect(window).toBeDefined();
const url = window.url();
expect(url.length).toBeGreaterThan(0);
```

**Why it is a hole.** `firstWindow()` resolving proves a BrowserWindow
opened — which _would_ catch the dev:main silent-hang (no `main.ts` load →
no window). But (a) this suite runs only against the bundled path (Hole 2),
and (b) `url.length > 0` does not prove the renderer loaded the app rather
than an error page. Electron's own testing guide shows the stronger
pattern: `electronApp.evaluate(({ app }) => app.isPackaged)` to assert on
**main-process** state, not just window presence [S3].

**Bug class that slips through:** partial boots that still open a window.

### Hole 5 — better-sqlite3 dev/test ABI mutex is manual and undocumented in tooling

**Sites:** `package.json:10` (`predev: npx electron-rebuild` → Electron
ABI 135), `package.json:17` (`postinstall: electron-builder install-app-deps`
→ Electron ABI), `package.json:33` (`test: vitest run` → system Node ABI
137 on Node 24). Memory: `electron-native-abi-postinstall.md`.

**Why it is a hole.** After `pnpm install` or `pnpm dev`,
`better-sqlite3.node` is compiled for Electron's ABI (Electron 36 bundles
Node 22 = ABI 135). `pnpm test` runs vitest under the system Node (v24 =
ABI 137). Any test or script that actually loads `better-sqlite3` under
system Node then hits `NODE_MODULE_VERSION 135 vs 137` [S7][S9] — the exact
symptom in WiseLibs#704. The inverse holds after a `pnpm rebuild
better-sqlite3` for Node: `pnpm dev` then crashes. The maintainer rule is
in memory ("Electron projects must never `pnpm rebuild <pkg>` in
postinstall"), and the fix removing the rogue `pnpm rebuild` is already on
this branch — but the **dev/test switch still requires a manual rebuild and
nothing fails fast when the ABI is wrong**. Today this is partly masked
because `vitest.config.ts` coverage excludes the Electron-dependent
managers that would load the native module, so most unit tests don't
touch it; the moment a test does, it becomes a "玄学" failure.

**Bug class that slips through:** intermittent native-module load failures
that depend on which target was rebuilt last, with no preflight to tell the
developer which ABI is currently compiled.

### Hole 6 — `concurrently` swallows the main-process stack

**Site:** `package.json:11` (`dev: concurrently -k -r ...`), memory
`electron-native-abi-postinstall.md`.

**Why it is a hole.** When `dev:main` crashes, the terminal shows only
`[ELIFECYCLE] exit code 1` — `concurrently` does not surface Electron's
Uncaught Exception stack. The real stack is in
`~/Library/Application Support/Murmur/logs/app.log`. This is a diagnosis
gap, not a guard gap, but it is why the silent-hang class _looks_ like a
vague failure instead of an obvious one, lengthening time-to-detect.

## 4. Industry best practices — primary-source grounded

### 4.1 tsx registration: `NODE_OPTIONS='--import tsx'` is the documented form

tsx's own Node-CLI docs state the pattern directly [S1]:

> _"To use the node command directly with tsx, pass it as a flag:
> `node --import tsx` … You can use the Node.js `NODE_OPTIONS` environment
> variable to pass in the flag (e.g. `NODE_OPTIONS="--import tsx"`)."_

The `NODE_OPTIONS` route (vs. a CLI flag on the wrapper binary) is what
makes the loader propagate into child processes and tool-managed spawns
[S14] — and, critically for Electron, into Electron's **internal** Node.
electron-react-boilerplate's `ERR_UNKNOWN_FILE_EXTENSION` issue tracked the
same migration (ts-node → modern loaders) and landed on the
`NODE_OPTIONS="--import tsx"` form [S2]. Murmur's current `package.json:12`
matches this exactly. **Verdict: the current form is the documented best
practice; no more stable official option exists.** The residual risk is
not the form — it is that nothing _verifies_ the form works at runtime
(Hole 1).

### 4.2 Electron + TS main: the industry default is to **bundle**, not to run `electron main.ts`

Every mainstream Electron+TS toolchain bundles `main`/`preload` (and
renderer) and points Electron at the bundle, for **both** dev and prod:

- **electron-vite** [S11]: `build.rollupOptions.input` for main + preload +
  renderer; dev mode **watches and relaunches**, it does not run
  `electron main.ts`. HMR for the renderer via `VITE_DEV_SERVER_URL`;
  main/preload hot-reload via watch. Preload path is resolved with
  `__dirname`/`fileURLToPath` against the bundled `.js`.
- **Electron Forge + Vite plugin** [S12]: official bundling path, same
  model — main and renderer are bundled, Electron loads the bundle.
- **electron-react-boilerplate** [S2]: webpack-bundles the main process;
  the TS-loader issue (#3568) was about _which_ transpiler feeds the
  bundle, not about running TS directly in Electron.

**Why the industry bundles instead of running `electron main.ts`:** it
collapses the dev/prod asymmetry that caused Hole 2. When dev and prod
load the same artifact, the prod-tested path _is_ the dev path. tsx-direct
(Murmur's current choice) is a legitimate but minority pattern: faster
dev loop (no rebuild step), at the cost of two divergent load mechanisms.
That cost is acceptable **only if a runtime smoke covers the dev path**
(§5 P0).

### 4.3 Catching silent hangs: assert on main-process state, not just process liveness

Electron's testing guide [S3] shows two assertion shapes stronger than
"process alive":

1. `electronApp.evaluate(({ app }) => …)` — run code **inside the main
   process** and assert on its result (the guide's example asserts
   `app.isPackaged`). This is the canonical "main entry actually loaded
   and executed" proof.
2. `await electronApp.firstWindow()` — resolves only when a BrowserWindow
   opens, i.e. the boot reached window creation.

Playwright issue #13297 [S13] documents how misleading Electron smoke
tests can be when `firstWindow` timing is misread (VS Code launch "didn't
finish" but looked alive). The lesson generalises: **liveness ≠ loaded**.
A dev:main smoke must assert one of (canary line on stderr / `firstWindow`
/ `evaluate`), with a hard timeout — never "the process didn't exit."

Murmur already has the right primitives: `electron-launch.ts:94-97`
captures main-process stderr, `main.ts:12` emits the canary, and
`firstWindow()` is already awaited. The gap is purely that no test
_asserts_ on them for the dev path (Holes 1+3).

### 4.4 Native ABI: `install-app-deps` for Electron, `ELECTRON_RUN_AS_NODE` to share the ABI in tests

- **`@electron/rebuild`** [S5] "rebuilds native Node.js modules against the
  version of Node.js that your Electron project is using." Default
  `--types` is `prod,optional` — **devDependencies are NOT rebuilt** — and
  Forge uses it automatically when packaging. Requires Node v22.12.0+.
- **`electron-builder install-app-deps`** [S6] is "optional; in any case
  electron-builder will rebuild production native deps on build." Its role
  is the **dev-time** rebuild so `pnpm dev` works after install. This is
  exactly Murmur's `package.json:17` postinstall — correct.
- **The mismatch is fundamental** [S9]: _"Compiling a module against Node
  will not produce a module that is usable with Electron. The ABIs are not
  explicitly compatible."_ So any test that loads `better-sqlite3` under
  system Node _will_ fail if it was rebuilt for Electron, and vice versa.
- **The clean way to make tests and dev share an ABI** [S10]: run the
  tests under Electron's bundled Node with `ELECTRON_RUN_AS_NODE=1`, so the
  test runtime and the dev/prod runtime use the same ABI. The alternative
  is to mock/exclude the native module from Node-run tests (Murmur's
  current approach via `vitest.config.ts:27-48` exclusions).
- **Newer `better-sqlite3` ships prebuilt Electron binaries** [S8], which
  removes the from-source rebuild pain; Murmur is on `11.10.0`
  (`package.json:119`), which is in the prebuilt range.

**Verdict for Murmur:** the postinstall is already correct (Electron ABI).
The remaining risk is the dev↔test local switch (Hole 5). Industry offers
two answers — run tests under `ELECTRON_RUN_AS_NODE` (shares ABI, heavier),
or keep the current mock/exclude strategy and add a **fast ABI probe** that
fails before the test suite rather than inside it (§5 P0).

## 5. Prioritised improvement recommendations

Each item: motivation → concrete change (file/command/test) → what
regressions it blocks → cost. Ordered by ROI.

### P0 — Immediate (this branch or next PR, hours)

#### P0.1 — Add a `dev:main` runtime smoke test (closes Hole 1+2 for the silent-hang class)

**Motivation.** This is the single guard that can catch the `c875321`
class. String regex cannot; bundled E2E cannot. Only "spawn
`NODE_OPTIONS='--import tsx' electron main.ts` and prove `main.ts`
loaded" can.

**Concrete change (minimal, no new framework).** A new vitest test, e.g.
`tests/unit/dev-main-smoke.test.ts`, that:

1. Spawns `electron main.ts` with `env.NODE_OPTIONS='--import tsx'` and
   `NODE_ENV=development` via `child_process.spawn` (cross-platform via
   `cross-env` already in the deps).
2. Captures stderr, scans for the `[main:canary] main.ts module-load-started`
   line (`main.ts:12`).
3. **Asserts** the canary appears within a hard timeout (e.g. 15s); kills
   the process either way.
4. Optionally also awaits `firstWindow`-equivalent signal — but the canary
   alone is sufficient and ~10× faster, because it fires before
   `app.whenReady()`.

The binary "canary appeared = pass / timeout = fail" judgment is exactly
the "写文件 probe" method already proven in agent memory
`electron-tsx-esm-loader.md`. Keep the existing string guard
(`ci-config.test.ts:141`) as a fast first-line check; this smoke is the
second line that actually executes the path.

**Blocks:** every silent-hang regression in `dev:main` — wrong tsx form,
unresolvable tsx, broken `NODE_OPTIONS` quoting, `main.ts` entry-path
mistakes, ESM-only imports that break under tsx but not esbuild.

**Cost.** ~1 hour. No new dependency (`child_process` is stdlib,
`cross-env`/`electron` already present). The one subtlety: on CI this
spawns a real Electron, so it needs the same headless accommodation
(`app.disableHardwareAcceleration()` for `NODE_ENV=test`,
`main.ts:223-225`) and `CSC_IDENTITY_AUTO_DISCOVERY=false`. Tag it
`@slow` or gate behind an env flag if CI macOS flakiness is a concern —
but do not skip it by default.

#### P0.2 — Add a `better-sqlite3` ABI probe preflight (closes Hole 5's "玄学" mode)

**Motivation.** The dev/test ABI switch currently fails _inside_ a test or
_inside_ `dev:main`, deep in the run. A preflight that fails _before_ with
a one-line remediation command turns a 20-minute debugging session into a
5-second message.

**Concrete change.** A tiny `scripts/check-native-abi.js` that does
`require('better-sqlite3')` in a try/catch and prints either
`[abi] better-sqlite3 OK (runtime=<abi>)` or
`[abi] FAIL: rebuild for <target> → pnpm rebuild better-sqlite3   (or)   pnpm exec electron-rebuild`.
Wire it as:

- `predev` already runs `electron-rebuild` (`package.json:10`) — add the
  probe _after_, so a failed rebuild surfaces immediately.
- `pretest`: add `node scripts/check-native-abi.js` (or run it under
  system Node to assert the _test_ ABI is correct).

The probe pattern is already endorsed in memory
`electron-native-abi-postinstall.md` ("`./node_modules/.bin/electron probe.js` …
PROBE_OK/FAIL 立判").

**Blocks:** the recurring "test passes after dev, fails after install, 玄学"
class. Does not fix the mutex (that needs P2.2) but makes it fail loudly at
the boundary.

**Cost.** ~30 min. No new dependency.

### P1 — Short-term (days, medium risk)

#### P1.1 — Promote the `main.ts` canary to an asserted E2E gate (closes Hole 3)

**Motivation.** The canary already emits; the launch helper already
captures it (`electron-launch.ts:94-97`); it is one `expect` away from
being a gate.

**Concrete change.** In `launchElectronApp` (`electron-launch.ts`), collect
stderr into a buffer and, after `firstWindow()` resolves (or on timeout),
assert the buffer contains `[main:canary]`. On failure, print the captured
stderr so the CI log shows _why_ `main.ts` didn't load. This hardens _all_
E2E suites, not just a new smoke.

**Blocks:** any regression where Electron spawns but `main.ts` module-load
stalls (import side-effect hang, missing native module on the _bundled_
path, etc.).

**Cost.** ~2 hours.

#### P1.2 — Fix the stale `ci-config.test.ts` comment and tighten the string guard

**Motivation.** `ci-config.test.ts:126-130` still claims
`--import tsx/esm` "registers an ESM loader hook" — the form that was
broken. Misleading comments are how the next regression gets reintroduced.

**Concrete change.** Rewrite the comment to point at the empirical 4-form
result (agent memory `electron-tsx-esm-loader.md`) and add a
`not.toContain("--import tsx/esm")` line alongside the existing
`not.toContain("--require tsx/cjs")`. Cheap belt-and-suspenders behind
P0.1.

**Cost.** ~10 min.

### P2 — Root-cause / strategic (week, higher risk)

#### P2.1 — Eliminate the dev/prod asymmetry (the structural cause of Hole 2)

The silent-hang class exists _because_ dev and prod load `main.ts` by
different mechanisms. Two ways to remove the asymmetry, in ascending effort:

- **Option A — esbuild-watch for dev (smallest diff).** Replace the tsx
  direct-run with `esbuild main.ts --bundle --watch=forever …` feeding
  `dist-main/main.js`, and point `dev:main` at the bundle (`electron .`
  or `electron dist-main/main.js`). Dev now loads the **same artifact**
  E2E and prod load. Loses tsx's instant-reload snappiness; gains
  path-parity. Keeps the existing esbuild config (`package.json:13`).
  Effort: ~0.5 day. This is the ponytail choice — smallest change that
  closes the structural hole.

- **Option B — migrate to electron-vite (industry default).** electron-vite
  [S11] bundles main/preload/renderer for dev-watch _and_ prod, provides
  renderer HMR via `VITE_DEV_SERVER_URL`, and is the path Electron Forge
  officially sanctions [S12]. It removes the uncovered dev path
  _structurally_ and replaces Murmur's hand-rolled `concurrently` +
  tsx + esbuild + Vite-renderer cocktail with one config. Effort:
  ~1 week (move `main.ts`/`preload.ts` into `src/main`/`src/preload`,
  write `electron.vite.config.ts`, rewire `dev`/`build` scripts, re-verify
  the FunASR/python path setup and `asarUnpack` config). High value but
  real cost.

**Recommendation.** If P0.1 ships (dev:main smoke), the tsx-direct pattern
becomes safe enough to keep — **Option A is then optional**. Choose
Option B only when the dev-loop pain (manual preload rebuild in `predev`,
`package.json:10`) or a second dev-path regression justifies the migration
week. Until then, P0.1 + P1 are the ROI winners.

#### P2.2 — Resolve the dev/test ABI mutex structurally

Two industry-aligned options (§4.4):

- **Run unit tests under Electron's Node** via `ELECTRON_RUN_AS_NODE=1`
  [S10] so tests and dev share ABI 135. Heavier test runner; removes the
  switch entirely.
- **Keep mocks/excludes, formalise the contract**: a test that needs
  `better-sqlite3` _must_ declare it (smoke/probe), and the suite
  explicitly never loads the native module under system Node. Document
  this as an ADR so the exclusion list (`vitest.config.ts:27-48`) is a
  deliberate boundary, not an accident.

**Recommendation.** The second option matches Murmur's current shape (the
exclusions already exist) — formalise it with P0.2's probe as the
enforcer. Reserve `ELECTRON_RUN_AS_NODE` for if/when a test genuinely
needs the real native module under the bundled Node.

## 6. Decision tree — what to do next

```
Is the silent-hang class currently catchable by any test?
├── NO — Hole 1 (string-only) + Hole 2 (bundled-only) + Hole 3 (canary diagnostic-only)
│
What is the minimum guard that catches it?
├── P0.1: spawn `electron main.ts` under NODE_OPTIONS='--import tsx', assert [main:canary].
│   ~1 hr, no new deps. Ship this first, on this branch or the next PR.
│
Is the better-sqlite3 dev/test switch still going to bite?
├── YES, intermittently — add P0.2 (ABI probe preflight). ~30 min.
│
Want to harden every E2E suite, not just a new smoke?
├── P1.1: assert the canary in electron-launch.ts. ~2 hr.
│
Is the dev/prod asymmetry worth removing structurally?
├── Only if a second dev-path regression happens, or preload rebuild pain grows:
│   ├── Option A (esbuild-watch):  ~0.5 day, smallest diff, keeps tsx out.
│   └── Option B (electron-vite):  ~1 week, industry default, removes the class.
└── Otherwise: keep tsx-direct + P0.1. The smoke is the safety net.
```

## 7. Anti-patterns to reject (with citations)

| Anti-pattern                                                                  | Why rejected                                                                                                                      | Source                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Assert a npm-script _string_ to guard a _runtime_ load path                   | String-present ≠ runtime-works. The `c875321` class passes string guards. Assert behaviour (spawn + canary/firstWindow).          | §3 Hole 1                                                 |
| Treat "Electron process alive" as "main entry loaded"                         | Silent hang = alive process, empty stdout, `main.ts` never runs. Assert the canary or `firstWindow`, with a timeout.              | [S13], §4.3                                               |
| `pnpm rebuild <native>` in an Electron project's postinstall                  | Rebuilds for system Node ABI, overwrites the Electron ABI → `pnpm dev` crashes. Use `install-app-deps` / `electron-rebuild` only. | [S4][S5][S6], memory `electron-native-abi-postinstall.md` |
| Run `electron main.ts` in prod or E2E                                         | Industry bundles (electron-vite/Forge/ERB); dev/prod should load the same artifact. Murmur's asymmetry is the root cause here.    | [S11][S12][S2]                                            |
| Expect `better-sqlite3` compiled for Node to load in Electron (or vice versa) | ABIs are explicitly incompatible.                                                                                                 | [S9]                                                      |

## 8. References (consolidated)

### Primary external sources

- [S1] tsx — Node CLI docs. <https://github.com/privatenumber/tsx/blob/master/docs/dev-api/node-cli.md>
- [S2] electron-react-boilerplate — Issue #3568. <https://github.com/electron-react-boilerplate/electron-react-boilerplate/issues/3568>
- [S3] Electron — Automated Testing. <https://electronjs.org/docs/latest/tutorial/automated-testing>
- [S4] Electron — Native Node Modules. <https://electronjs.org/docs/latest/tutorial/using-native-node-modules>
- [S5] `@electron/rebuild` — README. <https://github.com/electron/rebuild>
- [S6] electron-builder — Issue #1906. <https://github.com/electron-builder/electron-builder/issues/1906>
- [S7] WiseLibs/better-sqlite3 — Issue #704. <https://github.com/WiseLibs/better-sqlite3/issues/704>
- [S8] WiseLibs/better-sqlite3 — Issue #1111. <https://github.com/WiseLibs/better-sqlite3/issues/1111>
- [S9] electron/electron — Issue #18128. <https://github.com/electron/electron/issues/18128>
- [S10] zeromq/zeromq.js — Issue #144. <https://github.com/zeromq/zeromq.js/issues/144>
- [S11] electron-vite — Development. <https://electron-vite.org/guide/dev>
- [S12] Electron Forge — Vite Plugin. <https://www.electronforge.io/config/plugins/vite>
- [S13] microsoft/playwright — Issue #13297. <https://github.com/microsoft/playwright/issues/13297>
- [S14] ts-node — Usage (`NODE_OPTIONS` propagation model). <https://typestrong.org/ts-node/docs/usage/>

### In-repo primary sources (verified 2026-07-28)

- `package.json:5,8-17,33,46,119` — scripts, main field, better-sqlite3 version
- `tests/unit/ci-config.test.ts:126-150` — the string-only `dev:main` guard (Hole 1)
- `main.ts:8-13` — the `[main:canary]` first-line canary (Hole 3 source)
- `tests/e2e/helpers/electron-launch.ts:94-97,228-232,267` — stderr capture, bundled-path launch args, `firstWindow()` (Holes 2+3)
- `tests/e2e/suites/00-launch-only.test.ts:41-52` — shallow launch assertion (Hole 4)
- `playwright.config.ts:9` — e2e `globalSetup` builds bundles
- `vitest.config.ts:9,27-48` — e2e excluded; native-module-dependent managers excluded from coverage
- agent memory `electron-tsx-esm-loader.md` — empirical 4-form tsx/Electron test (root-cause evidence)
- agent memory `electron-native-abi-postinstall.md` — postinstall/ABI rule, `concurrently` output-swallowing (Hole 6)

### Companion research docs

- `docs/research/README.md` — index of the research base
- `docs/research/ts-migration-audit-and-evolution.md` — TS migration capstone (why `main.ts` is ESM-source/CJS-output)
- `docs/research/e2e-functional-verification-strategy.md` — boot sequence + E2E tier strategy (bundled path)
- `docs/research/murmur-architecture-map.md` — runtime architecture / test seams
