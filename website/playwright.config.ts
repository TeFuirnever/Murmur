import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  baseURL: "http://127.0.0.1:4321/Murmur",
  retries: 1,
  timeout: 15000,
  use: {
    baseURL: "http://127.0.0.1:4321/Murmur",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx astro preview --port 4321",
    port: 4321,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
