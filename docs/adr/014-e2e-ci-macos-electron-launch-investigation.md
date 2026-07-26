# ADR-014: E2E CI macOS Electron launch investigation (unresolved)

Date: 2026-07-26
Status: **Investigation — needs human follow-up**
Supersedes: none
Related: `docs/research/e2e-functional-verification-strategy.md` §7 Stage 0

## Context

Every e2e test in CI macOS (`00-boot-health`, `00-ftue`, `01-lifecycle`,
all 39 suites) fails identically with:

```
TimeoutError: electronApplication.firstWindow: Timeout 30000ms exceeded
  at ../helpers/electron-launch.js:205
```

The blocking "E2E boot health" gate in `.github/workflows/ci.yml` is
correctly designed but cannot be promoted from `continue-on-error: true`
until this is resolved.

PRs #91, #92, and #93 (8 CI iterations across ~1 hour) progressively
narrowed the failure mode but did NOT identify a fixable root cause.

## Investigation summary (8 CI runs)

### What we confirmed IS working

| Check                                 | Result                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `electron.launch()` returns           | ✅ pid assigned, ~3s launch time                                                        |
| Electron binary path                  | ✅ `node_modules/.pnpm/electron@36.5.0/.../Electron.app/Contents/MacOS/Electron`        |
| Electron binary launcher size         | ✅ 50472 bytes (matches local; this is the launcher stub)                               |
| Electron dist total size              | ✅ 773328 KB (~755MB, exceeds local 262MB; has both arches)                             |
| `Electron Framework.framework` exists | ✅ true                                                                                 |
| Renderer bundle present               | ✅ `src/dist/index.html` (Vite `outDir: "dist"` + `cd src && vite build` → `src/dist/`) |
| Main bundle present                   | ✅ `dist-main/main.js` (esbuild output)                                                 |
| Preload bundle present                | ✅ `dist-preload/preload.js`                                                            |
| `NODE_ENV=test` set                   | ✅ (in launch env)                                                                      |
| `MURMUR_DB_PATH=:memory:` set         | ✅ (in launch env)                                                                      |
| `ELECTRON_ENABLE_LOGGING=1` set       | ✅ (in launch env)                                                                      |

### What we confirmed is NOT the cause

| Hypothesis                                                | Tested in    | Outcome                                                                                                 |
| --------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `app.dock.show()` throws on CI macOS (no GUI)             | PR #93 v1    | ❌ Wrong — added try/catch + `CI=true` guard, no effect                                                 |
| `startApp()` rejection unhandled                          | PR #93 v1    | ❌ Wrong — added `await` + try/catch, no effect                                                         |
| Top-level import side effect hangs before `app.whenReady` | PR #93 v2    | ❌ Wrong — canaries in main.ts never printed (ESM import hoisting)                                      |
| Electron binary never installed                           | PR #93 v3    | ❌ Wrong — `ci-probe.js` via `--require` never printed either                                           |
| pnpm v11 skips electron postinstall                       | PR #93 v4    | ❌ Wrong — `pnpm-workspace.yaml` already has `onlyBuiltDependencies: [electron]`                        |
| Electron binary missing or Framework absent               | PR #93 v6/v7 | ❌ Wrong — Framework exists, dist total 755MB                                                           |
| `app.getAppPath()` returns wrong dir                      | (rule out)   | ❌ Would still produce some JS output                                                                   |
| macOS code-signing rejection                              | (rule out)   | ❌ Would log a stderr error, not silent exit code=0                                                     |
| GPU/compositor init                                       | (rule out)   | ❌ `app.disableHardwareAcceleration()` IS gated on `NODE_ENV==="test"` and IS called before `whenReady` |

### The smoking gun

**The Electron process runs for ~30 seconds, then exits with code=0
(clean exit, not a crash). During those 30 seconds, NO JavaScript
executes — not even a `--require`'d CJS probe that runs before any
other JS.**

```
[e2e-launch] electron.launch() returned after 3334ms (pid=11589)
[e2e-launch] awaiting firstWindow()...
[e2e-launch] [main:launch] exit code=0 signal=null   ← after 30s
[e2e-launch] [main:launch] close event (app terminated)
```

The only stderr captured is Playwright's own inspector disconnect:

```
[main:launch] stderr: Debugger ending on ws://127.0.0.1:49243/...
[main:launch] stderr: For help, see: https://nodejs.org/en/docs/inspector
```

This is consistent with [Playwright issue
#9351](https://github.com/microsoft/playwright/issues/9351) — Electron
hangs during launch when the Playwright debugger is attached.

## Remaining hypotheses (untested)

Ordered by likelihood:

### 1. Playwright Electron inspector causes silent hang (HIGH)

The `Debugger ending` stderr message is suspicious. Playwright attaches
a V8 inspector to the Electron main process to control it. On certain
platform/config combinations, this attachment causes the Electron main
process to hang at startup — never reaching `app.whenReady()`.

Test: pass `executablePath` directly (skip Playwright's binary
resolution) and add `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` env. If the
inspector is the issue, also try disabling it via `--inspect=0` flag.

### 2. macOS Sequoia sandbox blocks unsigned Electron binary (MEDIUM)

`macos-latest` is now macOS 15 (Sequoia). Sequoia tightened notarization
requirements. The unsigned `Electron.app` from npm may be allowed to
**start** (pid assigned) but blocked from **executing its framework**
(silent termination).

Test: SSH into a CI runner, manually execute
`./Electron.app/Contents/MacOS/Electron --require /tmp/probe.js`, observe
whether macOS Gatekeeper logs anything to Console.app or blocks the
framework load.

### 3. Electron 36.x + Node 24 incompatibility (LOW)

`node=v24.18.0` is bleeding edge. Electron 36.x ships with its own
Node, but the postinstall `node-gyp rebuild` for `better-sqlite3`
targets the system Node. ABI mismatch could cause silent failures in
native modules — but that wouldn't prevent main.ts from running.

## Decision

**Close PR #93 as "investigation complete, root cause not isolated."**
Keep the instrumentation (it's now load-bearing diagnostic value). Mark
the boot health gate as permanently non-blocking until the underlying
issue is fixed via local macOS debugging.

**Pivot to productive work.** This problem needs:

- SSH access to a `macos-latest` GitHub Actions runner, OR
- A developer with a Mac to reproduce locally with `pnpm test:e2e:diag`

Continued LLM-driven CI iteration is low-yield — every cycle takes 8-12
minutes and the search space is too large to brute-force.

## Concrete next-step worklist for whoever picks this up

1. **Local repro**: `git clone` on a Mac, `pnpm install && pnpm test:e2e:diag`
   - If local fails identically → sandbox/environment issue, not CI-specific
   - If local works → CI-specific, see step 2
2. **CI SSH**: enable `tmate` or `ngrok` debugging action in `ci.yml`,
   reproduce manually on the runner:
   ```yaml
   - uses: mxschmitt/action-tmate@v3
     if: failure()
   ```
3. **Manual launch test** on runner:
   ```bash
   ./node_modules/.pnpm/electron@36.5.0/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
     --require tests/e2e/helpers/ci-probe.js
   ```
   Watch for Gatekeeper dialog or silent termination.
4. **Try Playwright `executablePath` override**:
   ```js
   electron.launch({ executablePath: require("electron"), ... })
   ```
5. **Try disabling Playwright inspector**: research whether `--no-inspector`
   or similar flag exists (may require Playwright source dive).

## Artifacts left in place

- `tests/e2e/helpers/electron-launch.js` — full instrumentation (env dump,
  bundle check, binary check, stderr/stdout listeners, phase canaries)
- `tests/e2e/helpers/ci-probe.js` — CJS probe loaded via `--require`
- `tests/e2e/suites/00-launch-only.test.js` — minimal launch smoke test
- `tests/e2e/suites/00-boot-health.test.js` — 7-test boot gate (spec §4.1)
- `.github/workflows/ci.yml` — non-blocking diagnostic + boot health + e2e
- `package.json` — `test:e2e:diag`, `test:e2e:boot` scripts
- `main.ts` — `app.dock.show()` guard + whenReady try/catch + canaries
  (harmless even though they don't fire on CI; useful for local debugging)

These remain valuable diagnostic infrastructure for the eventual fix.
