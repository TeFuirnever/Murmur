import type {
  AIProcessResult,
  AICheckStatusResult,
  AIMode,
  AIProviderPreset,
  LocalModelDetection,
  TranscriptionRecord,
  TranscriptionSaveResult,
  FileTranscriptionResult,
  ExportResult,
  ExportAllResult,
  AIReviewResult,
  FunASRStatusResult,
  FunASRInstallResult,
  ModelCheckResult,
  DownloadProgress,
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateProgressData,
  UpdateCompleteData,
  UpdateErrorData,
  PermissionResult,
  HotkeyRegistrationResult,
  ProcessingUpdateData,
  FileTranscriptionProgressData,
  OperationResult,
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

  // FunASR
  transcribeAudio: (
    audioData: ArrayBuffer | Blob,
    options?: Record<string, unknown>,
  ) => Promise<FileTranscriptionResult>;
  checkFunASRStatus: () => Promise<FunASRStatusResult>;
  installFunASR: () => Promise<FunASRInstallResult>;
  restartFunasrServer: () => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  // [20260822_T12_IdleUnload] Fire-and-forget reload warm-up (#190).
  reloadFunasrModels: () => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

  // Model management
  checkModelFiles: () => Promise<ModelCheckResult>;
  downloadModels: (
    callback?: (progress: DownloadProgress) => void,
  ) => Promise<ModelCheckResult>;
  onModelDownloadProgress: (
    callback: (eventOrProgress: unknown, progress?: DownloadProgress) => void,
  ) => () => void;

  // AI text processing
  processText: (
    text: string,
    mode: string,
    timeout?: number,
  ) => Promise<AIProcessResult>;
  checkAIStatus: (testConfig?: {
    ai_api_key?: string;
    ai_base_url?: string;
    ai_model?: string;
  }) => Promise<AICheckStatusResult>;
  getAIModes: () => Promise<AIMode[]>;
  getAIProviderPresets: () => Promise<AIProviderPreset[]>;
  detectLocalModels: () => Promise<LocalModelDetection[]>;

  // Clipboard
  // [20260820_E2E_PasteContractFix] PASTE resolves the same envelope COPY
  // uses: {success:true} on success, {success:false, error} on failure.
  pasteText: (text: string) => Promise<OperationResult>;
  copyText: (text: string) => Promise<OperationResult>;

  // Transcription
  saveTranscription: (data: {
    text: string;
    raw_text?: string;
    processed_text?: string;
    confidence?: number;
    duration?: number;
    audio_format?: string;
  }) => Promise<TranscriptionSaveResult>;
  getTranscriptions: (
    limit: number,
    offset: number,
  ) => Promise<TranscriptionRecord[]>;
  deleteTranscription: (id: number) => Promise<OperationResult>;
  diarizeAudio: (id: number) => Promise<{
    success: boolean;
    segments?: Array<{
      start_ms: number;
      end_ms: number;
      text: string;
      speaker: string;
    }>;
    error?: string;
  }>;
  clearAllTranscriptions: () => Promise<OperationResult>;

  // Settings
  getSetting: (key: string, defaultValue?: unknown) => Promise<unknown>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  getAllSettings: () => Promise<Record<string, unknown>>;
  saveSetting: (key: string, value: unknown) => Promise<void>;
  resetSettings: () => Promise<void>;

  // Hotkey
  registerHotkey: (hotkey: string) => Promise<HotkeyRegistrationResult>;
  unregisterHotkey: (hotkey: string) => Promise<HotkeyRegistrationResult>;
  getCurrentHotkey: () => Promise<string>;
  setRecordingState: (isRecording: boolean) => Promise<void>;
  getRecordingState: () => Promise<boolean>;
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
  validateAudioFile: (filePath: string) => Promise<{
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
    callback: (data: FileTranscriptionProgressData) => void,
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
  cancelUpdateDownload: () => Promise<OperationResult>;
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
  reloadWindow: () => Promise<void>;
  openDevTools: () => Promise<void>;

  // Event listeners
  onTranscriptionUpdate: (
    callback: (data: TranscriptionRecord) => void,
  ) => () => void;
  onProcessingUpdate: (
    callback: (eventOrData: unknown, data?: ProcessingUpdateData) => void,
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
  // [20260816_Refactor_DeadChannels] Removed bindings + orphaned types:
  // downloadModel/getAvailableModels/getCurrentModel/switchModel,
  // getTranscription/getTranscriptionStats, getSettings(legacy),
  // importSettings/exportSettings, and the TranscriptionStats/ModelInfo/
  // SettingsImportResult/SettingsExportResult interfaces in types/ipc.ts.
  interface Window {
    electronAPI: ElectronAPI;
    constants: AppConstants;
    debug?: DebugInfo;
  }
}
