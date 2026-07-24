// [20260724_TS_BigBang_PreloadEntry] Migrated from preload.js to preload.ts (ADR-010).
// Preload entry point. Top-level `require("electron")` and `require("./src/...")`
// became ESM imports. No module.exports — this is a side-effect entry that calls
// contextBridge.exposeInMainWorld. esbuild bundles to CJS for dist-preload/preload.js.
import { contextBridge, ipcRenderer } from "electron";
import * as C from "./src/helpers/ipc-contracts";

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls
  hideWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE),
  showWindow: () => ipcRenderer.invoke(C.WINDOW.SHOW),
  minimizeWindow: () => ipcRenderer.invoke(C.WINDOW.MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(C.WINDOW.MAXIMIZE),
  isWindowMaximized: () => ipcRenderer.invoke(C.WINDOW.IS_MAX),
  onWindowMaximizeChange: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(C.EVENTS.WINDOW_MAXIMIZE_CHANGE, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.WINDOW_MAXIMIZE_CHANGE, handler);
  },
  closeWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE),
  closeApp: () => ipcRenderer.invoke(C.WINDOW.CLOSE_APP),
  setAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke(C.WINDOW.SET_TOP, enabled),

  // Recording
  onToggleDictation: (callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(C.EVENTS.TOGGLE_DICTATION, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.TOGGLE_DICTATION, callback);
  },

  // FunASR speech recognition
  transcribeAudio: (audioData: unknown) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.AUDIO, audioData),
  checkFunASRStatus: () => ipcRenderer.invoke(C.FUNASR.STATUS),
  installFunASR: () => ipcRenderer.invoke(C.FUNASR.INSTALL),
  restartFunasrServer: () => ipcRenderer.invoke(C.FUNASR.RESTART),

  // Model file management
  checkModelFiles: () => ipcRenderer.invoke(C.MODELS.CHECK),
  getDownloadProgress: () => ipcRenderer.invoke(C.MODELS.PROGRESS),
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
  readClipboard: () => ipcRenderer.invoke(C.CLIPBOARD.READ),
  writeClipboard: (text: string) => ipcRenderer.invoke(C.CLIPBOARD.WRITE, text),

  // Database operations
  saveTranscription: (data: unknown) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.SAVE, data),
  getTranscriptions: (limit: number, offset: number) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.GET_ALL, limit, offset),
  getTranscription: (id: number) => ipcRenderer.invoke(C.TRANSCRIPTION.GET, id),
  searchTranscriptions: (query: string, limit: number) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.SEARCH, query, limit),
  getTranscriptionStats: () => ipcRenderer.invoke(C.TRANSCRIPTION.STATS),
  deleteTranscription: (id: number) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.DELETE, id),
  clearAllTranscriptions: () => ipcRenderer.invoke(C.TRANSCRIPTION.CLEAR),
  diarizeAudio: (id: number) => ipcRenderer.invoke(C.TRANSCRIPTION.DIARIZE, id),

  // Settings management
  getSettings: () => ipcRenderer.invoke(C.SETTINGS.GET_LEGACY),
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

  // F2 hotkey management
  registerF2Hotkey: () => ipcRenderer.invoke(C.HOTKEY.REGISTER_F2),
  unregisterF2Hotkey: () => ipcRenderer.invoke(C.HOTKEY.UNREGISTER_F2),
  setRecordingState: (isRecording: boolean) =>
    ipcRenderer.invoke(C.HOTKEY.SET_STATE, isRecording),
  getRecordingState: () => ipcRenderer.invoke(C.HOTKEY.GET_STATE),

  // F2 double-click event listener
  onF2DoubleClick: (callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(C.EVENTS.F2_DOUBLE_CLICK, callback);
    return () => ipcRenderer.removeListener(C.EVENTS.F2_DOUBLE_CLICK, callback);
  },

  // Hotkey triggered event listener
  onHotkeyTriggered: (callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(C.EVENTS.HOTKEY_TRIGGERED, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.HOTKEY_TRIGGERED, callback);
  },

  // File operations
  exportTranscriptions: (format: string) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.EXPORT_ALL, format),
  importSettings: () => ipcRenderer.invoke(C.SETTINGS.IMPORT),
  exportSettings: () => ipcRenderer.invoke(C.SETTINGS.EXPORT),

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
  onUpdateDownloadProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(C.EVENTS.UPDATE_DOWNLOAD_PROGRESS, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.UPDATE_DOWNLOAD_PROGRESS, handler);
  },
  onUpdateDownloadComplete: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(C.EVENTS.UPDATE_DOWNLOAD_COMPLETE, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.UPDATE_DOWNLOAD_COMPLETE, handler);
  },
  onUpdateDownloadError: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(C.EVENTS.UPDATE_DOWNLOAD_ERROR, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.UPDATE_DOWNLOAD_ERROR, handler);
  },
  openExternal: (url: string) =>
    ipcRenderer.invoke(C.SYSTEM.OPEN_EXTERNAL, url),

  // Debug and logging
  log: (level: string, message: string) =>
    ipcRenderer.invoke(C.SYSTEM.LOG, level, message),

  // Event listeners
  onTranscriptionUpdate: (callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(C.EVENTS.TRANSCRIPTION_UPDATE, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.TRANSCRIPTION_UPDATE, callback);
  },
  onProcessingUpdate: (callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(C.EVENTS.PROCESSING_UPDATE, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.PROCESSING_UPDATE, callback);
  },
  onError: (callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(C.EVENTS.ERROR, callback);
    return () => ipcRenderer.removeListener(C.EVENTS.ERROR, callback);
  },
  onSettingsUpdate: (callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(C.EVENTS.SETTINGS_UPDATE, callback);
    return () => ipcRenderer.removeListener(C.EVENTS.SETTINGS_UPDATE, callback);
  },

  // History window
  openHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.OPEN_HISTORY),
  closeHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE_HISTORY),
  hideHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE_HISTORY),

  // Settings window
  openSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.OPEN_SETTINGS),
  closeSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE_SETTINGS),
  hideSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE_SETTINGS),

  // Model management
  downloadModel: (modelName: string) =>
    ipcRenderer.invoke(C.MODELS.DOWNLOAD_MODEL, modelName),
  getAvailableModels: () => ipcRenderer.invoke(C.MODELS.AVAILABLE),
  getCurrentModel: () => ipcRenderer.invoke(C.MODELS.CURRENT),
  switchModel: (modelName: string) =>
    ipcRenderer.invoke(C.MODELS.SWITCH, modelName),

  // Model download progress listener
  onModelDownloadProgress: (callback: (...args: unknown[]) => void) => {
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
  onFileTranscriptionProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(C.EVENTS.FILE_TRANSCRIPTION_PROGRESS, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.FILE_TRANSCRIPTION_PROGRESS, handler);
  },

  // Export and AI creation
  exportTranscription: (id: number, format: string, options: unknown) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.EXPORT, id, format, options),
  aiReviewTranscription: (id: number, template: string) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.AI_REVIEW, id, template),
});

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
