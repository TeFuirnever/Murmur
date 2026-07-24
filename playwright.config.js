import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/suites",
  // [20260724_TS_BigBang_TestFix] Build bundles before e2e — tests run
  // against dist-main/main.js, not source .ts/.js
  globalSetup: "./tests/e2e/helpers/global-setup.js",
  // [20260724_TS_BigBang_TestFix] END
  timeout: 45000,
  retries: 0, // Start with 0 — increase to 1 only after suite stabilizes
  workers: 1, // Sequential: Electron can't parallelize
  use: {
    trace: "on-first-retry",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
