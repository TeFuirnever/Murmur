/**
 * Suite 0: First-Time User Experience (FTUE) Smoke Test
 *
 * Added based on Product Owner review (C-6): the most critical
 * conversion funnel had zero coverage.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

test.describe("Suite 0: First-Time User Experience", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    // Fresh app with no settings, no models, no history
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("0.1 — Fresh app shows model download prompt", async () => {
    // App title is visible
    const title = await window.locator("h1").first().textContent();
    expect(title).toContain("Murmur");

    // Status text should indicate model needs to be downloaded
    const body = await window.textContent("body");
    const hasDownloadPrompt =
      body.includes("需要下载") ||
      body.includes("下载") ||
      body.includes("download");
    expect(hasDownloadPrompt).toBe(true);
  });

  test("0.2 — Mic button is disabled when model not ready", async () => {
    const micButton = window.locator('[data-testid="mic-button"]');
    const isDisabled = await micButton.getAttribute("disabled");
    // Button should be disabled or have disabled appearance
    expect(isDisabled).not.toBeNull();
  });

  test("0.3 — Onboarding steps are visible", async () => {
    const body = await window.textContent("body");
    // First-time user should see usage steps
    const hasSteps =
      body.includes("使用步骤") || body.includes("下载") || body.includes("①");
    expect(hasSteps).toBe(true);
  });
});
