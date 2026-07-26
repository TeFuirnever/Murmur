// [20260726_Tier3_SystemHandlersChannelsMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 4. Pattern: typed `createIpcMain` helper with an
// explicit `Record<string, MockHandler>` index signature (TS7053) and typed
// `const C`/`const sysHandlers` via `typeof import("...")` (TS7005). The
// mock ipcMain/managers are cast to the source register() argument types via
// `as unknown as Parameters<...>`. Template reference: phase4-i18n.test.ts
// (commit d52f2e0).
import { describe, it, expect, vi } from "vitest";
const C: typeof import("../../src/helpers/ipc-contracts") = require("../../src/helpers/ipc-contracts");
const sysHandlers: typeof import("../../src/helpers/ipc/systemHandlers") = require("../../src/helpers/ipc/systemHandlers");

// [20260726_Tier3_SystemHandlersChannelsMigrate] Handler shape: ipcMain.handle
// registers `(event, ...args) => result` callbacks. The suite only asserts
// handler presence, so the return is `unknown`.
type MockHandler = (...args: unknown[]) => unknown;

function createIpcMain() {
  const handlers: Record<string, MockHandler | undefined> = {};
  return {
    handle: vi.fn((channel: string, fn: MockHandler) => {
      if (handlers[channel]) {
        throw new Error(`Duplicate handler registration for ${channel}`);
      }
      handlers[channel] = fn;
    }),
    _handlers: handlers,
  };
}

describe("systemHandlers channel registration", () => {
  it("registers LOG exactly once and does not register removed orphan channels", () => {
    const ipcMain = createIpcMain();
    const managers = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        getRecentLogs: vi.fn(),
        getFunASRLogs: vi.fn(),
        getLogFilePath: vi.fn(() => "/tmp/app.log"),
        getFunASRLogFilePath: vi.fn(() => "/tmp/funasr.log"),
        getSystemInfo: vi.fn(),
      },
      funasrManager: {
        isInitialized: false,
        modelsInitialized: false,
        serverReady: false,
        pythonCmd: "python3",
      },
      clipboardManager: {
        checkAccessibilityPermissions: vi.fn(() => Promise.resolve(true)),
        openSystemSettings: vi.fn(),
        pasteText: vi.fn(),
      },
    };

    // [20260726_Tier3_SystemHandlersChannelsMigrate] Cast the mock ipcMain
    // and stubbed managers to the source register() arg types via the
    // unknown bridge — structurally compatible with the exercised subset.
    sysHandlers.register(
      ipcMain as unknown as Parameters<typeof sysHandlers.register>[0],
      managers as unknown as Parameters<typeof sysHandlers.register>[1],
    );

    const channels = Object.keys(ipcMain._handlers);
    const logHits = channels.filter((c) => c === C.SYSTEM.LOG);
    expect(logHits.length).toBe(1);
    // The removed orphan channels must not appear as live handlers
    expect(channels).not.toContain("log-message");
    expect(channels).not.toContain("get-debug-info");
    expect(channels).not.toContain("report-error");
  });
});
