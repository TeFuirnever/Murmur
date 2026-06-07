/**
 * Suite 9: Window Management E2E Tests
 *
 * Tests minimize, maximize/restore, and always-on-top.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

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
    // Minimize via IPC
    await window.evaluate(() => window.electronAPI.minimizeWindow());

    // Give the window a moment to minimize
    await window.waitForTimeout(500);

    // Check if window is minimized via Electron API
    const isMinimized = await electronApp.evaluate(() => {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isMinimized() : false;
    });
    expect(isMinimized).toBe(true);

    // Restore for subsequent tests
    await electronApp.evaluate(() => {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.restore();
    });
    await window.waitForTimeout(300);
  });

  test("9.2 — Maximize and restore toggle", async () => {
    // Check initial state
    const initiallyMaximized = await window.evaluate(() =>
      window.electronAPI.isWindowMaximized(),
    );

    // Toggle maximize
    await window.evaluate(() => window.electronAPI.maximizeWindow());
    await window.waitForTimeout(500);

    const afterMaximize = await window.evaluate(() =>
      window.electronAPI.isWindowMaximized(),
    );
    expect(afterMaximize).toBe(!initiallyMaximized);

    // Toggle back
    await window.evaluate(() => window.electronAPI.maximizeWindow());
    await window.waitForTimeout(500);

    const afterRestore = await window.evaluate(() =>
      window.electronAPI.isWindowMaximized(),
    );
    expect(afterRestore).toBe(initiallyMaximized);
  });

  test("9.3 — Always-on-top toggle", async () => {
    // Set always on top
    await window.evaluate(() => window.electronAPI.setAlwaysOnTop(true));
    await window.waitForTimeout(300);

    const isOnTop = await electronApp.evaluate(() => {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isAlwaysOnTop() : false;
    });
    expect(isOnTop).toBe(true);

    // Turn off
    await window.evaluate(() => window.electronAPI.setAlwaysOnTop(false));
    await window.waitForTimeout(300);

    const isOffTop = await electronApp.evaluate(() => {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isAlwaysOnTop() : false;
    });
    expect(isOffTop).toBe(false);
  });
});
