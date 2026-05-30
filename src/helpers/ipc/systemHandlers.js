const { app, shell, BrowserWindow } = require("electron");
const C = require("../ipc-contracts");

function register(ipcMain, managers) {
  const { logger, funasrManager, clipboardManager } = managers;

  ipcMain.handle(C.SYSTEM.OPEN_EXTERNAL, (event, url) => {
    if (!url || typeof url !== "string" || !url.startsWith("https:")) {
      logger.warn("阻止打开非HTTPS链接:", url);
      return { success: false, error: "只允许打开HTTPS链接" };
    }
    shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle(C.SYSTEM.INFO, () => {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
    };
  });

  ipcMain.handle(C.SYSTEM.PERMISSIONS, async () => {
    try {
      const hasAccessibility =
        await clipboardManager.checkAccessibilityPermissions();
      return {
        microphone: true,
        accessibility: hasAccessibility,
      };
    } catch (error) {
      logger.error("检查权限失败:", error);
      return {
        microphone: false,
        accessibility: false,
        error: error.message,
      };
    }
  });

  ipcMain.handle(C.SYSTEM.REQUEST_PERMS, async () => {
    try {
      if (process.platform === "darwin") {
        clipboardManager.openSystemSettings();
      }
      return { success: true };
    } catch (error) {
      logger.error("请求权限失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.SYSTEM.TEST_A11Y, async () => {
    try {
      await clipboardManager.pasteText("Murmur权限测试");
      return { success: true, message: "辅助功能权限测试成功" };
    } catch (error) {
      logger.error("辅助功能权限测试失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.SYSTEM.OPEN_PERMS, () => {
    try {
      if (process.platform === "darwin") {
        clipboardManager.openSystemSettings();
        return { success: true };
      } else {
        return { success: false, error: "当前平台不支持自动打开权限设置" };
      }
    } catch (error) {
      logger.error("打开系统权限设置失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.SYSTEM.VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(C.SYSTEM.UPDATES, async () => {
    // Update checking moved to updateManager.js
    return { hasUpdate: false, error: "请使用新的更新检查接口" };
  });

  ipcMain.handle(C.SYSTEM.LOG, (event, level, message, data) => {
    logger[level](`[渲染进程] ${message}`, data || "");
    return true;
  });

  ipcMain.handle(C.SYSTEM.DEBUG_INFO, () => {
    try {
      const debugInfo = {
        system: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          appVersion: app.getVersion(),
        },
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          PYTHON_PATH: process.env.PYTHON_PATH,
          AI_API_KEY: "通过控制面板设置",
          AI_BASE_URL: "通过控制面板设置",
          AI_MODEL: "通过控制面板设置",
        },
        funasrStatus: {
          isInitialized: funasrManager.isInitialized,
          modelsInitialized: funasrManager.modelsInitialized,
          serverReady: funasrManager.serverReady,
          pythonCmd: funasrManager.pythonCmd,
        },
      };

      if (logger && logger.getSystemInfo) {
        debugInfo.loggerInfo = logger.getSystemInfo();
      }

      return { success: true, debugInfo };
    } catch (error) {
      logger.error("获取系统调试信息失败:", error);
      return { success: false, error: error.message };
    }
  });

  if (process.env.NODE_ENV === "development") {
    ipcMain.handle(C.WINDOW.OPEN_DEV_TOOLS, (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        window.webContents.openDevTools();
      }
    });

    ipcMain.handle(C.WINDOW.RELOAD, (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        window.reload();
      }
    });
  }
}

module.exports = { register };
