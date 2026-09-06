/**
 * Suite 5: File Import & Transcription E2E Tests
 *
 * Tests switching to file-import mode, file validation via IPC mock.
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import { writeTempSilentWav } from "../helpers/fixtures";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";
import { mockIpcHandler } from "../helpers/ipc-mock";

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
    await mockIpcHandler(electronApp, "validate-audio-file", {
      success: true,
      fileName: "test.wav",
      fileSize: 1024,
      extension: ".wav",
    });

    const result = await window.evaluate(() =>
      window.electronAPI.validateAudioFile("/path/to/test.wav"),
    );
    expect(result.success).toBe(true);
    expect(result.extension).toBe(".wav");
  });

  test("5.3 — Reject unsupported file type via IPC", async () => {
    // Mock file validation to reject
    await mockIpcHandler(electronApp, "validate-audio-file", {
      success: false,
      error: "不支持的文件格式: .exe",
    });

    const result = await window.evaluate(() =>
      window.electronAPI.validateAudioFile("/path/to/test.exe"),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("不支持");
  });
});

// [20260906_Test_FileTranscriptionJourney] Spec #266 T09 (#286): the full
// file-transcription journey with a REAL (runtime-generated) wav fixture.
// The OS dialog (import-audio-file) and the transcription engine
// (transcribe-file — including its history persistence and export record
// id, which the mock fakes) are mocked; validation runs for real. Covers the cancel branch via a hanging transcribe-file handler.
test.describe("Suite 5b: File transcription journey", () => {
  let electronApp;
  let window;
  let wavPath;

  /** Select the fixture through the (dialog-replacing) import mock. */
  async function importFixture() {
    await mockIpcHandler(electronApp, "import-audio-file", {
      success: true,
      filePath: wavPath,
      fileName: "silence-1s.wav",
      fileSize: 32044,
      extension: ".wav",
    });
    await window.locator('[data-testid="file-drop-zone"]').click();
    await expect(window.locator('button:has-text("开始转录")')).toBeVisible();
  }

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
    wavPath = writeTempSilentWav("silence");
    await window.locator('button:has-text("文件导入")').click();
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
    fs.rmSync(wavPath, { force: true });
  });

  test("5b.1 — progress card is cancellable mid-transcription", async () => {
    await mockIpcHandler(electronApp, "cancel-file-transcription", {
      success: true,
    });
    // transcribe-file hangs forever, like a long real transcription
    await electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);

      ipcMain.handle(channel, () => new Promise(() => {}));
    }, "transcribe-file");

    await importFixture();
    await window.locator('button:has-text("开始转录")').click();
    await expect(window.locator('button:has-text("取消转录")')).toBeVisible();

    await window.locator('button:has-text("取消转录")').click();
    await expect(window.locator("text=转录已取消")).toBeVisible();
  });

  test("5b.2 — happy journey lands on the result card with export panel", async () => {
    // cancelled state from 5b.1 -> back to the drop zone
    await window.locator('button:has-text("重新选择文件")').click();

    await mockIpcHandler(electronApp, "transcribe-file", {
      success: true,
      text: "会议测试转写结果",
      segments: [],
      duration: 1.0,
      id: 4242,
    });

    await importFixture();
    await window.locator('button:has-text("开始转录")').click();

    const result = window.locator('[data-testid="transcription-result"]');
    await expect(result).toBeVisible();
    await expect(result).toContainText("会议测试转写结果");
    // export panel mounts inside the result card when a record id exists
    await expect(result).toContainText("导出格式");
  });
});
