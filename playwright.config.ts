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
  retries: 0, // Start with 0 — increase to 1 only after suite stabilizes
  workers: 1, // Sequential: Electron can't parallelize
  use: {
    trace: "on-first-retry",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
