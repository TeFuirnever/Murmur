import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["tests/**/*.test.{js,ts,jsx,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/helpers/**/*.{js,ts}",
        "src/utils/**/*.{js,ts}",
        "src/bootstrap/**/*.{js,ts}",
      ],
      exclude: [
        // [20260724_TS_BigBang_TestFix] Changed .js → .ts to match migrated
        // file names. These are Electron-dependent (require runtime
        // IPC/BrowserWindow/app) and cannot be unit-tested.
        "src/helpers/clipboard.ts",
        "src/helpers/environment.ts",
        "src/helpers/tray.ts",
        "src/helpers/hotkeyManager.ts",
        "src/helpers/pythonEnvironment.ts",
        "src/helpers/pythonInstaller.ts",
        "src/helpers/funasrManager.ts",
        "src/helpers/funasrServer.ts",
        "src/helpers/modelManager.ts",
        "src/helpers/updateManager.ts",
        "src/helpers/windowManager.ts",
        "src/helpers/logManager.ts",
        // [20260724_TS_BigBang_TestFix] END
        // IPC handlers (integration-level, require Electron IPC bridge)
        "src/helpers/ipc/**",
      ],
      thresholds: {
        statements: 94,
        branches: 88,
        functions: 95,
        lines: 94,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
});
