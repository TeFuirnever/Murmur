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
      // [20260729_Gate_FullSrcCoverage] Full src/ coverage per industry
      // standard. Previously only helpers/utils/bootstrap were tracked (~40
      // files), leaving 46 files (React components, hooks, settings, i18n)
      // invisible to the coverage gate. Now all src/ is tracked with
      // realistic thresholds for a mixed backend+frontend Electron codebase
      // where React components need jsdom + RTL (not yet fully set up).
      include: ["src/**/*.{js,ts,tsx}"],
      exclude: [
        // Type declarations (no executable code)
        "src/**/*.d.ts",
        "src/types/**",
        // Build output
        "src/dist/**",
        "src/node_modules/**",
        "src/coverage/**",
        // Electron-dependent modules (require runtime IPC/BrowserWindow/app,
        // cannot be unit-tested in node environment)
        "src/helpers/clipboard.ts",
        "src/helpers/tray.ts",
        "src/helpers/hotkeyManager.ts",
        "src/helpers/pythonEnvironment.ts",
        "src/helpers/modelManager.ts",
        "src/helpers/updateManager.ts",
        "src/helpers/windowManager.ts",
        "src/helpers/logManager.ts",
        "src/helpers/ipc/**",
        // Vendored react-bits components (third-party source, SPDX preserved)
        "src/components/effects/Aurora.tsx",
        "src/components/effects/BlurText.tsx",
      ],
      // [20260729_Gate_FullSrcThresholds] Full-src thresholds set slightly
      // below current actual coverage (46% stmts / 39% branches / 45% funcs /
      // 47% lines) to provide a floor that prevents regression. The backend
      // helper layer is at 95%+; the gap is untested React components
      // (App.tsx, history.tsx, settings panels) needing jsdom + RTL.
      //
      // REGRESSION PLAN: as component tests are added, bump thresholds to
      // lock in gains. Target roadmap:
      //   ✅ v1.1.0: 65% statements (hooks + settings + panels + UI components)
      //   ✅ v1.2.0: 70% statements (App.tsx + misc components + SettingsSidebar)
      //   - v1.3.0: 80%+ (align with industry 80%)
      thresholds: {
        statements: 66,
        branches: 53,
        functions: 65,
        lines: 67,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // [20260729_Test_UIComponents] Mirror the renderer Vite config, which
      // runs with root = src/, so bare "src/lib/utils" imports resolve. Two
      // shadcn primitives (ui/input.tsx, ui/label.tsx) use this root-relative
      // path; the rest of src/ uses relative paths. Without this alias those
      // modules fail to resolve under the test runner (root = ".").
      src: path.resolve(__dirname, "./src"),
    },
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
});
