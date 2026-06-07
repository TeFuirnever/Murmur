/**
 * Suite 1: Application Lifecycle E2E Tests
 *
 * Validates that the Electron app launches correctly, renders all
 * page routes, and handles close behaviors. These are the most
 * fundamental tests — if these fail, nothing else matters.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

test.describe("Suite 1: Application Lifecycle", () => {
  let electronApp;
  let window;

  test.beforeAll(async (_page) => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("1.1 — Launch and show main window", async () => {
    expect(window).toBeDefined();

    const isVisible = await window.isVisible();
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
    const requiredMethods = [
      "getSystemInfo",
      "checkPermissions",
      "getSetting",
      "setSetting",
      "getAllSettings",
      "pasteText",
      "copyText",
      "readClipboard",
      "writeClipboard",
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

  test("1.5 — Settings page route renders correctly", async () => {
    const settingsApp = await launchElectronApp({
      page: "settings",
      env: {},
    });

    try {
      const settingsWindow = settingsApp.app
        ? await settingsApp.app.firstWindow()
        : settingsApp.window;

      // Wait for lazy-loaded settings page
      await settingsWindow.waitForLoadState("domcontentloaded");

      // Settings page should have form elements
      const hasSettingsContent = await settingsWindow.evaluate(() => {
        // Look for settings-related content (theme, AI config, etc.)
        const body = document.body.innerText;
        return (
          body.includes("主题") ||
          body.includes("theme") ||
          body.includes("AI") ||
          body.includes("设置")
        );
      });
      expect(hasSettingsContent).toBe(true);
    } finally {
      await closeElectronApp(settingsApp.app || settingsApp);
    }
  });
});
