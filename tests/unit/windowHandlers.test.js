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
      getBounds: vi.fn(() => ({ x: 100, y: 100, width: 520, height: 640 })),
      setBounds: vi.fn(),
    };

    const historyWindow = {
      setAlwaysOnTop: vi.fn(),
    };
    const settingsWindow = {
      setAlwaysOnTop: vi.fn(),
    };

    managers = {
      windowManager: {
        mainWindow,
        historyWindow,
        settingsWindow,
        setDefaultAlwaysOnTop: vi.fn(),
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
    expect(channels.length).toBeGreaterThanOrEqual(7);
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

  // [20260602_Fix_MaximizeToggle] Use _preMaximizeBounds instead of isMaximized()
  it("maximize-window toggles maximize state", () => {
    const win = managers.windowManager.mainWindow;
    win.webContents = { send: vi.fn() };
    ipcMain._handlers["maximize-window"]();
    expect(win.maximize).toHaveBeenCalled();

    ipcMain._handlers["maximize-window"]();
    expect(win.setBounds).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(
      "window-maximize-change",
      false,
    );
  });

  // [20260602_Fix_MaximizeToggle] Regression: save/restore bounds across multiple toggle cycles
  it("maximize-window saves bounds before maximize and restores on second click", () => {
    const win = managers.windowManager.mainWindow;
    const originalBounds = { x: 100, y: 200, width: 520, height: 640 };
    win.getBounds.mockReturnValue(originalBounds);
    win.webContents = { send: vi.fn() };

    // First click: not maximized → save bounds, then maximize
    ipcMain._handlers["maximize-window"]();
    expect(win.maximize).toHaveBeenCalled();
    expect(win.getBounds).toHaveBeenCalled();

    // Second click: has saved bounds → restore via setBounds
    ipcMain._handlers["maximize-window"]();
    expect(win.setBounds).toHaveBeenCalledWith(originalBounds);
    expect(win.webContents.send).toHaveBeenCalledWith(
      "window-maximize-change",
      false,
    );

    // Third click: no saved bounds → maximize again
    win.maximize.mockClear();
    ipcMain._handlers["maximize-window"]();
    expect(win.maximize).toHaveBeenCalled();
  });

  it("is-window-maximized returns maximize state via isMaximized()", () => {
    managers.windowManager.mainWindow.isMaximized.mockReturnValue(true);
    expect(ipcMain._handlers["is-window-maximized"]()).toBe(true);

    managers.windowManager.mainWindow.isMaximized.mockReturnValue(false);
    expect(ipcMain._handlers["is-window-maximized"]()).toBe(false);
  });

  // [Windows Compat] IS_MAX must reflect _preMaximizeBounds state, because
  // win.isMaximized() always returns false for transparent windows on Windows.
  // If this test fails, the IS_MAX handler still calls isMaximized() directly.
  it("is-window-maximized returns true when _preMaximizeBounds is set (Windows transparent compat)", () => {
    const win = managers.windowManager.mainWindow;
    win.webContents = { send: vi.fn() };
    // Simulate Windows transparent window: isMaximized() always returns false
    win.isMaximized.mockReturnValue(false);

    // First click: maximize via handler (sets _preMaximizeBounds)
    ipcMain._handlers["maximize-window"]();

    // IS_MAX should return true despite isMaximized() being false
    expect(ipcMain._handlers["is-window-maximized"]()).toBe(true);

    // Second click: restore (clears _preMaximizeBounds)
    ipcMain._handlers["maximize-window"]();

    // IS_MAX should now return false
    expect(ipcMain._handlers["is-window-maximized"]()).toBe(false);
  });

  // [macOS Compat] Regression: OS-initiated unmaximize must clear _preMaximizeBounds
  // so IS_MAX does not return a stale true on macOS.
  it("is-window-maximized returns false after OS-initiated unmaximize clears _preMaximizeBounds", () => {
    const win = managers.windowManager.mainWindow;
    win.webContents = { send: vi.fn() };
    win.isMaximized.mockReturnValue(false);

    // Maximize via button (sets _preMaximizeBounds)
    ipcMain._handlers["maximize-window"]();
    expect(ipcMain._handlers["is-window-maximized"]()).toBe(true);

    // Simulate OS-initiated unmaximize (e.g. user drags window away on macOS)
    // windowManager's unmaximize handler clears _preMaximizeBounds
    managers.windowManager._preMaximizeBounds = null;

    // IS_MAX should now return false (falls back to isMaximized() = false)
    expect(ipcMain._handlers["is-window-maximized"]()).toBe(false);
  });

  it("close-window closes the main window", () => {
    const result = ipcMain._handlers["close-window"]();
    expect(managers.windowManager.mainWindow.close).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("set-always-on-top sets the flag on all windows", () => {
    const result = ipcMain._handlers["set-always-on-top"]({}, true);
    expect(managers.windowManager.setDefaultAlwaysOnTop).toHaveBeenCalledWith(
      true,
    );
    expect(
      managers.windowManager.mainWindow.setAlwaysOnTop,
    ).toHaveBeenCalledWith(true);
    expect(
      managers.windowManager.historyWindow.setAlwaysOnTop,
    ).toHaveBeenCalledWith(true);
    expect(
      managers.windowManager.settingsWindow.setAlwaysOnTop,
    ).toHaveBeenCalledWith(true);
    expect(result).toEqual({ success: true });
  });
});
