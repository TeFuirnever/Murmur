export interface ElectronAPI {
  // Window control
  hideWindow: () => Promise<void>;
  showWindow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
  closeWindow: () => Promise<void>;
  closeApp: () => Promise<void>;
  setAlwaysOnTop: (enabled: boolean) => Promise<void>;

  // Dictation
  onToggleDictation: (callback: (...args: unknown[]) => void) => () => void;

  // FunASR
  transcribeAudio: (audioData: unknown) => Promise<unknown>;
  checkFunASRStatus: () => Promise<unknown>;
  installFunASR: () => Promise<unknown>;
  restartFunasrServer: () => Promise<unknown>;

  // Model management
  checkModelFiles: () => Promise<unknown>;
  getDownloadProgress: () => Promise<unknown>;
  downloadModels: () => Promise<unknown>;
  downloadModel: (modelName: string) => Promise<unknown>;
  getAvailableModels: () => Promise<unknown>;
  getCurrentModel: () => Promise<unknown>;
  switchModel: (modelName: string) => Promise<unknown>;
  onModelDownloadProgress: (callback: (...args: unknown[]) => void) => () => void;

  // AI text processing
  processText: (text: string, mode: string) => Promise<string>;
  checkAIStatus: (testConfig?: unknown) => Promise<unknown>;

  // Clipboard
  pasteText: (text: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;

  // Database
  saveTranscription: (data: unknown) => Promise<unknown>;
  getTranscriptions: (limit: number, offset: number) => Promise<unknown[]>;
  deleteTranscription: (id: number | string) => Promise<void>;
  clearAllTranscriptions: () => Promise<void>;

  // Settings
  getSettings: () => Promise<Record<string, unknown>>;
  getAllSettings: () => Promise<Record<string, unknown>>;
  getSetting: (key: string, defaultValue?: unknown) => Promise<unknown>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  saveSetting: (key: string, value: unknown) => Promise<void>;
  resetSettings: () => Promise<void>;
  importSettings: () => Promise<unknown>;
  exportSettings: () => Promise<unknown>;

  // Hotkey
  registerHotkey: (hotkey: string) => Promise<unknown>;
  unregisterHotkey: (hotkey: string) => Promise<unknown>;
  getCurrentHotkey: () => Promise<string>;
  registerF2Hotkey: () => Promise<unknown>;
  unregisterF2Hotkey: () => Promise<unknown>;
  setRecordingState: (isRecording: boolean) => Promise<void>;
  getRecordingState: () => Promise<boolean>;
  onF2DoubleClick: (callback: (...args: unknown[]) => void) => () => void;
  onHotkeyTriggered: (callback: (...args: unknown[]) => void) => () => void;

  // File operations
  exportTranscriptions: (format: string) => Promise<unknown>;

  // File transcription
  importAudioFile: () => Promise<unknown>;
  transcribeFile: (audioPath: string, options?: unknown) => Promise<unknown>;
  cancelFileTranscription: () => Promise<unknown>;
  onFileTranscriptionProgress: (callback: (...args: unknown[]) => void) => () => void;

  // Transcription export & AI review
  exportTranscription: (id: number | string, format: string, options?: unknown) => Promise<unknown>;
  aiReviewTranscription: (id: number | string, template?: string) => Promise<unknown>;

  // System
  getSystemInfo: () => Promise<unknown>;
  checkPermissions: () => Promise<unknown>;
  requestPermissions: () => Promise<unknown>;
  testAccessibilityPermission: () => Promise<unknown>;
  openSystemPermissions: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<unknown>;
  openExternal: (url: string) => Promise<void>;
  log: (level: string, message: string) => Promise<void>;

  // Event listeners
  onTranscriptionUpdate: (callback: (...args: unknown[]) => void) => () => void;
  onProcessingUpdate: (callback: (...args: unknown[]) => void) => () => void;
  onError: (callback: (...args: unknown[]) => void) => () => void;
  onSettingsUpdate: (callback: (...args: unknown[]) => void) => () => void;

  // History window
  openHistoryWindow: () => Promise<void>;
  closeHistoryWindow: () => Promise<void>;
  hideHistoryWindow: () => Promise<void>;

  // Settings window
  openSettingsWindow: () => Promise<void>;
  closeSettingsWindow: () => Promise<void>;
  hideSettingsWindow: () => Promise<void>;
}

export interface AppConstants {
  APP_NAME: string;
  VERSION: string;
  SUPPORTED_AUDIO_FORMATS: string[];
  SUPPORTED_EXPORT_FORMATS: string[];
  DEFAULT_HOTKEY: string;
  MAX_RECORDING_DURATION: number;
  MAX_TEXT_LENGTH: number;
  CHINESE_LANGUAGE_CODES: string[];
}

export interface DebugInfo {
  getElectronVersion: () => string;
  getNodeVersion: () => string;
  getChromeVersion: () => string;
  getPlatform: () => string;
  getArch: () => string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    constants: AppConstants;
    debug?: DebugInfo;
  }
}
