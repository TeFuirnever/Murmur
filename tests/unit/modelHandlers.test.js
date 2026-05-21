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

describe("modelHandlers", () => {
  let ipcMain;
  let managers;
  let register;

  beforeEach(() => {
    vi.resetModules();
    register = require("../../src/helpers/ipc/modelHandlers").register;
    ipcMain = createMockIpcMain();

    managers = {
      funasrManager: {
        checkModelFiles: vi.fn(async () => ({ downloaded: true })),
        getDownloadProgress: vi.fn(async () => ({ progress: 0 })),
        downloadModels: vi.fn(async () => ({ success: true })),
        checkStatus: vi.fn(async () => ({ models_downloaded: true })),
      },
    };

    register(ipcMain, managers);
  });

  it("registers all model handlers", () => {
    expect(ipcMain._handlers["check-model-files"]).toBeDefined();
    expect(ipcMain._handlers["get-download-progress"]).toBeDefined();
    expect(ipcMain._handlers["download-models"]).toBeDefined();
    expect(ipcMain._handlers["download-model"]).toBeDefined();
    expect(ipcMain._handlers["get-available-models"]).toBeDefined();
    expect(ipcMain._handlers["get-current-model"]).toBeDefined();
    expect(ipcMain._handlers["switch-model"]).toBeDefined();
  });

  it("check-model-files delegates to funasrManager", async () => {
    const result = await ipcMain._handlers["check-model-files"]();
    expect(managers.funasrManager.checkModelFiles).toHaveBeenCalled();
    expect(result).toEqual({ downloaded: true });
  });

  it("get-download-progress delegates to funasrManager", async () => {
    const result = await ipcMain._handlers["get-download-progress"]();
    expect(managers.funasrManager.getDownloadProgress).toHaveBeenCalled();
    expect(result).toEqual({ progress: 0 });
  });

  it("download-models delegates to funasrManager with progress callback", async () => {
    const mockSender = { send: vi.fn() };
    const mockEvent = { sender: mockSender };
    const result = await ipcMain._handlers["download-models"](mockEvent);
    expect(managers.funasrManager.downloadModels).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("get-available-models returns model list", () => {
    const result = ipcMain._handlers["get-available-models"]();
    expect(result.models).toHaveLength(3);
    expect(result.models[0].name).toBe("paraformer-large");
    expect(result.models[1].name).toBe("fsmn-vad");
    expect(result.models[2].name).toBe("ct-transformer-punc");
  });

  it("get-current-model returns model status", async () => {
    const result = await ipcMain._handlers["get-current-model"]();
    expect(result.model).toBe("paraformer-large");
    expect(result.status).toBe("ready");
  });

  it("switch-model returns failure (not supported)", () => {
    const result = ipcMain._handlers["switch-model"]({}, "some-model");
    expect(result.success).toBe(false);
    expect(result.error).toContain("暂不支持切换");
  });
});
