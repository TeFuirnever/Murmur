// [20260912_Feat_CliSkeleton] murmur CLI config whitelist (ticket #264).
//
// This list MUST stay in sync with ALLOWED_SETTING_KEYS in
// src/helpers/ipc/settingsHandlers.ts — the same key list semantics as the
// IPC settings boundary. The CLI cannot import TypeScript at runtime (it
// runs as a zero-dependency .mjs under ELECTRON_RUN_AS_NODE), so the list is
// mirrored here; tests/unit/cli-config.test.ts imports both modules and
// asserts set equality in both directions, so any drift fails CI.
export const CONFIG_KEYS = Object.freeze([
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "ai_temperature",
  "ai_max_tokens",
  "enable_ai_optimization",
  // [20260905_Fix_249_DefaultModeUi] Default AI processing mode (issue #249).
  "default_mode",
  "window_always_on_top",
  "auto_paste",
  "close_behavior",
  "theme",
  "hotkey",
  "language",
  "auto_start",
  "minimize_to_tray",
  "show_notifications",
  "model_download_path",
  // [20260820_T14_Hotwords] Hotword list (sanitized at the app boundaries).
  "hotwords",
  // [20260905_Feat_BloubSettings] bot mascot catalogue keys (spec #224).
  "bot_shape",
  "bot_color",
  "bot_expression",
]);

const CONFIG_KEY_SET = new Set(CONFIG_KEYS);

/** True when the key may be read/written by `murmur config`. */
export function isConfigKey(key) {
  return CONFIG_KEY_SET.has(key);
}
