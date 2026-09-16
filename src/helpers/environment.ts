// [20260724_TS_Migration_Environment] Migrated from .js to .ts (ADR-010 Phase 3).
// Depends on path, fs, os. ([20260815_Refactor_DotenvRemoval]: the dotenv
// dependency was replaced by a minimal parser in loadEnvironmentVariables.)
// [20260816_Refactor_MinimalEnvironment] The seven typed config getters,
// getSystemInfo, validateEnvironment, exportConfig, and the per-purpose
// directory helpers were removed — zero callers outside this file (the
// logManager has its own getSystemInfo/getLogDirectory). What remains is the
// whole externally-used surface: .env loading and the data-directory logic.
import path from "path";
import fs from "fs";
import os from "os";

class EnvironmentManager {
  constructor() {
    this.loadEnvironmentVariables();
  }

  // [20260815_Refactor_DotenvRemoval] Named prefix constant — also keeps the
  // literal away from `.length` accessors that can false-positive the naive
  // import-scanner regex in main-process-module-resolution.test.ts.
  private static readonly EXPORT_PREFIX = "export ";

  loadEnvironmentVariables(): void {
    // [20260815_Refactor_DotenvRemoval] Replaced the dotenv dependency
    // (108KB, packaged into the installer) with a minimal parser for the
    // subset real .env files here use: comments, blank lines, optional
    // `export ` prefix, KEY=value with optional matching quotes. Semantics
    // are locked by tests/unit/environment.test.ts.
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;

    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const assignment = line.startsWith(EnvironmentManager.EXPORT_PREFIX)
        ? line.slice(EnvironmentManager.EXPORT_PREFIX.length)
        : line;
      const eqIndex = assignment.indexOf("=");
      if (eqIndex <= 0) continue;

      const key = assignment.slice(0, eqIndex).trim();
      let value = assignment.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // dotenv v16+ ignores these keys; mirror that for defense-in-depth even
      // though assignment to process.env cannot pollute Object.prototype.
      if (key === "__proto__" || key === "constructor") continue;
      // dotenv's config() never overrides existing process.env entries
      // (override: false) — the real shell environment wins over .env files.
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  getDataDirectory(): string {
    const appName = "Murmur";
    switch (process.platform) {
      case "win32":
        return path.join(os.homedir(), "AppData", "Roaming", appName);
      case "darwin":
        return path.join(
          os.homedir(),
          "Library",
          "Application Support",
          appName,
        );
      case "linux":
        return path.join(os.homedir(), ".config", appName);
      default:
        return path.join(os.homedir(), `.${appName.toLowerCase()}`);
    }
  }

  ensureDataDirectory(): string {
    const dataDir = this.getDataDirectory();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
  }
}

export default EnvironmentManager;
