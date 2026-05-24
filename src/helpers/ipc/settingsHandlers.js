const fs = require("fs");
const { dialog } = require("electron");
const C = require("../ipc-contracts");

const ALLOWED_SETTING_KEYS = new Set([
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "ai_temperature",
  "ai_max_tokens",
  "enable_ai_optimization",
  "window_always_on_top",
  "auto_paste",
  "close_behavior",
  "theme",
  "hotkey",
  "language",
  "auto_start",
  "minimize_to_tray",
  "show_notifications",
  "model_download_path",
]);

const MAX_VALUE_LENGTH = 10000;

function maskApiKey(settings) {
  if (settings.ai_api_key && typeof settings.ai_api_key === "string") {
    const key = settings.ai_api_key;
    settings.ai_api_key = key.length > 4 ? `****${key.slice(-4)}` : "****";
  }
  return settings;
}

function validateSetting(key, value) {
  if (typeof key !== "string" || key.length > 100) return false;
  if (!ALLOWED_SETTING_KEYS.has(key)) return false;
  if (typeof value === "string" && value.length > MAX_VALUE_LENGTH)
    return false;
  return true;
}

function register(ipcMain, managers) {
  const { databaseManager, logger, windowManager } = managers;

  const broadcastSettingsUpdate = (key) => {
    const mw = windowManager?.mainWindow;
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send(C.EVENTS.SETTINGS_UPDATE, { key });
    }
  };

  ipcMain.handle(C.SETTINGS.GET, (event, key, defaultValue) => {
    return databaseManager.getSetting(key, defaultValue);
  });

  ipcMain.handle(C.SETTINGS.SET, (event, key, value) => {
    if (!validateSetting(key, value)) {
      return { success: false, error: "Invalid setting key or value" };
    }
    const result = databaseManager.setSetting(key, value);
    databaseManager.syncToFileConfig();
    broadcastSettingsUpdate(key);
    return result;
  });

  ipcMain.handle(C.SETTINGS.GET_ALL, () => {
    return maskApiKey(databaseManager.getAllSettings());
  });

  ipcMain.handle(C.SETTINGS.GET_LEGACY, () => {
    return maskApiKey(databaseManager.getAllSettings());
  });

  ipcMain.handle(C.SETTINGS.SAVE, (event, key, value) => {
    if (!validateSetting(key, value)) {
      return { success: false, error: "Invalid setting key or value" };
    }
    const result = databaseManager.setSetting(key, value);
    broadcastSettingsUpdate(key);
    return result;
  });

  ipcMain.handle(C.SETTINGS.RESET, () => {
    const result = databaseManager.resetSettings();
    broadcastSettingsUpdate(null);
    return result;
  });

  ipcMain.handle(C.SETTINGS.IMPORT, async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "导入设置",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const content = fs.readFileSync(result.filePaths[0], "utf-8");
      const settings = JSON.parse(content);

      let imported = 0;
      for (const [key, value] of Object.entries(settings)) {
        if (!validateSetting(key, value)) continue;
        databaseManager.setSetting(key, value);
        imported++;
      }
      broadcastSettingsUpdate(null);

      return { success: true, count: imported };
    } catch (error) {
      logger.error("导入设置失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.SETTINGS.EXPORT, async () => {
    try {
      const settings = databaseManager.getAllSettings();
      const content = JSON.stringify(settings, null, 2);

      const result = await dialog.showSaveDialog({
        title: "导出设置",
        defaultPath: "murmur-settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(result.filePath, content, "utf-8");
      return { success: true, path: result.filePath };
    } catch (error) {
      logger.error("导出设置失败:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register, validateSetting };
