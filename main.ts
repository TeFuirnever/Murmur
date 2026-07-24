// [20260724_TS_Migration_EntryPoints] Type declaration for main.js entry
// point (ADR-010 final phase). main.js is the Electron entry point,
// bundled by esbuild and executed directly by Electron. This .ts file
// provides type information for tsc without changing runtime behavior.
//
// The implementation stays in main.js because:
// 1. Electron's "main" field in package.json points to main.js
// 2. esbuild bundles it for production (build:main script)
// 3. tsx runs it for development (dev:main script)
// 4. Rewriting to ESM imports risks breaking Electron's CJS module resolution

import type LogManager from "./src/helpers/logManager";
import type EnvironmentManager from "./src/helpers/environment";
import type DatabaseManager from "./src/helpers/database";

/** Managers exported by main.js for use by other modules. */
export interface MainExports {
  environmentManager: InstanceType<typeof EnvironmentManager>;
  windowManager: unknown;
  databaseManager: InstanceType<typeof DatabaseManager>;
  clipboardManager: unknown;
  funasrManager: unknown;
  trayManager: unknown;
  hotkeyManager: unknown;
  logger: LogManager;
}

// Re-export from the .js entry point so consumers get typed access.
// At runtime, Electron loads main.js directly (per package.json "main" field).
export = require("./main.js") as MainExports;
