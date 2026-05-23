const { app, shell, BrowserWindow, net } = require("electron");
const path = require("path");
const C = require("../ipc-contracts");

function semverGt(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function register(ipcMain, managers) {
  const { logger, funasrManager, clipboardManager } = managers;

  ipcMain.handle(C.SYSTEM.SHOW_ITEM, (event, fullPath) => {
    if (!fullPath || typeof fullPath !== "string") return;
    const userDataPath = app.getPath("userData");
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(userDataPath)) {
      logger.warn("阻止访问用户数据目录外的路径:", fullPath);
      return;
    }
    shell.showItemInFolder(resolved);
  });

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

  ipcMain.handle(C.SYSTEM.GET_APP_PATH, (event, name) => {
    return app.getPath(name);
  });

  ipcMain.handle(C.SYSTEM.UPDATES, async () => {
    try {
      const currentVersion = app.getVersion();
      const response = await net.fetch(
        "https://api.github.com/repos/TeFuirnever/Murmur/releases/latest",
      );
      if (!response.ok) {
        return { hasUpdate: false, currentVersion, error: "无法检查更新" };
      }
      const data = await response.json();
      if (!data || typeof data.tag_name !== "string") {
        return { hasUpdate: false, currentVersion, error: "更新信息格式异常" };
      }
      const latestVersion = data.tag_name.replace(/^v/, "");
      const hasUpdate = semverGt(latestVersion, currentVersion);
      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseUrl: data.html_url,
        releaseNotes: data.body || "",
        message: hasUpdate
          ? `发现新版本 v${latestVersion}`
          : "当前已是最新版本",
      };
    } catch (error) {
      logger?.warn?.("检查更新失败", error);
      return {
        hasUpdate: false,
        currentVersion: app.getVersion(),
        error: "检查更新失败",
      };
    }
  });

  ipcMain.handle(C.SYSTEM.LOG, (event, level, message, data) => {
    logger[level](`[渲染进程] ${message}`, data || "");
    return true;
  });

  ipcMain.handle(C.SYSTEM.GET_APP_LOGS, (event, lines = 100) => {
    try {
      if (logger && logger.getRecentLogs) {
        return { success: true, logs: logger.getRecentLogs(lines) };
      }
      return { success: false, error: "日志管理器不可用" };
    } catch (error) {
      logger.error("获取应用日志失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.FUNASR.GET_LOGS, (event, lines = 100) => {
    try {
      if (logger && logger.getFunASRLogs) {
        return { success: true, logs: logger.getFunASRLogs(lines) };
      }
      return { success: false, error: "日志管理器不可用" };
    } catch (error) {
      logger.error("获取FunASR日志失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.SYSTEM.GET_LOG_PATH, () => {
    try {
      if (logger && logger.getLogFilePath) {
        return {
          success: true,
          appLogPath: logger.getLogFilePath(),
          funasrLogPath: logger.getFunASRLogFilePath(),
        };
      }
      return { success: false, error: "日志管理器不可用" };
    } catch (error) {
      logger.error("获取日志文件路径失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.SYSTEM.OPEN_LOG, (event, logType = "app") => {
    try {
      if (logger) {
        const logPath =
          logType === "funasr"
            ? logger.getFunASRLogFilePath()
            : logger.getLogFilePath();

        const userDataPath = app.getPath("userData");
        if (!path.resolve(logPath).startsWith(userDataPath)) {
          return { success: false, error: "路径不在允许范围内" };
        }
        shell.showItemInFolder(logPath);
        return { success: true };
      }
      return { success: false, error: "日志管理器不可用" };
    } catch (error) {
      logger.error("打开日志文件失败:", error);
      return { success: false, error: error.message };
    }
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
