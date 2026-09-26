<!-- Generated: 2026-04-13 | Updated: 2026-09-26 (merged with former CLAUDE.md content; CLAUDE.md removed — all tools read this file) -->

# AGENTS.md

Instructions for AI agents working on Murmur. All content in English.

This file is the **single source of truth** for all agent instructions. Claude Code (v2.1.277+) falls back to it when no `CLAUDE.md` exists; other agent tools (Codex, Cursor, …) read it directly.

> **Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.
>
> Architecture reference: `docs/`

---

## Identity & Principles

### Think Before Coding

Address the user as **【Specialist】** in every response.

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

### Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked; no abstractions for single-use code.
- No "flexibility", "configurability", or future-proofing that wasn't requested.
- No error handling for impossible scenarios.
- Prefer small, focused functions; extract helpers when a function exceeds 50 lines.

### Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting; match existing style.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that YOUR changes made unused; don't remove pre-existing dead code unless asked.
- Every changed line should trace directly to the user's request.

### Goal-Driven Execution

**Define success criteria. Loop until verified.**

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- For multi-step tasks, state a brief plan: each step with its verify check.

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### Core Principles

- **No Laziness** — find root causes, no temporary fixes, senior developer standards.
- **Verify Before Claiming Done** — evidence over assumptions. Don't assert repo state or past-run results from memory — confirm with a tool call.
- **Trace Before Fix** — when debugging, trace the FULL execution path from trigger to symptom; check the simplest explanation first. For performance issues, do this before proposing architectural solutions — see `.omc/skills/electron-perf-stall-patterns.md`.
- **Know When to Stop** — if blocked for more than 2 attempts, or requirements remain ambiguous after clarification, escalate instead of guessing.

## MUST DO

1. Clarify unclear requirements before implementation.
2. **Feature development: default to TDD.** Red-Green-Refactor for all non-trivial features: failing test → minimal code to pass → refactor under test coverage. No feature is complete without tests.
3. **Bug fixes: test first, then fix.** Write a regression test that reproduces the bug and fails. Confirm the failure. Fix the code. Verify the test passes. No bug fix without a regression test. **Type declaration fixes:** when modifying `.d.ts` or shared type schemas, write a type-contract test first.
4. For non-trivial work, define verifiable success criteria before implementation.
5. After submitting code: state potential risks + test recommendations.
6. All user-visible text MUST go through i18n (`src/i18n/locales/`); no hardcoded UI strings.
7. User-visible strings should be clear and consistent with existing terminology (e.g., "语音识别" for ASR, "AI 文本优化" for AI processing).

## Workflow

### Planning & Risk

- Use active planning for non-trivial tasks, architectural decisions, or work spanning multiple areas.
- If new evidence invalidates the current approach, stop and re-plan.
- **High-risk areas** — apply stronger planning, review, and verification:
  - `main.ts` and `preload.ts` boundaries (Electron IPC bridge)
  - IPC surfaces: `src/helpers/ipc-contracts.ts`, `src/helpers/ipc/` handler modules, and registration in `src/helpers/ipc/index.ts`
  - `src/helpers/funasrManager.ts` and sub-modules (Python subprocess lifecycle), `src/helpers/funasrServer.ts` (platform-specific process kill)
  - `src/helpers/windowManager.ts` (sandbox, CSP, window creation), `src/helpers/database.ts` (safeStorage encryption, schema), `src/helpers/audioPathValidator.ts` (cross-platform path validation)
  - `src/bot/` (vendored bloub animation engine, spec #224: numeric constants are frame-by-frame video measurements — never round or "fix" them; the eye-fit table is build-time only, never re-solve per frame; see `docs/bot/measurements.md`)
  - Packaging/release and electron-builder configuration
  - User-visible text and i18n resources

### Subagents & Lessons

- Use subagents when they materially improve correctness, speed, or parallelism on bounded work.
- Update `tasks/lessons.md` only when the work exposes a reusable policy, recurring failure mode, or repeatable workflow correction.

## Cross-Platform Support

Murmur targets **Windows** and **macOS** (Apple Silicon). Code must work on both platforms.

- **Platform checks**: `process.platform === "win32"` (not `os.platform()` or feature detection) — in the **main process and plain-Node code only**. Sandboxed renderer pages have no `process` global; a bare `process.platform` in renderer code survives the bundle and throws at render time (jsdom tests cannot catch it — Node provides `process`). Gate renderer UI on the preload bridge's `window.electronAPI.getPlatform()` instead. Add tests with `it.skipIf(process.platform === "win32")` for Unix-only behavior.
- **Python paths**: macOS uses `python/bin/python3.11` (embedded); Windows uses `python/python.exe` (embedded). `prepare-embedded-python.js` supports both via platform-aware getters.
- **Process management**: `gracefulShutdown()` uses `taskkill /T /F /PID` on Windows, `proc.kill("SIGKILL")` on Unix — see `src/helpers/funasrServer.ts`.
- **Path validation**: `audioPathValidator.ts` allows all `C:\` drive paths on Windows; UNC paths are rejected early. macOS uses realpath + `/Volumes/` prefix checks.
- **Storage engine** (spec #226): SQLite is `node:sqlite` (`DatabaseSync`, Node ≥22.5 / Electron 39) — no native addon, no ABI flip between `pnpm test` and `pnpm dev`. If a native addon is ever reintroduced, the forced-rebuild + packaged-DB-open gates must come back with it (see build.yml's sqlite packaging gate).
- **CI build**: `build.yml` runs on `windows-latest` and `macos-latest` with a hard, cache-backed embedded-Python import gate (the old Windows `continue-on-error` shipped v1.2.0–v1.3.2 installers without Python while builds stayed green). Releases are tag-triggered and must pass the five release gates — see `CONTRIBUTING.md` → Release Gates. The NSIS installer is `Murmur Setup <version>.exe`.

## Code Rules

### JavaScript / TypeScript / React

- No `any`, `as any`, `@ts-ignore`, `@ts-expect-error`.
- Prefer type inference; add explicit annotations when intent is unclear.
- No empty `catch` — log, rethrow, or handle errors intentionally.
- Error handling: always handle real error paths (main process, IPC, network); skip defensive code only for states that truly cannot occur.
- Use existing IPC contract constants from `src/helpers/ipc-contracts.ts` — zero hardcoded channel strings.
- ESLint with 0 warnings, 0 errors.

### Prohibited

1. No modifying FunASR Python subprocess lifecycle without test coverage.
2. No silent error swallowing in main process.
3. No hardcoded IPC channel strings — use `ipc-contracts.ts` constants.
4. No new IPC handler files without registering in `src/helpers/ipc/index.ts`.
5. No adding settings except by declaring them **once** in the schema: `src/settings/settingsSchema.ts` (key, type, default, load coercion, scope, `fileSync`/`textLike` traits). [20260926_Refactor_403_SettingsSchema] `SettingsState`, `DEFAULT_SETTINGS`, the load builder, `ALLOWED_SETTING_KEYS`, `FILE_CONFIGURABLE_KEYS` and `TEXT_INPUT_SETTING_KEYS` are all derived from the schema — a key declared anywhere else (useSettings.ts, settingsHandlers.ts, fileConfig.ts) silently breaks persistence. `tests/unit/settings-schema.test.ts` pins the migration equivalence and the one-entry acceptance.
6. <!-- [20260816_Refactor_RemoveEffects] Rule removed with the visual-effects feature: ogl/motion no longer exist in the dependency tree. -->

## Verification

### Delivery Gates

- **All commits MUST pass `pnpm ci:check` before push.** This mirrors CI and runs: format check, lint, debt-marker check, license check, typecheck, typecheck:tests, test with coverage, build:main, build:preload, build:renderer, dev smoke.
- **Quick check:** `pnpm lint` + `pnpm test` for rapid iteration during development.
- **High-risk** (session flow, IPC, security, privacy, release packaging): include a risk statement and fresh verification evidence.
- **Gate failure:** run `/ci-gate` or `node scripts/ci-check.js --json` to diagnose; use `--fix` for auto-fixable issues.
- **Releases:** push a `v*` tag → `build.yml` builds installers behind five release gates. Never bypass or downgrade these gates — every release before v1.3.2 shipped broken while CI stayed green. See `CONTRIBUTING.md` → Release Gates.

### Commit Guidance

- Prefer conventional prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, and `ci:` when repo history or tooling expects them.
- If the active environment requires the Lore commit protocol, treat the why-first intent line plus trailers as the authoritative format.

## Change Annotation Rules

- **Comments must be written in English.**
- **Do not modify original code unless the change requires it.** No reformatting, renaming, or comment changes on code unrelated to the current task.
- **Isolate new code blocks with tag comments.** Each independent change gets its own tag, format `YYYYMMDD_Type_Summary` (e.g., `20260602_Fix_MaximizeToggle`), wrapped header and footer:

  ```js
  // [20260602_Fix_MaximizeToggle] Description of root cause, purpose, or fix rationale
  ... new code ...
  // [20260602_Fix_MaximizeToggle] END
  ```

  The tag comment must explain root cause or rationale so future readers don't need git history. New files: file header comment with tag and purpose.

- **Add inline comments for substantial new code** — intent and context, especially for platform-specific workarounds or non-obvious logic.
- **No magic numbers.** Hard-coded values must be extracted into named constants at an appropriate scope.
- **Variable naming** follows the project's casing (camelCase / PascalCase / UPPER_SNAKE_CASE) and conveys intent. No meaningless abbreviations or single-letter variables (loop counters excepted).

## Docs & Reference

- Project overview & tech stack → `README.md`; versioned change log → `CHANGELOG.md`
- Dev setup, code style, PR process, architecture → `CONTRIBUTING.md` (架构概览 section)
- Security policy & measures → `SECURITY.md`
- User FAQ → `docs/faq.md`; troubleshooting → `docs/troubleshooting.md` (both bilingual)
- Tracked technical debt → `docs/follow-ups.md`
- Vision & acceptance policy → `VISION.md`, review verdicts → `docs/vision-answers.md`, streaming go/no-go gates → `docs/competitive-positioning.md`
- IPC contracts → `src/helpers/ipc-contracts.ts`; AI prompt templates → `src/helpers/aiPrompts.ts`
- CI gate check → `scripts/ci-check.js` and `/ci-gate` skill

## Agent Tooling

### Issue tracker

Issues and PRDs live as GitHub issues. Use the `gh-axi` CLI for all operations (agent-ergonomic `gh` wrapper, same auth, lower token cost). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Domain context: see `docs/agents/domain.md`.

### Shared task ledger

`backlog.md` is the shared task ledger for all agent sessions and worktrees. Use `tasks-axi` (`add` / `start` / `done` / `block` / `ready`) for all task state — never hand-edit task lines in the ledger.

### Push gate

Prefer `git push no-mistakes <branch>` for non-trivial deliveries — the local pipeline (AI review, tests, docs, lint) must be green before the branch reaches `origin`. Usage guide: `docs/agents/no-mistakes-gate.md`.

### Browser automation

Use `chrome-devtools-axi` (`open`, `snapshot`, `click @uid`, `eval`) instead of screenshot-and-guess.

### Operational Lessons (evidence-backed)

Rules distilled from real session failures (`.backpass/gap-ledger.json`):

- **Credentials never in command text or logs.** Pass secrets through protected stdin or a secret-store API — never embed literal values in shell command text (exposes them to command history and transcripts). [high recurrence]
- **Report installed tooling precisely.** State separately: which clients discover it, whether the executable is on PATH, and where credentials persist. Don't conflate into an unconditional "available" claim.
- **Codebase-memory re-index hygiene.** When re-indexing, reuse or delete the existing project for the same path instead of leaving a stale duplicate; record the canonical project name for later sessions.
- **Flag wildcard permission rules.** When editing `.claude/settings.local.json`, surface existing allow rules whose wildcards make approval unconditional (e.g. `Bash(grep *)`) for user review instead of citing them as coverage.

## Claude Code Skill Routing (Claude Code only)

Other agent tools: ignore this section.

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:

- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
