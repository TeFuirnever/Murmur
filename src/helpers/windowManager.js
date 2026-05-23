const { BrowserWindow, session } = require("electron");
const path = require("path");
const C = require("./ipc-contracts");

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.historyWindow = null;
    this.settingsWindow = null;
    this._creatingMainWindow = false;
    this._alwaysOnTop = true;
    this._cspSetup = false;
  }

  setDefaultAlwaysOnTop(enabled) {
    this._alwaysOnTop = enabled;
  }

  _setupCSP() {
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

  async createMainWindow() {
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
        transparent: true,
        alwaysOnTop: this._alwaysOnTop,
        resizable: true,
        minWidth: 400,
        minHeight: 500,
        skipTaskbar: true,
        movable: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: path.join(
            __dirname,
            "..",
            "..",
            "dist-preload",
            "preload.js",
          ),
        },
      });

      const isDev = process.env.NODE_ENV === "development";

      if (isDev) {
        await this.mainWindow.loadURL("http://localhost:5173");
      } else {
        await this.mainWindow.loadFile(
          path.join(__dirname, "..", "dist", "index.html"),
        );
      }

      this.mainWindow.on("closed", () => {
        this.mainWindow = null;
      });

      this.mainWindow.on("maximize", () => {
        this.mainWindow.webContents.send(C.EVENTS.WINDOW_MAXIMIZE_CHANGE, true);
      });

      this.mainWindow.on("unmaximize", () => {
        this.mainWindow.webContents.send(
          C.EVENTS.WINDOW_MAXIMIZE_CHANGE,
          false,
        );
      });

      return this.mainWindow;
    } finally {
      this._creatingMainWindow = false;
    }
  }

  async createHistoryWindow() {
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
        preload: path.join(__dirname, "..", "..", "dist-preload", "preload.js"),
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.historyWindow.loadURL("http://localhost:5173/history.html");
    } else {
      await this.historyWindow.loadFile(
        path.join(__dirname, "..", "dist", "history.html"),
      );
    }

    this.historyWindow.on("closed", () => {
      this.historyWindow = null;
    });

    return this.historyWindow;
  }

  async createSettingsWindow() {
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
        preload: path.join(__dirname, "..", "..", "dist-preload", "preload.js"),
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.settingsWindow.loadURL("http://localhost:5173?page=settings");
    } else {
      await this.settingsWindow.loadFile(
        path.join(__dirname, "..", "dist", "settings.html"),
      );
    }

    this.settingsWindow.on("closed", () => {
      this.settingsWindow = null;
    });

    return this.settingsWindow;
  }

  showHistoryWindow() {
    const show = () => {
      this.historyWindow.show();
      this.historyWindow.focus();
      this.historyWindow.setAlwaysOnTop(this._alwaysOnTop);
    };
    if (this.historyWindow) {
      show();
    } else {
      this.createHistoryWindow().then(show);
    }
  }

  hideHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.hide();
    }
  }

  closeHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.close();
    }
  }

  showSettingsWindow() {
    const show = () => {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      this.settingsWindow.setAlwaysOnTop(this._alwaysOnTop);
    };
    if (this.settingsWindow) {
      show();
    } else {
      this.createSettingsWindow().then(show);
    }
  }

  hideSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.hide();
    }
  }

  closeSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.close();
    }
  }

  closeAllWindows() {
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

module.exports = WindowManager;
