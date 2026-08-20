/**
 * Suite 9: Window Management E2E Tests
 *
 * Tests minimize, maximize/restore, and always-on-top.
 */
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";

test.describe("Suite 9: Window Management", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("9.1 — Minimize window", async () => {
    // [20260820_E2E_MinimizeEnvFinding] On macOS 26 under the Playwright
    // harness, native miniaturize is a silent no-op EVEN for a plain
    // frameless Electron window (verified with a standalone probe:
    // focused w.minimize() leaves isMinimized()=false, isVisible()=true),
    // so the native minimized state is not observable here. The handler's
    // delegation to mainWindow.minimize() is pinned by
    // tests/unit/windowHandlers.test.ts; this e2e covers the IPC contract:
    // the channel responds true and the window stays operable.
    const result = await window.evaluate(() =>
      window.electronAPI.minimizeWindow(),
    );
    expect(result).toBe(true);

    // Window must remain alive and queryable after the minimize request.
    // [20260820_E2E_EvalScopeRequireFix] electron module comes from the
    // evaluate callback's first argument — no require() in eval scope.
    const alive = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? !win.isDestroyed() : false;
    });
    expect(alive).toBe(true);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.restore();
    });
  });

  test("9.2 — Maximize and restore toggle", async () => {
    // Check initial state
    const initiallyMaximized = await window.evaluate(() =>
      window.electronAPI.isWindowMaximized(),
    );

    // Toggle maximize
    await window.evaluate(() => window.electronAPI.maximizeWindow());

    await expect
      .poll(
        async () => {
          return await window.evaluate(() =>
            window.electronAPI.isWindowMaximized(),
          );
        },
        { timeout: 3000 },
      )
      .toBe(!initiallyMaximized);

    // Toggle back
    await window.evaluate(() => window.electronAPI.maximizeWindow());

    await expect
      .poll(
        async () => {
          return await window.evaluate(() =>
            window.electronAPI.isWindowMaximized(),
          );
        },
        { timeout: 3000 },
      )
      .toBe(initiallyMaximized);
  });

  test("9.3 — Always-on-top toggle", async () => {
    // Set always on top
    await window.evaluate(() => window.electronAPI.setAlwaysOnTop(true));

    await expect
      .poll(
        async () => {
          return await electronApp.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            return win ? win.isAlwaysOnTop() : false;
          });
        },
        { timeout: 3000 },
      )
      .toBe(true);

    // Turn off
    await window.evaluate(() => window.electronAPI.setAlwaysOnTop(false));

    await expect
      .poll(
        async () => {
          return await electronApp.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            return win ? win.isAlwaysOnTop() : false;
          });
        },
        { timeout: 3000 },
      )
      .toBe(false);
  });
});
