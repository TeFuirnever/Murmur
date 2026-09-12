// [20260912_Feat_CliSkeleton] murmur CLI config whitelist (ticket #264).
//
// [20260912_Fix_264_ConfigWhitelistScope] This list mirrors
// FILE_CONFIGURABLE_KEYS in src/helpers/fileConfig.ts — the keys murmur.json
// ACTUALLY honors on load — not the broader IPC settings allowlist. Two
// reasons:
//   1. Effectiveness: the app filters murmur.json through this narrower list
//      (fileConfig.ts load/save both gate on it), so `config set` on any
//      other key would write a value the app silently ignores.
//   2. Secret hygiene: ai_api_key is deliberately ABSENT from the file
//      whitelist ("colleague names / keys must not land in a plaintext
//      dotfile" — fileConfig.ts header); an IPC-derived list would have let
//      the CLI write the decrypted key into plaintext murmur.json.
// The CLI cannot import TypeScript at runtime (zero-dependency .mjs under
// ELECTRON_RUN_AS_NODE), so the list is mirrored; tests/unit/cli-config.test.ts
// asserts set equality against fileConfig's export in both directions, so any
// drift fails CI.
export const CONFIG_KEYS = Object.freeze([
  "ai_base_url",
  "ai_model",
  "ai_temperature",
  "ai_max_tokens",
  "hotkey",
  "language",
  "theme",
  "auto_paste",
  "auto_start",
  "minimize_to_tray",
  "show_notifications",
]);

const CONFIG_KEY_SET = new Set(CONFIG_KEYS);

/** True when the key may be read/written by `murmur config`. */
export function isConfigKey(key) {
  return CONFIG_KEY_SET.has(key);
}
