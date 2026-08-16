import { defineConfig } from "vitest/config";

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
        // [20260816_Refactor_RemoveEffects] the vendored Aurora/BlurText
        // exclusion entries were removed with the effects feature.
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
      //   ✅ v1.3.0: 79% statements (useRecording + model-status + App expanded)
      //   ✅ v1.4.0: 80% lines (AIConfig expanded + sonner + unskipped tests)
      //   ✅ 2026-08-16 branch push: three parallel executors extended the
      //      suites with ~200 further cases (funasrServer health/crash/taskkill
      //      branches, useRecording MediaRecorder error chain, App condition
      //      matrix, database/validator/formatter/installer guards, four hooks'
      //      error paths). Final actuals: 96.6 S / 92.8 B / 94.5 F / 97.1 L —
      //      thresholds sit just below as the regression floor.
      thresholds: {
        statements: 96,
        branches: 92,
        functions: 94,
        lines: 96,
      },
    },
  },
  // [20260815_Refactor_DeadUI] The "@" and "src" aliases existed only for
  // root-relative "src/lib/utils" imports in the deleted ui/input.tsx and
  // ui/label.tsx shadcn primitives; no remaining module uses them.
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
});
