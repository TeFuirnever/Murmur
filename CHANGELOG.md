# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

- Vitest test suite expanded from 27 to 145 tests
- IPC contract validation tests
- Handler unit tests for window, model, settings, AI domains
- ESLint with 0 warnings, 0 errors
