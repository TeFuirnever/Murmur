const { contextBridge, ipcRenderer } = require("electron");
const C = require("./src/helpers/ipc-contracts");

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld("electronAPI", {
  // 窗口控制
  hideWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE),
  showWindow: () => ipcRenderer.invoke(C.WINDOW.SHOW),
  minimizeWindow: () => ipcRenderer.invoke(C.WINDOW.MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(C.WINDOW.MAXIMIZE),
  isWindowMaximized: () => ipcRenderer.invoke(C.WINDOW.IS_MAX),
  onWindowMaximizeChange: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(C.EVENTS.WINDOW_MAXIMIZE_CHANGE, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.WINDOW_MAXIMIZE_CHANGE, handler);
  },
  closeWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE),
  closeApp: () => ipcRenderer.invoke(C.WINDOW.CLOSE_APP),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke(C.WINDOW.SET_TOP, enabled),

  // 录音相关
  onToggleDictation: (callback) => {
    ipcRenderer.on(C.EVENTS.TOGGLE_DICTATION, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.TOGGLE_DICTATION, callback);
  },

  // FunASR语音识别
  transcribeAudio: (audioData) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.AUDIO, audioData),
  checkFunASRStatus: () => ipcRenderer.invoke(C.FUNASR.STATUS),
  installFunASR: () => ipcRenderer.invoke(C.FUNASR.INSTALL),
  restartFunasrServer: () => ipcRenderer.invoke(C.FUNASR.RESTART),

  // 模型文件管理
  checkModelFiles: () => ipcRenderer.invoke(C.MODELS.CHECK),
  getDownloadProgress: () => ipcRenderer.invoke(C.MODELS.PROGRESS),
  downloadModels: () => ipcRenderer.invoke(C.MODELS.DOWNLOAD),

  // AI文本处理
  processText: (text, mode, timeout) =>
    ipcRenderer.invoke(C.AI.PROCESS, text, mode, timeout),
  checkAIStatus: (testConfig) =>
    ipcRenderer.invoke(C.AI.CHECK_STATUS, testConfig),
  getAIModes: () => ipcRenderer.invoke(C.AI.GET_MODES),
  getAIProviderPresets: () => ipcRenderer.invoke(C.AI.GET_PROVIDER_PRESETS),
  detectLocalModels: () => ipcRenderer.invoke(C.AI.DETECT_LOCAL_MODELS),

  // 剪贴板操作
  pasteText: (text) => ipcRenderer.invoke(C.CLIPBOARD.PASTE, text),
  copyText: (text) => ipcRenderer.invoke(C.CLIPBOARD.COPY, text),
  readClipboard: () => ipcRenderer.invoke(C.CLIPBOARD.READ),
  writeClipboard: (text) => ipcRenderer.invoke(C.CLIPBOARD.WRITE, text),

  // 数据库操作
  saveTranscription: (data) => ipcRenderer.invoke(C.TRANSCRIPTION.SAVE, data),
  getTranscriptions: (limit, offset) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.GET_ALL, limit, offset),
  getTranscription: (id) => ipcRenderer.invoke(C.TRANSCRIPTION.GET, id),
  searchTranscriptions: (query, limit) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.SEARCH, query, limit),
  getTranscriptionStats: () => ipcRenderer.invoke(C.TRANSCRIPTION.STATS),
  deleteTranscription: (id) => ipcRenderer.invoke(C.TRANSCRIPTION.DELETE, id),
  clearAllTranscriptions: () => ipcRenderer.invoke(C.TRANSCRIPTION.CLEAR),
  diarizeAudio: (id) => ipcRenderer.invoke(C.TRANSCRIPTION.DIARIZE, id),

  // 设置管理
  getSettings: () => ipcRenderer.invoke(C.SETTINGS.GET_LEGACY),
  getAllSettings: () => ipcRenderer.invoke(C.SETTINGS.GET_ALL),
  getSetting: (key, defaultValue) =>
    ipcRenderer.invoke(C.SETTINGS.GET, key, defaultValue),
  setSetting: (key, value) => ipcRenderer.invoke(C.SETTINGS.SET, key, value),
  saveSetting: (key, value) => ipcRenderer.invoke(C.SETTINGS.SAVE, key, value),
  resetSettings: () => ipcRenderer.invoke(C.SETTINGS.RESET),

  // 热键管理
  registerHotkey: (hotkey) => ipcRenderer.invoke(C.HOTKEY.REGISTER, hotkey),
  unregisterHotkey: (hotkey) => ipcRenderer.invoke(C.HOTKEY.UNREGISTER, hotkey),
  getCurrentHotkey: () => ipcRenderer.invoke(C.HOTKEY.GET_CURRENT),

  // F2热键管理
  registerF2Hotkey: () => ipcRenderer.invoke(C.HOTKEY.REGISTER_F2),
  unregisterF2Hotkey: () => ipcRenderer.invoke(C.HOTKEY.UNREGISTER_F2),
  setRecordingState: (isRecording) =>
    ipcRenderer.invoke(C.HOTKEY.SET_STATE, isRecording),
  getRecordingState: () => ipcRenderer.invoke(C.HOTKEY.GET_STATE),

  // F2双击事件监听
  onF2DoubleClick: (callback) => {
    ipcRenderer.on(C.EVENTS.F2_DOUBLE_CLICK, callback);
    return () => ipcRenderer.removeListener(C.EVENTS.F2_DOUBLE_CLICK, callback);
  },

  // 热键触发事件监听
  onHotkeyTriggered: (callback) => {
    ipcRenderer.on(C.EVENTS.HOTKEY_TRIGGERED, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.HOTKEY_TRIGGERED, callback);
  },

  // 文件操作
  exportTranscriptions: (format) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.EXPORT_ALL, format),
  importSettings: () => ipcRenderer.invoke(C.SETTINGS.IMPORT),
  exportSettings: () => ipcRenderer.invoke(C.SETTINGS.EXPORT),

  // 系统信息
  getSystemInfo: () => ipcRenderer.invoke(C.SYSTEM.INFO),
  checkPermissions: () => ipcRenderer.invoke(C.SYSTEM.PERMISSIONS),
  requestPermissions: () => ipcRenderer.invoke(C.SYSTEM.REQUEST_PERMS),
  testAccessibilityPermission: () => ipcRenderer.invoke(C.SYSTEM.TEST_A11Y),
  openSystemPermissions: () => ipcRenderer.invoke(C.SYSTEM.OPEN_PERMS),

  // 应用信息
  getAppVersion: () => ipcRenderer.invoke(C.SYSTEM.VERSION),
  checkForUpdates: () => ipcRenderer.invoke(C.UPDATE.CHECK),
  downloadUpdate: (updateInfo) =>
    ipcRenderer.invoke(C.UPDATE.DOWNLOAD, updateInfo),
  cancelUpdateDownload: () => ipcRenderer.invoke(C.UPDATE.CANCEL),
  installUpdate: (filePath) => ipcRenderer.invoke(C.UPDATE.INSTALL, filePath),
  onUpdateDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(C.EVENTS.UPDATE_DOWNLOAD_PROGRESS, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.UPDATE_DOWNLOAD_PROGRESS, handler);
  },
  onUpdateDownloadComplete: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(C.EVENTS.UPDATE_DOWNLOAD_COMPLETE, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.UPDATE_DOWNLOAD_COMPLETE, handler);
  },
  onUpdateDownloadError: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(C.EVENTS.UPDATE_DOWNLOAD_ERROR, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.UPDATE_DOWNLOAD_ERROR, handler);
  },
  openExternal: (url) => ipcRenderer.invoke(C.SYSTEM.OPEN_EXTERNAL, url),

  // 调试和日志
  log: (level, message) => ipcRenderer.invoke(C.SYSTEM.LOG, level, message),

  // 事件监听
  onTranscriptionUpdate: (callback) => {
    ipcRenderer.on(C.EVENTS.TRANSCRIPTION_UPDATE, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.TRANSCRIPTION_UPDATE, callback);
  },
  onProcessingUpdate: (callback) => {
    ipcRenderer.on(C.EVENTS.PROCESSING_UPDATE, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.PROCESSING_UPDATE, callback);
  },
  onError: (callback) => {
    ipcRenderer.on(C.EVENTS.ERROR, callback);
    return () => ipcRenderer.removeListener(C.EVENTS.ERROR, callback);
  },
  onSettingsUpdate: (callback) => {
    ipcRenderer.on(C.EVENTS.SETTINGS_UPDATE, callback);
    return () => ipcRenderer.removeListener(C.EVENTS.SETTINGS_UPDATE, callback);
  },

  // 历史记录窗口相关
  openHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.OPEN_HISTORY),
  closeHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE_HISTORY),
  hideHistoryWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE_HISTORY),

  // 设置窗口相关
  openSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.OPEN_SETTINGS),
  closeSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.CLOSE_SETTINGS),
  hideSettingsWindow: () => ipcRenderer.invoke(C.WINDOW.HIDE_SETTINGS),

  // 模型管理
  downloadModel: (modelName) =>
    ipcRenderer.invoke(C.MODELS.DOWNLOAD_MODEL, modelName),
  getAvailableModels: () => ipcRenderer.invoke(C.MODELS.AVAILABLE),
  getCurrentModel: () => ipcRenderer.invoke(C.MODELS.CURRENT),
  switchModel: (modelName) => ipcRenderer.invoke(C.MODELS.SWITCH, modelName),

  // 模型下载进度监听
  onModelDownloadProgress: (callback) => {
    ipcRenderer.on(C.EVENTS.MODEL_DOWNLOAD_PROGRESS, callback);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.MODEL_DOWNLOAD_PROGRESS, callback);
  },

  // 文件转录相关
  importAudioFile: () => ipcRenderer.invoke(C.TRANSCRIPTION.IMPORT_FILE),
  validateAudioFile: (filePath) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.VALIDATE_FILE, filePath),
  transcribeFile: (audioPath, options) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.TRANSCRIBE_FILE, audioPath, options),
  cancelFileTranscription: () => ipcRenderer.invoke(C.TRANSCRIPTION.CANCEL),
  onFileTranscriptionProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(C.EVENTS.FILE_TRANSCRIPTION_PROGRESS, handler);
    return () =>
      ipcRenderer.removeListener(C.EVENTS.FILE_TRANSCRIPTION_PROGRESS, handler);
  },

  // 导出与AI创作
  exportTranscription: (id, format, options) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.EXPORT, id, format, options),
  aiReviewTranscription: (id, template) =>
    ipcRenderer.invoke(C.TRANSCRIPTION.AI_REVIEW, id, template),
});

// 添加一些实用的常量
contextBridge.exposeInMainWorld("constants", {
  APP_NAME: "Murmur",
  VERSION: "1.0.0",
  SUPPORTED_AUDIO_FORMATS: ["wav", "mp3", "m4a", "flac", "ogg", "wma", "aac"],
  SUPPORTED_EXPORT_FORMATS: ["txt", "docx", "srt", "vtt", "md"],
  DEFAULT_HOTKEY: "CommandOrControl+Shift+Space",
  MAX_RECORDING_DURATION: 300000, // 5分钟
  MAX_TEXT_LENGTH: 10000,
  CHINESE_LANGUAGE_CODES: ["zh", "zh-CN", "zh-TW", "zh-HK"],
});

// 添加调试信息（仅在开发模式下）
if (process.env.NODE_ENV === "development") {
  contextBridge.exposeInMainWorld("debug", {
    getElectronVersion: () => process.versions.electron,
    getNodeVersion: () => process.versions.node,
    getChromeVersion: () => process.versions.chrome,
    getPlatform: () => process.platform,
    getArch: () => process.arch,
  });
}
