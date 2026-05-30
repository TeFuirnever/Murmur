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
    try {
      return await clipboardManager.pasteText(text);
    } catch (error) {
      logger.error("粘贴文本失败:", error);
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
