/**
 * Suite 0: First-Time User Experience (FTUE) Smoke Test
 *
 * Added based on Product Owner review (C-6): the most critical
 * conversion funnel had zero coverage.
 */
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";
import { mockModelNeedDownload } from "../helpers/ipc-mock";

test.describe("Suite 0: First-Time User Experience", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    // Fresh app with no settings, no models, no history.
    // [20260820_E2E_FtueDeterminism] Whether this machine actually has
    // models downloaded is an environment bet — mock MODELS.CHECK to the
    // "no models" payload so the FTUE state is deterministic.
    ({ app: electronApp, window } = await launchElectronApp());
    await mockModelNeedDownload(electronApp);
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("0.1 — Fresh app shows model download prompt", async () => {
    // App title is visible
    const title = await window.locator("h1").first().textContent();
    expect(title).toContain("Murmur");

    // Model check is async — wait for the settled need_download copy
    // instead of reading body text right after domcontentloaded.
    await expect(
      window.getByText("需要下载AI模型文件才能开始使用"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("0.2 — Mic button is disabled when model not ready", async () => {
    const micButton = window.locator('[data-testid="mic-button"]');
    const isDisabled = await micButton.getAttribute("disabled");
    // Button should be disabled or have disabled appearance
    expect(isDisabled).not.toBeNull();
  });

  test("0.3 — Onboarding steps are visible", async () => {
    // The three-step onboarding block renders only in need_download stage.
    await expect(window.getByText("使用步骤：")).toBeVisible({
      timeout: 10_000,
    });
    const body = await window.textContent("body");
    expect(body).toContain("①");
  });
});
