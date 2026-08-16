// [20260724_TS_BigBang_SettingsHandlers] Migrated from .js to .ts (ADR-010).
import * as C from "../ipc-contracts";

interface DatabaseManager {
  getSetting(key: string, defaultValue?: unknown): unknown;
  setSetting(key: string, value: unknown): unknown;
  getAllSettings(): Record<string, unknown>;
  resetSettings(): unknown;
  syncToFileConfig(): void;
}

interface WindowManager {
  mainWindow: Electron.BrowserWindow | null;
}

interface Managers {
  databaseManager: DatabaseManager;
  windowManager: WindowManager;
}

const ALLOWED_SETTING_KEYS = new Set<string>([
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
  // [20260816_Refactor_RemoveEffects] effects_enabled removed from this
  // allowlist with the visual-effects feature.
]);

const MAX_VALUE_LENGTH = 10000;

function maskApiKey(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  if (settings.ai_api_key && typeof settings.ai_api_key === "string") {
    const key = settings.ai_api_key;
    settings.ai_api_key = key.length > 4 ? `****${key.slice(-4)}` : "****";
  }
  return settings;
}

export function validateSetting(key: unknown, value: unknown): boolean {
  if (typeof key !== "string" || key.length > 100) return false;
  if (!ALLOWED_SETTING_KEYS.has(key)) return false;
  if (typeof value === "string" && value.length > MAX_VALUE_LENGTH)
    return false;
  return true;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  // [20260816_Refactor_DeadChannels] logger dropped from the destructure —
  // its only consumers were the removed IMPORT/EXPORT handlers.
  const { databaseManager, windowManager } = managers;

  const broadcastSettingsUpdate = (key: string | null) => {
    const mw = windowManager?.mainWindow;
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send(C.EVENTS.SETTINGS_UPDATE, { key });
    }
  };

  ipcMain.handle(
    C.SETTINGS.GET,
    (_event, key: string, defaultValue: unknown) => {
      return databaseManager.getSetting(key, defaultValue);
    },
  );

  ipcMain.handle(C.SETTINGS.SET, (_event, key: string, value: unknown) => {
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

  // [20260816_Refactor_DeadChannels] The GET_LEGACY alias and the IMPORT/
  // EXPORT handlers (dialog-backed but with no UI entry point anywhere) were
  // removed with their contract constants.

  ipcMain.handle(C.SETTINGS.SAVE, (_event, key: string, value: unknown) => {
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
}
// [20260724_TS_BigBang_SettingsHandlers] END
