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
  INSTALL: "install-funasr",
  STATUS: "check-funasr-status",
  RESTART: "restart-funasr-server",
} as const;

export const MODELS = {
  CHECK: "check-model-files",
  DOWNLOAD: "download-models",
  PROGRESS: "get-download-progress",
  DOWNLOAD_MODEL: "download-model",
  AVAILABLE: "get-available-models",
  CURRENT: "get-current-model",
  SWITCH: "switch-model",
} as const;

export const TRANSCRIPTION = {
  AUDIO: "transcribe-audio",
  IMPORT_FILE: "import-audio-file",
  VALIDATE_FILE: "validate-audio-file",
  TRANSCRIBE_FILE: "transcribe-file",
  CANCEL: "cancel-file-transcription",
  SAVE: "save-transcription",
  GET: "get-transcription",
  GET_ALL: "get-transcriptions",
  DELETE: "delete-transcription",
  SEARCH: "search-transcriptions",
  STATS: "get-transcription-stats",
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
  GET_LEGACY: "get-settings",
  SAVE: "save-setting",
  RESET: "reset-settings",
  IMPORT: "import-settings",
  EXPORT: "export-settings",
} as const;

export const WINDOW = {
  HIDE: "hide-window",
  SHOW: "show-window",
  MINIMIZE: "minimize-window",
  MAXIMIZE: "maximize-window",
  IS_MAX: "is-window-maximized",
  CLOSE: "close-window",
  SET_TOP: "set-always-on-top",
  CLOSE_APP: "close-app",
  RELOAD: "reload-window",
  OPEN_DEV_TOOLS: "open-dev-tools",
  OPEN_HISTORY: "open-history-window",
  CLOSE_HISTORY: "close-history-window",
  HIDE_HISTORY: "hide-history-window",
  OPEN_SETTINGS: "open-settings-window",
  CLOSE_SETTINGS: "close-settings-window",
  HIDE_SETTINGS: "hide-settings-window",
} as const;

export const HOTKEY = {
  REGISTER: "register-hotkey",
  UNREGISTER: "unregister-hotkey",
  GET_CURRENT: "get-current-hotkey",
  REGISTER_F2: "register-f2-hotkey",
  UNREGISTER_F2: "unregister-f2-hotkey",
  SET_STATE: "set-recording-state",
  GET_STATE: "get-recording-state",
} as const;

export const CLIPBOARD = {
  PASTE: "paste-text",
  COPY: "copy-text",
  READ: "read-clipboard",
  WRITE: "write-clipboard",
} as const;

export const UPDATE = {
  CHECK: "check-update",
  DOWNLOAD: "download-update",
  CANCEL: "cancel-update-download",
  INSTALL: "install-update",
} as const;

export const SYSTEM = {
  INFO: "get-system-info",
  DEBUG_INFO: "get-system-debug-info",
  PERMISSIONS: "check-permissions",
  REQUEST_PERMS: "request-permissions",
  TEST_A11Y: "test-accessibility-permission",
  OPEN_PERMS: "open-system-permissions",
  VERSION: "get-app-version",
  LOG: "log",
  OPEN_EXTERNAL: "open-external",
} as const;

export const EVENTS = {
  TOGGLE_DICTATION: "toggle-dictation",
  HOTKEY_TRIGGERED: "hotkey-triggered",
  F2_DOUBLE_CLICK: "f2-double-click",
  WINDOW_MAXIMIZE_CHANGE: "window-maximize-change",
  TRANSCRIPTION_UPDATE: "transcription-update",
  PROCESSING_UPDATE: "processing-update",
  ERROR: "error",
  SETTINGS_UPDATE: "settings-update",
  MODEL_DOWNLOAD_PROGRESS: "model-download-progress",
  FILE_TRANSCRIPTION_PROGRESS: "file-transcription-progress",
  FUNASR_INSTALL_PROGRESS: "funasr-install-progress",
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
