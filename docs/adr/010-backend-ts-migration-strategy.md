# ADR 010: Backend TS migration strategy

## Status: Superseded — big-bang migration completed 2026-07-24

## Context

Backend Node.js files (`src/helpers/*.js`, `main.js`, `preload.js`) use `require()` for module resolution. TypeScript files (`.ts`) cannot be resolved by Node.js's native `require()`. Previous attempt to rename `.js` → `.ts` broke all `require()` calls.

## Decision (original — superseded)

Prepare infrastructure for gradual backend migration without forcing it now:

1. Install `tsx` runtime (`electron --require tsx/cjs .`) for dev mode
2. Add `esbuild` build script (`build:main`) for production bundling
3. Keep all backend files as `.js` until migration is done file-by-file
4. Migrate one file per PR, starting with pure functions (no `require` dependencies)

## Why gradual migration failed

The dual-source approach (.ts type stub + .js runtime) had a fatal flaw:
`.js` source files' internal `require("./foo")` uses Node's native resolver,
which cannot resolve `.ts`. This means deleting any `.js` file breaks all
`.js` files that require it — verified empirically (178 test failures).

The gradual approach was never truly gradual — it was a deferred big-bang.
Adversarial code review (3 parallel reviewers) found 6 P0 defects in the
original big-bang plan, all fixed before execution.

## Decision (final — big-bang, 2026-07-24)

All 39 backend `.js` files migrated to `.ts` in one atomic operation:

1. All `require()` → `import`, all `module.exports` → `export default`/named
2. esbuild bundles `main.ts` → `dist-main/main.js`, `preload.ts` → `dist-preload/preload.js`
3. `package.json "main"` → `dist-main/main.js`
4. electron-builder ships only bundles (no raw `src/helpers/**`)
5. `build:main` wired into all packaging paths (build/dist/pack/prebuild/CI)
6. `__dirname` paths replaced with `app.getAppPath()` (13 sites)
7. Test infrastructure: `tests/_tsresolve.setup.js` monkey-patches Node's
   module system so `.js` test files' `require()` can load `.ts` (esbuild
   .ts loader + .ts resolution + \_\_esModule default unwrap)

### Export strategy

| Pattern                             | Solution                                               |
| ----------------------------------- | ------------------------------------------------------ |
| `module.exports = Class`            | `export default Class` (consumers use `import X from`) |
| `module.exports = { fn }`           | named exports `export function fn`                     |
| Whole-object export (ipc-contracts) | named exports per top-level key                        |
| Conditional `require("osascript")`  | kept as CJS require inside try/catch                   |

### Verified

- `tsc --noEmit`: 0 errors
- `eslint`: 0 warnings
- `vitest`: 672/672 tests pass
- `build:main` + `build:preload`: bundles produced
- `electron-builder pack`: asar contains `dist-main/main.js` + `dist-preload/preload.js`, no raw source

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
