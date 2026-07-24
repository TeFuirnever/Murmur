// [20260724_TS_BigBang_EnvironmentHandlers] Migrated from .js to .ts (ADR-010).
// `module.exports = { register }` became named export.
import * as C from "../ipc-contracts";

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

interface FunasrManager {
  checkStatus(): Promise<
    Record<string, unknown> & {
      success?: boolean;
      models_downloaded?: boolean;
      python_installed?: boolean;
      funasr_installed?: boolean;
    }
  >;
  installFunASR(
    cb: (progress: Record<string, unknown>) => void,
  ): Promise<unknown>;
  restartServer(): Promise<unknown>;
  modelsInitialized: boolean;
  serverReady: boolean;
  initializationPromise: Promise<unknown> | null;
}

interface Managers {
  funasrManager: FunasrManager;
  logger: Logger;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { funasrManager, logger } = managers;

  ipcMain.handle(C.FUNASR.STATUS, async () => {
    const status = await funasrManager.checkStatus();
    const modelsInitialized = funasrManager.modelsInitialized;
    const serverReady = funasrManager.serverReady;
    const isInitializing = funasrManager.initializationPromise !== null;

    let status_message: string;
    if (serverReady && modelsInitialized) {
      status_message = "ready";
    } else if (isInitializing) {
      status_message = "initializing";
    } else if (status?.models_downloaded === false) {
      status_message = "models_not_downloaded";
    } else if (!status?.python_installed) {
      status_message = "python_not_installed";
    } else if (!status?.funasr_installed) {
      status_message = "funasr_not_installed";
    } else {
      status_message = "not_ready";
    }

    return {
      ...status,
      success: status?.success !== false,
      models_initialized: modelsInitialized,
      server_ready: serverReady,
      is_initializing: isInitializing,
      status_message,
    };
  });

  ipcMain.handle(C.FUNASR.INSTALL, async (event) => {
    return await funasrManager.installFunASR((progress) => {
      event.sender.send(C.EVENTS.FUNASR_INSTALL_PROGRESS, progress);
    });
  });

  ipcMain.handle(C.FUNASR.RESTART, async () => {
    try {
      logger.info?.("手动重启FunASR服务器");
      const result = await funasrManager.restartServer();
      return result;
    } catch (error) {
      logger.error?.("重启FunASR服务器失败", error);
      return { success: false, error: (error as Error).message };
    }
  });
}
// [20260724_TS_BigBang_EnvironmentHandlers] END
