# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `postinstall` 用系统 Node 重编 better-sqlite3 导致 ABI 不匹配(`NODE_MODULE_VERSION 137` vs Electron 36 需要的 `135`),`pnpm run dev` 加载原生模块即崩且错误被 `concurrently` 吞掉、终端无输出。删除有害的 `pnpm rebuild better-sqlite3`,改由 `electron-builder install-app-deps` 统一用 Electron ABI 编译。

## [1.0.3] - 2026-07-27

### Added

- [20260725_Autopilot_T1.4] Backend TypeScript migration (ADR-010, big-bang completed 2026-07-24): all 39 backend `.js` files atomically migrated to `.ts`. ESM `import` source, esbuild bundles to `dist-main/main.js` + `dist-preload/preload.js` (CJS for Electron sandbox). `__dirname` → `app.getAppPath()` (13 sites).
- E2E boot health smoke gate (7 tests covering Phase A-E of boot sequence) per `docs/research/e2e-functional-verification-strategy.md` §4.1
- E2E launch diagnosis instrumentation (env dump, bundle check, stderr/stdout listeners)
- Module identity regression test guard (prevents future cache-leak risk from `vi.resetModules` removal)
- Dependabot remediation plan (`docs/research/dependabot-remediation-plan.md`, 30 alerts triaged)
- TypeScript migration tech debt audit (`docs/research/ts-migration-tech-debt-audit.md`, 7 dimensions)
- ADR-013: ManagersBag cast seam documentation
- ADR-014: e2e CI macOS Electron launch investigation (8 CI iterations, root cause isolated to runtime not install)
- AI prompt few-shot examples for platform modes (xiaohongshu, zhihu, douyin, dianping) — ADR-012 Issue #4c resolved
- Promotion content: community post templates and video scripts
- Promotion infographics: competitor comparison matrix and bento-grid features overview
- Windows `bindings` runtime dependency fix (credit: @Deeeemooo, PR #50)
- ASR benchmark scripts comparing Paraformer-large vs SenseVoice vs Fun-ASR-Nano

### Changed

- **Complete test migration to TypeScript**: 54 unit test files + 13 e2e suites + 4 e2e helpers all migrated from `.js` to `.ts` (100% TypeScript tests)
- **Deleted `_tsresolve.setup.js`**: 118-line Node module monkey-patch removed; all 96 `require()` calls converted to ESM `import` across test files
- **Typecheck gate strengthened**: `tsconfig.test.json` now has ZERO per-file exclusions (was 7); all 64 strict-mode errors in previously-excluded files fixed
- **`no-require-imports` lint rule** re-enabled for `tests/unit/**` (Tier 3.3)
- **Root config files migrated**: `vitest.config.js` → `.ts`, `postcss.config.js` → `.ts`, `playwright.config.js` → `.ts`
- **database.ts typed Row helpers**: `getRow<T>()` + `getCount()` eliminate 7 structural casts for better-sqlite3 queries
- Settings page refactored: 1195-line monolith split into 7 focused modules with full i18n coverage (154 keys, zero hardcoded Chinese)
- Dynamic transcription timeout based on file size (replaces hardcoded 5-minute limit)
- OpenRouter provider preset added with free-tier models
- `ProviderPreset` type unified: `type ProviderPreset = AIProviderPreset`
- Preload bridge: `export const preloadApi: ElectronAPI` drift detector + `makeListener<T>()` helper (10 listeners refactored)
- `electronAPI.d.ts`: `any` → `unknown` at 2 sites; `OperationResult`, `ProcessingUpdateData`, `FileTranscriptionProgressData` type extracts

### Fixed

- CRITICAL: `auto_paste` option value mismatch (`'clipboard'` → `'clipboard_only'`) causing wrong paste behavior
- Security: `tar` bumped from `^7.4.3` to `^7.5.19` (resolves 1 critical + 2 medium CVE)
- Restored lost functionality: `cancelUpdateDownload` button, `testResult.usage` display, live `setAlwaysOnTop` side-effect, `localStorage` language persistence
- Removed 21 dead TS re-export stubs that provided zero type safety
- `main.ts`: `startApp()` now properly awaited in `whenReady` callback; `app.dock.show()` guarded on CI
- Removed 3 dead legacy e2e test files (`tests/e2e/legacy/`)
- Swept stale `.js` references across 8+ docs/ADRs to reflect `.ts` migration
- AI prompt few-shot examples for platform modes (xiaohongshu, zhihu, douyin, dianping) — ADR-012 Issue #4c resolved
- Promotion content: community post templates (即刻/V2EX/少数派) and video scripts (B站/抖音)
- Promotion infographics: competitor comparison matrix and bento-grid features overview (HTML+Playwright)
- Windows `bindings` runtime dependency fix (credit: @Deeeemooo, PR #50)
- ASR benchmark scripts comparing Paraformer-large vs SenseVoice vs Fun-ASR-Nano

### Changed

- Settings page refactored: 1195-line monolith split into 7 focused modules with full i18n coverage (154 keys, zero hardcoded Chinese)
- Dynamic transcription timeout based on file size (replaces hardcoded 5-minute limit) — ADR-012 Issue #1 resolved
- OpenRouter provider preset added with free-tier models
- esbuild `--resolve-extensions=.js,.ts` to handle dual .ts/.js backend files during bundling (no longer needed post-big-bang; kept defensively)
- Provider registration guide text moved from providerPresets.js to i18n locale files
- `ProviderPreset` type unified: `type ProviderPreset = AIProviderPreset` (single source of truth in types/ipc.ts)

### Fixed

- CRITICAL: `auto_paste` option value mismatch (`'clipboard'` → `'clipboard_only'`) causing wrong paste behavior
- Restored lost functionality: `cancelUpdateDownload` button, `testResult.usage` display, live `setAlwaysOnTop` side-effect, `localStorage` language persistence
- Removed 21 dead TS re-export stubs that provided zero type safety (code review finding)

## [1.0.2] - 2026-06-07

### Added

- E2E test infrastructure: Playwright Electron with IPC-level mocking, 11 test suites (35 tests) covering FTUE, lifecycle, recording, hotkeys, file import, clipboard, settings, history, window management, and error resilience
- Model download guard unit tests (13 cases) covering missing models, Windows Chinese path validation, and audio format guards
- `MURMUR_DB_PATH` env var for in-memory test isolation (`database.js`)
- `data-testid` attributes on mic button, file drop zone, and transcription result for E2E selectors
- `PYTHONUTF8=1` in Python subprocess environment to prevent encoding corruption on Windows Chinese locales

### Changed

- Extracted `validateAudioPath()` from `transcriptionHandlers.js` into `src/helpers/audioPathValidator.js` for testability
- Rewrote `tests/e2e/helpers/ipc-mock.js` to properly wrap `electronApp.evaluate()` with serializable responses
- Replaced all `waitForTimeout()` with `expect.poll()` in E2E suites for deterministic assertions
- Moved legacy E2E tests to `tests/e2e/legacy/`

### Fixed

- Chinese file path encoding corruption: file paths with CJK characters (e.g. `新录音.m4a`) were garbled when passed to Python subprocess on Windows (GBK/CP936 locale) — now forced UTF-8 via `PYTHONUTF8=1`
- Misleading test 3.6: mock was applied to wrong app instance — now correctly tests default no-models state
- Fragile `__dirname` 4-level traversal in `electron-launch.js` replaced with `PROJECT_ROOT` constant

## [1.0.1] - 2026-05-31

### Fixed

- AI_REVIEW handler hardcoded "optimize" mode, overriding platform-specific system prompts (xiaohongshu, dianping) — now uses correct prompt per template
- `processTextWithAI` and `checkAIStatus` had no request timeout — added AbortController with 60s and 15s limits respectively, with friendly Chinese error messages
- Removed dead `SYSTEM.UPDATES` IPC handler and added error handling for clipboard PASTE
- Removed 15 orphan IPC handlers and stale type declarations

### Changed

- Unified prompt definitions: moved `dianping`, `professional`, `raw_with_notes` prompts from `exportFormatters.js` into `aiPrompts.js`, eliminating duplicate prompt systems
- `getAIReviewPrompt` removed from `exportFormatters.js`; `AI_REVIEW` handler now uses `buildPrompt` directly

### Added

- ADR 012: known limitations & technical debt document (`docs/adr/012-known-limitations-tradeoffs.md`)

## [1.0.0] - 2026-05-27

### Added

- i18n internationalization: i18next integration with zh-CN/en translations and language selector in settings
- Accessibility: ARIA labels, keyboard navigation, focus-visible styles, decorative aria-hidden
- Semi-auto update with SHA256 verification, progress UI, and system notification
- TypeScript strict mode: `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess` across entire frontend
- Full TypeScript migration: all hooks, components, and pages migrated to TS/TSX
- AI provider presets: 11 providers (OpenAI, DeepSeek, Qwen, GLM, SiliconFlow, Groq, Moonshot, MiniMax, OpenRouter, Ollama, LM Studio) with auto-fill and registration links
- Quick Start guide: one-click registration links for providers with free tiers (DeepSeek, SiliconFlow recommended)
- Local model auto-detection: probes Ollama (11434) and LM Studio (1234) with 2s timeout
- Custom AI prompt templates with user-defined system/user prompts
- Quick experience mode: per-model download progress, optional punc model for faster startup
- Configurable AI temperature and max_tokens settings
- File-based config (`~/.murmur.json`): DB-first with file fallback, bidirectional sync
- ASR engine abstraction interface for future multi-engine support
- SQLite FTS5 full-text search with trigram tokenizer for CJK text
- SQLite integrity check on startup
- IPC rate limiting for expensive handlers
- FunASR server auto-restart on crash with health monitor (30s ping/pong)
- GPU auto-detection (CUDA > MPS > CPU)
- E2E testing with Playwright: launch, settings, and IPC integration tests
- CI gate enforcement: format check, coverage thresholds, license compliance, build verification
- Local CI gate script (`scripts/ci-check.js`) with `--fix`, `--json`, `--quiet`, `--e2e` modes
- Dependabot configuration for npm and GitHub Actions
- Node version pinning via `.nvmrc`
- Pre-commit hooks via husky + lint-staged (eslint --fix, prettier --write)
- GitHub Actions Node 24 readiness (`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`)
- CI config validation tests (12 tests for husky, lint-staged, dependabot, workflow config)
- 593 unit tests with high coverage

### Changed

- Audio format conversion: replaced system ffmpeg dependency with Python librosa/soundfile (zero new deps)
- AI prompt engineering overhaul: system/user role separation + XML `<transcript>` tags
- AI optimization redesign: platform styles, humanizer, speaker diarization
- SSRF protection for AI base URLs: https-only + RFC1918 loopback blocking in handler layer
- CSP `connect-src` relaxed to `https:` (SSRF guard now enforced in `aiHandlers.js`, not CSP)
- Log sanitization: AI requests log `inputLength`/`outputLength` instead of full text content
- AI processing mode auto-selects based on transcript length (`optimize` vs `optimize_long`)
- FunASR decomposition: monolithic `funasrManager.js` → thin facade + 4 sub-modules
- IPC architecture: monolithic `ipcHandlers.js` → 9 domain-scoped handler modules
- App.tsx refactored: extracted 5 inline components for maintainability
- Postinstall: `electron-rebuild` → `electron-builder install-app-deps` for CI compatibility
- TypeScript added as explicit devDependency (was missing from package.json)
- Windows CI build: `npx electron-rebuild` → `pnpm rebuild better-sqlite3`

### Fixed

- Audio import: librosa converts MP3/OGG to WAV without requiring system ffmpeg
- MPS device: skipped Apple GPU due to FunASR float64 incompatibility, falls back to CPU
- Hotkey registration: shows toast warning when shortcut is occupied by another app
- FunASR initialization: failure path no longer skips preInitializeModels
- Audio duration: bare except now logs warnings for diagnostic visibility
- History page: shows toast on load/delete failures
- Model verification: correctly handles directory-based models (APFS `statSync` size semantics)
- Contract mismatch: `FUNASR.STATUS` spread order corrected
- Contract mismatch: `saveTranscription` preload signature aligned with handler
- Settings save button no longer blocks users with AI optimization disabled
- Clipboard null safety: `clipboard.readText()` returns null when empty
- Native module version mismatch on Node upgrade (`lastInsertRowid` path fix)
- Recording save path: use `lastInsertRowid` instead of `id`
- File transcription result: unified `lastInsertRowid` usage
- Post-transcription experience: unified recording & file-import flows
- Prettier formatting: 12 files reformatted to pass CI format check
- TypeScript 6.0 `baseUrl` deprecation: added `ignoreDeprecations: "6.0"` to tsconfig
- Missing CSS module type declarations: added `src/vite-env.d.ts` with Vite client types

### Removed

- Dead `useTextProcessing.js` hook (handleTranscription was never called)
- System ffmpeg dependency for audio conversion (replaced by Python librosa)
- `.claude/skills/` files from git index (local-only, already in `.gitignore`)

### Security

- SSRF validation on AI base URL (block internal networks: localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x)
- Settings import whitelist validation and SQL parameter escaping
- License compliance check blocking GPL/AGPL dependencies
- API key encryption at rest using `electron.safeStorage`
- Plaintext-to-encrypted migration for existing API keys
- Path validation on `show-item-in-folder` (restricted to userData)
- HTTPS-only validation on `open-external`
- CSP `connect-src` for AI providers (modelscope, openai, bigmodel)
- `sandbox: true` on all BrowserWindow instances
