// [20260724_TS_BigBang_MainEntry] Migrated from main.js to main.ts (ADR-010).
// Entry point for the Electron main process. Top-level `require("electron")`
// and helper modules became ESM imports. The `module.exports = { managers }`
// at the bottom became ESM named exports — no consumer requires main.ts as a
// module (e2e tests launch the bundled dist-main/main.js via Electron, and
// unit tests read source as text), so ESM is safe.

// [20260725_E2E_CiStartupCanary] FIRST-LINE CANARY — must run before any
// import to confirm main.ts is even loaded by Electron. If this does not
// appear in CI logs, the issue is BEFORE main.ts (Electron binary itself,
// esbuild bundle, or app path resolution).
console.error("[main:canary] main.ts module-load-started");
// [20260725_E2E_CiStartupCanary] END
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
const trayManager = new TrayManager(logger);
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
  // [20260725_E2E_CiStartupFix] Skip on CI runners — app.dock.show()
  // throws when no interactive GUI session is available (macOS GitHub
  // Actions runners have no Dock). The thrown error escaped startApp
  // as an unhandled rejection because the caller at line 229 did not
  // await startApp(). With the caller fix above this is now caught,
  // but skipping dock.show() in CI is also correct: CI doesn't need
  // a Dock icon, and calling it just to swallow the error is noise.
  if (process.platform === "darwin" && app.dock && process.env.CI !== "true") {
    try {
      await app.dock.show();
      logger.info("macOS Dock已显示");
    } catch (err) {
      // Defensive: dock.show can still fail on unusual macOS configs.
      logger.warn("macOS Dock显示失败 (非致命):", err);
    }
  }
  // [20260725_E2E_CiStartupFix] END

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

// [20260724_Fix_E2E_Headless] Disable GPU hardware acceleration in test
// mode. CI macOS runners lack GPU support, causing firstWindow() timeout
// when Electron tries to initialize the compositor. This is the standard
// fix recommended by Playwright and Electron docs for headless CI.
if (process.env.NODE_ENV === "test") {
  app.disableHardwareAcceleration();
}
// [20260724_Fix_E2E_Headless] END

// [20260725_E2E_CiStartupCanary] PRE-WHENREADY CANARY — runs after all
// top-level imports and disableHardwareAcceleration, before whenReady
// is registered. If canary #1 prints but this doesn't, an import is
// throwing at module-load time.
console.error("[main:canary] main.ts pre-whenReady (imports done)");
// [20260725_E2E_CiStartupCanary] END

// [20260725_E2E_CiStartupCanary] READY-EVENT CANARY — registers a direct
// listener on the 'ready' event IN ADDITION to whenReady().then(). If
// ready fires but whenReady().then() doesn't, we have a Playwright/Electron
// Promise-interop bug. If neither fires, Electron itself never initializes.
app.on("ready", () => {
  console.error("[main:canary] app.on('ready') fired");
});
// [20260725_E2E_CiStartupCanary] END

// App event handlers
// [20260725_E2E_CiStartupFix] The original `.then(() => { startApp(); })`
// had two issues that combined to produce silent CI macOS failure:
//
// 1. `startApp()` is async and returns a Promise, but the .then() callback
//    is sync. Any rejection inside startApp (e.g. from app.dock.show() on
//    a CI runner without a GUI session) became an unhandled rejection —
//    caught by process.on('unhandledRejection') at line 31 which only
//    logs, never quits. The app sat half-initialized until Playwright's
//    30s firstWindow timeout disconnected the inspector (exit code 0).
//    See docs/research/e2e-functional-verification-strategy.md §7 Stage 0
//    "2026-07-25 update 2" for the full evidence chain.
//
// 2. `app.dock.show()` at startApp:186 requires a macOS Dock session.
//    On CI macOS runners (which have no interactive GUI), this throws.
//    Now guarded by a try/catch and skipped when CI=true.
//
// The fix: wrap whenReady callback in async IIFE with try/catch that
// logs the failure AND quits the app so Playwright sees a real exit
// code instead of timing out. Canaries at each phase help narrow any
// future regression.
// [20260725_E2E_CiStartupFix] END
app.whenReady().then(async () => {
  // [20260725_E2E_CiStartupFix] Phase canaries — stderr so Playwright's
  // app.process().stderr listener captures them in CI logs. Each marks
  // a distinct phase so a future hang pinpoints the failing step.
  console.error("[main:startup] phase=whenReady-fired");
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      databaseManager.setSafeStorage(safeStorage);
    }
    console.error("[main:startup] phase=safeStorage-done");
    await startApp();
    console.error("[main:startup] phase=startApp-complete");
  } catch (err) {
    // CRITICAL: previously this rejection was unhandled, leaving the
    // app half-alive. Now we log with stack AND quit so the CI run
    // surfaces a real failure rather than a 30s timeout.
    console.error("[main:startup] phase=startApp-failed", err);
    if (err instanceof Error) {
      console.error("[main:startup] stack:", err.stack);
    }
    // app.quit() ignores exit codes; use process.exit after the
    // will-quit handlers run so the failure is visible to Playwright.
    app.quit();
    process.exitCode = 1;
  }
});
// [20260725_E2E_CiStartupFix] END

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
