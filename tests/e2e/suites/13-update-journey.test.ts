/**
 * Suite 13: Semi-auto update journey (Spec #266 T13).
 *
 * Drives the REAL settings window About tab. Only the update-check IPC
 * (check-update) and the download IPC (download-update) are mocked; the
 * download handler replays progress events and then a checksum-failure
 * error event through the sender's webContents, exercising the REAL
 * renderer state machine (progress bar → error display).
 */
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";
import { mockIpcHandler } from "../helpers/ipc-mock";

test.describe("Suite 13: Update journey", () => {
  let electronApp;
  let window;
  let settingsWindow;

  async function openAboutTab() {
    await window.evaluate(() => window.electronAPI?.openSettingsWindow());
    for (let i = 0; i < 20 && !settingsWindow; i += 1) {
      settingsWindow = electronApp
        .windows()
        .find((w) => w.url().includes("settings.html"));
      if (!settingsWindow) await new Promise((r) => setTimeout(r, 250));
    }
    expect(settingsWindow).toBeDefined();
    await settingsWindow!.waitForLoadState("domcontentloaded");
    await settingsWindow!.locator('button:has-text("关于")').click();
  }

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("13.1 — new-version card appears from a mocked release check", async () => {
    await openAboutTab();

    await mockIpcHandler(electronApp, "check-update", {
      hasUpdate: true,
      currentVersion: "1.5.0",
      latestVersion: "9.9.9",
      downloadUrl: "https://example.com/Murmur-9.9.9.dmg",
      downloadSize: 157286400,
    });

    await settingsWindow!.locator('button:has-text("检查更新")').click();
    await expect(settingsWindow!.locator("text=发现新版本")).toBeVisible();
    await expect(settingsWindow!.locator("text=v9.9.9 可用")).toBeVisible();
    await expect(
      settingsWindow!.locator('button:has-text("下载更新")'),
    ).toBeVisible();
  });

  test("13.2 — download replays progress then surfaces the SHA256 failure", async () => {
    // The mocked download handler drives the REAL renderer listeners by
    // emitting progress + error over the sender's webContents.
    await electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (event) => {
        const sender = (
          event as unknown as {
            sender: { send: (ch: string, payload: unknown) => void };
          }
        ).sender;
        sender.send("update-download-progress", {
          progress: 42,
          downloaded: 66026410,
          total: 157286400,
        });
        await new Promise((r) => setTimeout(r, 300));
        sender.send("update-download-error", {
          error: "SHA256 校验失败：下载文件已损坏",
        });
        return { success: false, error: "SHA256 校验失败：下载文件已损坏" };
      });
    }, "download-update");

    await settingsWindow!.locator('button:has-text("下载更新")').click();

    await expect(settingsWindow!.locator("text=下载中... 42%")).toBeVisible();
    await expect(settingsWindow!.locator("text=SHA256 校验失败")).toBeVisible();
  });
});
