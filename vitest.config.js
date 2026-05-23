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
        // Electron-dependent (require runtime IPC/BrowserWindow/app)
        "src/helpers/clipboard.js",
        "src/helpers/environment.js",
        "src/helpers/tray.js",
        "src/helpers/hotkeyManager.js",
        "src/helpers/pythonEnvironment.js",
        "src/helpers/pythonInstaller.js",
        "src/helpers/funasrManager.js",
        "src/helpers/funasrServer.js",
        "src/helpers/modelManager.js",
        "src/helpers/updateManager.js",
        "src/helpers/windowManager.js",
        "src/helpers/logManager.js",
        // IPC handlers (integration-level, require Electron IPC bridge)
        "src/helpers/ipc/**",
      ],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 89,
        lines: 86,
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
