const fs = require("fs");
const path = require("path");

/** @type {string[]} */
const FILE_CONFIGURABLE_KEYS = [
  "ai_base_url",
  "ai_model",
  "hotkey",
  "language",
  "theme",
  "auto_paste",
  "auto_start",
  "minimize_to_tray",
  "show_notifications",
];

/**
 * @param {string} configPath
 * @returns {Record<string, unknown>}
 */
function loadFileConfig(configPath) {
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};

    const allowed = new Set(FILE_CONFIGURABLE_KEYS);
    const filtered = {};
    for (const key of Object.keys(parsed)) {
      if (allowed.has(key)) filtered[key] = parsed[key];
    }
    return filtered;
  } catch {
    return {};
  }
}

/**
 * @param {string} configPath
 * @param {Record<string, unknown>} settings
 */
function saveFileConfig(configPath, settings) {
  const allowed = new Set(FILE_CONFIGURABLE_KEYS);
  const filtered = {};
  for (const key of Object.keys(settings)) {
    if (allowed.has(key)) filtered[key] = settings[key];
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(filtered, null, 2), "utf-8");
}

module.exports = { loadFileConfig, saveFileConfig, FILE_CONFIGURABLE_KEYS };
