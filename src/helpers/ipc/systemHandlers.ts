// [20260724_TS_BigBang_SystemHandlers] Migrated from .js to .ts (ADR-010).
// [20260906_Refactor_DeadChannelCleanup] Ticket #250: the SYSTEM.INFO,
// SYSTEM.PERMISSIONS, SYSTEM.REQUEST_PERMS, SYSTEM.TEST_A11Y,
// SYSTEM.OPEN_PERMS, SYSTEM.DEBUG_INFO handlers and the dev-only
// WINDOW.RELOAD / WINDOW.OPEN_DEV_TOOLS block were removed — zero renderer
// callers (orphans yellow list). Only OPEN_EXTERNAL / VERSION / LOG remain,
// so the Managers surface shrank to the logger alone.
import { app, shell } from "electron";
import * as C from "../ipc-contracts";

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
  [key: string]: unknown;
}

interface Managers {
  logger: Logger;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { logger } = managers;

  ipcMain.handle(C.SYSTEM.OPEN_EXTERNAL, (_event, url: string) => {
    if (!url || typeof url !== "string" || !url.startsWith("https:")) {
      logger.warn("阻止打开非HTTPS链接:", url);
      return { success: false, error: "只允许打开HTTPS链接" };
    }
    shell.openExternal(url);
    return { success: true };
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
}
// [20260724_TS_BigBang_SystemHandlers] END
