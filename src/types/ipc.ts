// IPC response types for Murmur's main ↔ renderer communication

// ─── Common ───

export interface SuccessResult {
  success: true;
}

export interface ErrorResult {
  success: false;
  error: string;
}

export type Result = SuccessResult | ErrorResult;

// ─── AI ───

export interface AIProcessResult {
  success: boolean;
  text?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
  error?: string;
}

export interface AICheckStatusResult {
  available: boolean;
  model?: string;
  status?: string;
  response?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  details?: string;
  error?: string;
}

export interface AIMode {
  name: string;
  label: string;
  description: string;
}

export interface AIProviderPreset {
  name: string;
  label: string;
  base_url: string;
  models: string[];
  requires_api_key: boolean;
}

export interface LocalModelDetection {
  name: string;
  label: string;
  models: string[];
}

// ─── Transcription ───

export interface TranscriptionRecord {
  id: number;
  text: string;
  raw_text?: string;
  processed_text?: string;
  confidence?: number;
  duration?: number;
  audio_format?: string;
  created_at: string;
  updated_at?: string;
  tags?: string;
}

export interface TranscriptionSaveResult {
  success: boolean;
  id?: number;
  lastInsertRowid?: number;
  changes?: number;
  error?: string;
}

export interface FileTranscriptionResult {
  success: boolean;
  text?: string;
  id?: number;
  error?: string;
  canceled?: boolean;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  extension?: string;
  duration?: number;
  segments?: Array<{ start_ms: number; end_ms: number; text: string }>;
  confidence?: number;
  language?: string;
  processed_text?: string;
  raw_text?: string;
  file_size?: number;
}

export interface ExportResult {
  success: boolean;
  path?: string;
  error?: string;
  canceled?: boolean;
}

export interface ExportAllResult {
  success: boolean;
  path?: string;
  count?: number;
  error?: string;
  canceled?: boolean;
}

export interface AIReviewResult {
  success: boolean;
  reviewText?: string;
  error?: string;
}

export interface TranscriptionStats {
  total: number;
  totalDuration: number;
  avgConfidence: number;
  firstDate?: string;
  lastDate?: string;
}

// ─── FunASR ───

export interface FunASRStatusResult {
  success: boolean;
  error?: string;
  installed: boolean;
  models_downloaded: boolean;
  missing_models?: string[];
  initializing: boolean;
  models_initialized?: boolean;
  status_message?: string;
}

export interface ModelCheckResult {
  success?: boolean;
  models_downloaded: boolean;
  minimum_ready?: boolean;
  missing_models: string[];
  model_path?: string;
  error?: string;
}

export interface DownloadProgress {
  progress: number;
  status: string;
  current_file?: string;
  error?: string;
  overall_progress?: number;
}

export interface ModelInfo {
  name: string;
  description: string;
  size: string;
  downloaded: boolean;
}

// ─── Settings ───

export interface SettingsImportResult {
  success: boolean;
  count?: number;
  error?: string;
  canceled?: boolean;
}

export interface SettingsExportResult {
  success: boolean;
  path?: string;
  error?: string;
  canceled?: boolean;
}

// ─── Environment ───

export interface EnvironmentConfig {
  platform: string;
  arch: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  appVersion: string;
  isDev: boolean;
}

export interface PythonCheckResult {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface PythonInstallResult {
  success: boolean;
  error?: string;
}

export interface FunASRInstallResult {
  installed: boolean;
  packages?: string[];
  error?: string;
}

// ─── Update ───

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  downloadUrl?: string;
  downloadSize?: number;
  checksumsUrl?: string;
  message?: string;
  error?: string;
}

export interface UpdateDownloadResult {
  success: boolean;
  filePath?: string;
  hashValid?: boolean;
  error?: string;
}

export interface UpdateProgressData {
  progress: number;
  downloaded: number;
  total: number;
}

export interface UpdateCompleteData {
  filePath: string;
  version: string;
  hashValid: boolean;
}

export interface UpdateErrorData {
  error: string;
}

// ─── Permissions ───

export interface PermissionResult {
  accessibility: boolean;
  microphone: boolean;
  [key: string]: boolean;
}

// ─── Hotkey ───

export interface HotkeyRegistrationResult {
  success: boolean;
  error?: string;
}
