// [20260912_Feat_CliSkeleton] murmur.json reader/writer for the CLI
// (ticket #264). Mirrors the app's src/helpers/fileConfig.ts semantics so the
// CLI and the app agree on the same file: unknown keys are filtered out on
// read AND on write (loadFileConfig/saveFileConfig behaviour), invalid or
// missing files read as {}, and the file is pretty-printed with 2-space
// indent exactly like saveFileConfig. The key whitelist itself lives in
// configKeys.mjs.
import fs from "node:fs";
import path from "node:path";
import { CONFIG_KEYS } from "./configKeys.mjs";

const JSON_INDENT_SPACES = 2;

/**
 * Load the whitelist-filtered settings from murmur.json.
 * Returns {} when the file is missing, unreadable, or not a JSON object —
 * the same contract as the app's loadFileConfig (which swallows every error).
 */
export function readConfig(configPath) {
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};

    const filtered = {};
    for (const key of Object.keys(parsed)) {
      if (CONFIG_KEYS.includes(key)) filtered[key] = parsed[key];
    }
    return filtered;
  } catch {
    // Mirror the app: a broken config file degrades to {} rather than
    // failing the read path.
    return {};
  }
}

/**
 * Persist a whitelist-filtered settings record to murmur.json, creating
 * parent directories as needed (saveFileConfig behaviour). Throws on real
 * write errors (permissions, disk) — the CLI maps those to exit code 1.
 */
export function writeConfig(configPath, settings) {
  const filtered = {};
  for (const key of Object.keys(settings)) {
    if (CONFIG_KEYS.includes(key)) filtered[key] = settings[key];
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(filtered, null, JSON_INDENT_SPACES),
    "utf-8",
  );
  return filtered;
}
