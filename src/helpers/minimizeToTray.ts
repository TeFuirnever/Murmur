// [20260926_Issue405] Issue #405 (minimize_to_tray): the main-process
// minimize-interception module (loginItem.ts precedent: thin, mock-friendly
// helpers + platform gates, wiring stays in main.ts/windowManager).
//   - readMinimizeToTraySetting(db, logger) — the persisted value with the
//     STRICT `=== true` gate and the historical default FALSE (mirror of the
//     `!== false` gates whose defaults are on; same shape as auto_start in
//     #404). A thrown db read degrades to "off" WITH a logged warning — no
//     silent swallow (CLAUDE.md rule 2); the degrade keeps the minimize.
//   - isMinimizeToTraySupportedPlatform() — win32 only: macOS minimizes
//     into the Dock by system convention and is already tray-resident via
//     close_behavior "hide", so minimize→tray is non-idiomatic there
//     (issue #405 macOS decision, downgrade noted in the ticket).
//   - interceptMinimizeToTray(win, readEnabled, logger?) — attaches the
//     `minimize` listener ONLY on a supported platform (attach-time gate:
//     on macOS no listener ever exists, so the yellow button keeps the
//     stock system path). Enabled minimize → preventDefault + hide(),
//     SILENT by design: TrayManager has no notification channel, so the
//     ticket's first-time tray balloon was downgraded to hide-only
//     (surgical priority).
import type { BrowserWindow } from "electron";

/** Minimal logger shape accepted by this module (mirrors loginItem). */
export interface LoggerLike {
  info?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

/** Minimal db shape accepted by readMinimizeToTraySetting. */
export interface SettingReader {
  getSetting(key: string, defaultValue?: unknown): unknown;
}

/** Lazy reader the interception calls at every minimize event. */
export type MinimizeToTrayReader = () => boolean;

/**
 * True only on Windows: the minimize-into-Dock convention keeps macOS out
 * of scope (issue #405 macOS decision).
 */
export function isMinimizeToTraySupportedPlatform(): boolean {
  return process.platform === "win32";
}

/**
 * The persisted minimize_to_tray value — strict `=== true`, default false.
 * Never throws: a failed read logs a warning and degrades to "off", so a
 * db hiccup can never strand the user with an unminimizable window.
 */
export function readMinimizeToTraySetting(
  db: SettingReader,
  logger: LoggerLike,
): boolean {
  try {
    return db.getSetting("minimize_to_tray", false) === true;
  } catch (error) {
    logger.warn("minimize_to_tray 读取失败，按关闭处理:", error);
    return false;
  }
}

/**
 * Attach the minimize interception. No-op on unsupported platforms (macOS
 * keeps the system minimize convention — nothing is ever registered).
 */
export function interceptMinimizeToTray(
  win: BrowserWindow,
  readEnabled: MinimizeToTrayReader,
  logger?: LoggerLike,
): void {
  if (!isMinimizeToTraySupportedPlatform()) return;
  // Electron's typings declare the minimize listener as `() => void`, but
  // the runtime passes a cancelable Event — hence the rest-arg signature.
  win.on("minimize", (...args: unknown[]) => {
    const event = args[0] as { preventDefault(): void };
    if (!readEnabled()) return;
    // Convert the minimize into a hide-to-tray. Silent: no notification
    // channel exists in TrayManager (issue #405 downgrade), and hide()
    // itself does not re-fire "minimize", so there is no recursion.
    event.preventDefault();
    win.hide();
    logger?.info?.("主窗口最小化→隐藏到托盘 (minimize_to_tray)");
  });
}
