import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

describe("IPC rate limit integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function createIpcMain() {
    const handlers = {};
    return {
      handle: vi.fn((channel, fn) => {
        handlers[channel] = fn;
      }),
      _handlers: handlers,
    };
  }

  function createManagers() {
    return {
      environmentManager: { exportConfig: vi.fn(), validateEnvironment: vi.fn() },
      funasrManager: {
        checkPythonInstallation: vi.fn(),
        installPython: vi.fn(),
        checkFunASRInstallation: vi.fn(),
        checkStatus: vi.fn(async () => ({ server_running: true })),
        modelsInitialized: false,
        serverReady: false,
        initializationPromise: null,
        installFunASR: vi.fn(),
        restartServer: vi.fn(),
        findPythonExecutable: vi.fn(async () => "python3"),
        downloadModels: vi.fn(async () => ({ success: true })),
        modelManager: {
          downloadModels: vi.fn(async () => ({ success: true })),
        },
      },
      databaseManager: {
        getSetting: vi.fn(async () => null),
        setSetting: vi.fn(() => true),
        getAllSettings: vi.fn(() => ({})),
        resetSettings: vi.fn(() => true),
        saveTranscription: vi.fn(() => ({ lastInsertRowid: 1 })),
        syncToFileConfig: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      windowManager: {
        mainWindow: {
          isDestroyed: vi.fn(() => false),
          webContents: { send: vi.fn() },
        },
      },
      templatesDir: "/tmp/test-templates",
    };
  }

  it("rate-limits process-text channel", async () => {
    const { registerAll } = require("../../src/helpers/ipc/index");
    const ipcMain = createIpcMain();
    registerAll(ipcMain, createManagers());

    const handler = ipcMain._handlers["process-text"];
    expect(handler).toBeDefined();

    // Handler should be wrapped — call it many times rapidly
    let rateLimited = false;
    for (let i = 0; i < 25; i++) {
      const result = await handler({}, "test", "optimize");
      if (result.success === false && result.error?.match(/rate/i)) {
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });

  it("rate-limits download-models with strict limit", async () => {
    const { registerAll } = require("../../src/helpers/ipc/index");
    const ipcMain = createIpcMain();
    registerAll(ipcMain, createManagers());

    const handler = ipcMain._handlers["download-models"];
    expect(handler).toBeDefined();

    // Should be limited to 3 calls per 5 minutes
    await handler({}, vi.fn());
    await handler({}, vi.fn());
    await handler({}, vi.fn());
    const result = await handler({}, vi.fn());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate/i);
  });

  it("does not rate-limit unrestricted channels", async () => {
    const { registerAll } = require("../../src/helpers/ipc/index");
    const ipcMain = createIpcMain();
    registerAll(ipcMain, createManagers());

    const handler = ipcMain._handlers["check-funasr-status"];
    expect(handler).toBeDefined();

    // Call many times — should never be rate limited
    for (let i = 0; i < 50; i++) {
      const result = await handler();
      expect(result.success).toBe(true);
    }
  });
});
