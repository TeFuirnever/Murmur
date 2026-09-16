import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  // [20260803_Feature_WebsiteRedesign] e2e server + baseURL fix.
  // Background: astro.config.mjs sets `base: "/Murmur"` for the GitHub Pages
  // deployment (project site under /Murmur). `astro preview` honors that base
  // at serve time, so the homepage is at /Murmur/ while "/" returns 404. But
  // the e2e tests call page.goto("/") and page.goto("/zh/") expecting the app
  // root. The build output (dist/) actually contains index.html at its root,
  // so serving dist/ with a plain static server (no base rewrite) makes "/"
  // resolve to the homepage as the tests expect. Switched the webServer from
  // `astro preview` to `python3 -m http.server` on dist/, and set baseURL to
  // the host root. Also bumped timeout 10s → 30s for cold preview starts and
  // switched host 127.0.0.1 → localhost (astro/http.server bind IPv6 ::1 on
  // macOS, so IPv4 127.0.0.1 was refused with ERR_CONNECTION_REFUSED).
  baseURL: "http://localhost:4321",
  retries: 1,
  timeout: 15000,
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    port: 4321,
    host: "localhost",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
// [20260803_Feature_WebsiteRedesign] END
