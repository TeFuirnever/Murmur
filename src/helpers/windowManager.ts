// [20260724_TS_BigBang_WindowManager] Migrated from .js to .ts (ADR-010).
// `module.exports = WindowManager` (class) became `export default
// WindowManager`. ipc-contracts consumed via namespace import.
// [20260724_TS_BigBang_DirnameFix] Add app import for getAppPath()-based
// path resolution. After esbuild bundling, __dirname becomes dist-main/,
// so __dirname-relative paths break. app.getAppPath() returns the project
// root in dev and the asar app dir in prod — correct for both.
import { BrowserWindow, session, app } from "electron";
// [20260724_TS_BigBang_DirnameFix] END
import path from "path";
import * as C from "./ipc-contracts";

class WindowManager {
  mainWindow: Electron.BrowserWindow | null;
  historyWindow: Electron.BrowserWindow | null;
  settingsWindow: Electron.BrowserWindow | null;
  private _creatingMainWindow: boolean;
  private _alwaysOnTop: boolean;
  private _cspSetup: boolean;
  // [20260602_Fix_MaximizeToggle] Bounds snapshot before maximize
  // On Windows, transparent windows always report isMaximized() === false,
  // so we use this property as the maximize-state flag instead.
  _preMaximizeBounds: Electron.Rectangle | null;

  constructor() {
    this.mainWindow = null;
    this.historyWindow = null;
    this.settingsWindow = null;
    this._creatingMainWindow = false;
    this._alwaysOnTop = true;
    this._cspSetup = false;
    // [20260602_Fix_MaximizeToggle] Bounds snapshot before maximize
    // On Windows, transparent windows always report isMaximized() === false,
    // so we use this property as the maximize-state flag instead.
    this._preMaximizeBounds = null;
  }

  setDefaultAlwaysOnTop(enabled: boolean): void {
    this._alwaysOnTop = enabled;
  }

  _setupCSP(): void {
    if (this._cspSetup) return;
    this._cspSetup = true;

    const isDev = process.env.NODE_ENV === "development";
    // connect-src is intentionally permissive (any https endpoint). AI
    // calls are user-configurable; the actual SSRF guard lives in
    // aiHandlers.validateAIBaseUrl. CSP still restricts scripts, styles,
    // and other vectors strictly.
    const prodCsp =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:";
    const devCsp =
      "default-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:* https:";

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [isDev ? devCsp : prodCsp],
        },
      });
    });
  }

  async createMainWindow(): Promise<Electron.BrowserWindow | null> {
    if (this.mainWindow) {
      this.mainWindow.focus();
      return this.mainWindow;
    }
    if (this._creatingMainWindow) return null;
    this._creatingMainWindow = true;
    try {
      this.mainWindow = new BrowserWindow({
        width: 520,
        height: 640,
        frame: false,
        // [ADR-015] Removed transparent:true — Tracer confirmed body/#root CSS
        // backgrounds are opaque, so transparency was unused. transparent +
        // skipTaskbar:false is a known-broken combination on Windows.
        alwaysOnTop: this._alwaysOnTop,
        resizable: true,
        minWidth: 400,
        minHeight: 500,
        // [ADR-015] Removed skipTaskbar:true — the app must show a taskbar
        // icon so users can find and restore the window.
        icon: this.getMainWindowIconPath(),
        movable: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          // [ADR-015] Disable background throttling so renderer timers (AI
          // optimization setTimeout, model status polling) are not throttled
          // when the main window is hidden. Without this, a 100ms delay
          // becomes ~1s and transcription results can be lost.
          backgroundThrottling: false,
          // [20260724_TS_BigBang_DirnameFix] Use app.getAppPath() instead of
          // __dirname so the path survives esbuild bundling.
          preload: path.join(app.getAppPath(), "dist-preload", "preload.js"),
          // [20260724_TS_BigBang_DirnameFix] END
        },
      });

      const isDev = process.env.NODE_ENV === "development";

      if (isDev) {
        await this.mainWindow.loadURL("http://localhost:5173");
      } else {
        await this.mainWindow.loadFile(
          // [20260724_TS_BigBang_DirnameFix] Renderer HTML lives at
          // src/dist/ in both dev and packaged layouts.
          path.join(app.getAppPath(), "src", "dist", "index.html"),
          // [20260724_TS_BigBang_DirnameFix] END
        );
      }

      this.mainWindow.on("closed", () => {
        this.mainWindow = null;
      });

      this.mainWindow.on("maximize", () => {
        this.mainWindow!.webContents.send(
          C.EVENTS.WINDOW_MAXIMIZE_CHANGE,
          true,
        );
      });

      this.mainWindow.on("unmaximize", () => {
        // [Windows Compat] Clear stale bounds on OS-initiated unmaximize so
        // IS_MAX does not return a false positive on macOS.
        this._preMaximizeBounds = null;
        this.mainWindow!.webContents.send(
          C.EVENTS.WINDOW_MAXIMIZE_CHANGE,
          false,
        );
      });

      return this.mainWindow;
    } finally {
      this._creatingMainWindow = false;
    }
  }

  async createHistoryWindow(): Promise<Electron.BrowserWindow> {
    if (this.historyWindow) {
      this.historyWindow.focus();
      return this.historyWindow;
    }

    this.historyWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      title: "转录历史 - Murmur",
      alwaysOnTop: this._alwaysOnTop,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // [20260724_TS_BigBang_DirnameFix] app.getAppPath()-based preload path
        preload: path.join(app.getAppPath(), "dist-preload", "preload.js"),
        // [20260724_TS_BigBang_DirnameFix] END
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.historyWindow.loadURL("http://localhost:5173/history.html");
    } else {
      await this.historyWindow.loadFile(
        // [20260724_TS_BigBang_DirnameFix] Renderer HTML at src/dist/
        path.join(app.getAppPath(), "src", "dist", "history.html"),
        // [20260724_TS_BigBang_DirnameFix] END
      );
    }

    this.historyWindow.on("closed", () => {
      this.historyWindow = null;
      // [ADR-015] Restore focus to main window so the app doesn't "disappear"
      this.restoreMainWindow();
    });

    return this.historyWindow;
  }

  async createSettingsWindow(): Promise<Electron.BrowserWindow> {
    if (this.settingsWindow) {
      this.settingsWindow.focus();
      return this.settingsWindow;
    }

    this.settingsWindow = new BrowserWindow({
      width: 700,
      height: 600,
      show: false,
      title: "设置 - Murmur",
      alwaysOnTop: this._alwaysOnTop,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // [20260724_TS_BigBang_DirnameFix] app.getAppPath()-based preload path
        preload: path.join(app.getAppPath(), "dist-preload", "preload.js"),
        // [20260724_TS_BigBang_DirnameFix] END
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      // [20260816_Refactor_DeadChannels] Dev settings window now loads the
      // settings.html entry directly (same pattern as historyWindow above) —
      // the old ?page=settings route through an in-App lazy page was removed.
      await this.settingsWindow.loadURL("http://localhost:5173/settings.html");
    } else {
      await this.settingsWindow.loadFile(
        // [20260724_TS_BigBang_DirnameFix] Renderer HTML at src/dist/
        path.join(app.getAppPath(), "src", "dist", "settings.html"),
        // [20260724_TS_BigBang_DirnameFix] END
      );
    }

    this.settingsWindow.on("closed", () => {
      this.settingsWindow = null;
      // [ADR-015] Restore focus to main window so the app doesn't "disappear"
      this.restoreMainWindow();
    });

    return this.settingsWindow;
  }

  showHistoryWindow(): void {
    // [ADR-015] Temporarily disable main window alwaysOnTop so the history
    // window is not covered by the floating panel. Restored on close.
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setAlwaysOnTop(false);
    }
    const show = () => {
      this.historyWindow!.show();
      this.historyWindow!.focus();
    };
    if (this.historyWindow) {
      show();
    } else {
      this.createHistoryWindow().then(show);
    }
  }

  hideHistoryWindow(): void {
    if (this.historyWindow) {
      this.historyWindow.hide();
    }
  }

  closeHistoryWindow(): void {
    if (this.historyWindow) {
      this.historyWindow.close();
    }
  }

  showSettingsWindow(): void {
    // [ADR-015] Temporarily disable main window alwaysOnTop so the settings
    // window is not covered by the floating panel. Restored on close.
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setAlwaysOnTop(false);
    }
    const show = () => {
      this.settingsWindow!.show();
      this.settingsWindow!.focus();
    };
    if (this.settingsWindow) {
      show();
    } else {
      this.createSettingsWindow().then(show);
    }
  }

  hideSettingsWindow(): void {
    if (this.settingsWindow) {
      this.settingsWindow.hide();
    }
  }

  closeSettingsWindow(): void {
    if (this.settingsWindow) {
      this.settingsWindow.close();
    }
  }

  // [ADR-015] Restore main window visibility, focus, and alwaysOnTop state.
  // Called when a child window (settings/history) closes or hides, so the app
  // doesn't appear to "disappear" after the child window is gone.
  restoreMainWindow(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setAlwaysOnTop(this._alwaysOnTop);
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  // [ADR-015] Dev/prod icon path resolution — mirrors tray.ts:getTrayIconPath()
  // pattern. In production, assets live under process.resourcesPath (asar).
  private getMainWindowIconPath(): string {
    const isDev = process.env.NODE_ENV === "development";
    if (isDev) {
      return path.join(app.getAppPath(), "assets", "icon.png");
    }
    return path.join(process.resourcesPath, "assets", "icon.png");
  }

  closeAllWindows(): void {
    if (this.mainWindow) {
      this.mainWindow.close();
    }
    if (this.historyWindow) {
      this.historyWindow.close();
    }
    if (this.settingsWindow) {
      this.settingsWindow.close();
    }
  }
}

export default WindowManager;
