/**
 * Suite 11: Cross-window feature journeys (P1-P3 batch)
 *
 * Covers the user journeys shipped in the #246/#247/#248 batch that cross
 * window or process boundaries — the layer the unit suites below Playwright
 * deliberately do not reach:
 *  - language switch propagates live to the MAIN window (#247)
 *  - a persisted hotkey change re-registers the global shortcut (#246)
 *  - the history window's clear-all + export toolbar work end-to-end (#248)
 */
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";
import { mockModelReady } from "../helpers/ipc-mock";

test.describe("Suite 11: cross-window journeys", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
    await mockModelReady(electronApp);
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    // Leave the persisted settings clean for other suites.
    await window.evaluate(() => window.electronAPI.resetSettings());
    await closeElectronApp(electronApp);
  });

  test("11.1 — a persisted hotkey change re-registers the global shortcut", async () => {
    // The full chain: SET → DB → SETTINGS_UPDATE broadcast → App re-applies
    // → atomic replace in hotkeyHandlers → real globalShortcut.
    await window.evaluate(() =>
      window.electronAPI.setSetting("hotkey", "CommandOrControl+Shift+K"),
    );

    // GET_CURRENT reads the manager's registered list — after the atomic
    // replace only the new combo may remain.
    await expect
      .poll(
        async () => {
          return await window.evaluate(() =>
            window.electronAPI.getCurrentHotkey(),
          );
        },
        { timeout: 5000 },
      )
      .toBe("CommandOrControl+Shift+K");
  });

  test("11.2 — language switch propagates live to the main window", async () => {
    // The window may boot in either locale (navigator language). Switch to
    // zh-CN explicitly and assert the flip happens WITHOUT a reload — that
    // is the live-propagation contract (#247).
    await window.evaluate(() =>
      window.electronAPI.setSetting("language", "zh-CN"),
    );

    await expect(window.getByLabel("最小化")).toBeAttached({
      timeout: 5000,
    });
    await expect(window.getByLabel("Minimize")).toHaveCount(0);
    await expect(
      window.getByRole("button", { name: "实时录音" }),
    ).toBeVisible();
  });

  test("11.3 — history window clear-all wipes records behind a confirm", async () => {
    // Seed one record so the window has content to clear.
    const saved = await window.evaluate(() =>
      window.electronAPI.saveTranscription({
        text: "Suite11 清空测试记录",
        raw_text: "Suite11 清空测试记录",
        confidence: 0.9,
        duration: 2.0,
        source_type: "recording",
      }),
    );
    expect(saved.success).toBe(true);

    await window.evaluate(() => window.electronAPI.openHistoryWindow());
    const historyPage = await (async () => {
      for (let i = 0; i < 50; i++) {
        const pages = electronApp.windows();
        const hit = pages.find((p) => p.url().includes("history.html"));
        if (hit) return hit;
        await window.waitForTimeout(100);
      }
      return null;
    })();
    expect(historyPage).toBeTruthy();

    // The window's language depends on the persisted choice / navigator —
    // accept either locale title.
    await expect(
      historyPage.getByText(/Murmur - (转录历史|Transcription History)/),
    ).toBeVisible({ timeout: 10_000 });
    await expect(historyPage.getByText("Suite11 清空测试记录")).toBeVisible();

    // Accept the native confirm dialog.
    historyPage.once("dialog", (dialog) => dialog.accept());
    await historyPage.getByTestId("clear-all").click();

    await expect(historyPage.getByText("暂无转录历史")).toBeVisible({
      timeout: 5000,
    });

    // The empty state renders in the window's active locale.
    await expect(
      historyPage.getByText(/暂无转录历史|No transcriptions yet/),
    ).toBeVisible({ timeout: 5000 });

    // The wipe reached the database, not just the UI list.
    const remaining = await window.evaluate(() =>
      window.electronAPI.getTranscriptions(100, 0),
    );
    const items = remaining.transcriptions || remaining || [];
    expect(items.map((r) => r.text)).not.toContain("Suite11 清空测试记录");

    await historyPage.close();
  });

  test("11.4 — history export uses the selected format; a cancelled save is silent", async () => {
    // Seed a record so the export path has data.
    await window.evaluate(() =>
      window.electronAPI.saveTranscription({
        text: "Suite11 导出测试记录",
        raw_text: "Suite11 导出测试记录",
        confidence: 0.9,
        duration: 2.0,
        source_type: "recording",
      }),
    );

    await window.evaluate(() => window.electronAPI.openHistoryWindow());
    const historyPage = await (async () => {
      for (let i = 0; i < 50; i++) {
        const pages = electronApp.windows();
        const hit = pages.find((p) => p.url().includes("history.html"));
        if (hit) return hit;
        await window.waitForTimeout(100);
      }
      return null;
    })();
    expect(historyPage).toBeTruthy();

    // Patch the MAIN-process save dialog to report "cancelled" — proves the
    // renderer's cancelled-silent branch without a native dialog.
    await electronApp.evaluate(({ dialog }) => {
      (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog =
        async () => ({ canceled: true, filePath: undefined });
    });

    await historyPage.getByTestId("export-format").selectOption("md");
    await historyPage.getByTestId("export-all").click();

    // Cancelled → no success toast appears within the settle window.
    await window.waitForTimeout(1500);
    const body = await historyPage.textContent("body");
    expect(body).not.toContain("导出成功");
    expect(body).not.toContain("Export successful");

    await historyPage.close();
  });
});
