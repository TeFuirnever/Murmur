const { app } = require("electron");
const C = require("../ipc-contracts");

function register(ipcMain, managers) {
  const { windowManager } = managers;

  ipcMain.handle(C.WINDOW.HIDE, () => {
    if (windowManager.mainWindow) {
      windowManager.mainWindow.hide();
    }
    return true;
  });

  ipcMain.handle(C.WINDOW.SHOW, () => {
    if (windowManager.mainWindow) {
      windowManager.mainWindow.show();
    }
    return true;
  });

  ipcMain.handle(C.WINDOW.MINIMIZE, () => {
    if (windowManager.mainWindow) {
      windowManager.mainWindow.minimize();
    }
    return true;
  });

  // [20260602_Fix_MaximizeToggle] Fix maximize-toggle on Windows transparent windows.
  // Root cause: win.isMaximized() always returns false for transparent windows on
  // Windows, so the restore path was never taken and maximize() was called again.
  // Fix: track maximize state via _preMaximizeBounds (null = normal, non-null = maximized).
  // Save bounds before maximize, restore with setBounds() on toggle, and notify
  // the renderer directly since the unmaximize event may not fire.
  ipcMain.handle(C.WINDOW.MAXIMIZE, () => {
    if (windowManager.mainWindow) {
      const win = windowManager.mainWindow;
      const saved = windowManager._preMaximizeBounds;
      if (saved) {
        windowManager._preMaximizeBounds = null;
        win.setBounds(saved);
        win.webContents.send(C.EVENTS.WINDOW_MAXIMIZE_CHANGE, false);
      } else {
        windowManager._preMaximizeBounds = win.getBounds();
        win.maximize();
      }
    }
    return true;
  });
  // [20260602_Fix_MaximizeToggle] END

  // [Windows Compat] On Windows transparent windows, isMaximized() always
  // returns false. Use _preMaximizeBounds as the authoritative flag (set by
  // the MAXIMIZE handler above). Fall back to isMaximized() for OS-initiated
  // maximize on other platforms.
  ipcMain.handle(C.WINDOW.IS_MAX, () => {
    if (windowManager.mainWindow) {
      return (
        !!windowManager._preMaximizeBounds ||
        windowManager.mainWindow.isMaximized()
      );
    }
    return false;
  });

  ipcMain.handle(C.WINDOW.CLOSE, () => {
    if (windowManager.mainWindow) {
      windowManager.mainWindow.close();
    }
    return true;
  });

  ipcMain.handle(C.WINDOW.SET_TOP, (event, enabled) => {
    windowManager.setDefaultAlwaysOnTop(enabled);
    for (const win of [
      windowManager.mainWindow,
      windowManager.historyWindow,
      windowManager.settingsWindow,
    ]) {
      if (win) win.setAlwaysOnTop(enabled);
    }
    return { success: true };
  });

  ipcMain.handle(C.WINDOW.OPEN_HISTORY, () => {
    windowManager.showHistoryWindow();
    return true;
  });

  ipcMain.handle(C.WINDOW.CLOSE_HISTORY, () => {
    windowManager.closeHistoryWindow();
    return true;
  });

  ipcMain.handle(C.WINDOW.HIDE_HISTORY, () => {
    windowManager.hideHistoryWindow();
    return true;
  });

  ipcMain.handle(C.WINDOW.OPEN_SETTINGS, () => {
    windowManager.showSettingsWindow();
    return true;
  });

  ipcMain.handle(C.WINDOW.CLOSE_SETTINGS, () => {
    windowManager.closeSettingsWindow();
    return true;
  });

  ipcMain.handle(C.WINDOW.HIDE_SETTINGS, () => {
    windowManager.hideSettingsWindow();
    return true;
  });

  ipcMain.handle(C.WINDOW.CLOSE_APP, () => {
    app.quit();
  });
}

module.exports = { register };
