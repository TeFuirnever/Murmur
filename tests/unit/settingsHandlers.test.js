import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockIpcMain() {
  const handlers = {};
  return {
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    _handlers: handlers,
  };
}

describe("settingsHandlers", () => {
  let ipcMain;
  let managers;
  let register;

  beforeEach(() => {
    vi.resetModules();
    register = require("../../src/helpers/ipc/settingsHandlers").register;
    ipcMain = createMockIpcMain();

    managers = {
      databaseManager: {
        getSetting: vi.fn((key, defaultValue) => defaultValue || "value-" + key),
        setSetting: vi.fn(() => true),
        getAllSettings: vi.fn(() => ({
          ai_api_key: "sk-test-12345678",
          ai_base_url: "https://api.openai.com/v1",
          ai_model: "gpt-3.5-turbo",
        })),
        resetSettings: vi.fn(() => true),
      },
      logger: { error: vi.fn() },
    };

    register(ipcMain, managers);
  });

  it("registers all settings handlers", () => {
    expect(ipcMain._handlers["get-setting"]).toBeDefined();
    expect(ipcMain._handlers["set-setting"]).toBeDefined();
    expect(ipcMain._handlers["get-all-settings"]).toBeDefined();
    expect(ipcMain._handlers["get-settings"]).toBeDefined();
    expect(ipcMain._handlers["save-setting"]).toBeDefined();
    expect(ipcMain._handlers["reset-settings"]).toBeDefined();
    expect(ipcMain._handlers["import-settings"]).toBeDefined();
    expect(ipcMain._handlers["export-settings"]).toBeDefined();
  });

  it("get-setting delegates to databaseManager", () => {
    ipcMain._handlers["get-setting"]({}, "test-key", "default");
    expect(managers.databaseManager.getSetting).toHaveBeenCalledWith("test-key", "default");
  });

  it("set-setting delegates to databaseManager", () => {
    ipcMain._handlers["set-setting"]({}, "test-key", "test-value");
    expect(managers.databaseManager.setSetting).toHaveBeenCalledWith("test-key", "test-value");
  });

  it("get-all-settings masks API key", () => {
    const result = ipcMain._handlers["get-all-settings"]();
    expect(result.ai_api_key).toBe("****5678");
    expect(result.ai_base_url).toBe("https://api.openai.com/v1");
  });

  it("get-settings (legacy) also masks API key", () => {
    const result = ipcMain._handlers["get-settings"]();
    expect(result.ai_api_key).toBe("****5678");
  });

  it("save-setting delegates to databaseManager.setSetting", () => {
    ipcMain._handlers["save-setting"]({}, "key", "value");
    expect(managers.databaseManager.setSetting).toHaveBeenCalledWith("key", "value");
  });

  it("reset-settings delegates to databaseManager", () => {
    ipcMain._handlers["reset-settings"]();
    expect(managers.databaseManager.resetSettings).toHaveBeenCalled();
  });
});
