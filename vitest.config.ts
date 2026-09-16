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
        // [20260906_Spec259_T1] Exemption reasons for the three remaining
        // exclusions (ticket #273 — instrumentation close-out):
        //   - clipboard/tray/hotkeyManager: thin Electron wrappers whose
        //     behavior suites (tray.test.ts, hotkeyManager.test.ts,
        //     clipboard.test.ts) run them under a fully-mocked electron
        //     module; they stay out of the measurement to avoid counting
        //     mock-driven execution as product coverage. Un-excluding them
        //     requires re-evaluating those suites' representativeness.
        "src/helpers/clipboard.ts",
        "src/helpers/tray.ts",
        "src/helpers/hotkeyManager.ts",
        // [20260906_Spec259_T1] pythonEnvironment / modelManager /
        // updateManager / windowManager / logManager / ipc/** handlers are
        // INSTRUMENTED as of this ticket (previously excluded as
        // "Electron-dependent"): their behavior suites mock electron at the
        // module boundary and execute the real module code, so v8 coverage
        // is meaningful. Per-glob branch floors are configured in
        // thresholds below; config assertion test:
        // tests/unit/coverage-configuration.test.ts
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
      // [20260905_Fix_CoveragePlatformScope] these floors are authored from
      // macOS measurements and are enforced on the macOS CI leg only (ci.yml):
      // platform-conditional branches make the Windows percentage
      // non-comparable (first honest win measurement: 91.53 branch).
      // [20260906_Spec259_T1] Global thresholds RE-BASELINED 2026-09-07 to
      // include the six newly instrumented module groups (measured
      // 88.42 stmts / 83.96 branches / 88.59 funcs / 89.02 lines with them
      // in the aggregate). The previous 96/92/94/96 numbers were computed
      // while these groups were excluded and are unattainable with them
      // instrumented; the ratchet path back is: T2 (#274) raises the five
      // helpers to 92, T3 (#275) raises ipc/** to 92, then the global
      // numbers rise to meet them. Never lower the global numbers or any
      // per-glob floor without a spec.
      thresholds: {
        statements: 88,
        branches: 83,
        functions: 88,
        lines: 89,
        // Per-glob branch floors for the newly instrumented groups: files
        // matching a glob are additionally checked against its floor.
        // First measured values recorded inline (2026-09-07); floors only
        // ratchet UP:
        //   - helpers five: DONE — raised to the global 92 by T2 (#274)
        //   - ipc/**: DONE — raised to the global 92 by T3 (#275)
        // Measured origins recorded inline; never lower a floor.
        "src/helpers/modelManager.ts": { branches: 92 }, // raised to global 92 (Spec #259 T2, #274); first measured 55.04 (2026-09-07)
        "src/helpers/windowManager.ts": { branches: 92 }, // raised to global 92 (Spec #259 T2, #274); first measured 48.21 (2026-09-07)
        "src/helpers/updateManager.ts": { branches: 92 }, // raised to global 92 (Spec #259 T2, #274); first measured 14.60 (2026-09-07)
        "src/helpers/logManager.ts": { branches: 92 }, // raised to global 92 (Spec #259 T2, #274); first measured 79.31 (2026-09-07)
        "src/helpers/pythonEnvironment.ts": { branches: 92 }, // raised to global 92 (Spec #259 T2, #274); first measured 28.57 (2026-09-07)
        "src/helpers/ipc/**": { branches: 92 }, // raised to global 92 (Spec #259 T3, #275); dir aggregate first measured 67.18 (2026-09-07)
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
