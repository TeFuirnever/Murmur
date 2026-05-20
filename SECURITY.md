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

- **Content Security Policy (CSP)** — Restricts script/style/connect sources
- **Context Isolation** — Electron `contextIsolation: true`, `nodeIntegration: false`
- **API Key Protection** — Sensitive settings encrypted via macOS Keychain / Windows Credential Store
- **URL Validation** — External links restricted to `https:` protocol
- **IPC Input Validation** — File paths and IDs validated in handlers
- **Local Processing** — All audio processed locally, no data uploaded

## Known Security Considerations

- The application uses `sandbox: false` due to Python subprocess requirements
- `com.apple.security.cs.allow-unsigned-executable-memory` entitlement is required for FunASR
- API keys are stored locally in SQLite with optional OS-level encryption
