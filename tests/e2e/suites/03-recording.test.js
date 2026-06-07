/**
 * Suite 3: Real-time Recording Flow E2E Tests
 *
 * Tests the complete recording pipeline: start → stop → transcribe → AI optimize.
 * Uses IPC mocks for transcription and AI processing.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";
import { mockIpcHandler } from "../helpers/ipc-mock.js";

test.describe("Suite 3: Real-time Recording Flow", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());

    // Mock model to ready state so recording is enabled
    await mockIpcHandler(electronApp, "check-model-files", {
      stage: "ready",
      isReady: true,
      downloadProgress: 100,
    });

    await window.reload();
    await window.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("3.1 — Click mic button starts recording", async () => {
    const micButton = window.locator('[data-testid="mic-button"]');

    // Wait for model to be ready
    await expect(micButton).toBeAttached();

    // Click to start recording
    await micButton.click();

    // aria-label should change to "停止录音"
    const ariaLabel = await micButton.getAttribute("aria-label");
    expect(ariaLabel).toBe("停止录音");
  });

  test("3.2 — Click mic button stops recording", async () => {
    const micButton = window.locator('[data-testid="mic-button"]');

    // Click again to stop recording
    await micButton.click();

    // aria-label should change back to "开始录音"
    const ariaLabel = await micButton.getAttribute("aria-label");
    expect(ariaLabel).toBe("开始录音");
  });

  test("3.3 — Transcription result via IPC mock", async () => {
    await mockIpcHandler(electronApp, "transcribe-audio", {
      success: true,
      text: "这是一段E2E测试文本",
      raw_text: "这是一段E2E测试文本",
      confidence: 0.95,
      duration: 3.5,
      language: "zh-CN",
    });

    const result = await window.evaluate(() =>
      window.electronAPI.transcribeAudio(new ArrayBuffer(0)),
    );
    expect(result.success).toBe(true);
    expect(result.text).toContain("E2E测试");
  });

  test("3.4 — AI optimization via IPC mock", async () => {
    await mockIpcHandler(electronApp, "process-text", {
      success: true,
      text: "这是优化后的E2E测试文本",
      enhanced_by_ai: true,
      mode: "optimize",
    });

    const result = await window.evaluate(() =>
      window.electronAPI.processText("原始文本", "optimize"),
    );
    expect(result.success).toBe(true);
    expect(result.enhanced_by_ai).toBe(true);
  });

  test("3.5 — AI failure returns error via IPC", async () => {
    await mockIpcHandler(electronApp, "process-text", {
      success: false,
      error: "AI 服务连接失败",
    });

    const result = await window.evaluate(() =>
      window.electronAPI.processText("原始文本", "optimize"),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("3.6 — Recording blocked when model not ready (default state)", async () => {
    // Launch a fresh app — by default, models are not downloaded,
    // so mic button should be disabled without any mocks.
    const freshApp = await launchElectronApp();
    try {
      const micButton = freshApp.window.locator('[data-testid="mic-button"]');
      const isDisabled = await micButton.getAttribute("disabled");
      expect(isDisabled).not.toBeNull();
    } finally {
      await closeElectronApp(freshApp.app);
    }
  });
});
