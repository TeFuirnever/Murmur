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

describe("windowHandlers", () => {
  let ipcMain;
  let managers;
  let register;

  beforeEach(() => {
    register = require("../../src/helpers/ipc/windowHandlers").register;
    ipcMain = createMockIpcMain();

    const mainWindow = {
      hide: vi.fn(),
      show: vi.fn(),
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
      setAlwaysOnTop: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };

    managers = {
      windowManager: {
        mainWindow,
        showControlPanel: vi.fn(),
        hideControlPanel: vi.fn(),
        showHistoryWindow: vi.fn(),
        closeHistoryWindow: vi.fn(),
        hideHistoryWindow: vi.fn(),
        showSettingsWindow: vi.fn(),
        closeSettingsWindow: vi.fn(),
        hideSettingsWindow: vi.fn(),
      },
    };

    register(ipcMain, managers);
  });

  it("registers all window handlers", () => {
    const channels = Object.keys(ipcMain._handlers);
    expect(channels.length).toBeGreaterThanOrEqual(10);
    expect(ipcMain._handlers["hide-window"]).toBeDefined();
    expect(ipcMain._handlers["show-window"]).toBeDefined();
    expect(ipcMain._handlers["close-window"]).toBeDefined();
  });

  it("hide-window hides the main window", () => {
    const result = ipcMain._handlers["hide-window"]();
    expect(managers.windowManager.mainWindow.hide).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("show-window shows the main window", () => {
    const result = ipcMain._handlers["show-window"]();
    expect(managers.windowManager.mainWindow.show).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("minimize-window minimizes the main window", () => {
    const result = ipcMain._handlers["minimize-window"]();
    expect(managers.windowManager.mainWindow.minimize).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("maximize-window toggles maximize state", () => {
    managers.windowManager.mainWindow.isMaximized.mockReturnValue(false);
    ipcMain._handlers["maximize-window"]();
    expect(managers.windowManager.mainWindow.maximize).toHaveBeenCalled();

    managers.windowManager.mainWindow.isMaximized.mockReturnValue(true);
    ipcMain._handlers["maximize-window"]();
    expect(managers.windowManager.mainWindow.unmaximize).toHaveBeenCalled();
  });

  it("is-window-maximized returns maximize state", () => {
    managers.windowManager.mainWindow.isMaximized.mockReturnValue(true);
    expect(ipcMain._handlers["is-window-maximized"]()).toBe(true);

    managers.windowManager.mainWindow.isMaximized.mockReturnValue(false);
    expect(ipcMain._handlers["is-window-maximized"]()).toBe(false);
  });

  it("close-window closes the main window", () => {
    const result = ipcMain._handlers["close-window"]();
    expect(managers.windowManager.mainWindow.close).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("open-control-panel delegates to showControlPanel", () => {
    const result = ipcMain._handlers["open-control-panel"]();
    expect(managers.windowManager.showControlPanel).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("set-always-on-top sets the flag", () => {
    const result = ipcMain._handlers["set-always-on-top"]({}, true);
    expect(managers.windowManager.mainWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(result).toEqual({ success: true });
  });
});
