# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- i18n internationalization: i18next integration with zh-CN/en translations and language selector in settings
- Accessibility: ARIA labels, keyboard navigation, focus-visible styles, decorative aria-hidden
- Semi-auto update with SHA256 verification, progress UI, and system notification
- TypeScript strict mode: `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess` across entire frontend
- Full TypeScript migration: all hooks, components, and pages migrated to TS/TSX
- AI provider presets: 8 providers (OpenAI, DeepSeek, Qwen, GLM, SiliconFlow, Groq, Ollama, LM Studio) with auto-fill
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
- 548 unit tests with 94%+ coverage (statements/branches/functions/lines)

### Changed

- Audio format conversion: replaced system ffmpeg dependency with Python librosa/soundfile (zero new deps)
- AI prompt engineering overhaul: system/user role separation + XML `<transcript>` tags
- SSRF protection for AI base URLs: https-only + RFC1918 loopback blocking in handler layer
- CSP `connect-src` relaxed to `https:` (SSRF guard now enforced in `aiHandlers.js`, not CSP)
- Log sanitization: AI requests log `inputLength`/`outputLength` instead of full text content
- AI processing mode auto-selects based on transcript length (`optimize` vs `optimize_long`)
- FunASR decomposition: monolithic `funasrManager.js` → thin facade + 4 sub-modules
- IPC architecture: monolithic `ipcHandlers.js` → 9 domain-scoped handler modules
- App.tsx refactored: extracted 5 inline components for maintainability

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

### Removed

- Dead `useTextProcessing.js` hook (handleTranscription was never called)
- System ffmpeg dependency for audio conversion (replaced by Python librosa)

### Security

- SSRF validation on AI base URL (block internal networks: localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x)
- Settings import whitelist validation and SQL parameter escaping
- License compliance check blocking GPL/AGPL dependencies

## [1.0.0] - 2026-05-21

### Added

- Voice recording with global hotkey (`Cmd+Shift+Space`)
- Real-time speech recognition using FunASR Paraformer-large
- AI text optimization (compatible with OpenAI API)
- Audio file transcription (wav/mp3/m4a/flac)
- Transcription history with search and pagination
- Export to TXT/SRT/VTT/MD/DOCX formats
- Settings management with import/export
- System tray integration
- Content Security Policy (CSP) headers
- API key masking in settings API
- URL protocol validation for external links
- Window controls (minimize/maximize/close)
- Resizable main window with size persistence
- FunASR health monitor with auto-restart (30s ping/pong)
- Graceful shutdown with Python process cleanup and 5s timeout
- Embedded Python environment support for production builds
- GitHub Actions CI (lint + test + coverage gate) for macOS DMG + Windows EXE
- Auto-update version detection via GitHub Releases API
- alwaysOnTop toggle setting with live window update
- Apple Design System UI across all pages

### Changed

- IPC architecture: monolithic `ipcHandlers.js` → 9 domain-scoped handler modules under `src/helpers/ipc/`
- IPC contracts: all channel names extracted to `ipc-contracts.js` constants, zero hardcoded strings
- FunASR decomposition: monolithic `funasrManager.js` (1600+ lines) → thin facade + 4 sub-modules (`funasrServer.js`, `modelManager.js`, `pythonEnvironment.js`, `audioFileHelpers.js`)
- Message routing: new `serverMessageRouter.js` with per-request timeout, progress streaming, and crash recovery (`_rejectAll`)
- Window creation: singleton lock prevents duplicate windows
- Preload: all APIs reference contract constants from `ipc-contracts.js`

### Security

- `sandbox: true` on all 4 BrowserWindow instances
- API key encryption at rest using `electron.safeStorage`
- Plaintext-to-encrypted migration for existing API keys
- Path validation on `show-item-in-folder` (restricted to userData)
- HTTPS-only validation on `open-external`
- CSP `connect-src` for AI providers (modelscope, openai, bigmodel)

### Fixed

- Conditional React hooks in App.jsx (rules-of-hooks)
- Unused variables/imports across all files
- Native module version conflicts for better-sqlite3
- All empty catch blocks now log errors
- FunASR request timeout prevents UI hang on Python crash (60s default)
- Hardcoded event channel strings eliminated from handlers

### Tests

- Vitest test suite expanded from 27 to 320 tests
- IPC contract validation tests
- Handler unit tests for window, model, settings, AI domains
- ESLint with 0 warnings, 0 errors
