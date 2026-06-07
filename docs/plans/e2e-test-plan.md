# E2E Test Plan for Murmur

**Status:** `pending approval`
**Created:** 2026-06-07
**Author:** Planner Agent (revised by Architect + Critic)
**Consensus:** Iteration 2 — Architect APPROVE, Critic APPROVE

---

## RALPLAN-DR Summary

### Principles
1. **User-Journey Coverage** — Tests mirror real user workflows, not implementation details
2. **Platform Parity** — Critical paths tested on macOS and Windows in CI
3. **Flaky-Free by Design** — Mock external deps at the IPC handler boundary; never rely on real network or hardware
4. **Testing Pyramid** — Thin E2E layer (~28 tests for P0/P1 critical paths) complementing 767 unit tests; edge cases stay as integration tests
5. **Deterministic Assertions** — Assert observable UI state (aria-labels, data-testid, text content) or IPC response shape; no timing-based waits

### Decision Drivers
1. **CI reliability** — Current E2E tests pass inconsistently; new suite must be resilient with proper Electron binary caching
2. **Maintenance cost** — E2E tests cost 5-10x more to maintain than unit tests; keep the suite lean and focused
3. **Coverage gaps** — Zero E2E coverage for recording, AI processing, file import, history, updates, window management, hotkeys

### ADR: Option A — Full Playwright Electron E2E with IPC-level mocking

**Decision:** Use Playwright `_electron.launch()` with IPC handler mocking.
**Drivers:** CI reliability, testing pyramid balance, maintenance cost.
**Alternatives considered:**
- Option B (IPC-only integration): Rejected — would miss UI/IPC integration bugs like the Windows maximize bug (#29)
- Option C (Hybrid E2E + integration): Rejected — two test patterns adds complexity; IPC mocking within Playwright achieves same result
**Why chosen:** Single test pattern that covers real Electron lifecycle + UI state + IPC flow; mocks at the right boundary.
**Consequences:** Suite runs ~2-3 min; requires Electron binary in CI; platform matrix doubles CI time.
**Follow-ups:** Add Windows CI runner after macOS suite stabilizes (Phase 2).

---

## Test Scenarios (28 cases across 10 suites)

### Suite 1: Application Lifecycle (5 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 1.1 | Launch and show main window | P0 | `window.isVisible() === true`; title matches /Murmur/; `window.electronAPI` defined |
| 1.2 | Settings page route renders | P0 | Navigate to `?page=settings`; `aria-label="设置页面"` visible |
| 1.3 | History page route renders | P0 | Navigate to `?page=history`; heading "转录历史" visible |
| 1.4 | Close behavior "hide" | P1 | Set `close_behavior=hide`; click close button; `electronApp.isRunning() === true` |
| 1.5 | Close behavior "quit" | P1 | Set `close_behavior=quit`; click close button; process exits with code 0 |

### Suite 2: Model Download & Loading (4 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 2.1 | Initial state: need_download | P0 | Text "需要下载" visible; mic button has `disabled` attribute |
| 2.2 | Download progress updates | P0 | Emit `model-download-progress` event with `{progress: 50}`; `aria-valuenow="50"` on progress bar |
| 2.3 | Model ready enables recording | P0 | Mock model status to `ready`; mic button `disabled === false` |
| 2.4 | Download failure + retry | P1 | Mock download failure; error toast visible; retry button triggers re-download |

### Suite 3: Real-time Recording Flow (6 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 3.1 | Start recording via mic button | P0 | Click mic; `aria-label` changes to "停止录音"; `recording-pulse` CSS class present |
| 3.2 | Stop recording and show processing | P0 | Click mic again; `aria-label="开始录音"` or processing indicator; `isRecording === false` |
| 3.3 | Recording blocked when model not ready | P0 | With model `not ready`; click mic; toast contains "模型" |
| 3.4 | Transcription result displayed | P0 | Mock `transcribe-audio` IPC response; `data-testid="transcription-result"` contains expected text |
| 3.5 | AI optimization replaces text | P0 | Mock `process-text` IPC response; processed text shown, "AI文本优化完成" toast |
| 3.6 | AI failure falls back to original | P1 | Mock `process-text` error; original text auto-pasted; toast contains "AI优化失败" |

### Suite 4: Hotkey Management (3 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 4.1 | Default hotkey shown in UI | P0 | Text contains "⌘" on macOS or "Ctrl" on Windows |
| 4.2 | Hotkey IPC event toggles recording | P0 | Emit `hotkey-triggered` event; recording state toggles |
| 4.3 | Platform shows correct modifier | P1 | Assert hotkey text matches `process.platform` |

### Suite 5: File Import & Transcription (3 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 5.1 | Switch to file-import mode | P0 | Click "文件导入" tab; `data-testid="file-drop-zone"` visible |
| 5.2 | Validate supported audio file | P0 | Mock `validate-audio-file` IPC to return valid; file accepted |
| 5.3 | Reject unsupported file type | P1 | Mock validation IPC error; error message visible |

### Suite 6: Clipboard & Auto-Paste (3 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 6.1 | Copy text to clipboard | P0 | `writeClipboard("test")` then `readClipboard()` returns "test" |
| 6.2 | Auto-paste "paste" mode | P1 | Set `auto_paste=paste`; mock transcription; `pasteText` IPC called |
| 6.3 | Auto-paste "clipboard_only" mode | P1 | Set `auto_paste=clipboard_only`; mock transcription; only `copyText` IPC called |

### Suite 7: Settings Persistence (4 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 7.1 | Theme setting persists | P0 | Set theme "dark"; restart app; `getSetting("theme") === "dark"` |
| 7.2 | AI provider preset auto-fills | P0 | Select "DeepSeek" preset; `ai_base_url` field contains "deepseek.com" |
| 7.3 | API key show/hide toggle | P1 | Click eye icon; input `type` toggles between "password" and "text" |
| 7.4 | Settings roundtrip export/import | P1 | Export settings JSON; import into fresh app; all values match |

### Suite 8: History Management (3 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 8.1 | Open history with data | P0 | Insert test records; open history; `N 条记录` counter matches |
| 8.2 | Search filters results | P0 | Insert records; search for keyword; only matching records shown |
| 8.3 | Delete single transcription | P1 | Delete record; counter decrements; record gone from list |

### Suite 9: Window Management (3 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 9.1 | Minimize window | P0 | `minimizeWindow()` called; `window.isMinimized() === true` |
| 9.2 | Maximize/restore toggle | P0 | `maximizeWindow()` then again; `isMaximized` toggles each time |
| 9.3 | Always-on-top toggle | P1 | `setAlwaysOnTop(true)`; `window.isAlwaysOnTop() === true` |

### Suite 10: Error Resilience (2 tests)
| # | Test Case | Priority | Acceptance Criteria |
|---|-----------|----------|---------------------|
| 10.1 | FunASR crash triggers auto-restart | P0 | Kill Python process; health check detects; server restarts within 90s |
| 10.2 | AI network error graceful fallback | P1 | Mock `process-text` to reject; original text shown; error toast displayed |

---

## Technical Architecture

### File Structure

```
tests/e2e/
├── helpers/
│   ├── electron-launch.js        # launchElectronApp() + shared teardown
│   ├── ipc-mock.js               # mockIpcHandler(app, channel, response)
│   ├── ipc-events.js             # emitIpcEvent(app, channel, payload)
│   ├── assertions.js             # Custom Playwright matchers
│   └── fixtures.js               # Test data: sample transcriptions, settings, audio files
├── suites/
│   ├── 01-lifecycle.test.js
│   ├── 02-model-download.test.js
│   ├── 03-recording.test.js
│   ├── 04-hotkey.test.js
│   ├── 05-file-import.test.js
│   ├── 06-clipboard.test.js
│   ├── 07-settings.test.js
│   ├── 08-history.test.js
│   ├── 09-window.test.js
│   └── 10-errors.test.js
└── playwright.config.js          # Updated config
```

### Mocking Strategy (IPC Handler Boundary)

All mocks intercept at the Electron IPC layer via `electronApp.evaluate()`:

| Dependency | Mock Method | Example |
|------------|-------------|---------|
| FunASR transcription | Override `ipcMain.handle('transcribe-audio')` in main process | `app.evaluate(() => ipcMain.handle('transcribe-audio', () => ({success: true, text: '测试'})))` |
| AI processing | Override `ipcMain.handle('process-text')` | Return `{success: true, text: '优化后', enhanced_by_ai: true}` |
| Model download | Override `ipcMain.handle('download-models')` | Return `{success: true}` instantly |
| Model status | Override `ipcMain.handle('check-model-files')` | Return `{stage: 'ready', isReady: true}` |
| AI API HTTP calls | `page.route()` to intercept XHR | `page.route('**/chat/completions', route => route.fulfill({...}))` |
| Update check | Override `ipcMain.handle('check-update')` | Return `{hasUpdate: false, currentVersion: '1.0.1'}` |

### Test Isolation Strategy

```js
// Each test suite uses a fresh Electron app with clean state
beforeAll(async () => {
  app = await launchElectronApp({
    // Use in-memory or temp database
    env: { ...process.env, NODE_ENV: 'test', MURMUR_DB_PATH: ':memory:' }
  });
  window = await app.firstWindow();
});

afterAll(async () => {
  await app.close();
});

// Settings cleanup between tests
afterEach(async () => {
  await window.evaluate(() => window.electronAPI.resetSettings());
});
```

**Key isolation guarantees:**
- Fresh Electron app per suite (not per test — too slow)
- In-memory SQLite database (`:memory:`) via `MURMUR_DB_PATH` env var
- Settings reset between tests within a suite
- No shared state between suites

### Playwright Config

```js
export default defineConfig({
  testDir: './suites',
  timeout: 45000,           // 45s per test (Electron startup takes time)
  retries: 1,               // Retry once on failure (catches flaky IPC timing)
  workers: 1,               // Sequential execution (Electron can't parallelize)
  use: {
    trace: 'on-first-retry',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
```

### CI Integration

**Phase 1 (macOS primary):**
```yaml
e2e-tests:
  runs-on: macos-latest
  needs: [lint-and-test]     # Run after unit tests pass
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v6
      with: { node-version: 22 }
    - run: pnpm install
    - run: pnpm run build:preload
    - run: pnpm run build:renderer
    - run: pnpm test:e2e
      env:
        NODE_ENV: test
```

**Phase 2 (add Windows, after suite stabilizes):**
```yaml
strategy:
  matrix:
    os: [macos-latest, windows-latest]
```

**Electron binary resilience:** Add `actions/cache` for `node_modules/electron/dist` to avoid re-downloading.

---

## Implementation Phases

### Phase 1: Infrastructure (2-3 hours)
- [ ] Create test helpers (`electron-launch.js`, `ipc-mock.js`, `fixtures.js`)
- [ ] Update `playwright.config.js` with proper timeouts
- [ ] Add `MURMUR_DB_PATH` support to `database.js` for test isolation
- [ ] Verify infrastructure with Suite 1 (lifecycle) smoke tests

### Phase 2: Core User Flows (3-4 hours)
- [ ] Suite 2: Model download & loading
- [ ] Suite 3: Real-time recording flow
- [ ] Suite 5: File import
- [ ] Suite 6: Clipboard & auto-paste

### Phase 3: Settings & History (2-3 hours)
- [ ] Suite 7: Settings persistence
- [ ] Suite 8: History management
- [ ] Suite 4: Hotkey management

### Phase 4: Window & Error Resilience (1-2 hours)
- [ ] Suite 9: Window management
- [ ] Suite 10: Error resilience
- [ ] CI integration

### Phase 5: CI & Documentation (1 hour)
- [ ] Add E2E CI job to `.github/workflows/ci.yml`
- [ ] Update CONTRIBUTING.md with E2E test guidelines
- [ ] Verify all 28 tests pass in CI

**Total estimate: 10-13 hours**

---

## Acceptance Criteria (Plan-Level)

1. All 28 P0/P1 test cases implemented and passing
2. Zero flaky tests in 5 consecutive CI runs
3. E2E suite runs in CI as non-blocking gate (non-blocking, like current E2E)
4. Mock infrastructure reusable — adding a new test requires only a new `mockIpcHandler()` call
5. No regression in existing 767 unit tests
6. Test execution time < 4 minutes for full suite
7. `MURMUR_DB_PATH` env var supported for test isolation
8. CONTRIBUTING.md updated with E2E test guidelines
