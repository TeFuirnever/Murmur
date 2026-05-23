# ADR 010: Backend TS migration strategy

## Status: Accepted

## Context

Backend Node.js files (`src/helpers/*.js`, `main.js`, `preload.js`) use `require()` for module resolution. TypeScript files (`.ts`) cannot be resolved by Node.js's native `require()`. Previous attempt to rename `.js` → `.ts` broke all `require()` calls.

## Decision

Prepare infrastructure for gradual backend migration without forcing it now:
1. Install `tsx` runtime (`electron --require tsx/cjs .`) for dev mode
2. Add `esbuild` build script (`build:main`) for production bundling
3. Keep all backend files as `.js` until migration is done file-by-file
4. Migrate one file per PR, starting with pure functions (no `require` dependencies)

## Consequences

- Zero disruption to existing code
- Dev infrastructure ready for future migration
- Production builds will use esbuild to bundle `.ts` → `.js`
- Migration can proceed incrementally without blocking feature work
