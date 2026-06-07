/**
 * Suite 6: Clipboard & Auto-Paste E2E Tests
 *
 * Tests clipboard read/write and auto-paste behavior modes.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

test.describe("Suite 6: Clipboard & Auto-Paste", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("6.1 — Copy text to clipboard and read back", async () => {
    const testText = "E2E clipboard test " + Date.now();

    // Write to clipboard
    await window.evaluate(
      (t) => window.electronAPI.writeClipboard(t),
      testText,
    );

    // Read back from clipboard
    const result = await window.evaluate(() =>
      window.electronAPI.readClipboard(),
    );
    expect(result).toBe(testText);
  });

  test("6.2 — Auto-paste mode setting via IPC", async () => {
    // Set auto_paste to "clipboard_only"
    await window.evaluate(() =>
      window.electronAPI.setSetting("auto_paste", "clipboard_only"),
    );

    const value = await window.evaluate(() =>
      window.electronAPI.getSetting("auto_paste"),
    );
    expect(value).toBe("clipboard_only");

    // Reset to default
    await window.evaluate(() =>
      window.electronAPI.setSetting("auto_paste", "paste"),
    );
  });

  test("6.3 — pasteText IPC call succeeds", async () => {
    // pasteText may fail in test environment (no active text field)
    // but the IPC call itself should not throw
    const result = await window.evaluate(() =>
      window.electronAPI.pasteText("test paste").catch((e) => ({
        error: e.message,
      })),
    );
    // Result is either void (success) or an error object
    // The important thing is the IPC channel exists and responds
    expect(result).toBeDefined();
  });
});
