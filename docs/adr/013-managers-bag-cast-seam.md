# ADR 013: ManagersBag cast seam

## Status

Accepted — 2026-07-25

## Context

`src/helpers/ipc/index.ts:29` defines `type ManagersBag = Record<string, unknown>`. Each handler module (`aiHandlers`, `clipboardHandlers`, etc.) accepts its own typed manager bag in `register()`. `registerAll()` in `index.ts:82` routes the loose bag into each handler via:

```ts
function asManagers<T>(bag: ManagersBag): T {
  return bag as unknown as T;
}
```

This is a **deliberate cast through `unknown`**, not `any`. The double cast avoids the `backend-type-safety` guard test (which forbids `any`) while letting structural compatibility flow at runtime. It is the type-system equivalent of "trust the call site" — `main.ts:147-155` assembles the bag with the correct manager instances, so each handler receives what it expects.

## Decision

Keep the `asManagers<T>` cast. Do not refactor to:

- a per-handler typed registry (adds indirection for no runtime gain)
- `any` (forbidden by `backend-type-safety` test)
- a single concrete `ManagersBag` interface (couples every handler to every manager)

The seam is audited by `tests/unit/backend-type-safety.test.js` (dynamic, walks all backend `.ts` files asserting zero `any`/`as any`/`@ts-ignore`). The cast through `unknown` is the maximum type-safety achievable without per-handler registry overhead.

## Consequences

- **Pro**: `main.ts` is the single assembly point; handlers stay decoupled from each other's manager types.
- **Pro**: `backend-type-safety` guard prevents regression to `any`.
- **Con**: A misconfigured bag (e.g., swapping two manager instances in `main.ts:147`) compiles fine but fails at runtime. Mitigated by integration tests that invoke handlers through `registerAll`.
- **Con**: IPC handler tests that capture registered handlers via mocked `ipcMain` see `result: unknown` return types (the source of ~38 TS18046 errors in test files). Fixing those requires either (a) tightening handler return types in `ipc-contracts.ts` or (b) asserting specific shapes per test. Defer to follow-up.

## Alternatives considered

1. **`as any`** — rejected by `backend-type-safety` test and project lint (`@typescript-eslint/no-explicit-any: off` is a concession for the renderer's HMR/browser-API casts, not a license for backend logic).
2. **Per-handler typed bag** — `interface AiManagers { aiManager: AIManager; logger: Logger }` per handler, assembled by `main.ts`. Cleaner inference but triples the surface area (10 handler interfaces + an aggregate) for no runtime change.
3. **Single concrete aggregate bag** — couples handlers; a handler testing in isolation would need to construct the full bag.

## References

- `src/helpers/ipc/index.ts:29,73-78` — bag type + cast helper
- `src/helpers/ipc/index.ts:82-124` — `registerAll` routing
- `main.ts:147-155` — bag assembly point
- `tests/unit/backend-type-safety.test.js` — `any` guard
- `docs/research/ts-migration-audit-and-evolution.md` §2.3 Decision 3 — original audit of this seam

## Note on the preload ↔ d.ts drift detector (Tier 2.3)

`preload.ts` uses `export const preloadApi: ElectronAPI = {...}` so any drift
between the preload runtime literal and `src/electronAPI.d.ts` fails
`pnpm typecheck`. This detector is **unidirectional** — it catches
preload→d.ts divergence but does NOT validate the d.ts internally, because
`tsconfig.json` sets `skipLibCheck: true` (required to suppress the
`noDeprecation` modifier conflict between `@types/node` and `electron.d.ts`).

Three classes of d.ts internal errors are therefore invisible to the
canonical gate: duplicate interface members, missing type imports, and
conflicting return types across merged interface declarations. The d.ts
must be audited manually when modified. A scoped `tsc --skipLibCheck false`
over `src/**/*.d.ts` (excluding `node_modules`) would close this gap but is
deferred — the third-party conflicts it would surface make it a separate
project to enable safely.
