// [20260724_TS_BigBang_MainEntry] Migrated from main.js to main.ts (ADR-010).
// Entry point for the Electron main process. Top-level `require("electron")`
// and helper modules became ESM imports. The `module.exports = { managers }`
// at the bottom became ESM named exports — no consumer requires main.ts as a
// module (e2e tests launch the bundled dist-main/main.js via Electron, and
// unit tests read source as text), so ESM is safe.
import {
  app,
  globalShortcut,
  BrowserWindow,
  safeStorage,
  ipcMain,
} from "electron";
import path from "path";

// Import log manager
import LogManager from "./src/helpers/logManager";

// Initialize log manager
const logger = new LogManager();

// Add global error handling
process.on("uncaughtException", (error: Error & { code?: string }) => {
  logger.error("Uncaught Exception:", error);
  if (error.code === "EPIPE") {
    return;
  }
  logger.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason: unknown, promise: unknown) => {
  logger.error("Unhandled Rejection at:", { promise, reason });
});

// Import helper modules
import EnvironmentManager from "./src/helpers/environment";
import WindowManager from "./src/helpers/windowManager";
import DatabaseManager from "./src/helpers/database";
import ClipboardManager from "./src/helpers/clipboard";
import FunASRManager from "./src/helpers/funasrManager";
import TrayManager from "./src/helpers/tray";
import HotkeyManager from "./src/helpers/hotkeyManager";
import { registerAll as registerIPCHandlers } from "./src/helpers/ipc";

// Set production environment PATH
function setupProductionPath(): void {
  logger.info("设置生产环境PATH", {
    platform: process.platform,
    nodeEnv: process.env.NODE_ENV,
    currentPath: process.env.PATH,
  });

  if (process.platform === "darwin" && process.env.NODE_ENV !== "development") {
    const commonPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      "/Library/Frameworks/Python.framework/Versions/3.9/bin",
      "/Library/Frameworks/Python.framework/Versions/3.8/bin",
      // Add more possible Python paths
      "/opt/homebrew/opt/python@3.11/bin",
      "/opt/homebrew/opt/python@3.10/bin",
      "/opt/homebrew/opt/python@3.9/bin",
      "/usr/local/opt/python@3.11/bin",
      "/usr/local/opt/python@3.10/bin",
      "/usr/local/opt/python@3.9/bin",
    ];

    const currentPath = process.env.PATH || "";
    const pathsToAdd = commonPaths.filter((p) => !currentPath.includes(p));

    if (pathsToAdd.length > 0) {
      const newPath = `${currentPath}:${pathsToAdd.join(":")}`;
      process.env.PATH = newPath;
      logger.info("PATH已更新", {
        添加的路径: pathsToAdd,
        新PATH: newPath,
      });
    } else {
      logger.info("PATH无需更新，所有路径已存在");
    }
  } else if (
    process.platform === "win32" &&
    process.env.NODE_ENV !== "development"
  ) {
    // Windows platform Python path setup
    const localAppData = process.env.LOCALAPPDATA || "";
    const commonPaths = [
      "C:\\Python311\\Scripts",
      "C:\\Python311",
      "C:\\Python310\\Scripts",
      "C:\\Python310",
      "C:\\Python39\\Scripts",
      "C:\\Python39",
      ...(localAppData
        ? ["Python311", "Python310"].flatMap((ver) => [
            path.join(localAppData, "Programs", "Python", ver, "Scripts"),
            path.join(localAppData, "Programs", "Python", ver),
          ])
        : []),
    ];

    const currentPath = process.env.PATH || "";
    const pathsToAdd = commonPaths.filter((p) => !currentPath.includes(p));

    if (pathsToAdd.length > 0) {
      const newPath = `${currentPath};${pathsToAdd.join(";")}`;
      process.env.PATH = newPath;
      logger.info("Windows PATH已更新", {
        添加的路径: pathsToAdd,
        新PATH: newPath,
      });
    }
  }
}

// 在初始化管理器之前设置PATH
setupProductionPath();

// Set user data directory env var for Python scripts to use
process.env.ELECTRON_USER_DATA = app.getPath("userData");
logger.info("设置用户数据目录环境变量", {
  ELECTRON_USER_DATA: process.env.ELECTRON_USER_DATA,
});

// Initialize managers
const environmentManager = new EnvironmentManager();
const windowManager = new WindowManager();
const databaseManager = new DatabaseManager();
const clipboardManager = new ClipboardManager(logger); // Pass logger instance
const funasrManager = new FunASRManager(logger); // Pass logger instance
const trayManager = new TrayManager();
const hotkeyManager = new HotkeyManager();

// Initialize database
const dataDirectory = environmentManager.ensureDataDirectory();
databaseManager.initialize(dataDirectory);
databaseManager.setFileConfigPath(path.join(dataDirectory, "murmur.json"));

// Initialize IPC handlers with all managers
registerIPCHandlers(ipcMain, {
  environmentManager,
  databaseManager,
  clipboardManager,
  funasrManager,
  windowManager,
  hotkeyManager,
  logger,
});

// Main app startup function
async function startApp(): Promise<void> {
  logger.info("应用启动开始", {
    nodeEnv: process.env.NODE_ENV,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    appVersion: app.getVersion(),
  });

  // Commented out accessibility support - may interfere with text insertion
  // try {
  //   app.setAccessibilitySupportEnabled(true);
  //   logger.info('✅ 已启用 Electron accessibility 支持');
  // } catch (error) {
  //   logger.warn('⚠️ 启用 accessibility 支持失败:', error.message);
  // }

  // Log system info
  logger.info("系统信息", logger.getSystemInfo());

  // In dev mode, add a small delay so Vite starts correctly
  if (process.env.NODE_ENV === "development") {
    logger.info("开发模式，等待Vite启动...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Ensure dock is visible on macOS
  if (process.platform === "darwin" && app.dock) {
    app.dock.show();
    logger.info("macOS Dock已显示");
  }

  // Initialize FunASR manager at startup (don't wait to avoid blocking)
  logger.info("开始初始化FunASR管理器...");
  funasrManager.initializeAtStartup().catch((err: unknown) => {
    logger.warn("FunASR在启动时不可用，这不是关键问题", err);
  });

  // Create main window
  windowManager._setupCSP();
  try {
    logger.info("创建主窗口...");
    const alwaysOnTop = Boolean(
      databaseManager.getSetting("window_always_on_top", true),
    );
    windowManager.setDefaultAlwaysOnTop(alwaysOnTop);
    await windowManager.createMainWindow();
    logger.info("主窗口创建成功");
  } catch (error) {
    logger.error("创建主窗口时出错:", error);
  }

  // Set up tray
  logger.info("设置系统托盘...");
  trayManager.setWindows(windowManager.mainWindow);
  await trayManager.createTray();
  logger.info("系统托盘设置完成");

  logger.info("应用启动完成");
}

// App event handlers
app.whenReady().then(() => {
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    databaseManager.setSafeStorage(safeStorage);
  }
  startApp();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createMainWindow();
  }
});

app.on("will-quit", async (e) => {
  e.preventDefault();
  globalShortcut.unregisterAll();

  try {
    const shutdownPromise = funasrManager.gracefulShutdown();
    await Promise.race([
      shutdownPromise,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (err) {
    logger.error("Error during FunASR shutdown:", err);
  }

  try {
    databaseManager.close();
  } catch (err) {
    logger.error("Error closing database:", err);
  }

  app.exit();
});

// Export managers for use by other modules
export {
  environmentManager,
  windowManager,
  databaseManager,
  clipboardManager,
  funasrManager,
  trayManager,
  hotkeyManager,
  logger,
};
// [20260724_TS_BigBang_MainEntry] END
