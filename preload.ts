// [20260724_TS_BigBang_PreloadEntry] Migrated from preload.js to preload.ts (ADR-010).
// Preload entry point. Top-level `require("electron")` and `require("./src/...")`
// became ESM imports. No module.exports — this is a side-effect entry that calls
// contextBridge.exposeInMainWorld. esbuild bundles to CJS for dist-preload/preload.js.
// [20260725_CodeReview_T2.3] Exported the literal as `preloadApi` with a
// `: ElectronAPI` type annotation so the runtime shape stays in sync with
// src/electronAPI.d.ts (the renderer-side contract). Drift in preload vs
// the d.ts now fails tsc (`pnpm typecheck`). The detector is unidirectional
// — it catches preload→d.ts drift but NOT d.ts internal errors, because
// tsconfig.json sets `skipLibCheck: true`. The d.ts-internal errors are
// caught separately by tests/unit/backend-type-safety.test.js (which scans
// .d.ts for `any`). See ADR-013 for the wider preload ↔ handler ↔ db seam.
// reloadWindow/openDevTools handlers are registered dev-only in
// systemHandlers.ts (NOT main.ts) under NODE_ENV === "development".
import { contextBridge, ipcRenderer } from "electron";
import * as C from "./src/helpers/ipc-contracts";
import type { ElectronAPI } from "./src/electronAPI";
import type {
  UpdateProgressData,
  UpdateCompleteData,
  UpdateErrorData,
  TranscriptionRecord,
  DownloadProgress,
  ProcessingUpdateData,
  FileTranscriptionProgressData,
} from "./src/types/ipc";

// [20260725_CodeReview_ListenerHelper] Common shape for 7 `on*` event
// listeners that follow the pattern: register a handler that strips the
// IPC `_event` arg and forwards only the payload to the user callback;
// return an unsubscribe that removes exactly that handler. Heterogeneous
// listeners (onProcessingUpdate forwards both args, onModelDownloadProgress
// passes the callback through directly) stay inline.
function makeListener<T>(
  channel: string,
  callback: (data: T) => void,
): () => void {
  const handler = (_event: unknown, data: T): void => {
    callback(data);
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Expose a safe API to the renderer process
export const preloadApi: ElectronAPI = {
  // Window controls
  hideWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE),
  showWindow: () => ipcRenderer.invoke(C.WINDOW.SHOW),
  minimizeWindow: () => ipcRenderer.invoke(C.WINDOW.MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(C.WINDOW.MAXIMIZE),
  isWindowMaximized: () => ipcRenderer.invoke(C.WINDOW.IS_MAX),
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) =>
    makeListener<boolean>(C.EVENTS.WINDOW_MAXIMIZE_CHANGE, callback),
  closeWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE),
  closeApp: () => ipcRenderer.invoke(C.WINDOW.CLOSE_APP),
  setAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke(C.WINDOW.SET_TOP, enabled),

  // FunASR speech recognition
  transcribeAudio: (audioData: unknown) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.AUDIO, audioData),
  checkFunASRStatus: () => ipcRenderer.invoke(C.FUNASR.STATUS),
  installFunASR: () => ipcRenderer.invoke(C.FUNASR.INSTALL),
  restartFunasrServer: () => ipcRenderer.invoke(C.FUNASR.RESTART),

  // Model file management
  checkModelFiles: () => ipcRenderer.invoke(C.MODELS.CHECK),
  downloadModels: () => ipcRenderer.invoke(C.MODELS.DOWNLOAD),

  // AI text processing
  processText: (text: string, mode: string, timeout?: number) =>
    ipcRenderer.invoke(C.AI.PROCESS, text, mode, timeout),
  checkAIStatus: (testConfig: unknown) =>
    ipcRenderer.invoke(C.AI.CHECK_STATUS, testConfig),
  getAIModes: () => ipcRenderer.invoke(C.AI.GET_MODES),
  getAIProviderPresets: () => ipcRenderer.invoke(C.AI.GET_PROVIDER_PRESETS),
  detectLocalModels: () => ipcRenderer.invoke(C.AI.DETECT_LOCAL_MODELS),

  // Clipboard operations
  pasteText: (text: string) => ipcRenderer.invoke(C.CLIPBOARD.PASTE, text),
  copyText: (text: string) => ipcRenderer.invoke(C.CLIPBOARD.COPY, text),

  // Database operations
  saveTranscription: (data: unknown) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.SAVE, data),
  getTranscriptions: (limit: number, offset: number) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.GET_ALL, limit, offset),
  deleteTranscription: (id: number) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.DELETE, id),
  clearAllTranscriptions: () => ipcRenderer.invoke(C.TRANSCRIPTION.CLEAR),
  diarizeAudio: (id: number) => ipcRenderer.invoke(C.TRANSCRIPTION.DIARIZE, id),

  // Settings management
  // [20260816_Refactor_DeadChannels] getTranscription/getTranscriptionStats/
  // getSettings(legacy)/importSettings/exportSettings bindings removed with
  // their zero-caller channels.
  getAllSettings: () => ipcRenderer.invoke(C.SETTINGS.GET_ALL),
  getSetting: (key: string, defaultValue?: unknown) =>
    ipcRenderer.invoke(C.SETTINGS.GET, key, defaultValue),
  setSetting: (key: string, value: unknown) =>
    ipcRenderer.invoke(C.SETTINGS.SET, key, value),
  saveSetting: (key: string, value: unknown) =>
    ipcRenderer.invoke(C.SETTINGS.SAVE, key, value),
  resetSettings: () => ipcRenderer.invoke(C.SETTINGS.RESET),

  // Hotkey management
  registerHotkey: (hotkey: string) =>
    ipcRenderer.invoke(C.HOTKEY.REGISTER, hotkey),
  unregisterHotkey: (hotkey: string) =>
    ipcRenderer.invoke(C.HOTKEY.UNREGISTER, hotkey),
  getCurrentHotkey: () => ipcRenderer.invoke(C.HOTKEY.GET_CURRENT),
  // [20260816_Refactor_DeadChannels] F2 register/unregister bindings removed
  // (zero renderer callers).
  setRecordingState: (isRecording: boolean) =>
    ipcRenderer.invoke(C.HOTKEY.SET_STATE, isRecording),
  getRecordingState: () => ipcRenderer.invoke(C.HOTKEY.GET_STATE),

  // Hotkey triggered event listener
  onHotkeyTriggered: (callback: (hotkey: string) => void) =>
    makeListener<string>(C.EVENTS.HOTKEY_TRIGGERED, callback),

  // File operations
  exportTranscriptions: (format: string) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.EXPORT_ALL, format),

  // System info
  getSystemInfo: () => ipcRenderer.invoke(C.SYSTEM.INFO),
  checkPermissions: () => ipcRenderer.invoke(C.SYSTEM.PERMISSIONS),
  requestPermissions: () => ipcRenderer.invoke(C.SYSTEM.REQUEST_PERMS),
  testAccessibilityPermission: () => ipcRenderer.invoke(C.SYSTEM.TEST_A11Y),
  openSystemPermissions: () => ipcRenderer.invoke(C.SYSTEM.OPEN_PERMS),

  // App info
  getAppVersion: () => ipcRenderer.invoke(C.SYSTEM.VERSION),
  checkForUpdates: () => ipcRenderer.invoke(C.UPDATE.CHECK),
  downloadUpdate: (updateInfo: unknown) =>
    ipcRenderer.invoke(C.UPDATE.DOWNLOAD, updateInfo),
  cancelUpdateDownload: () => ipcRenderer.invoke(C.UPDATE.CANCEL),
  installUpdate: (filePath: string) =>
    ipcRenderer.invoke(C.UPDATE.INSTALL, filePath),
  onUpdateDownloadProgress: (callback: (data: UpdateProgressData) => void) =>
    makeListener<UpdateProgressData>(
      C.EVENTS.UPDATE_DOWNLOAD_PROGRESS,
      callback,
    ),
  onUpdateDownloadComplete: (callback: (data: UpdateCompleteData) => void) =>
    makeListener<UpdateCompleteData>(
      C.EVENTS.UPDATE_DOWNLOAD_COMPLETE,
      callback,
    ),
  onUpdateDownloadError: (callback: (data: UpdateErrorData) => void) =>
    makeListener<UpdateErrorData>(C.EVENTS.UPDATE_DOWNLOAD_ERROR, callback),
  openExternal: (url: string) =>
    ipcRenderer.invoke(C.SYSTEM.OPEN_EXTERNAL, url),

  // Debug and logging
  log: (level: string, message: string) =>
    ipcRenderer.invoke(C.SYSTEM.LOG, level, message),

  // Event listeners
  onTranscriptionUpdate: (callback: (data: TranscriptionRecord) => void) =>
    makeListener<TranscriptionRecord>(C.EVENTS.TRANSCRIPTION_UPDATE, callback),
  onProcessingUpdate: (
    callback: (eventOrData: unknown, data?: ProcessingUpdateData) => void,
  ) => {
    const handler = (eventOrData: unknown, data?: ProcessingUpdateData) =>
      callback(eventOrData, data);
    ipcRenderer.on(C.EVENTS.PROCESSING_UPDATE, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.PROCESSING_UPDATE, handler);
  },
  onError: (callback: (data: { error: string }) => void) =>
    makeListener<{ error: string }>(C.EVENTS.ERROR, callback),
  onSettingsUpdate: (callback: (data: Record<string, unknown>) => void) =>
    makeListener<Record<string, unknown>>(C.EVENTS.SETTINGS_UPDATE, callback),

  // Dev tools (dev-only handlers registered in systemHandlers.ts under
  // NODE_ENV === "development"; these reject in prod with "No handler
  // registered")
  reloadWindow: () => ipcRenderer.invoke(C.WINDOW.RELOAD),
  openDevTools: () => ipcRenderer.invoke(C.WINDOW.OPEN_DEV_TOOLS),

  // History window
  openHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.OPEN_HISTORY),
  closeHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE_HISTORY),
  hideHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE_HISTORY),

  // Settings window
  openSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.OPEN_SETTINGS),
  closeSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE_SETTINGS),
  hideSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE_SETTINGS),

  // Model management
  // [20260816_Refactor_DeadChannels] downloadModel/getAvailableModels/
  // getCurrentModel/switchModel bindings removed — hardcoded placeholder
  // handlers with zero renderer callers. downloadModels above is the real path.

  // Model download progress listener
  onModelDownloadProgress: (
    callback: (eventOrProgress: unknown, progress?: DownloadProgress) => void,
  ) => {
    ipcRenderer.on(C.EVENTS.MODEL_DOWNLOAD_PROGRESS, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.MODEL_DOWNLOAD_PROGRESS, callback);
  },

  // File transcription
  importAudioFile: () => ipcRenderer.invoke(C.TRANSCRIPTION.IMPORT_FILE),
  validateAudioFile: (filePath: string) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.VALIDATE_FILE, filePath),
  transcribeFile: (audioPath: string, options: unknown) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.TRANSCRIBE_FILE, audioPath, options),
  cancelFileTranscription: () => ipcRenderer.invoke(C.TRANSCRIPTION.CANCEL),
  onFileTranscriptionProgress: (
    callback: (data: FileTranscriptionProgressData) => void,
  ) =>
    makeListener<FileTranscriptionProgressData>(
      C.EVENTS.FILE_TRANSCRIPTION_PROGRESS,
      callback,
    ),

  // Export and AI creation
  exportTranscription: (id: number, format: string, options: unknown) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.EXPORT, id, format, options),
  aiReviewTranscription: (id: number, template?: string) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.AI_REVIEW, id, template),
};
// [20260725_CodeReview_T2.3] END
contextBridge.exposeInMainWorld("electronAPI", preloadApi);

// Add some useful constants
contextBridge.exposeInMainWorld("constants", {
  APP_NAME: "Murmur",
  VERSION: "1.0.0",
  SUPPORTED_AUDIO_FORMATS: ["wav", "mp3", "m4a", "flac", "ogg", "wma", "aac"],
  SUPPORTED_EXPORT_FORMATS: ["txt", "docx", "srt", "vtt", "md"],
  DEFAULT_HOTKEY: "CommandOrControl+Shift+Space",
  MAX_RECORDING_DURATION: 300000, // 5 minutes
  MAX_TEXT_LENGTH: 10000,
  CHINESE_LANGUAGE_CODES: ["zh", "zh-CN", "zh-TW", "zh-HK"],
});

// Add debug info (only in dev mode)
if (process.env.NODE_ENV === "development") {
  contextBridge.exposeInMainWorld("debug", {
    getElectronVersion: () => process.versions.electron,
    getNodeVersion: () => process.versions.node,
    getChromeVersion: () => process.versions.chrome,
    getPlatform: () => process.platform,
    getArch: () => process.arch,
  });
}
// [20260724_TS_BigBang_PreloadEntry] END
