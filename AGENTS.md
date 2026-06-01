<!-- Generated: 2026-04-13 | Updated: 2026-05-30 -->

# AGENTS.md

Instructions for AI agent. All content in English.

> **Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.
>
> Architecture reference: `docs/`

---

## Identity & Principles

### Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### Core Principles

- **Verify Before Claiming Done** — evidence over assumptions.
- **Trace Before Fix** — when debugging performance issues (especially "entire client is slow"), trace the FULL execution path from user trigger to observable symptom, step by step. Do not propose architectural solutions based on assumptions. Check the simplest explanation first. Lesson from PR#599.
- **Know When to Stop** — if blocked for more than 2 attempts, or requirements remain ambiguous after clarification, escalate instead of guessing.

## MUST DO

1. Clarify unclear requirements before implementation (see _Think Before Coding_ above).
2. **Feature development: default to TDD.** Red-Green-Refactor for all non-trivial features: failing test → minimal code to pass → refactor under test coverage. No feature is complete without tests.
3. **Bug fixes: test first, then fix.** Write a regression test that reproduces the bug and fails. Confirm the failure. Fix the code. Verify the test passes. No bug fix without a regression test.
4. For non-trivial work, define verifiable success criteria before implementation (see _Goal-Driven Execution_ above).
5. After submitting code: state potential risks + test recommendations.
6. All user-visible text MUST go through i18n; no hardcoded strings (see _i18n_ section for details).

## Workflow

### Planning & Risk

- Use active planning for non-trivial tasks, architectural decisions, or work spanning multiple areas.
- If new evidence invalidates the current approach, stop and re-plan.
- **High-risk areas** — apply stronger planning, review, and verification:
  - `electron/main/` and preload boundaries
  - `packages/ipc-contracts/` and IPC channel changes
  - `packages/gateway/`, `packages/bastion/`, and MCP/security flows
  - Session flow, auth, privacy, and packaging/release behavior
  - User-visible text and i18n resources

### Bug Fixes

1. Reproduce the issue, then follow MUST DO #3 (test-first workflow).
2. State potential risks + test recommendations (MUST DO #5).
3. **DTS / declaration fixes:** when modifying `.d.ts` or shared type schemas, write a type-contract test (schema validation, runtime parse, or compile-time assertion) first. Confirm it fails with the current broken declaration, fix, then verify the test passes.

## Code Rules

### TypeScript

- No `any`, `as any`, `@ts-ignore`, `@ts-expect-error`.
- Prefer type inference; add explicit annotations when intent is unclear.
- No empty `catch` — log, rethrow, or handle errors intentionally.
- Error handling: always handle real error paths (main process, IPC, network); skip defensive code only for states that truly cannot occur.
- No magic numbers or hardcoded config.

## Verification

### Delivery Gates

- **Build gate:** `./build.sh` MUST pass (exit code 0) before any commit is considered ready for merge. This is the single source of truth for project health — it runs lint, typecheck, tests, and packaging in one shot.
- **Basic:** `pnpm lint` + `pnpm typecheck` + `pnpm test` + `pnpm test:i18n`
- **Bug fix:** follow MUST DO #3 (test-first workflow).
- **High-risk** (session flow, IPC, security, privacy, release packaging): include a risk statement and fresh verification evidence.

### Commit Format

- Prefer conventional prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.

## Change Annotation Rules

Rules for how code changes are structured, documented, and annotated in the codebase.

- **Comments must be written in English.** All comments, annotations, and descriptions use English.

- **Do not modify original code unless the change requires it.** No reformatting, renaming, or comment changes on code unrelated to the current task.

- **Isolate new code blocks with tag comments.** Every insertion of new code must be wrapped with a tag header and footer:

  ```js
  // [Tag_Name] Description of what this change does and why
  ... new code ...
  // [Tag_Name] END
  ```

- **Each independent change must have its own tag.** Format: `YYYYMMDD_Type_Summary` (e.g., `20260602_Fix_MaximizeToggle`). Each tag corresponds to one logically distinct change.

- **Each tag must include a description.** The tag comment must explain the root cause, purpose, or fix rationale so that future readers can understand the change without checking git history.

- **Add inline comments for substantial new code.** When adding more than a few lines, include comments at key positions explaining intent and context — especially for platform-specific workarounds or non-obvious logic.

- **New files must have a file header comment with tag and purpose.** Example:

  ```js
  // [20260602_Fix_MaximizeToggle] This file extracts shared validation
  // logic previously duplicated across multiple handlers.
  ```

- **No magic numbers.** All hard-coded values (numbers, strings, thresholds) must be extracted into named constants placed at an appropriate scope.

- **Variable naming must follow consistent conventions and convey meaning.** Use the project's established casing (camelCase / PascalCase / UPPER_SNAKE_CASE). Names must express clear intent. No meaningless abbreviations, single-letter variables (loop counters excepted), or arbitrary naming.
