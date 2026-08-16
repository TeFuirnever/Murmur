// [20260724_TS_BigBang_HotkeyHandlers] Migrated from .js to .ts (ADR-010).
import * as C from "../ipc-contracts";

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

interface HotkeyManager {
  registerHotkey(hotkey: string, cb: () => void): boolean;
  unregisterHotkey(hotkey: string): boolean;
  getRegisteredHotkeys(): string[];
  setRecordingState(isRecording: boolean): void;
  getRecordingState(): boolean;
}

interface WindowManager {
  mainWindow: Electron.BrowserWindow | null;
}

interface Managers {
  hotkeyManager: HotkeyManager | null;
  windowManager: WindowManager;
  logger: Logger;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { hotkeyManager, windowManager, logger } = managers;

  const hotkeyRegisteredSenders = new Set<number>();

  ipcMain.handle(C.HOTKEY.REGISTER, (event, hotkey: string) => {
    try {
      if (hotkeyManager) {
        const senderId = event.sender.id;

        if (hotkeyRegisteredSenders.has(senderId)) {
          logger.info?.(`发送者 ${senderId} 已注册过热键，跳过重复注册`);
          return { success: true };
        }

        const success = hotkeyManager.registerHotkey(hotkey, () => {
          logger.info?.(`热键 ${hotkey} 被触发，发送事件到主窗口`);
          if (
            windowManager &&
            windowManager.mainWindow &&
            !windowManager.mainWindow.isDestroyed()
          ) {
            windowManager.mainWindow.webContents.send(
              C.EVENTS.HOTKEY_TRIGGERED,
              { hotkey },
            );
          }
        });

        if (success) {
          hotkeyRegisteredSenders.add(senderId);

          event.sender.on("destroyed", () => {
            hotkeyRegisteredSenders.delete(senderId);
            logger.info?.(`清理发送者 ${senderId} 的热键注册记录`);
          });

          logger.info?.(`热键 ${hotkey} 注册成功，发送者: ${senderId}`);
        } else {
          logger.error?.(`热键 ${hotkey} 注册失败`);
        }

        return { success };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      logger.error?.("注册热键失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(C.HOTKEY.UNREGISTER, (_event, hotkey: string) => {
    try {
      if (hotkeyManager) {
        const success = hotkeyManager.unregisterHotkey(hotkey);
        return { success };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      logger.error?.("注销热键失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(C.HOTKEY.GET_CURRENT, () => {
    try {
      if (hotkeyManager) {
        const hotkeys = hotkeyManager.getRegisteredHotkeys();
        const mainHotkey = hotkeys[0] || "CommandOrControl+Shift+Space";
        return mainHotkey;
      }
      return "CommandOrControl+Shift+Space";
    } catch (error) {
      logger.error?.("获取当前热键失败:", error);
      return "CommandOrControl+Shift+Space";
    }
  });

  // [20260816_Refactor_DeadChannels] REGISTER_F2/UNREGISTER_F2 handlers
  // removed — the renderer only uses the classic hotkey flow.

  ipcMain.handle(C.HOTKEY.SET_STATE, (_event, isRecording: boolean) => {
    try {
      if (hotkeyManager) {
        hotkeyManager.setRecordingState(isRecording);
        return { success: true };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      logger.error?.("设置录音状态失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(C.HOTKEY.GET_STATE, () => {
    try {
      if (hotkeyManager) {
        const isRecording = hotkeyManager.getRecordingState();
        return { success: true, isRecording };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      logger.error?.("获取录音状态失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });
}
// [20260724_TS_BigBang_HotkeyHandlers] END
