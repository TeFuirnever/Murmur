// [20260724_TS_BigBang_WindowHandlers] Migrated from .js to .ts (ADR-010).
import { app } from "electron";
import * as C from "../ipc-contracts";

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowManager {
  mainWindow: Electron.BrowserWindow | null;
  historyWindow: Electron.BrowserWindow | null;
  settingsWindow: Electron.BrowserWindow | null;
  _preMaximizeBounds: Rectangle | null;
  setDefaultAlwaysOnTop(enabled: boolean): void;
  showHistoryWindow(): void;
  closeHistoryWindow(): void;
  hideHistoryWindow(): void;
  showSettingsWindow(): void;
  closeSettingsWindow(): void;
  hideSettingsWindow(): void;
}

interface Managers {
  windowManager: WindowManager;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
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

  ipcMain.handle(C.WINDOW.SET_TOP, (_event, enabled: boolean) => {
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
// [20260724_TS_BigBang_WindowHandlers] END
