// [20260724_TS_BigBang_SystemHandlers] Migrated from .js to .ts (ADR-010).
// [20260906_Refactor_DeadChannelCleanup] Ticket #250: the SYSTEM.INFO,
// SYSTEM.PERMISSIONS, SYSTEM.REQUEST_PERMS, SYSTEM.TEST_A11Y,
// SYSTEM.OPEN_PERMS, SYSTEM.DEBUG_INFO handlers and the dev-only
// WINDOW.RELOAD / WINDOW.OPEN_DEV_TOOLS block were removed — zero renderer
// callers (orphans yellow list). Only OPEN_EXTERNAL / VERSION / LOG remain,
// so the Managers surface shrank to the logger alone.
import { app, shell, systemPreferences } from "electron";
import * as C from "../ipc-contracts";
// [20260926_Issue404] Login-item payload building/apply lives in the
// loginItem module (unit-tested standalone with a mocked electron app).
import { applyLoginItemSetting } from "../loginItem";
import type {
  MediaPermissionStatus,
  PermissionStatusResult,
} from "../../types/ipc";

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

  // [20260926_Fix_396_PermissionStatus] Real OS systemPreferences-backed
  // permission status (issue #396). macOS: getMediaAccessStatus("microphone")
  // plus isTrustedAccessibilityClient(false) — prompt=false is a pure
  // AXIsProcessTrusted query and never triggers the system prompt. Windows:
  // getMediaAccessStatus("microphone") mirrors the real global Windows
  // privacy setting for desktop apps, but Windows has no accessibility
  // permission model — report "unsupported" instead of pretending. Failures
  // degrade to "unknown" WITH a logged warning, so the UI shows no badge
  // rather than a fake one.
  ipcMain.handle(C.SYSTEM.PERMISSION_STATUS, (): PermissionStatusResult => {
    try {
      if (process.platform === "darwin") {
        const microphone: MediaPermissionStatus =
          systemPreferences.getMediaAccessStatus("microphone");
        const accessibility: MediaPermissionStatus =
          systemPreferences.isTrustedAccessibilityClient(false)
            ? "granted"
            : "denied";
        return { microphone, accessibility };
      }
      if (process.platform === "win32") {
        return {
          microphone: systemPreferences.getMediaAccessStatus("microphone"),
          accessibility: "unsupported",
        };
      }
      return { microphone: "unknown", accessibility: "unknown" };
    } catch (error) {
      logger.warn("查询系统权限状态失败:", error);
      return { microphone: "unknown", accessibility: "unknown" };
    }
  });

  // [20260926_Issue404] Launch-at-login apply (issue #404): the renderer's
  // auto_start toggle notifies main to (re)write the OS login item. The
  // boolean is coerced strictly (only literal true enables) and the
  // platform payload (macOS openAtLogin / Windows registry args) is built
  // by the loginItem module — platform differences never reach the
  // renderer. Failures return a { success:false, error } envelope WITH a
  // logged warning (no silent swallowing).
  ipcMain.handle(C.SYSTEM.SET_LOGIN_ITEM, (_event, enabled: unknown) => {
    const value = enabled === true;
    const result = applyLoginItemSetting(value);
    if (!result.success) {
      logger.warn("应用开机自启失败:", result.error);
    }
    return result;
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
      // [20260910_Fix_LogHandlerThisBinding] Bind the call to the logger:
      // a detached `fn?.(...)` runs LogManager's methods with `this`
      // undefined (they delegate via this.log), throwing on EVERY renderer
      // log — and the renderer's unhandledrejection handler logs through
      // this same channel, turning one error into an infinite IPC flood.
      fn?.call(logger, `[渲染进程] ${message}`, data || "");
      // [20260910_Fix_LogHandlerThisBinding] END
      return true;
    },
  );
}
// [20260724_TS_BigBang_SystemHandlers] END
