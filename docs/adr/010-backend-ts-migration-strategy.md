# ADR 010: Backend TS migration strategy

## Status: Accepted — updated 2026-07-24 with dual-source findings

## Context

Backend Node.js files (`src/helpers/*.js`, `main.js`, `preload.js`) use `require()` for module resolution. TypeScript files (`.ts`) cannot be resolved by Node.js's native `require()`. Previous attempt to rename `.js` → `.ts` broke all `require()` calls.

## Decision

Prepare infrastructure for gradual backend migration without forcing it now:

1. Install `tsx` runtime (`electron --require tsx/cjs .`) for dev mode
2. Add `esbuild` build script (`build:main`) for production bundling
3. Keep all backend files as `.js` until migration is done file-by-file
4. Migrate one file per PR, starting with pure functions (no `require` dependencies)

## Current State (2026-07-24)

14 backend helpers now have dual `.ts` + `.js` source files:

- `.ts` = typed source of truth (used by `tsc --noEmit` and vitest, which resolves `.ts` first)
- `.js` = runtime implementation (used by Electron `require()` in production and by vitest CJS interop)

**The `.js` files cannot be deleted yet.** Attempted deletion caused 178 test failures because:

- CJS consumers (`main.js`, `ipc/index.js`, other `.js` helpers) use `require("./module")` expecting `module.exports = X`
- When vitest resolves to `.ts` (ESM `export default X`), CJS `require()` gets `{ default: X }` instead of `X`
- This is a systemic ESM/CJS interop issue, not fixable per-file without `@ts-ignore` or `module.exports` shims

### To fully delete `.js` files (future work)

All three must happen simultaneously (big-bang migration):

1. Migrate `main.js` → `main.ts` with `import` syntax
2. Migrate all IPC handlers (10 files) and managers (9 files) to `.ts` with `import`
3. Change `package.json` `"main"` to `"main.ts"` or a built entry point
4. Verify the entire `require()` chain is ESM-compatible (no CJS `require()` left)

This is a large coordinated change that should be done in a dedicated sprint, not incrementally.

## Consequences

- Zero disruption to existing code
- Dev infrastructure ready for future migration
- Production builds use esbuild to bundle `.ts` → `.js` (with `--resolve-extensions=.js,.ts`)
- Dual-source pattern (`.ts` + `.js`) requires manual sync until big-bang migration
- 40 parity tests guard against drift between `.ts` and `.js` sources
- Migration can proceed incrementally without blocking feature work
