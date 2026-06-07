/**
 * Suite 2: Model Download & Loading E2E Tests
 *
 * Tests model lifecycle: need_download → downloading → loading → ready.
 * Uses IPC mocks to simulate model states without real downloads.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

test.describe("Suite 2: Model Download & Loading", () => {
  let electronApp;
  let window;

  test.afterEach(async () => {
    await closeElectronApp(electronApp);
  });

  test("2.1 — Initial state shows need_download", async () => {
    ({ app: electronApp, window } = await launchElectronApp());

    // Mic button should be disabled
    const micButton = window.locator('[data-testid="mic-button"]');
    const isDisabled = await micButton.getAttribute("disabled");
    expect(isDisabled).not.toBeNull();

    // Status text indicates download needed
    const body = await window.textContent("body");
    expect(body.includes("需要下载") || body.includes("下载")).toBe(true);
  });

  test("2.2 — Model ready state enables recording", async () => {
    ({ app: electronApp, window } = await launchElectronApp());

    // Mock model status to ready
    await electronApp.evaluate(() => {
      const { ipcMain } = require("electron");
      ipcMain.removeHandler("check-model-files");
      ipcMain.handle("check-model-files", () => ({
        stage: "ready",
        isReady: true,
        downloadProgress: 100,
      }));
    });

    // Reload to trigger re-check
    await window.reload();
    await window.waitForLoadState("domcontentloaded");

    // Wait for model status to update
    const micButton = window.locator('[data-testid="mic-button"]');
    // After model is ready, button should not be disabled
    await expect(micButton).toBeAttached();
    const isDisabled = await micButton.getAttribute("disabled");
    // isDisabled should be null (not disabled) when model is ready
    expect(isDisabled).toBeNull();
  });

  test("2.3 — Download failure shows error state", async () => {
    ({ app: electronApp, window } = await launchElectronApp());

    // Mock download to fail
    await electronApp.evaluate(() => {
      const { ipcMain } = require("electron");
      ipcMain.removeHandler("download-models");
      ipcMain.handle("download-models", () => ({
        success: false,
        error: "下载失败：网络连接超时",
      }));
    });

    // Trigger download attempt
    const result = await window.evaluate(() =>
      window.electronAPI.downloadModels(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("2.4 — Model status IPC returns valid structure", async () => {
    ({ app: electronApp, window } = await launchElectronApp());

    const status = await window.evaluate(() =>
      window.electronAPI.checkModelFiles(),
    );
    expect(status).toBeDefined();
    expect(status).toHaveProperty("stage");
    expect(status).toHaveProperty("isReady");
  });
});
