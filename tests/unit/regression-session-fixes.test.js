import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

// ---------------------------------------------------------------------------
// Regression tests for fixes from the 2026-05-22/23 session.
// Each test guards against a specific bug that was fixed.
// ---------------------------------------------------------------------------

const C = require("../../src/helpers/ipc-contracts");

function createIpcMain() {
  const handlers = {};
  return {
    handle: vi.fn((channel, fn) => {
      handlers[channel] = fn;
    }),
    _handlers: handlers,
  };
}

// 1. FUNASR.STATUS spread order — success field computed AFTER spread
describe("FUNASR.STATUS spread order regression", () => {
  it("defaults to success:true when checkStatus returns no success field", async () => {
    const envHandlers = require("../../src/helpers/ipc/environmentHandlers");
    const ipcMain = createIpcMain();

    const managers = {
      environmentManager: {
        exportConfig: vi.fn(),
        validateEnvironment: vi.fn(),
      },
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
        findPythonExecutable: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };

    envHandlers.register(ipcMain, managers);
    const result = await ipcMain._handlers[C.FUNASR.STATUS]();

    // Without the spread fix, this would be undefined (spread overrode it)
    expect(result.success).toBe(true);
    expect(result.models_initialized).toBe(false);
  });

  it("propagates success:false when checkStatus explicitly fails", async () => {
    const envHandlers = require("../../src/helpers/ipc/environmentHandlers");
    const ipcMain = createIpcMain();

    const managers = {
      environmentManager: {
        exportConfig: vi.fn(),
        validateEnvironment: vi.fn(),
      },
      funasrManager: {
        checkPythonInstallation: vi.fn(),
        installPython: vi.fn(),
        checkFunASRInstallation: vi.fn(),
        checkStatus: vi.fn(async () => ({
          success: false,
          error: "something broke",
        })),
        modelsInitialized: false,
        serverReady: false,
        initializationPromise: null,
        installFunASR: vi.fn(),
        restartServer: vi.fn(),
        findPythonExecutable: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };

    envHandlers.register(ipcMain, managers);
    const result = await ipcMain._handlers[C.FUNASR.STATUS]();

    expect(result.success).toBe(false);
  });

  it("preserves success:true from checkStatus", async () => {
    const envHandlers = require("../../src/helpers/ipc/environmentHandlers");
    const ipcMain = createIpcMain();

    const managers = {
      environmentManager: {
        exportConfig: vi.fn(),
        validateEnvironment: vi.fn(),
      },
      funasrManager: {
        checkPythonInstallation: vi.fn(),
        installPython: vi.fn(),
        checkFunASRInstallation: vi.fn(),
        checkStatus: vi.fn(async () => ({
          success: true,
          server_running: true,
        })),
        modelsInitialized: true,
        serverReady: true,
        initializationPromise: null,
        installFunASR: vi.fn(),
        restartServer: vi.fn(),
        findPythonExecutable: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };

    envHandlers.register(ipcMain, managers);
    const result = await ipcMain._handlers[C.FUNASR.STATUS]();

    expect(result.success).toBe(true);
    expect(result.models_initialized).toBe(true);
    expect(result.server_ready).toBe(true);
  });
});

// 7. FUNASR.STATUS includes user-friendly status_message
describe("FUNASR.STATUS status_message", () => {
  function createEnvManagers(overrides = {}) {
    return {
      environmentManager: {
        exportConfig: vi.fn(),
        validateEnvironment: vi.fn(),
      },
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
        findPythonExecutable: vi.fn(),
        ...overrides,
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };
  }

  it("includes status_message when server is ready", async () => {
    const envHandlers = require("../../src/helpers/ipc/environmentHandlers");
    const ipcMain = createIpcMain();
    const managers = createEnvManagers({
      modelsInitialized: true,
      serverReady: true,
    });

    envHandlers.register(ipcMain, managers);
    const result = await ipcMain._handlers[C.FUNASR.STATUS]();

    expect(result.status_message).toBeDefined();
    expect(typeof result.status_message).toBe("string");
  });

  it("includes status_message when initializing", async () => {
    const envHandlers = require("../../src/helpers/ipc/environmentHandlers");
    const ipcMain = createIpcMain();
    const managers = createEnvManagers({
      initializationPromise: Promise.resolve(),
    });

    envHandlers.register(ipcMain, managers);
    const result = await ipcMain._handlers[C.FUNASR.STATUS]();

    expect(result.status_message).toBeDefined();
    expect(result.is_initializing).toBe(true);
  });

  it("includes status_message when not ready", async () => {
    const envHandlers = require("../../src/helpers/ipc/environmentHandlers");
    const ipcMain = createIpcMain();
    const managers = createEnvManagers();

    envHandlers.register(ipcMain, managers);
    const result = await ipcMain._handlers[C.FUNASR.STATUS]();

    expect(result.status_message).toBeDefined();
  });
});

// 2. TRANSCRIPTION.SAVE canonical return shape
describe("TRANSCRIPTION.SAVE return shape regression", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns {success:true} on successful save", async () => {
    const { register } = require("../../src/helpers/ipc/transcriptionHandlers");
    const ipcMain = createIpcMain();

    const managers = {
      databaseManager: {
        saveTranscription: vi.fn(() => ({ lastInsertRowid: 42, changes: 1 })),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      processTextWithAI: vi.fn(),
    };

    register(ipcMain, managers);
    const result = await ipcMain._handlers[C.TRANSCRIPTION.SAVE](
      {},
      { text: "hello", raw_text: "hello" },
    );

    expect(result.success).toBe(true);
    expect(result.lastInsertRowid).toBe(42);
  });

  it("returns {success:false, error} on failure", async () => {
    const { register } = require("../../src/helpers/ipc/transcriptionHandlers");
    const ipcMain = createIpcMain();

    const managers = {
      databaseManager: {
        saveTranscription: vi.fn(() => {
          throw new Error("DB locked");
        }),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      processTextWithAI: vi.fn(),
    };

    register(ipcMain, managers);
    const result = await ipcMain._handlers[C.TRANSCRIPTION.SAVE](
      {},
      { text: "hello", raw_text: "hello" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("DB locked");
  });
});

// 3. SETTINGS_UPDATE broadcast on save
describe("SETTINGS_UPDATE broadcast regression", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function createManagers() {
    const sendSpy = vi.fn();
    return {
      managers: {
        databaseManager: {
          getSetting: vi.fn(() => "val"),
          setSetting: vi.fn(() => true),
          getAllSettings: vi.fn(() => ({})),
          resetSettings: vi.fn(() => true),
          syncToFileConfig: vi.fn(),
        },
        logger: { error: vi.fn() },
        windowManager: {
          mainWindow: {
            isDestroyed: vi.fn(() => false),
            webContents: { send: sendSpy },
          },
        },
      },
      sendSpy,
    };
  }

  it("sends SETTINGS_UPDATE event on save-setting", async () => {
    const { register } = require("../../src/helpers/ipc/settingsHandlers");
    const ipcMain = createIpcMain();
    const { managers, sendSpy } = createManagers();

    register(ipcMain, managers);
    await ipcMain._handlers[C.SETTINGS.SAVE]({}, "theme", "dark");

    expect(sendSpy).toHaveBeenCalledWith(
      C.EVENTS.SETTINGS_UPDATE,
      expect.objectContaining({ key: "theme" }),
    );
  });

  it("sends SETTINGS_UPDATE event on set-setting", async () => {
    const { register } = require("../../src/helpers/ipc/settingsHandlers");
    const ipcMain = createIpcMain();
    const { managers, sendSpy } = createManagers();

    register(ipcMain, managers);
    await ipcMain._handlers[C.SETTINGS.SET]({}, "theme", "dark");

    expect(sendSpy).toHaveBeenCalledWith(
      C.EVENTS.SETTINGS_UPDATE,
      expect.objectContaining({ key: "theme" }),
    );
  });

  it("sends SETTINGS_UPDATE event on reset-settings", async () => {
    const { register } = require("../../src/helpers/ipc/settingsHandlers");
    const ipcMain = createIpcMain();
    const { managers, sendSpy } = createManagers();

    register(ipcMain, managers);
    await ipcMain._handlers[C.SETTINGS.RESET]();

    expect(sendSpy).toHaveBeenCalledWith(
      C.EVENTS.SETTINGS_UPDATE,
      expect.objectContaining({ key: null }),
    );
  });
});

// 4. aiPrompts returns {system, user} structure
describe("aiPrompts system/user structure regression", () => {
  it("buildPrompt returns {system, user} for optimize mode", () => {
    const { buildPrompt } = require("../../src/helpers/aiPrompts");
    const result = buildPrompt("optimize", "测试文本");

    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
    expect(result.user).toContain("<transcript>");
    expect(result.user).toContain("测试文本");
  });

  it("buildPrompt returns {system, user} for optimize_long mode", () => {
    const { buildPrompt } = require("../../src/helpers/aiPrompts");
    const result = buildPrompt("optimize_long", "长文本测试");

    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
    expect(result.user).toContain("<transcript>");
  });

  it("buildPrompt falls back to optimize for unknown mode", () => {
    const { buildPrompt } = require("../../src/helpers/aiPrompts");
    const result = buildPrompt("unknown_mode", "文本");

    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
  });

  it("system prompt contains core rules", () => {
    const { buildPrompt } = require("../../src/helpers/aiPrompts");
    const { system } = buildPrompt("optimize", "文本");

    expect(system).toContain("绝对禁止");
    expect(system).toContain("输出要求");
  });
});

// 5. SSRF validation in processTextWithAI (not just checkAIStatus)
describe("processTextWithAI SSRF regression", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects internal base URL in process flow", async () => {
    const { processTextWithAI } = require("../../src/helpers/ipc/aiHandlers");

    const db = {
      getSetting: vi.fn(async (key) => {
        if (key === "ai_api_key") return "sk-test";
        if (key === "ai_base_url") return "https://192.168.1.1/v1";
        if (key === "ai_model") return "gpt-3.5-turbo";
        return null;
      }),
    };
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const result = await processTextWithAI("test", "optimize", db, logger);
    expect(result.success).toBe(false);
    expect(result.error).toContain("https");
  });

  it("rejects http base URL in process flow", async () => {
    const { processTextWithAI } = require("../../src/helpers/ipc/aiHandlers");

    const db = {
      getSetting: vi.fn(async (key) => {
        if (key === "ai_api_key") return "sk-test";
        if (key === "ai_base_url") return "http://api.openai.com/v1";
        if (key === "ai_model") return "gpt-3.5-turbo";
        return null;
      }),
    };
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const result = await processTextWithAI("test", "optimize", db, logger);
    expect(result.success).toBe(false);
  });
});

// 6. downloadModels must call findPythonExecutable — not use stale pythonCmd
describe("downloadModels python path regression", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function createManager() {
    const FunASRManager = require("../../src/helpers/funasrManager");
    const mgr = new FunASRManager();
    // Override internal methods to avoid real filesystem/electron calls
    mgr.pythonEnv.findPythonExecutable = vi.fn(async () => "/resolved/python3");
    mgr.modelManager.downloadModels = vi.fn(async () => ({ success: true }));
    return mgr;
  }

  it("calls findPythonExecutable before passing path to modelManager", async () => {
    const mgr = createManager();
    await mgr.downloadModels();

    expect(mgr.pythonEnv.findPythonExecutable).toHaveBeenCalled();
    expect(mgr.modelManager.downloadModels).toHaveBeenCalledWith(
      undefined,
      "/resolved/python3",
    );
  });

  it("does not fall back to hardcoded python3 when pythonCmd is null", async () => {
    const mgr = createManager();
    mgr.pythonEnv.pythonCmd = null;
    await mgr.downloadModels();

    const passedCmd = mgr.modelManager.downloadModels.mock.calls[0][1];
    expect(passedCmd).not.toBe("python3");
    expect(passedCmd).toBe("/resolved/python3");
  });
});
