import type {
  AIProcessResult,
  AICheckStatusResult,
  AIMode,
  TranscriptionRecord,
  TranscriptionSaveResult,
  FileTranscriptionResult,
  ExportResult,
  ExportAllResult,
  AIReviewResult,
  TranscriptionStats,
  FunASRStatusResult,
  ModelCheckResult,
  DownloadProgress,
  ModelInfo,
  SettingsImportResult,
  SettingsExportResult,
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateProgressData,
  UpdateCompleteData,
  UpdateErrorData,
  PermissionResult,
  HotkeyRegistrationResult,
} from "./types/ipc";

export interface ElectronAPI {
  // Window control
  hideWindow: () => Promise<void>;
  showWindow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximizeChange: (
    callback: (isMaximized: boolean) => void,
  ) => () => void;
  closeWindow: () => Promise<void>;
  closeApp: () => Promise<void>;
  setAlwaysOnTop: (enabled: boolean) => Promise<void>;

  // Dictation
  onToggleDictation: (callback: (isRecording: boolean) => void) => () => void;

  // FunASR
  transcribeAudio: (
    audioData: ArrayBuffer | Blob,
    options?: Record<string, unknown>,
  ) => Promise<FileTranscriptionResult>;
  checkFunASRStatus: () => Promise<FunASRStatusResult>;
  installFunASR: () => Promise<{ installed: boolean; error?: string }>;
  restartFunasrServer: () => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

  // Model management
  checkModelFiles: () => Promise<ModelCheckResult>;
  getDownloadProgress: () => Promise<DownloadProgress>;
  downloadModels: (
    callback?: (progress: DownloadProgress) => void,
  ) => Promise<ModelCheckResult>;
  downloadModel: (
    modelName: string,
  ) => Promise<{ success: boolean; error?: string }>;
  getAvailableModels: () => Promise<ModelInfo[]>;
  getCurrentModel: () => Promise<string>;
  switchModel: (
    modelName: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onModelDownloadProgress: (
    callback: (eventOrProgress: any, progress?: DownloadProgress) => void,
  ) => () => void;

  // AI text processing
  processText: (text: string, mode: string) => Promise<AIProcessResult>;
  checkAIStatus: (testConfig?: {
    ai_api_key?: string;
    ai_base_url?: string;
    ai_model?: string;
  }) => Promise<AICheckStatusResult>;
  getAIModes: () => Promise<AIMode[]>;
  getAIProviderPresets: () => Promise<AIProviderPreset[]>;
  detectLocalModels: () => Promise<LocalModelDetection[]>;

  // Clipboard
  pasteText: (text: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;

  // Transcription
  saveTranscription: (data: {
    text: string;
    raw_text?: string;
    processed_text?: string;
    confidence?: number;
    duration?: number;
    audio_format?: string;
  }) => Promise<TranscriptionSaveResult>;
  getTranscription: (id: number) => Promise<TranscriptionRecord | null>;
  getTranscriptions: (
    limit: number,
    offset: number,
  ) => Promise<TranscriptionRecord[]>;
  deleteTranscription: (
    id: number,
  ) => Promise<{ success: boolean; error?: string }>;
  diarizeAudio: (id: number) => Promise<{
    success: boolean;
    segments?: Array<{ start_ms: number; end_ms: number; text: string; speaker: string }>;
    error?: string;
  }>;
  clearAllTranscriptions: () => Promise<{ success: boolean; error?: string }>;
  searchTranscriptions: (
    query: string,
    limit?: number,
  ) => Promise<TranscriptionRecord[]>;
  getTranscriptionStats: () => Promise<TranscriptionStats>;

  // Settings
  getSetting: (key: string, defaultValue?: unknown) => Promise<unknown>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  getAllSettings: () => Promise<Record<string, unknown>>;
  getSettings: () => Promise<Record<string, unknown>>;
  saveSetting: (key: string, value: unknown) => Promise<void>;
  resetSettings: () => Promise<void>;
  importSettings: () => Promise<SettingsImportResult>;
  exportSettings: () => Promise<SettingsExportResult>;

  // Hotkey
  registerHotkey: (hotkey: string) => Promise<HotkeyRegistrationResult>;
  unregisterHotkey: (hotkey: string) => Promise<HotkeyRegistrationResult>;
  getCurrentHotkey: () => Promise<string>;
  registerF2Hotkey: () => Promise<HotkeyRegistrationResult>;
  unregisterF2Hotkey: () => Promise<HotkeyRegistrationResult>;
  setRecordingState: (isRecording: boolean) => Promise<void>;
  getRecordingState: () => Promise<boolean>;
  onF2DoubleClick: (callback: () => void) => () => void;
  onHotkeyTriggered: (callback: (hotkey: string) => void) => () => void;

  // File operations
  exportTranscription: (
    id: number,
    format: string,
    options?: Record<string, unknown>,
  ) => Promise<ExportResult>;
  exportTranscriptions: (format: string) => Promise<ExportAllResult>;

  // File transcription
  importAudioFile: () => Promise<FileTranscriptionResult>;
  validateAudioFile: (
    filePath: string,
  ) => Promise<{
    success: boolean;
    filePath?: string;
    fileName?: string;
    fileSize?: number;
    extension?: string;
    error?: string;
  }>;
  transcribeFile: (
    audioPath: string,
    options?: Record<string, unknown>,
  ) => Promise<FileTranscriptionResult>;
  cancelFileTranscription: () => Promise<{ success: boolean }>;
  onFileTranscriptionProgress: (
    callback: (data: {
      progress?: number;
      status?: string;
      phase?: string;
      message?: string;
      processed_ms?: number;
      total_ms?: number;
      progress_pct?: number;
    }) => void,
  ) => () => void;

  // AI review
  aiReviewTranscription: (
    id: number,
    template?: string,
  ) => Promise<AIReviewResult>;

  // System
  getSystemInfo: () => Promise<Record<string, unknown>>;
  checkPermissions: () => Promise<PermissionResult>;
  requestPermissions: () => Promise<PermissionResult>;
  testAccessibilityPermission: () => Promise<boolean>;
  openSystemPermissions: () => Promise<void>;
  getAppVersion: () => Promise<string>;

  // Update management
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: (updateInfo: {
    downloadUrl: string;
    checksumsUrl: string;
    latestVersion: string;
  }) => Promise<UpdateDownloadResult>;
  cancelUpdateDownload: () => Promise<{ success: boolean; error?: string }>;
  installUpdate: (filePath: string) => Promise<boolean>;
  onUpdateDownloadProgress: (
    callback: (data: UpdateProgressData) => void,
  ) => () => void;
  onUpdateDownloadComplete: (
    callback: (data: UpdateCompleteData) => void,
  ) => () => void;
  onUpdateDownloadError: (
    callback: (data: UpdateErrorData) => void,
  ) => () => void;

  // Misc
  openExternal: (url: string) => Promise<void>;
  log: (level: string, message: string, data?: unknown) => Promise<void>;
  getAppPath: (name: string) => Promise<string>;
  showItemInFolder: (path: string) => Promise<void>;
  reloadWindow: () => Promise<void>;
  openDevTools: () => Promise<void>;

  // Event listeners
  onTranscriptionUpdate: (
    callback: (data: TranscriptionRecord) => void,
  ) => () => void;
  onProcessingUpdate: (
    callback: (
      eventOrData: any,
      data?: {
        status?: string;
        progress?: number;
        type?: string;
        isLoading?: boolean;
        isReady?: boolean;
      },
    ) => void,
  ) => () => void;
  onError: (callback: (data: { error: string }) => void) => () => void;
  onSettingsUpdate: (
    callback: (data: Record<string, unknown>) => void,
  ) => () => void;

  // History window
  openHistoryWindow: () => Promise<void>;
  closeHistoryWindow: () => Promise<void>;
  hideHistoryWindow: () => Promise<void>;

  // Settings window
  openSettingsWindow: () => Promise<void>;
  closeSettingsWindow: () => Promise<void>;
  hideSettingsWindow: () => Promise<void>;

  // Python environment
  checkPython: () => Promise<import("./types/ipc").PythonCheckResult>;
  installPython: () => Promise<import("./types/ipc").PythonInstallResult>;
  testPythonEnvironment: () => Promise<
    import("./types/ipc").PythonInstallResult
  >;
  checkFunASR: () => Promise<import("./types/ipc").FunASRInstallResult>;
  installFunASR: () => Promise<import("./types/ipc").FunASRInstallResult>;
  getFunASRLogs: () => Promise<string[]>;

  // Environment
  getConfig: () => Promise<import("./types/ipc").EnvironmentConfig>;
  validateEnvironment: () => Promise<{
    python: boolean;
    funasr: boolean;
    ffmpeg: boolean;
    models: boolean;
  }>;
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
