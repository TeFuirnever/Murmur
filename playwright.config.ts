import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/suites",
  // [20260724_TS_BigBang_TestFix] Build bundles before e2e — tests run
  // against dist-main/main.js, not source .ts/.js
  // [20260726_Tier43_E2EHelpers] globalSetup path bumped .js→.ts to
  // match the helper rename. Playwright loads TS configs natively.
  globalSetup: "./tests/e2e/helpers/global-setup.ts",
  // [20260724_TS_BigBang_TestFix] END
  // [20260726_Tier43_E2EHelpers] END
  timeout: 45000,
  // [20260906_Test_E2eGatePromotion] Spec #266 T01: boot health is now a
  // blocking CI gate, and one CI-only retry absorbs the documented macOS
  // firstWindow flakiness (architect recommendation from the original
  // promotion plan). Local runs keep 0 retries so flakiness stays visible
  // to developers.
  retries: process.env.CI ? 1 : 0,
  // [20260906_Test_E2eGatePromotion] END
  workers: 1, // Sequential: Electron can't parallelize
  use: {
    trace: "on-first-retry",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
