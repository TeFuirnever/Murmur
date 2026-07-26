import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["tests/**/*.test.{js,ts,jsx,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    globals: true,
    // [20260726_Tier32_ShimDeleted] The _tsresolve.setup.js shim has been
    // deleted. All test files now use ESM `import` for source modules;
    // vi.mock intercepts electron imports at the module level; per-test
    // module isolation uses vi.resetModules + dynamic import(). No test
    // depends on the .ts CJS loader, .ts resolution patch, or default-
    // export unwrap that the shim provided.
    // setupFiles: [], (empty — no monkey-patches needed)
    // [20260726_Tier32_ShimDeleted] END
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
        // [20260725_Fix_WrongExclusion] 4 files removed from exclude — they
        // have zero electron module dependency:
        // - environment.ts: only reads process.versions.electron (no import)
        // - funasrServer.ts: no electron reference at all
        // - funasrManager.ts: no electron reference at all
        // - pythonInstaller.ts: no electron reference at all
        "src/helpers/tray.ts",
        "src/helpers/hotkeyManager.ts",
        "src/helpers/pythonEnvironment.ts",
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
