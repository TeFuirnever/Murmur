import type {
  AIProcessResult,
  AICheckStatusResult,
  AIMode,
  AIProviderPreset,
  LocalModelDetection,
  TranscriptionRecord,
  TranscriptionSaveResult,
  TranscriptionUpdateResult,
  ListModelsResult,
  PolishChunk,
  FileTranscriptionResult,
  ExportResult,
  ExportAllResult,
  AIReviewResult,
  FunASRStatusResult,
  ModelCheckResult,
  DownloadProgress,
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateProgressData,
  UpdateCompleteData,
  UpdateErrorData,
  HotkeyRegistrationResult,
  FileTranscriptionProgressData,
  OperationResult,
  TemplateListResult,
  TemplateReadResult,
  TemplateSaveResult,
} from "./types/ipc";

export interface ElectronAPI {
  // Window control
  hideWindow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
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
    requestId?: string,
  ) => Promise<AIProcessResult>;
  checkAIStatus: (testConfig?: {
    ai_api_key?: string;
    ai_base_url?: string;
    ai_model?: string;
  }) => Promise<AICheckStatusResult>;
  // [20260907_Feat_233_ListModels] Provider model-list derivation (T6).
  listAIModels: (baseUrl: string, apiKey: string) => Promise<ListModelsResult>;
  // [20260907_Feat_235_StreamPipeline] T8 streaming abort + chunk push.
  abortPolish: (requestId: string) => Promise<OperationResult>;
  // [20260908_Feat_240_VocabCorrections] T13 vocabulary CRUD.
  listVocabCorrections: () => Promise<{
    success: boolean;
    entries: Array<{ wrong: string; right: string }>;
  }>;
  addVocabCorrection: (
    wrong: string,
    right: string,
  ) => Promise<OperationResult>;
  deleteVocabCorrection: (wrong: string) => Promise<OperationResult>;
  clearVocabCorrections: () => Promise<OperationResult>;
  // [20260910_Feat_237_StreamDegradation] T10 degradation-memory view/reset.
  listStreamDegradations: () => Promise<{
    success: boolean;
    entries: Array<{ baseUrl: string; at: number }>;
    error?: string;
  }>;
  resetStreamDegradations: () => Promise<
    OperationResult & {
      removed?: number;
    }
  >;
  // [20260910_Feat_237_StreamDegradation] END
  onPolishChunk: (callback: (chunk: PolishChunk) => void) => () => void;
  getAIModes: () => Promise<AIMode[]>;
  getAIProviderPresets: () => Promise<AIProviderPreset[]>;
  detectLocalModels: () => Promise<LocalModelDetection[]>;

  // [20260912_Feat_242_TemplateSystem] Ticket #242 (spec #193 T15): custom
  // template editor. Requests carry NAME+CONTENT only — never a path; the
  // main process sanitizes the name into the on-disk filename.
  // [20260912_Fix_242_ReviewRound2] READ/SAVE/DELETE take the on-disk
  // fileName from LIST (a bare filename; sanitized again main-side).
  listTemplates: () => Promise<TemplateListResult>;
  readTemplate: (fileName: string) => Promise<TemplateReadResult>;
  saveTemplate: (
    fileName: string,
    content: string,
  ) => Promise<TemplateSaveResult>;
  deleteTemplate: (fileName: string) => Promise<OperationResult>;
  // [20260912_Feat_242_TemplateSystem] END

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
    // [20260912_TypeContract_SaveTranscriptionPayload] Ticket #322: language
    // and file_size ride the SAVE channel from the recording auto-path
    // INSERT (useRecording.ts) and the main-process handler persists them —
    // declared here so the payload passes typecheck without casts (contract
    // test: preload-bridge-contract.test.ts).
    language?: string;
    file_size?: number;
  }) => Promise<TranscriptionSaveResult>;
  getTranscriptions: (
    limit: number,
    offset: number,
  ) => Promise<TranscriptionRecord[]>;
  deleteTranscription: (id: number) => Promise<OperationResult>;
  // [20260906_Feat_TranscriptionUpdate] Manual polish write-back (spec #193
  // T1, ticket #228): only the polished-text columns are patchable — the DB
  // whitelist rejects everything else, raw_text is never writable.
  // [20260906_Feat_ManualEditProtection] Spec #193 T2 (ticket #229): the
  // manual-edit flag joins the whitelist — the history-window edit-save sets
  // it in the SAME atomic call that writes the edited text.
  updateTranscription: (
    id: number,
    patch: {
      processed_text?: string;
      text?: string;
      manually_edited?: boolean;
    },
    // [20260912_Fix_322_AutoUpdateGuard] Ticket #322: the auto-polish
    // write-back passes the T2 manual-edit guard; omitted (undefined) by
    // the user-triggered polish/edit path, which stays unrestricted.
    options?: { skipWhenManuallyEdited?: boolean },
  ) => Promise<TranscriptionUpdateResult>;
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

  // Hotkey
  registerHotkey: (hotkey: string) => Promise<HotkeyRegistrationResult>;
  unregisterHotkey: (hotkey: string) => Promise<HotkeyRegistrationResult>;
  getCurrentHotkey: () => Promise<string>;
  setRecordingState: (isRecording: boolean) => Promise<void>;
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
  // [20260911_Fix_338_DragDropImport] webUtils.getPathForFile bridge for
  // drag & drop imports (Electron >= 32 removed File.path).
  getPathForFile: (file: File) => string;
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

  // Event listeners
  onSettingsUpdate: (
    callback: (data: Record<string, unknown>) => void,
  ) => () => void;

  // History window
  openHistoryWindow: () => Promise<void>;
  closeHistoryWindow: () => Promise<void>;

  // Settings window
  openSettingsWindow: () => Promise<void>;
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
  // [20260906_Refactor_DeadChannelCleanup] Ticket #250: removed the 20
  // renderer-orphan channels measured by ipc-contracts-orphans.test.ts
  // (yellow list) — showWindow, isWindowMaximized, installFunASR,
  // restartFunasrServer, saveSetting, resetSettings, getRecordingState,
  // getSystemInfo, checkPermissions, requestPermissions,
  // testAccessibilityPermission, openSystemPermissions, reloadWindow,
  // openDevTools, hideHistoryWindow, closeSettingsWindow,
  // onTranscriptionUpdate, onProcessingUpdate, onError — plus the orphaned
  // FunASRInstallResult/PermissionResult/ProcessingUpdateData imports.
  interface Window {
    electronAPI: ElectronAPI;
    constants: AppConstants;
    debug?: DebugInfo;
  }
}
