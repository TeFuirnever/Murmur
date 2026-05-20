# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-05-20

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
- Graceful shutdown with Python process cleanup
- Embedded Python environment support for production builds
- GitHub Actions CI for macOS DMG + Windows EXE
- Vitest test suite (27 tests)
- ESLint configuration with 0 errors

### Changed

- Replaced `window` global callbacks with React callback-props
- Removed 11 unused IPC handlers and preload APIs
- Window architecture consolidated to single-window + floating widget

### Fixed

- Conditional React hooks in App.jsx (rules-of-hooks)
- Unused variables/imports across all files
- Native module version conflicts for better-sqlite3
