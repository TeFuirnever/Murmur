Instructions for AI agents working. All content in English.

> **Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.
>
> Architecture reference: `docs/`

---

## Scope & Precedence

- This file defines repository constraints only.
- General execution policy, planning, skills, model routing, and completion discipline follow the project's AGENTS.md and rules/ configuration.
- If runtime instructions and this file overlap, preserve the invariants below without reintroducing stale local workflow rules.
- **Priority when rules conflict:** project-specific rules below > general behavioral guidelines.

## Identity & Principles

- Address the user as **【Specialist】** in every response.
- **Think before coding** — if motivation, goal, or constraints are unclear, stop and clarify before acting. If multiple interpretations exist, state the assumption or tradeoff instead of choosing silently.
- **Push back when warranted** — if the proposed path is not the shortest, safest, or most effective, say so and recommend a better approach.
- **Minimum code, maximum clarity** — no features, abstractions, or "flexibility" beyond what was asked. Prefer small, focused functions; extract helpers when a function exceeds 50 lines.

**MUST DO:**

1. Clarify unclear requirements before implementation.
2. For bug fixes: reproduce the issue, add a failing or regression test first, then submit the fix.
3. For non-trivial work, define verifiable success criteria before implementation.
4. After submitting code: state potential risks + test recommendations.
5. User-visible strings should be clear and consistent with existing terminology (e.g., "语音识别" for ASR, "AI 文本优化" for AI processing).

**Core Principles:**

- **Simplicity First** — minimal code impact, simplest possible change.
- **No Laziness** — find root causes, no temporary fixes, senior developer standards.
- **Surgical Changes Only** — every changed line should trace directly to the current task. Don't refactor adjacent code or "improve" formatting unless required.
- **No Speculation** — do not add abstractions, configuration, or future-proofing that the request does not need.
- **Verify Before Claiming Done** — evidence over assumptions.
- **Know When to Stop** — if blocked for more than 2 attempts on the same issue, or if requirements remain ambiguous after clarification, escalate to the user instead of guessing.
- **Trace Before Fix** — when debugging performance issues (especially "entire client is slow"), trace the FULL execution path from user trigger to observable symptom, step by step. Do not propose architectural solutions based on assumptions. The simplest explanation (wrong execution order, missing input validation) should be checked first. See `.omc/skills/electron-perf-stall-patterns.md` for the hard-won lesson.

## Workflow

### Planning & Risk

- Use the active planning workflow for non-trivial tasks, architectural decisions, or work that spans multiple moving parts.
- If new evidence invalidates the current approach, stop and re-plan instead of forcing the original path through.
- Treat these areas as high-risk and apply stronger planning, review, and verification:
  - `main.ts` and `preload.ts` boundaries (Electron IPC bridge)
  - `src/helpers/ipc-contracts.ts` and IPC channel changes
  - `src/helpers/ipc/` handler modules (domain-scoped IPC handlers)
  - `src/helpers/funasrManager.ts` and its sub-modules (Python subprocess lifecycle)
  - `src/helpers/windowManager.ts` (sandbox, CSP, window creation)
  - `src/helpers/database.ts` (safeStorage encryption, schema)
  - packaging/release and electron-builder configuration

### Change Discipline

- Match existing local style and patterns before introducing new structure.
- Do not refactor adjacent code, comments, or formatting unless the current task requires it.
- Remove dead code only when it is made obsolete by the current change. If unrelated cleanup is tempting, mention it separately.
- When your changes create orphans: remove imports/variables/functions that YOUR changes made unused. Don't remove pre-existing dead code unless asked.

### Bug Fixes

1. Reproduce the issue.
2. **Write a failing or regression test FIRST** — never fix then backfill tests. This ensures the test genuinely captures the bug and guards against regressions (TDD for bugs).
3. Implement the minimal fix.
4. Verify tests pass (the new test should flip from red to green).
5. State potential risks + test recommendations.

## Cross-Platform Support

Murmur targets **Windows** and **macOS** (Apple Silicon). Code must work on both platforms. Known platform-specific concerns:

- **Python paths**: macOS uses `python/bin/python3.11` (embedded); Windows uses `python/python.exe` (embedded). The `prepare-embedded-python.js` script supports both platforms via platform-aware getters (`pythonBin`, `sitePackagesPath`, `downloadPlatform`).
- **Process management**: `gracefulShutdown()` uses `taskkill /T /F /PID` on Windows, `proc.kill("SIGKILL")` on Unix — see `src/helpers/funasrServer.ts`.
- **Path validation**: `audioPathValidator.ts` allows all `C:\` drive paths on Windows; UNC paths (`\\server\share`) are rejected early to avoid network timeouts. macOS uses realpath + `/Volumes/` prefix checks.
- **Native modules**: `better-sqlite3` needs the Electron ABI. Beware: `electron-builder install-app-deps` can silently no-op (~0.2s "finished") while pnpm's `onlyBuiltDependencies` allowlist lets better-sqlite3's own install fetch a system-Node-ABI prebuild — the release pipeline therefore forces `npx @electron/rebuild -f -w better-sqlite3` and gates packaging on a real DB open under Electron. Locally: `pnpm rebuild better-sqlite3` before tests, `npx electron-rebuild` before dev.
- **CI build**: `.github/workflows/build.yml` runs `build-win` on `windows-latest` and `build-mac` on `macos-latest` (embedded Python is `continue-on-error` on Windows). Releases are tag-triggered (`v*`) and must pass the four release gates — native ABI, preload presence, mac/win packaged boot smoke — documented in `CONTRIBUTING.md` → Release Gates. The NSIS installer is named `Murmur Setup <version>.exe` (spaces, not dots).

When adding platform-specific code, use `process.platform === "win32"` checks. Add tests with `it.skipIf(process.platform === "win32")` for Unix-only behavior.

### Subagents & Lessons

- Use subagents when they materially improve correctness, speed, or parallelism on bounded work.
- Update `tasks/lessons.md` only when the work exposes a reusable policy, recurring failure mode, or repeatable workflow correction.

## Code Rules

### JavaScript / React

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
5. No adding settings without touching **all 4** places: `SettingsState` + `DEFAULT_SETTINGS` + `loadSettings` builder + `saveSettings` body in `useSettings.ts`, AND the key in `ALLOWED_SETTING_KEYS` (`settingsHandlers.ts`). Missing any one silently breaks persistence.
6. <!-- [20260816_Refactor_RemoveEffects] Rule removed with the visual-effects feature: ogl/motion no longer exist in the dependency tree. -->

## Verification

### Delivery Gates

- **All commits MUST pass `pnpm ci:check` before push.** This mirrors CI and runs: format check, lint, license check, typecheck, typecheck:tests, test with coverage, build:main, build:preload, build:renderer, dev smoke (pnpm run dev boots and the vite dev server answers).
- **Quick check:** `pnpm lint` + `pnpm test` for rapid iteration during development.
- **Bug fix:** reproduce the bug, add a failing test **first**, then fix and verify; no implementation-only fixes, no fix-then-backfill tests.
- **High-risk** (session flow, IPC, security, privacy, release packaging): include a risk statement and fresh verification evidence.
- **Gate failure:** run `/ci-gate` or `node scripts/ci-check.js --json` to diagnose; use `--fix` for auto-fixable issues.

### Commit Guidance

- Prefer conventional prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, and `ci:` when repo history or tooling expects them.
- If the active environment requires the Lore commit protocol, treat the why-first intent line plus trailers as the authoritative format.

## Documentation

- `README.md` — project overview, install, build, tech stack, structure
- `CHANGELOG.md` — versioned change log
- `CONTRIBUTING.md` — dev setup, code style, PR process, architecture overview
- `SECURITY.md` — security policy and measures
- `docs/faq.md` — user FAQ (bilingual)
- `docs/troubleshooting.md` — troubleshooting guide (bilingual)
- `docs/follow-ups.md` — tracked technical debt and deferred items
- `VISION.md` — project acceptance policy: what aligns and what gets resisted

## Reference

- Project overview & tech stack → `README.md`
- Architecture & data flow → `CONTRIBUTING.md` (架构概览 section)
- IPC contracts → `src/helpers/ipc-contracts.ts` (single source of truth, `as const` channels)
- AI prompt templates → `src/helpers/aiPrompts.ts`
- Security measures → `SECURITY.md`
- Vision & positioning → `VISION.md` (acceptance policy), `docs/vision-answers.md` (review verdicts), `docs/competitive-positioning.md` (streaming go/no-go gates)
- CI gate check → `scripts/ci-check.js` and `/ci-gate` skill

#

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues. Use the `gh-axi` CLI for all operations (agent-ergonomic `gh` wrapper, same auth, lower token cost). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Domain context: see `docs/agents/domain.md`.

### Agent tooling

- **Push gate**: prefer `git push no-mistakes <branch>` for non-trivial deliveries - the local pipeline (AI review, tests, docs, lint) must be green before the branch reaches `origin`. Usage guide: `docs/agents/no-mistakes-gate.md`.
- `backlog.md` is the shared task ledger for all agent sessions and worktrees. Use `tasks-axi` (`add` / `start` / `done` / `block` / `ready`) for all task state — never hand-edit task lines in the ledger.
- Browser automation: use `chrome-devtools-axi` (`open`, `snapshot`, `click @uid`, `eval`) instead of screenshot-and-guess.

## GBrain Configuration (configured by /setup-gbrain)

- Mode: local-stdio
- Engine: pglite
- Embedding model: ollama:nomic-embed-text (768d, local Ollama at localhost:11434) — verified 2026-07-28; bge-m3 no longer in local ollama list
- Config file: ~/.gbrain/config.json (mode 0600)
- Setup date: 2026-05-21 (embedding reconfigured 2026-06-15)
- MCP registered: yes (user scope)
- Artifacts sync: off
- Current repo policy: read-write
- Note: ollama recipe patched at ~/gbrain/src/core/ai/recipes/ollama.ts (added bge-m3 + dims_options); re-apply after gbrain upgrade

## GBrain Search Guidance (configured by /sync-gbrain)

<!-- gstack-gbrain-search-guidance:start -->

GBrain is set up and synced on this machine. The agent should prefer gbrain
over Grep when the question is semantic or when you don't know the exact
identifier yet. Two indexed corpora available via the `gbrain` CLI:

- This repo's code (registered as `gstack-code-<repo>` source).
- `~/.gstack/` curated memory (registered as `gstack-brain-<user>` source via
  the existing federation pipeline).

Prefer gbrain when:

- "Where is X handled?" / semantic intent, no exact string yet:
  `gbrain search "<terms>"` or `gbrain query "<question>"`
- "Where is symbol Y defined?" / symbol-based code questions:
  `gbrain code-def <symbol>` or `gbrain code-refs <symbol>`
- "What calls Y?" / "What does Y depend on?":
  `gbrain code-callers <symbol>` / `gbrain code-callees <symbol>`
- "What did we decide last time?" / past plans, retros, learnings:
  `gbrain search "<terms>" --source gstack-brain-<user>`

Grep is still right for known exact strings, regex, multiline patterns, and
file globs. The brain auto-syncs incrementally on every gstack skill start.
Run `/sync-gbrain` to force-refresh, `/sync-gbrain --full` for full reindex.

<!-- gstack-gbrain-search-guidance:end -->

## Skill routing

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
