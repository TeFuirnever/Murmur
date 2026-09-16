// [20260724_TS_BigBang_ClipboardHandlers] Migrated from .js to .ts (ADR-010).
// `module.exports = { register }` (named) became named export. CJS require
// of ipc-contracts became namespace import.
import * as C from "../ipc-contracts";

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

interface ClipboardManager {
  copyText(text: string): Promise<unknown>;
  pasteText(text: string): Promise<unknown>;
}

interface Managers {
  clipboardManager: ClipboardManager;
  logger: Logger;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { clipboardManager, logger } = managers;

  ipcMain.handle(C.CLIPBOARD.COPY, async (_event, text: string) => {
    try {
      return await clipboardManager.copyText(text);
    } catch (error) {
      logger.error?.("复制文本失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(C.CLIPBOARD.PASTE, async (_event, text: string) => {
    try {
      // [20260820_E2E_PasteContractFix] clipboardManager.pasteText resolves
      // void on success; return the same {success:true} envelope COPY uses
      // so both clipboard channels share one contract.
      await clipboardManager.pasteText(text);
      return { success: true };
    } catch (error) {
      logger.error?.("粘贴文本失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });
}
// [20260724_TS_BigBang_ClipboardHandlers] END
