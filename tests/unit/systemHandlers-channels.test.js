import { describe, it, expect, vi } from "vitest";
const C = require("../../src/helpers/ipc-contracts");
const sysHandlers = require("../../src/helpers/ipc/systemHandlers");

function createIpcMain() {
  const handlers = {};
  return {
    handle: vi.fn((channel, fn) => {
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

    sysHandlers.register(ipcMain, managers);

    const channels = Object.keys(ipcMain._handlers);
    const logHits = channels.filter((c) => c === C.SYSTEM.LOG);
    expect(logHits.length).toBe(1);
    // The removed orphan channels must not appear as live handlers
    expect(channels).not.toContain("log-message");
    expect(channels).not.toContain("get-debug-info");
    expect(channels).not.toContain("report-error");
  });
});
