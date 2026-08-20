/**
 * Suite 1: Application Lifecycle E2E Tests
 *
 * Validates that the Electron app launches correctly, renders all
 * page routes, and handles close behaviors. These are the most
 * fundamental tests — if these fail, nothing else matters.
 */
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";

test.describe("Suite 1: Application Lifecycle", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("1.1 — Launch and show main window", async () => {
    expect(window).toBeDefined();

    // [20260724_E2E_PlaywrightApiFix] Playwright 1.60 requires a selector
    // argument for page.isVisible(). Use "body" to check the page rendered.
    const isVisible = await window.isVisible("body");
    // [20260724_E2E_PlaywrightApiFix] END
    expect(isVisible).toBe(true);

    const title = await window.title();
    expect(title).toBeTruthy();

    // Verify electronAPI is exposed via preload bridge
    const hasAPI = await window.evaluate(() => !!window.electronAPI);
    expect(hasAPI).toBe(true);
  });

  test("1.2 — electronAPI exposes core methods", async () => {
    const methods = await window.evaluate(() =>
      Object.keys(window.electronAPI),
    );

    // Must-have methods for the app to function
    // [20260815_Refactor_DeadIpc] readClipboard/writeClipboard removed with
    // their zero-renderer-caller IPC channels.
    const requiredMethods = [
      "getSystemInfo",
      "checkPermissions",
      "getSetting",
      "setSetting",
      "getAllSettings",
      "pasteText",
      "copyText",
      "getAppVersion",
    ];

    for (const method of requiredMethods) {
      expect(methods).toContain(method);
    }
  });

  test("1.3 — Main window shows mic button with correct aria-label", async () => {
    const micButton = window.locator('[data-testid="mic-button"]');
    await expect(micButton).toBeAttached();

    const ariaLabel = await micButton.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    // Should be either "开始录音" or "停止录音"
    expect(["开始录音", "停止录音"]).toContain(ariaLabel);
  });

  test("1.4 — App version is valid semver", async () => {
    const version = await window.evaluate(() =>
      window.electronAPI.getAppVersion(),
    );
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("1.5 — Settings opens as a standalone window and renders", async () => {
    // [20260816_Refactor_DeadChannels] removed the in-app settings route —
    // settings now live in a standalone settings.html window opened via
    // WINDOW.OPEN_SETTINGS. [20260820_E2E_SettingsWindowFix] Rewritten to
    // verify that real window: click the main-window gear button, wait for
    // the second BrowserWindow, and assert real settings content renders.
    const settingsWindowPromise = electronApp.waitForEvent("window");
    await window.locator("button:has(svg.lucide-settings)").click();
    const settingsPage = await settingsWindowPromise;

    try {
      await settingsPage.waitForLoadState("domcontentloaded");

      // The sidebar sections (通用/权限/AI/关于 zh defaults, General/… en)
      // settle after getAllSettings resolves — poll rather than read once.
      await expect
        .poll(
          async () => {
            const body = await settingsPage.textContent("body");
            return (
              body.includes("通用") ||
              body.includes("General") ||
              body.includes("权限") ||
              body.includes("Permissions") ||
              body.includes("AI")
            );
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    } finally {
      await settingsPage.close();
    }
  });
});
