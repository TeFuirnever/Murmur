import { defineConfig } from "playwright-core";

export default defineConfig({
  testDir: "./tests/e2e/suites",
  timeout: 45000,
  retries: 0, // Start with 0 — increase to 1 only after suite stabilizes
  workers: 1, // Sequential: Electron can't parallelize
  use: {
    trace: "on-first-retry",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
