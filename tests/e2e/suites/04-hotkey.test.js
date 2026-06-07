/**
 * Suite 4: Hotkey Management E2E Tests
 *
 * Tests hotkey display and IPC event triggers.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";
import { mockIpcHandler } from "../helpers/ipc-mock.js";

test.describe("Suite 4: Hotkey Management", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("4.1 — Default hotkey displayed in UI", async () => {
    // The hotkey text should be visible in the main window
    const body = await window.textContent("body");

    // Should show either Mac or Windows hotkey
    const hasHotkey =
      body.includes("⌘") ||
      body.includes("Ctrl") ||
      body.includes("Shift") ||
      body.includes("Space");
    expect(hasHotkey).toBe(true);
  });

  test("4.2 — Hotkey IPC event triggers recording toggle", async () => {
    // Mock model as ready
    await mockIpcHandler(electronApp, "check-model-files", {
      stage: "ready",
      isReady: true,
    });

    // Reload to pick up mock
    await window.reload();
    await window.waitForLoadState("domcontentloaded");

    const micButton = window.locator('[data-testid="mic-button"]');
    await expect(micButton).toBeAttached();

    // Simulate hotkey trigger via IPC event (like global hotkey would)
    await electronApp.evaluate(() => {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send("hotkey-triggered");
      }
    });

    // Poll for state change instead of waitForTimeout
    await expect
      .poll(
        async () => {
          return await micButton.getAttribute("aria-label");
        },
        { timeout: 3000 },
      )
      .toBe("停止录音");

    // Trigger again to stop
    await electronApp.evaluate(() => {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send("hotkey-triggered");
      }
    });

    await expect
      .poll(
        async () => {
          return await micButton.getAttribute("aria-label");
        },
        { timeout: 3000 },
      )
      .toBe("开始录音");
  });

  test("4.3 — Hotkey registration via IPC", async () => {
    const result = await window.evaluate(() =>
      window.electronAPI.registerHotkey("CommandOrControl+Shift+Space"),
    );
    // Should return true (success) or undefined (void)
    // The important thing is it doesn't throw
    expect(result === undefined || result === true).toBe(true);
  });
});
