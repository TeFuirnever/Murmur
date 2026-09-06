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
  // [20260822_T12_IdleUnload] Hotkey-down reload pre-trigger (#190).
  reloadModels(): Promise<unknown>;
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

  // [20260906_Refactor_DeadChannelCleanup] Ticket #250: the FUNASR.INSTALL
  // handler (and its install-progress event sender) and the FUNASR.RESTART
  // handler were removed — zero renderer callers (orphans yellow list).

  // [20260822_T12_IdleUnload] Hotkey-down pre-trigger: fire-and-forget —
  // the renderer never blocks on the reload; the transcription request
  // that follows waits on the Python models lock instead.
  ipcMain.handle(C.FUNASR.RELOAD_MODELS, async () => {
    try {
      // [T12 review MINOR] The promise can reject (reload timeout / server
      // died mid-reload) — route it to the logger, not the global
      // unhandledRejection handler.
      funasrManager
        .reloadModels()
        .catch((e: unknown) => logger.warn?.("模型重载失败", e));
      return { success: true, message: "模型重载已触发" };
    } catch (error) {
      logger.error?.("触发模型重载失败", error);
      return { success: false, error: (error as Error).message };
    }
  });
}
// [20260724_TS_BigBang_EnvironmentHandlers] END
