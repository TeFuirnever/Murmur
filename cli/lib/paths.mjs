// [20260912_Feat_CliSkeleton] Path resolution for the murmur CLI (ticket #264,
// spec #258). Replicates — in plain ESM, because cli/ must run with zero deps
// under ELECTRON_RUN_AS_NODE — the exact derivations used by the app:
//   - data directory: src/helpers/environment.ts getDataDirectory()
//   - ELECTRON_USER_DATA override: main.ts sets it before spawning children
//   - murmur.json location: main.ts (dataDirectory + "murmur.json")
//   - database location + MURMUR_DB_PATH override: src/helpers/database.ts
//     initialize() (MURMUR_DB_PATH || dataDirectory/transcriptions.db)
// tests/unit/cli.test.ts locks the derivation shape per platform.
import path from "node:path";

const APP_DATA_DIR_NAME = "Murmur";
const CONFIG_FILE_NAME = "murmur.json";
const DATABASE_FILE_NAME = "transcriptions.db";

/** Environment variable overrides honoured by the CLI (same names the app uses). */
export const ENV_USER_DATA = "ELECTRON_USER_DATA";
export const ENV_DB_PATH = "MURMUR_DB_PATH";

/**
 * @typedef {object} PathContext
 * @property {Record<string, string | undefined>} [env] Environment (defaults to process.env).
 * @property {string} [platform] Platform identifier (defaults to process.platform).
 * @property {() => string} [homedir] Home directory resolver (defaults to os.homedir).
 */

/**
 * Resolve the Murmur data directory.
 *
 * Precedence: ELECTRON_USER_DATA env (set by the app for its children; also
 * lets tests/dev shells redirect everything) -> platform default mirroring
 * environment.ts exactly (win32: AppData/Roaming, darwin: Application Support,
 * linux: .config, other: ~/.murmur).
 *
 * @param {PathContext} [context]
 * @returns {string}
 */
export function resolveDataDirectory(context = {}) {
  const env = context.env ?? process.env;
  const platform = context.platform ?? process.platform;
  const homedir = context.homedir ?? (() => "");
  const override = env[ENV_USER_DATA];
  if (override) return override;

  switch (platform) {
    case "win32":
      return path.join(homedir(), "AppData", "Roaming", APP_DATA_DIR_NAME);
    case "darwin":
      return path.join(
        homedir(),
        "Library",
        "Application Support",
        APP_DATA_DIR_NAME,
      );
    case "linux":
      return path.join(homedir(), ".config", APP_DATA_DIR_NAME);
    default:
      return path.join(homedir(), `.${APP_DATA_DIR_NAME.toLowerCase()}`);
  }
}

/** Resolve the murmur.json path (main.ts: dataDirectory + "murmur.json"). */
export function resolveConfigPath(context = {}) {
  return path.join(resolveDataDirectory(context), CONFIG_FILE_NAME);
}

/**
 * Resolve the SQLite database path (database.ts initialize():
 * MURMUR_DB_PATH env wins, else dataDirectory/transcriptions.db).
 */
export function resolveDatabasePath(context = {}) {
  const override = context.env?.[ENV_DB_PATH];
  if (override) return override;
  return path.join(resolveDataDirectory(context), DATABASE_FILE_NAME);
}
