/**
 * Suite 12: Hotword persistence + speaker diarization journeys (Spec #266 T10)
 *
 * 12.1 drives the real settings window: type hotwords → auto-persist → read
 *     back through the real settings DB round-trip.
 * 12.2 asserts the diarization entry appears when the result carries
 *     segments (a UI regression here previously hid the feature).
 * 12.3 runs the file journey with the persisted hotwords present and asserts
 *     a clean completion (the hotword→server option injection itself is
 *     unit-covered in tests/unit/hotword-injection.test.ts — with
 *     transcribe-file mocked at the IPC boundary the injection is not
 *     observable from E2E, by construction).
 */
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";
import { mockIpcHandler } from "../helpers/ipc-mock";
import fs from "fs";
import os from "os";
import path from "path";

test.describe("Suite 12: Hotwords + diarize journeys", () => {
  let electronApp;
  let window;
  let wavPath;

  function makeSilentWav() {
    const sampleRate = 16000;
    const dataSize = sampleRate * 2;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, Buffer.alloc(dataSize)]);
  }

  async function importFixtureAndStart() {
    // a previous journey may have left the controller in done/cancelled
    // state — return to the drop zone first
    for (const label of ["导入新文件", "重新选择文件"]) {
      const reset = window.locator(`button:has-text("${label}")`);
      if (await reset.isVisible().catch(() => false)) {
        await reset.click();
      }
    }
    await mockIpcHandler(electronApp, "import-audio-file", {
      success: true,
      filePath: wavPath,
      fileName: "silence-1s.wav",
      fileSize: 32044,
      extension: ".wav",
    });
    await window.locator('button:has-text("文件导入")').click();
    await window.locator('[data-testid="file-drop-zone"]').click();
    await window.locator('button:has-text("开始转录")').click();
  }

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
    wavPath = path.join(os.tmpdir(), `murmur-e2e-hotword-${Date.now()}.wav`);
    fs.writeFileSync(wavPath, makeSilentWav());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
    fs.rmSync(wavPath, { force: true });
  });

  test("12.1 — hotwords typed in the settings window persist", async () => {
    await window.evaluate(() => window.electronAPI?.openSettingsWindow());

    let settingsWindow;
    for (let i = 0; i < 20 && !settingsWindow; i += 1) {
      settingsWindow = electronApp
        .windows()
        .find((w) => w.url().includes("settings.html"));
      if (!settingsWindow) await new Promise((r) => setTimeout(r, 250));
    }
    expect(settingsWindow).toBeDefined();
    await settingsWindow!.waitForLoadState("domcontentloaded");

    const input = settingsWindow!.locator("#hotwords-input");
    await input.waitFor({ state: "visible", timeout: 15000 });
    await input.fill("E2E热词");

    // onChange auto-persists; poll the real settings DB round-trip
    let saved: unknown = undefined;
    for (let i = 0; i < 20; i += 1) {
      saved = await settingsWindow!.evaluate(() =>
        window.electronAPI?.getSetting("hotwords"),
      );
      if (saved === "E2E热词") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(saved).toBe("E2E热词");
  });

  test("12.2 — diarization entry appears when segments exist", async () => {
    await mockIpcHandler(electronApp, "transcribe-file", {
      success: true,
      text: "带分段的转写结果",
      segments: [
        { text: "第一句", startTime: 0, endTime: 500, speaker: 0 },
        { text: "第二句", startTime: 500, endTime: 1000, speaker: 1 },
      ],
      duration: 1.0,
      id: 4242,
    });

    await importFixtureAndStart();

    const result = window.locator('[data-testid="transcription-result"]');
    await expect(result).toBeVisible();
    await expect(result.locator('button:has-text("识别说话人")')).toBeVisible();
  });

  test("12.3 — file journey completes cleanly with persisted hotwords", async () => {
    // 12.1 persisted "E2E热词"; transcription must succeed end to end with
    // that setting in place (no degradation error surfaces).
    await mockIpcHandler(electronApp, "transcribe-file", {
      success: true,
      text: "热词存在时的转写结果",
      segments: [],
      duration: 1.0,
      id: 4243,
    });

    await importFixtureAndStart();

    const result = window.locator('[data-testid="transcription-result"]');
    await expect(result).toBeVisible();
    await expect(result).toContainText("热词存在时的转写结果");
  });
});
