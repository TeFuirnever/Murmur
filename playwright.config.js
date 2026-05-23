import { defineConfig } from "playwright-core";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  retries: 0,
  use: {
    trace: "on-first-retry",
  },
});
