/**
 * Suite 4: Hotkey Management E2E Tests
 *
 * Tests hotkey display and IPC event triggers.
 */
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";
import { mockModelReady } from "../helpers/ipc-mock";

test.describe("Suite 4: Hotkey Management", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());

    // [20260820_E2E_HotkeyDisplayFix] The hotkey hint text ("点击麦克风或按
    // ⌘/Ctrl + ⇧ + 空格 开始录音") only renders when modelStatus.isReady —
    // mock the model ready before asserting the displayed hotkey.
    await mockModelReady(electronApp);
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("4.1 — Default hotkey displayed in UI", async () => {
    // Wait for the ready-state hint so the symbolic hotkey text is on screen,
    // then assert formatHotkey's symbol rendering (useHotkey.ts): the
    // platform modifier (⌘ on macOS, Ctrl on Windows) plus ⇧ and 空格.
    const hint = window.getByText("点击麦克风或按", { exact: false });
    await expect(hint).toBeVisible({ timeout: 10_000 });

    const body = await window.textContent("body");
    expect(body).toContain(process.platform === "darwin" ? "⌘" : "Ctrl");
    expect(body).toContain("⇧");
    expect(body).toContain("空格");
  });

  test("4.2 — Hotkey IPC event triggers recording toggle", async () => {
    const micButton = window.locator('[data-testid="mic-button"]');
    await expect(micButton).toBeAttached();

    // Simulate hotkey trigger via IPC event (like global hotkey would).
    // [20260820_E2E_EvalScopeRequireFix] electron module comes from the
    // evaluate callback's first argument — no require() in eval scope.
    await electronApp.evaluate(({ BrowserWindow }) => {
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
    await electronApp.evaluate(({ BrowserWindow }) => {
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
    // [20260820_E2E_HotkeyRegisterContract] The renderer registered this
    // same accelerator at startup (useHotkey), so HOTKEY.REGISTER answers
    // from its duplicate-sender path — the handler's envelope is
    // {success:true}, never a bare boolean.
    expect(result).toEqual({ success: true });
  });
});
