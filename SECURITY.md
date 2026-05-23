# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅ |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via:

- **GitHub Security Advisory**: [Create a new security advisory](https://github.com/TeFuirnever/Murmur/security/advisories/new)
- **Email**: Send details to the maintainer

Please include:

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Suggested fix (if any)

We will acknowledge your report within 48 hours and aim to provide a fix within 7 days.

## Security Measures

Murmur implements the following security measures:

- **Content Security Policy (CSP)** — Restricts script/style/connect sources; `connect-src: https:` for AI API calls
- **Context Isolation** — Electron `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on all BrowserWindows
- **API Key Encryption** — Sensitive settings (API keys) encrypted at rest via `electron.safeStorage` (backed by OS keychain)
- **SSRF Protection** — AI base URL validated to be `https:` with RFC1918/loopback blocking in handler layer
- **URL Validation** — External links restricted to `https:` protocol
- **IPC Input Validation** — File paths and IDs validated in handlers
- **Local Processing** — All audio processed locally, no data uploaded

## Known Security Considerations

- `com.apple.security.cs.allow-unsigned-executable-memory` entitlement required for FunASR/PyTorch JIT
- macOS App Sandbox (`com.apple.security.app-sandbox`) is disabled due to Python subprocess requirements; Electron-level `sandbox: true` remains enabled on all BrowserWindows
- API keys are encrypted via `electron.safeStorage` before storage in SQLite; a plaintext migration runs once on first load of older databases
