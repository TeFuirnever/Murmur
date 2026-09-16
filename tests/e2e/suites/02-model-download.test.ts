/**
 * Suite 2: Model Download & Loading E2E Tests
 *
 * Tests model lifecycle: need_download → downloading → loading → ready.
 * Uses IPC mocks to simulate model states without real downloads.
 */
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";
import {
  mockIpcHandler,
  mockModelNeedDownload,
  mockModelReady,
} from "../helpers/ipc-mock";

test.describe("Suite 2: Model Download & Loading", () => {
  let electronApp;
  let window;

  test.afterEach(async () => {
    await closeElectronApp(electronApp);
  });

  test("2.1 — Initial state shows need_download", async () => {
    ({ app: electronApp, window } = await launchElectronApp());

    // [20260820_E2E_DeterministicModelState] Mock the "no models" payload
    // so the assertion does not bet on this machine having no models.
    await mockModelNeedDownload(electronApp);
    await window.reload();
    await window.waitForLoadState("domcontentloaded");

    // Model check is async — wait for the settled need_download copy
    // instead of reading body text right after domcontentloaded.
    await expect(
      window.getByText("需要下载AI模型文件才能开始使用"),
    ).toBeVisible({ timeout: 10_000 });

    // Mic button should be disabled
    const micButton = window.locator('[data-testid="mic-button"]');
    const isDisabled = await micButton.getAttribute("disabled");
    expect(isDisabled).not.toBeNull();
  });

  test("2.2 — Model ready state enables recording", async () => {
    ({ app: electronApp, window } = await launchElectronApp());

    // [20260820_E2E_ModelReadyPayloadFix] stage "ready" is DERIVED by
    // useModelStatus from the MODELS.CHECK + FUNASR.STATUS payloads — the
    // old {stage:"ready"} mock never produced a ready state.
    await mockModelReady(electronApp);

    // Reload to trigger re-check
    await window.reload();
    await window.waitForLoadState("domcontentloaded");

    // After model is ready, button should not be disabled. The stage
    // settles asynchronously — poll instead of reading the attribute once.
    const micButton = window.locator('[data-testid="mic-button"]');
    await expect(micButton).toBeAttached();
    await expect
      .poll(async () => await micButton.getAttribute("disabled"), {
        timeout: 10_000,
      })
      .toBeNull();
  });

  test("2.3 — Download failure shows error state", async () => {
    ({ app: electronApp, window } = await launchElectronApp());

    // Mock download to fail
    await mockIpcHandler(electronApp, "download-models", {
      success: false,
      error: "下载失败：网络连接超时",
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

    // Real (unmocked) call — assert the actual MODELS.CHECK payload shape
    // (modelManager.ts checkModelFiles), not the derived useModelStatus
    // stage object.
    const status = await window.evaluate(() =>
      window.electronAPI.checkModelFiles(),
    );
    expect(status).toBeDefined();
    expect(status).toHaveProperty("success");
    expect(status).toHaveProperty("models_downloaded");
    expect(status).toHaveProperty("minimum_ready");
    expect(status).toHaveProperty("missing_models");
  });
});
