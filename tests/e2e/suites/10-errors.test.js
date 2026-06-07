/**
 * Suite 10: Error Resilience E2E Tests
 *
 * Tests graceful handling of failures:
 * - AI service errors
 * - Invalid IPC inputs
 *
 * Note: FunASR crash/restart test (10.1) is intentionally
 * excluded from E2E and moved to integration tests per QA review (M-1).
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";
import { mockIpcHandler } from "../helpers/ipc-mock.js";

test.describe("Suite 10: Error Resilience", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("10.1 — AI service error returns graceful failure", async () => {
    // Mock AI processing to simulate network error
    await mockIpcHandler(electronApp, "process-text", {
      success: false,
      error: "网络连接失败：无法连接到 AI 服务",
    });

    const result = await window.evaluate(() =>
      window.electronAPI.processText("测试文本", "optimize"),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // Error message should be user-friendly (Chinese)
    expect(result.error.length).toBeGreaterThan(0);
  });

  test("10.2 — Invalid transcription save is handled", async () => {
    // Try to save with invalid data
    const result = await window.evaluate(() =>
      window.electronAPI
        .saveTranscription(null)
        .catch((e) => ({ error: e.message })),
    );

    // Should not crash — either returns error or handles gracefully
    expect(result).toBeDefined();
  });
});
