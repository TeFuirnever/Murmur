/**
 * Suite 5: File Import & Transcription E2E Tests
 *
 * Tests switching to file-import mode, file validation via IPC mock.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

test.describe("Suite 5: File Import & Transcription", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("5.1 — Switch to file-import mode shows drop zone", async () => {
    // Click the file-import tab
    const fileImportTab = window.locator('button:has-text("文件导入")');
    await fileImportTab.click();

    // FileDropZone should be visible
    const dropZone = window.locator('[data-testid="file-drop-zone"]');
    await expect(dropZone).toBeVisible();
  });

  test("5.2 — Validate supported audio file via IPC", async () => {
    // Mock file validation to return valid
    await electronApp.evaluate(() => {
      const { ipcMain } = require("electron");
      ipcMain.removeHandler("validate-audio-file");
      ipcMain.handle("validate-audio-file", (_e, _filePath) => ({
        success: true,
        fileName: "test.wav",
        fileSize: 1024,
        extension: ".wav",
      }));
    });

    const result = await window.evaluate(() =>
      window.electronAPI.validateAudioFile("/path/to/test.wav"),
    );
    expect(result.success).toBe(true);
    expect(result.extension).toBe(".wav");
  });

  test("5.3 — Reject unsupported file type via IPC", async () => {
    // Mock file validation to reject
    await electronApp.evaluate(() => {
      const { ipcMain } = require("electron");
      ipcMain.removeHandler("validate-audio-file");
      ipcMain.handle("validate-audio-file", () => ({
        success: false,
        error: "不支持的文件格式: .exe",
      }));
    });

    const result = await window.evaluate(() =>
      window.electronAPI.validateAudioFile("/path/to/test.exe"),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("不支持");
  });
});
