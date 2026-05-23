const { BrowserWindow } = require("electron");
const C = require("../ipc-contracts");

function register(ipcMain, managers) {
  const { hotkeyManager, windowManager, logger } = managers;

  const hotkeyRegisteredSenders = new Set();
  const f2RegisteredSenders = new Set();

  ipcMain.handle(C.HOTKEY.REGISTER, (event, hotkey) => {
    try {
      if (hotkeyManager) {
        const senderId = event.sender.id;

        if (hotkeyRegisteredSenders.has(senderId)) {
          logger.info(`发送者 ${senderId} 已注册过热键，跳过重复注册`);
          return { success: true };
        }

        const success = hotkeyManager.registerHotkey(hotkey, () => {
          logger.info(`热键 ${hotkey} 被触发，发送事件到主窗口`);
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
            logger.info(`清理发送者 ${senderId} 的热键注册记录`);
          });

          logger.info(`热键 ${hotkey} 注册成功，发送者: ${senderId}`);
        } else {
          logger.error(`热键 ${hotkey} 注册失败`);
        }

        return { success };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      logger.error("注册热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.HOTKEY.UNREGISTER, (event, hotkey) => {
    try {
      if (hotkeyManager) {
        const success = hotkeyManager.unregisterHotkey(hotkey);
        return { success };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      logger.error("注销热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.HOTKEY.GET_CURRENT, () => {
    try {
      if (hotkeyManager) {
        const hotkeys = hotkeyManager.getRegisteredHotkeys();
        const mainHotkey =
          hotkeys.find((key) => key !== "F2") || "CommandOrControl+Shift+Space";
        return mainHotkey;
      }
      return "CommandOrControl+Shift+Space";
    } catch (error) {
      logger.error("获取当前热键失败:", error);
      return "CommandOrControl+Shift+Space";
    }
  });

  ipcMain.handle(C.HOTKEY.REGISTER_F2, (event) => {
    try {
      const senderId = event.sender.id;

      if (f2RegisteredSenders.has(senderId)) {
        logger.info(`F2热键已为发送者 ${senderId} 注册过，跳过重复注册`);
        return { success: true };
      }

      if (hotkeyManager) {
        const isFirstRegistration = f2RegisteredSenders.size === 0;

        if (isFirstRegistration) {
          const success = hotkeyManager.registerF2DoubleClick((data) => {
            logger.info("发送F2双击事件到渲染进程:", data);
            f2RegisteredSenders.forEach((id) => {
              const window = BrowserWindow.getAllWindows().find(
                (w) => w.webContents.id === id,
              );
              if (window && !window.isDestroyed()) {
                window.webContents.send(C.EVENTS.F2_DOUBLE_CLICK, data);
              }
            });
          });

          if (!success) {
            return { success: false, error: "F2热键注册失败" };
          }
        }

        f2RegisteredSenders.add(senderId);

        event.sender.on("destroyed", () => {
          f2RegisteredSenders.delete(senderId);
          logger.info(`清理发送者 ${senderId} 的F2热键注册记录`);

          if (f2RegisteredSenders.size === 0) {
            hotkeyManager.unregisterHotkey("F2");
            logger.info("所有发送者都已注销，注销F2热键");
          }
        });

        return { success: true };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      logger.error("注册F2热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.HOTKEY.UNREGISTER_F2, (event) => {
    try {
      const senderId = event.sender.id;

      if (hotkeyManager && f2RegisteredSenders.has(senderId)) {
        f2RegisteredSenders.delete(senderId);

        if (f2RegisteredSenders.size === 0) {
          const success = hotkeyManager.unregisterHotkey("F2");
          logger.info("所有发送者都已注销，注销F2热键");
          return { success };
        } else {
          logger.info(
            `发送者 ${senderId} 已注销，但还有其他发送者注册了F2热键`,
          );
          return { success: true };
        }
      }
      return { success: false, error: "热键管理器未初始化或未注册" };
    } catch (error) {
      logger.error("注销F2热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.HOTKEY.SET_STATE, (event, isRecording) => {
    try {
      if (hotkeyManager) {
        hotkeyManager.setRecordingState(isRecording);
        return { success: true };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      logger.error("设置录音状态失败:", error);
      return { success: false, error: error.message };
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
      logger.error("获取录音状态失败:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
