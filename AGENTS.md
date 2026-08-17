<!-- Generated: 2026-04-13 | Updated: 2026-08-02 -->

# AGENTS.md

Instructions for AI agents working on Murmur. All content in English.

> **Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.
>
> Architecture reference: `docs/`
> Project-specific constraints: `CLAUDE.md`

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
- If you write 200 lines and it could be 50, rewrite.

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
- **Trace Before Fix** — when debugging, trace the FULL execution path from trigger to symptom. Check the simplest explanation first.
- **Know When to Stop** — if blocked for more than 2 attempts, or requirements remain ambiguous after clarification, escalate instead of guessing.

## MUST DO

1. Clarify unclear requirements before implementation (see _Think Before Coding_ above).
2. **Feature development: default to TDD.** Red-Green-Refactor for all non-trivial features: failing test → minimal code to pass → refactor under test coverage. No feature is complete without tests.
3. **Bug fixes: test first, then fix.** Write a regression test that reproduces the bug and fails. Confirm the failure. Fix the code. Verify the test passes. No bug fix without a regression test.
4. For non-trivial work, define verifiable success criteria before implementation (see _Goal-Driven Execution_ above).
5. After submitting code: state potential risks + test recommendations.
6. All user-visible text MUST go through i18n (`src/i18n/locales/`); no hardcoded UI strings.

## Workflow

### Planning & Risk

- Use active planning for non-trivial tasks, architectural decisions, or work spanning multiple areas.
- If new evidence invalidates the current approach, stop and re-plan.
- **High-risk areas** — apply stronger planning, review, and verification:
  - `main.ts` and `preload.ts` boundaries (Electron IPC bridge)
  - `src/helpers/ipc-contracts.ts` and IPC channel changes
  - `src/helpers/ipc/` handler modules (domain-scoped IPC handlers)
  - `src/helpers/funasrManager.ts` and sub-modules (Python subprocess lifecycle)
  - `src/helpers/funasrServer.ts` (platform-specific process kill: `taskkill` vs `SIGKILL`)
  - `src/helpers/windowManager.ts` (sandbox, CSP, window creation)
  - `src/helpers/database.ts` (safeStorage encryption, schema)
  - `src/helpers/audioPathValidator.ts` (cross-platform path validation)
  - Packaging/release and electron-builder configuration
  - User-visible text and i18n resources

### Cross-Platform Awareness

Murmur targets **Windows** and **macOS**. See `CLAUDE.md` → _Cross-Platform Support_ for the full list of platform-specific concerns. Key rules:

- Use `process.platform === "win32"` for platform checks, not `os.platform()` or feature detection.
- Windows paths use backslashes; UNC paths (`\\server\share`) are rejected by `audioPathValidator`.
- Native modules (`better-sqlite3`) need Electron ABI. Hazard: `electron-builder install-app-deps` can silently no-op while pnpm's build allowlist fetches a system-Node-ABI prebuild — release CI forces `@electron/rebuild -f` and gates packaging on a real DB open under Electron (details in `CLAUDE.md` → Cross-Platform Support).
- Embedded Python (`prepare-embedded-python.js`) supports both macOS (`-apple-darwin`) and Windows (`-pc-windows-msvc-shared`) downloads.
- Add `it.skipIf(process.platform === "win32")` for Unix-only test behavior.

### Bug Fixes

1. Reproduce the issue, then follow MUST DO #3 (test-first workflow).
2. State potential risks + test recommendations (MUST DO #5).
3. **Type declaration fixes:** when modifying `.d.ts` or shared type schemas, write a type-contract test first. Confirm it fails with the current broken declaration, fix, then verify the test passes.

## Code Rules

### JavaScript / TypeScript / React

- No `any`, `as any`, `@ts-ignore`, `@ts-expect-error`.
- Prefer type inference; add explicit annotations when intent is unclear.
- No empty `catch` — log, rethrow, or handle errors intentionally.
- Error handling: always handle real error paths (main process, IPC, network); skip defensive code only for states that truly cannot occur.
- No magic numbers or hardcoded config.
- Use existing IPC contract constants from `src/helpers/ipc-contracts.ts` — zero hardcoded channel strings.
- ESLint with 0 warnings, 0 errors.

### Prohibited

1. No modifying FunASR Python subprocess lifecycle without test coverage.
2. No silent error swallowing in main process.
3. No hardcoded IPC channel strings — use `ipc-contracts.ts` constants.
4. No new IPC handler files without registering in `src/helpers/ipc/index.ts`.
5. No adding settings without touching **all 4** places: `SettingsState` + `DEFAULT_SETTINGS` + `loadSettings` builder + `saveSettings` body in `useSettings.ts`, AND the key in `ALLOWED_SETTING_KEYS` (`settingsHandlers.ts`).
6. <!-- [20260816_Refactor_RemoveEffects] Rule removed with the visual-effects feature: ogl/motion no longer exist in the dependency tree. -->

## Verification

### Delivery Gates

- **All commits MUST pass `pnpm ci:check` before push.** This runs: format check, lint, license check, typecheck, typecheck:tests, test with coverage, build:main, build:preload, build:renderer, dev smoke (`pnpm run dev` boots and the vite dev server answers).
- **Quick check:** `pnpm lint` + `pnpm test` for rapid iteration during development.
- **Bug fix:** reproduce the bug, add a failing test **first**, then fix and verify.
- **High-risk** (session flow, IPC, security, privacy, release packaging): include a risk statement and fresh verification evidence.
- **Gate failure:** run `node scripts/ci-check.js --json` to diagnose; use `--fix` for auto-fixable issues.
- **Releases:** push a `v*` tag → `build.yml` builds installers behind four release gates (native ABI, preload presence, mac/win packaged boot smoke). Never bypass or downgrade these gates — every release before v1.3.2 shipped broken while CI stayed green. See `CONTRIBUTING.md` → Release Gates.

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
