# ADR 008: Enable TypeScript strict mode

## Status: Accepted

## Context

The codebase had `strict: false` in tsconfig.json, allowing null/undefined values to pass through unchecked. This caused runtime errors in:

- `catch (err)` blocks where `err.message` was accessed without type narrowing
- `useState(null)` inferred as `never`, preventing property access
- Optional IPC result fields accessed without null checks

## Decision

Enable `strict: true` in tsconfig.json, fixing all resulting type errors:

- Type catch variables as `Error` via `(err as Error).message`
- Type useState with proper union types (e.g., `UpdateCheckResult | null`)
- Add non-null assertions (`!`) after runtime guards
- Widen callback ref types to match hook interfaces

## Consequences

- Compile-time detection of null/undefined access bugs
- Better IDE autocomplete and inline documentation
- All 503 tests pass, lint clean, build clean
