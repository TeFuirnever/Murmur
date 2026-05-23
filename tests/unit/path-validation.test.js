import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);
const Module = requireCJS("module");
const C = requireCJS("../../src/helpers/ipc-contracts");

const MOCK_USER_DATA = "/mock/userData";

function createIpcMain() {
  const handlers = {};
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn; }),
    _handlers: handlers,
  };
}

describe("path validation regression — systemHandlers SHOW_ITEM and OPEN_LOG", () => {
  let origResolve;
  let showItemSpy;

  beforeEach(() => {
    vi.resetModules();
    showItemSpy = vi.fn();

    const electronStub = {
      app: { getPath: vi.fn(() => MOCK_USER_DATA) },
      shell: { showItemInFolder: showItemSpy, openExternal: vi.fn() },
      BrowserWindow: vi.fn(),
      net: { isOnline: vi.fn(() => true) },
    };

    origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === "electron") return "electron-stub-path";
      return origResolve.call(this, request, ...rest);
    };
    requireCJS.cache["electron-stub-path"] = {
      id: "electron-stub-path",
      filename: "electron-stub-path",
      loaded: true,
      exports: electronStub,
    };
  });

  afterEach(() => {
    Module._resolveFilename = origResolve;
    delete requireCJS.cache["electron-stub-path"];
    const sysPath = requireCJS.resolve("../../src/helpers/ipc/systemHandlers");
    delete requireCJS.cache[sysPath];
  });

  function registerHandlers() {
    const ipcMain = createIpcMain();
    const managers = {
      logger: {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
        getRecentLogs: vi.fn(), getFunASRLogs: vi.fn(),
        getLogFilePath: vi.fn(() => "/mock/userData/logs/app.log"),
        getFunASRLogFilePath: vi.fn(() => "/mock/userData/logs/funasr.log"),
        getSystemInfo: vi.fn(),
      },
      funasrManager: { isInitialized: false, modelsInitialized: false, serverReady: false, pythonCmd: "python3" },
      clipboardManager: { checkAccessibilityPermissions: vi.fn(() => Promise.resolve(true)), openSystemSettings: vi.fn(), pasteText: vi.fn() },
    };

    const sysHandlers = requireCJS("../../src/helpers/ipc/systemHandlers");
    sysHandlers.register(ipcMain, managers);
    return { ipcMain, managers };
  }

  describe("SHOW_ITEM path validation", () => {
    it("allows paths inside userData", async () => {
      const { ipcMain } = registerHandlers();
      await ipcMain._handlers[C.SYSTEM.SHOW_ITEM]({}, "/mock/userData/transcriptions.db");
      expect(showItemSpy).toHaveBeenCalledWith("/mock/userData/transcriptions.db");
    });

    it("rejects absolute path outside userData", async () => {
      const { ipcMain } = registerHandlers();
      await ipcMain._handlers[C.SYSTEM.SHOW_ITEM]({}, "/etc/passwd");
      expect(showItemSpy).not.toHaveBeenCalled();
    });

    it("rejects null and non-string paths", async () => {
      const { ipcMain } = registerHandlers();
      await ipcMain._handlers[C.SYSTEM.SHOW_ITEM]({}, null);
      await ipcMain._handlers[C.SYSTEM.SHOW_ITEM]({}, 123);
      expect(showItemSpy).not.toHaveBeenCalled();
    });
  });

  describe("OPEN_LOG path validation", () => {
    it("allows log files inside userData", async () => {
      const { ipcMain } = registerHandlers();
      const result = await ipcMain._handlers[C.SYSTEM.OPEN_LOG]({}, "app");
      expect(result.success).toBe(true);
      expect(showItemSpy).toHaveBeenCalled();
    });

    it("rejects log files outside userData", async () => {
      const { ipcMain, managers } = registerHandlers();
      managers.logger.getLogFilePath = vi.fn(() => "/tmp/evil.log");
      const result = await ipcMain._handlers[C.SYSTEM.OPEN_LOG]({}, "app");
      expect(result.success).toBe(false);
      expect(result.error).toContain("路径");
    });
  });
});
