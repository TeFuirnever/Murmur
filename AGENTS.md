<!-- Generated: 2026-04-13 | Updated: 2026-05-23 -->

# AGENTS.md

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
  - `main.js` and `preload.js` boundaries (Electron IPC bridge)
  - `src/helpers/ipc-contracts.js` and IPC channel changes
  - `src/helpers/ipc/` handler modules (domain-scoped IPC handlers)
  - `src/helpers/funasrManager.js` and its sub-modules (Python subprocess lifecycle)
  - `src/helpers/windowManager.js` (sandbox, CSP, window creation)
  - `src/helpers/database.js` (safeStorage encryption, schema)
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

### Subagents & Lessons

- Use subagents when they materially improve correctness, speed, or parallelism on bounded work.
- Update `tasks/lessons.md` only when the work exposes a reusable policy, recurring failure mode, or repeatable workflow correction.

## Code Rules

### JavaScript / React

- No empty `catch` — log, rethrow, or handle errors intentionally.
- Error handling: always handle real error paths (main process, IPC, network); skip defensive code only for states that truly cannot occur.
- No magic numbers or hardcoded config.
- Use existing IPC contract constants from `src/helpers/ipc-contracts.js` — zero hardcoded channel strings.
- ESLint with 0 warnings, 0 errors.

### Prohibited

1. No modifying FunASR Python subprocess lifecycle without test coverage.
2. No silent error swallowing in main process.
3. No hardcoded IPC channel strings — use `ipc-contracts.js` constants.
4. No new IPC handler files without registering in `src/helpers/ipc/index.js`.

## Verification

### Delivery Gates

- **Build gate:** `pnpm lint` + `pnpm test` MUST both pass before any commit is considered ready for merge.
- **Basic:** `pnpm lint` + `pnpm test`
- **Bug fix:** reproduce the bug, add a failing test **first**, then fix and verify; no implementation-only fixes, no fix-then-backfill tests.
- **High-risk** (session flow, IPC, security, privacy, release packaging): include a risk statement and fresh verification evidence.

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

## Reference

- Project overview & tech stack → `README.md`
- Architecture & data flow → `CONTRIBUTING.md` (架构概览 section)
- IPC contracts → `src/helpers/ipc-contracts.js`
- AI prompt templates → `src/helpers/aiPrompts.js`
- Security measures → `SECURITY.md`

# 

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues. Use the `gh` CLI for all operations. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at root + `docs/adr/`. See `docs/agents/domain.md`.

## GBrain Configuration (configured by /setup-gbrain)
- Mode: local-stdio
- Engine: pglite
- Config file: ~/.gbrain/config.json (mode 0600)
- Setup date: 2026-05-21
- MCP registered: yes (user scope)
- Artifacts sync: off
- Current repo policy: read-write

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
