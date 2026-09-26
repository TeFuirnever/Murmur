// [20260724_TS_Migration_FileConfig] Migrated from .js to .ts (ADR-010 Phase 2).
// Depends only on fs and path.
// [20260926_Refactor_403_SettingsSchema] Issue #403: the key list is DERIVED
// from the settings schema's fileSync flags (one declaration per key) instead
// of a hand-maintained mirror. Secrets are structurally excluded — the
// schema never sets fileSync on ai_api_key / hotwords, so colleague names
// and keys cannot land in a plaintext dotfile. Exported at the bottom for
// the boundary test (re-exported so existing importers keep their path).
import { FILE_CONFIGURABLE_KEYS } from "../settings/settingsSchema";
import fs from "fs";
import path from "path";

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
