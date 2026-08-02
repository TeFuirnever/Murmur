// [20260724_TS_Migration_FileConfig] Migrated from .js to .ts (ADR-010 Phase 2).
// Depends only on fs and path.
import fs from "fs";
import path from "path";

/** Settings keys that can be configured via ~/.murmur.json */
const FILE_CONFIGURABLE_KEYS: readonly string[] = [
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
] as const;

/** A settings record keyed by string. */
type SettingsRecord = Record<string, unknown>;

/** Load filtered settings from a JSON config file. Returns {} on any error. */
function loadFileConfig(configPath: string): SettingsRecord {
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};

    const allowed = new Set(FILE_CONFIGURABLE_KEYS);
    const filtered: SettingsRecord = {};
    for (const key of Object.keys(parsed as object)) {
      if (allowed.has(key)) filtered[key] = (parsed as SettingsRecord)[key];
    }
    return filtered;
  } catch {
    return {};
  }
}

/** Save filtered settings to a JSON config file. */
function saveFileConfig(configPath: string, settings: SettingsRecord): void {
  const allowed = new Set(FILE_CONFIGURABLE_KEYS);
  const filtered: SettingsRecord = {};
  for (const key of Object.keys(settings)) {
    if (allowed.has(key)) filtered[key] = settings[key];
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(filtered, null, 2), "utf-8");
}

export { loadFileConfig, saveFileConfig, FILE_CONFIGURABLE_KEYS };
