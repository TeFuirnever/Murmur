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

  ipcMain.handle(C.WINDOW.MAXIMIZE, () => {
    if (windowManager.mainWindow) {
      const win = windowManager.mainWindow;
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    return true;
  });

  ipcMain.handle(C.WINDOW.IS_MAX, () => {
    if (windowManager.mainWindow) {
      return windowManager.mainWindow.isMaximized();
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
    const win = windowManager.mainWindow;
    if (win) {
      win.setAlwaysOnTop(enabled);
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle(C.WINDOW.OPEN_CONTROL, () => {
    windowManager.showControlPanel();
    return true;
  });

  ipcMain.handle(C.WINDOW.CLOSE_CONTROL, () => {
    windowManager.hideControlPanel();
    return true;
  });

  ipcMain.handle(C.WINDOW.SHOW_CONTROL, () => {
    windowManager.showControlPanel();
    return true;
  });

  ipcMain.handle(C.WINDOW.HIDE_CONTROL, () => {
    windowManager.hideControlPanel();
    return true;
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
