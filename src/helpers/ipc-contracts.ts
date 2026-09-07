// [20260724_TS_BigBang_IpcContracts] Migrated from .js to .ts as the single
// source of truth (ADR-010). Converted from `module.exports = ipcContracts`
// (whole-object export) to named exports so both `import * as C from
// "./ipc-contracts"` (C.AI) and `const C = require("./ipc-contracts")` return
// the namespace object. DO NOT use `export default` here — esbuild CJS output
// would wrap it as `{ default: X }`, breaking `C.AI` access.
/**
 * Central registry of all IPC channel names used between main and renderer.
 * This object is shared between preload, main, and all IPC handlers.
 */

export const FUNASR = {
  STATUS: "check-funasr-status",
  // [20260822_T12_IdleUnload] Hotkey-down reload pre-trigger (fire-and-
  // forget warm-up; ticket #190).
  RELOAD_MODELS: "reload-funasr-models",
} as const;

// [20260815_Refactor_DeadIpc] Removed dead channels (zero renderer callers):
// MODELS.PROGRESS (UI uses the MODEL_DOWNLOAD_PROGRESS push event),
// TRANSCRIPTION.SEARCH (history page filters client-side),
// CLIPBOARD.READ/WRITE, EVENTS.TOGGLE_DICTATION (never emitted).

// [20260816_Refactor_DeadChannels] Removed with their zero-renderer-caller
// handlers: MODELS.AVAILABLE/CURRENT/SWITCH/DOWNLOAD_MODEL (hardcoded
// placeholder responses — fake feature), TRANSCRIPTION.GET/STATS, and
// SETTINGS.GET_LEGACY/IMPORT/EXPORT (no UI entry points).

// [20260906_Refactor_DeadChannelCleanup] Ticket #250: removed the 20
// renderer-orphan channels measured by ipc-contracts-orphans.test.ts
// (yellow list), plus the processing-update push event with its live
// subscriber (useModelStatus) per the ticket manifest. See that test for
// the evidence baseline; the deleted keys span the FUNASR, SETTINGS,
// WINDOW, HOTKEY, SYSTEM and EVENTS domains.

export const MODELS = {
  CHECK: "check-model-files",
  DOWNLOAD: "download-models",
} as const;

export const TRANSCRIPTION = {
  AUDIO: "transcribe-audio",
  IMPORT_FILE: "import-audio-file",
  VALIDATE_FILE: "validate-audio-file",
  TRANSCRIBE_FILE: "transcribe-file",
  CANCEL: "cancel-file-transcription",
  SAVE: "save-transcription",
  GET_ALL: "get-transcriptions",
  DELETE: "delete-transcription",
  CLEAR: "clear-all-transcriptions",
  EXPORT: "export-transcription",
  EXPORT_ALL: "export-transcriptions",
  AI_REVIEW: "ai-review-transcription",
  DIARIZE: "diarize-transcription",
} as const;

export const AI = {
  PROCESS: "process-text",
  CHECK_STATUS: "check-ai-status",
  GET_MODES: "get-ai-modes",
  GET_PROVIDER_PRESETS: "get-ai-provider-presets",
  DETECT_LOCAL_MODELS: "detect-local-models",
} as const;

export const SETTINGS = {
  GET: "get-setting",
  SET: "set-setting",
  GET_ALL: "get-all-settings",
} as const;

export const WINDOW = {
  HIDE: "hide-window",
  MINIMIZE: "minimize-window",
  MAXIMIZE: "maximize-window",
  CLOSE: "close-window",
  SET_TOP: "set-always-on-top",
  CLOSE_APP: "close-app",
  OPEN_HISTORY: "open-history-window",
  CLOSE_HISTORY: "close-history-window",
  OPEN_SETTINGS: "open-settings-window",
  HIDE_SETTINGS: "hide-settings-window",
} as const;

export const HOTKEY = {
  REGISTER: "register-hotkey",
  UNREGISTER: "unregister-hotkey",
  GET_CURRENT: "get-current-hotkey",
  SET_STATE: "set-recording-state",
} as const;

export const CLIPBOARD = {
  PASTE: "paste-text",
  COPY: "copy-text",
} as const;

export const UPDATE = {
  CHECK: "check-update",
  DOWNLOAD: "download-update",
  CANCEL: "cancel-update-download",
  INSTALL: "install-update",
} as const;

export const SYSTEM = {
  VERSION: "get-app-version",
  LOG: "log",
  OPEN_EXTERNAL: "open-external",
} as const;

export const EVENTS = {
  HOTKEY_TRIGGERED: "hotkey-triggered",
  WINDOW_MAXIMIZE_CHANGE: "window-maximize-change",
  SETTINGS_UPDATE: "settings-update",
  MODEL_DOWNLOAD_PROGRESS: "model-download-progress",
  FILE_TRANSCRIPTION_PROGRESS: "file-transcription-progress",
  UPDATE_DOWNLOAD_PROGRESS: "update-download-progress",
  UPDATE_DOWNLOAD_COMPLETE: "update-download-complete",
  UPDATE_DOWNLOAD_ERROR: "update-download-error",
} as const;

export const AUDIO_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".m4a",
  ".flac",
  ".ogg",
  ".wma",
  ".aac",
] as const;
