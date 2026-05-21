const C = require("../ipc-contracts");

function register(ipcMain, managers) {
  const { clipboardManager, logger } = managers;

  ipcMain.handle(C.CLIPBOARD.COPY, async (event, text) => {
    try {
      return await clipboardManager.copyText(text);
    } catch (error) {
      logger.error("复制文本失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.CLIPBOARD.PASTE, async (event, text) => {
    return await clipboardManager.pasteText(text);
  });

  ipcMain.handle(C.CLIPBOARD.INSERT, async (event, text) => {
    try {
      return await clipboardManager.insertTextDirectly(text);
    } catch (error) {
      logger.error("直接插入文本失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.CLIPBOARD.MACOS_A11Y, async () => {
    try {
      if (process.platform === "darwin") {
        const result = await clipboardManager.enableMacOSAccessibility();
        return { success: result };
      }
      return { success: true, message: "非 macOS 平台，无需设置" };
    } catch (error) {
      logger.error("启用 macOS accessibility 失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.CLIPBOARD.READ, async () => {
    try {
      const text = await clipboardManager.readClipboard();
      return { success: true, text };
    } catch (error) {
      logger.error("读取剪贴板失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.CLIPBOARD.WRITE, async (event, text) => {
    try {
      return await clipboardManager.writeClipboard(text);
    } catch (error) {
      logger.error("写入剪贴板失败:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
