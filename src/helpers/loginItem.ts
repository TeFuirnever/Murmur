// [20260926_Issue404] Issue #404 (auto_start): the main-process login-item
// module. Responsibilities:
//   - buildLoginItemOptions(enabled) — the Electron Settings payload.
//     { openAtLogin } on every platform; Windows adds args ["--hidden"] so
//     the login launch carries a hidden-start marker (documented win32-only
//     in the Electron Settings type; macOS 13+ has no API-supported hidden
//     flag — openAsHidden is deprecated and non-functional on macOS 13+).
//   - applyLoginItemSetting(enabled) — app.setLoginItemSettings with a
//     failure envelope for the IPC handler (no silent swallow: failures are
//     logged and reported, startup never breaks on them).
//   - syncLoginItemAtStartup(db, logger) — the SETTINGS-WIN alignment: the
//     persisted auto_start boolean is the source of truth; when the real
//     login item (app.getLoginItemSettings().openAtLogin) disagrees, it is
//     forced back to the setting. A match is a no-op.
//   - isLoginItemLaunch(logger) — detects a login launch: Windows argv
//     marker (--hidden), macOS wasOpenedAtLogin.
//   - hideMainWindowOnLoginLaunch(windowManager, logger) — at login launch,
//     hide the content-loaded main window (menu-bar convention: no focus
//     steal at login; the window exists for tray/hotkey use).
// Platform checks use process.platform === "win32"/"darwin" per the repo
// cross-platform convention; other platforms degrade to a no-op.
import { app } from "electron";

/** The argv marker that marks a hidden login launch (Windows args). */
const LOGIN_LAUNCH_ARG = "--hidden";

/** Minimal logger shape accepted by this module (mirrors systemHandlers). */
export interface LoggerLike {
  info?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

/** Minimal db shape accepted by syncLoginItemAtStartup. */
export interface SettingReader {
  getSetting(key: string, defaultValue?: unknown): unknown;
}

/** Minimal window-manager shape accepted by hideMainWindowOnLoginLaunch. */
export interface LoginItemWindowManager {
  mainWindow: Electron.BrowserWindow | null;
}

/** Build the Electron Settings payload for the given enabled state. */
export function buildLoginItemOptions(enabled: boolean): Electron.Settings {
  const options: Electron.Settings = { openAtLogin: enabled };
  if (process.platform === "win32") {
    options.args = [LOGIN_LAUNCH_ARG];
  }
  return options;
}

/**
 * Apply the login item state; returns an envelope for the IPC handler.
 * Failures are NOT swallowed silently — they return { success:false } so
 * the caller (systemHandlers) can log + report, and never throw out.
 */
export function applyLoginItemSetting(enabled: boolean): {
  success: boolean;
  error?: string;
} {
  try {
    app.setLoginItemSettings(buildLoginItemOptions(enabled));
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Startup alignment (settings win): read the persisted auto_start boolean
 * (strict default false) and force the real login item back onto it when
 * they disagree. Never throws — a failure is a logged warning only, so the
 * app boot is never blocked by login-item bookkeeping.
 */
export function syncLoginItemAtStartup(
  db: SettingReader,
  logger: LoggerLike,
): void {
  try {
    const enabled = db.getSetting("auto_start", false) === true;
    const actual = app.getLoginItemSettings();
    if (actual.openAtLogin !== enabled) {
      app.setLoginItemSettings(buildLoginItemOptions(enabled));
      logger.info?.("登录项与设置不一致，已按设置对齐", {
        enabled,
        was: actual.openAtLogin,
      });
    }
  } catch (error) {
    logger.warn("登录项启动同步失败（非致命）:", error);
  }
}

/**
 * True when this process was launched by the OS login item (auto_start):
 * Windows carries the --hidden argv marker (setLoginItemSettings args);
 * macOS reports wasOpenedAtLogin. Other platforms: false. A query failure
 * degrades to false WITH a logged warning (no silent swallow).
 */
export function isLoginItemLaunch(logger: LoggerLike): boolean {
  try {
    if (process.platform === "win32") {
      return process.argv.includes(LOGIN_LAUNCH_ARG);
    }
    if (process.platform === "darwin") {
      return app.getLoginItemSettings().wasOpenedAtLogin === true;
    }
    return false;
  } catch (error) {
    logger.warn("登录启动检测失败（按非登录启动处理）:", error);
    return false;
  }
}

/**
 * At a login launch, hide the content-loaded main window — menu-bar
 * convention, no focus steal. The window still exists (tray toggle, hotkey
 * recording, tray "显示主窗口" all keep working). Non-login launches are a
 * no-op. Never throws.
 */
export function hideMainWindowOnLoginLaunch(
  windowManager: LoginItemWindowManager,
  logger: LoggerLike,
): void {
  try {
    if (!isLoginItemLaunch(logger)) return;
    const win = windowManager.mainWindow;
    if (win && !win.isDestroyed()) {
      win.hide();
      logger.info?.("登录启动：主窗口保持隐藏（不抢焦点）");
    }
  } catch (error) {
    logger.warn("登录启动隐藏主窗口失败（非致命）:", error);
  }
}
