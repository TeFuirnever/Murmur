// [20260724_TS_BigBang_SystemHandlers] Migrated from .js to .ts (ADR-010).
import { app, shell, BrowserWindow } from "electron";
import * as C from "../ipc-contracts";

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
  getSystemInfo?(): unknown;
  [key: string]: unknown;
}

interface ClipboardManager {
  checkAccessibilityPermissions(): Promise<boolean>;
  openSystemSettings(): void;
  pasteText(text: string): Promise<unknown>;
}

interface FunasrManager {
  isInitialized: boolean;
  modelsInitialized: boolean;
  serverReady: boolean;
  pythonCmd: string | null;
}

interface Managers {
  logger: Logger;
  funasrManager: FunasrManager;
  clipboardManager: ClipboardManager;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { logger, funasrManager, clipboardManager } = managers;

  ipcMain.handle(C.SYSTEM.OPEN_EXTERNAL, (_event, url: string) => {
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
      logger.error?.("检查权限失败:", error);
      return {
        microphone: false,
        accessibility: false,
        error: (error as Error).message,
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
      logger.error?.("请求权限失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(C.SYSTEM.TEST_A11Y, async () => {
    try {
      await clipboardManager.pasteText("Murmur权限测试");
      return { success: true, message: "辅助功能权限测试成功" };
    } catch (error) {
      logger.error?.("辅助功能权限测试失败:", error);
      return { success: false, error: (error as Error).message };
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
      logger.error?.("打开系统权限设置失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(C.SYSTEM.VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(
    C.SYSTEM.LOG,
    (_event, level: string, message: string, data: unknown) => {
      // [20260724_TS_BigBang_SystemHandlers] Dynamic log-level dispatch.
      // Logger index signature returns unknown; cast to a callable shape.
      const fn = (
        logger as unknown as Record<
          string,
          ((...args: unknown[]) => void) | undefined
        >
      )[level];
      fn?.(`[渲染进程] ${message}`, data || "");
      return true;
    },
  );

  ipcMain.handle(C.SYSTEM.DEBUG_INFO, () => {
    try {
      const debugInfo: Record<string, unknown> = {
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
      logger.error?.("获取系统调试信息失败:", error);
      return { success: false, error: (error as Error).message };
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
// [20260724_TS_BigBang_SystemHandlers] END
