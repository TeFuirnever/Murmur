// [20260724_TS_BigBang_SettingsHandlers] Migrated from .js to .ts (ADR-010).
import * as C from "../ipc-contracts";

interface DatabaseManager {
  getSetting(key: string, defaultValue?: unknown): unknown;
  setSetting(key: string, value: unknown): unknown;
  getAllSettings(): Record<string, unknown>;
  syncToFileConfig(): void;
  // [20260908_Feat_240_VocabCorrections] T13 corrections-table CRUD.
  listVocabCorrections(): Array<{ wrong: string; right: string }>;
  addVocabCorrection(wrong: string, right: string): void;
  deleteVocabCorrection(wrong: string): void;
  clearVocabCorrections(): void;
}

interface WindowManager {
  mainWindow: Electron.BrowserWindow | null;
  // [20260905_Fix_249_ReviewMinor] History window listens too — the language
  // switch must reach it live, not only at next start.
  historyWindow?: Electron.BrowserWindow | null;
}

interface TrayManager {
  setLanguage(lang: string): void;
}

interface Managers {
  databaseManager: DatabaseManager;
  windowManager: WindowManager;
  // [20260906_Fix_TrayI18n] Optional so existing call sites (and tests)
  // without a tray keep working; the language write rebuilds the tray.
  trayManager?: TrayManager;
}

const ALLOWED_SETTING_KEYS = new Set<string>([
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "ai_temperature",
  "ai_max_tokens",
  "enable_ai_optimization",
  // [20260905_Fix_249_DefaultModeUi] Default AI processing mode — the read
  // side (useRecording/useFileTranscription) already honored it; now writable
  // (issue #249).
  "default_mode",
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
  // [20260820_T14_Hotwords] Hotword list (one entry per line, sanitized at
  // both the save and injection boundaries — see src/helpers/hotwords.ts).
  "hotwords",
  // [20260905_Feat_BloubSettings] bot mascot catalogue keys (spec #224
  // ticket 5); values are validated at the mascot boundary
  "bot_shape",
  "bot_color",
  "bot_expression",
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
    // [20260905_Fix_249_ReviewMinor] Also reach the history window — without
    // this the language switch stayed stale there until the window re-opened.
    const hw = windowManager?.historyWindow;
    if (hw && !hw.isDestroyed()) {
      hw.webContents.send(C.EVENTS.SETTINGS_UPDATE, { key });
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
    // [20260906_Fix_TrayI18n] The tray lives in the main process and has no
    // renderer i18n context — push the language switch to it directly.
    if (key === "language") {
      managers.trayManager?.setLanguage(String(value));
    }
    return result;
  });

  ipcMain.handle(C.SETTINGS.GET_ALL, () => {
    return maskApiKey(databaseManager.getAllSettings());
  });

  // [20260816_Refactor_DeadChannels] The GET_LEGACY alias and the IMPORT/
  // EXPORT handlers (dialog-backed but with no UI entry point anywhere) were
  // removed with their contract constants.

  // [20260908_Feat_240_VocabCorrections] T13: vocabulary CRUD for the
  // settings page. Small quotas — the settings page edits, not polls.
  ipcMain.handle(C.AI.VOCAB_LIST, () => {
    try {
      return {
        success: true,
        entries: databaseManager.listVocabCorrections(),
      };
    } catch (error) {
      return {
        success: false,
        entries: [],
        error: (error as Error).message,
      };
    }
  });

  ipcMain.handle(C.AI.VOCAB_ADD, (_event, wrong: string, right: string) => {
    try {
      databaseManager.addVocabCorrection(wrong, right);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(C.AI.VOCAB_DELETE, (_event, wrong: string) => {
    try {
      databaseManager.deleteVocabCorrection(wrong);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(C.AI.VOCAB_CLEAR, () => {
    try {
      databaseManager.clearVocabCorrections();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // [20260906_Refactor_DeadChannelCleanup] Ticket #250: the SETTINGS.SAVE and
  // SETTINGS.RESET handlers were removed — zero renderer callers (orphans
  // yellow list). Persistence goes through SETTINGS.SET.
}
// [20260724_TS_BigBang_SettingsHandlers] END
