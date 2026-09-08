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
import { contextBridge, ipcRenderer } from "electron";
import * as C from "./src/helpers/ipc-contracts";
import type { ElectronAPI } from "./src/electronAPI";
import type {
  UpdateProgressData,
  UpdateCompleteData,
  UpdateErrorData,
  DownloadProgress,
  FileTranscriptionProgressData,
} from "./src/types/ipc";

// [20260725_CodeReview_ListenerHelper] Common shape for 7 `on*` event
// listeners that follow the pattern: register a handler that strips the
// IPC `_event` arg and forwards only the payload to the user callback;
// return an unsubscribe that removes exactly that handler. The one
// heterogeneous listener left (onModelDownloadProgress passes the callback
// through directly) stays inline.
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

// [20260906_Refactor_DeadChannelCleanup] Ticket #250: removed the 20
// renderer-orphan channels measured by ipc-contracts-orphans.test.ts
// (yellow list). See that test for the evidence baseline.
// Expose a safe API to the renderer process
export const preloadApi: ElectronAPI = {
  // Window controls
  hideWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE),
  minimizeWindow: () => ipcRenderer.invoke(C.WINDOW.MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(C.WINDOW.MAXIMIZE),
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
  // [20260822_T12_IdleUnload] Hotkey-down reload pre-trigger (#190).
  reloadFunasrModels: () => ipcRenderer.invoke(C.FUNASR.RELOAD_MODELS),

  // Model file management
  checkModelFiles: () => ipcRenderer.invoke(C.MODELS.CHECK),
  downloadModels: () => ipcRenderer.invoke(C.MODELS.DOWNLOAD),

  // AI text processing
  processText: (
    text: string,
    mode: string,
    timeout?: number,
    requestId?: string,
  ) => ipcRenderer.invoke(C.AI.PROCESS, text, mode, timeout, requestId),
  checkAIStatus: (testConfig: unknown) =>
    ipcRenderer.invoke(C.AI.CHECK_STATUS, testConfig),
  // [20260907_Feat_233_ListModels] Provider model-list derivation (T6).
  listAIModels: (baseUrl: string, apiKey: string) =>
    ipcRenderer.invoke(C.AI.LIST_MODELS, baseUrl, apiKey),
  // [20260907_Feat_235_StreamPipeline] T8: streaming abort + chunk push.
  abortPolish: (requestId: string) =>
    ipcRenderer.invoke(C.AI.POLISH_ABORT, requestId),
  onPolishChunk: (
    callback: (chunk: import("./src/types/ipc").PolishChunk) => void,
  ) =>
    makeListener<import("./src/types/ipc").PolishChunk>(
      C.EVENTS.AI_POLISH_CHUNK,
      callback,
    ),
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
  // [20260906_Feat_TranscriptionUpdate] Manual polish write-back (spec #193
  // T1, ticket #228): persist polished text into the saved record.
  updateTranscription: (id: number, patch: Record<string, unknown>) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.UPDATE, id, patch),
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

  // Hotkey triggered event listener
  onHotkeyTriggered: (callback: (hotkey: string) => void) =>
    makeListener<string>(C.EVENTS.HOTKEY_TRIGGERED, callback),

  // File operations
  exportTranscriptions: (format: string) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.EXPORT_ALL, format),

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
  onSettingsUpdate: (callback: (data: Record<string, unknown>) => void) =>
    makeListener<Record<string, unknown>>(C.EVENTS.SETTINGS_UPDATE, callback),

  // History window
  openHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.OPEN_HISTORY),
  closeHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE_HISTORY),

  // Settings window
  openSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.OPEN_SETTINGS),
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
