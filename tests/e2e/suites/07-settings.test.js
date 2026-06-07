/**
 * Suite 7: Settings Persistence E2E Tests
 *
 * Tests settings CRUD, theme persistence, AI provider presets.
 * Uses resetSettings in afterEach for isolation.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

test.describe("Suite 7: Settings Persistence", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    // Clean up settings
    await window.evaluate(() => window.electronAPI.resetSettings());
    await closeElectronApp(electronApp);
  });

  test("7.1 — Set and get a setting", async () => {
    await window.evaluate(() => window.electronAPI.setSetting("theme", "dark"));
    const value = await window.evaluate(() =>
      window.electronAPI.getSetting("theme"),
    );
    expect(value).toBe("dark");
  });

  test("7.2 — getAllSettings returns object", async () => {
    const settings = await window.evaluate(() =>
      window.electronAPI.getAllSettings(),
    );
    expect(settings).toBeDefined();
    expect(typeof settings).toBe("object");
  });

  test("7.3 — AI provider presets are available via IPC", async () => {
    const presets = await window.evaluate(() =>
      window.electronAPI.getAIProviderPresets(),
    );

    // Should return an array of provider presets
    expect(Array.isArray(presets)).toBe(true);

    // Must include common providers
    const providerNames = presets.map((p) => p.name);
    expect(providerNames).toContain("openai");
    expect(providerNames).toContain("deepseek");
  });

  test("7.4 — Export and import settings roundtrip", async () => {
    // Set a unique value
    await window.evaluate(() =>
      window.electronAPI.setSetting("theme", "light"),
    );

    // Export
    const exported = await window.evaluate(() =>
      window.electronAPI.exportSettings(),
    );
    expect(exported).toBeDefined();

    // Change the value
    await window.evaluate(() => window.electronAPI.setSetting("theme", "dark"));

    // Import back
    await window.evaluate(
      (s) => window.electronAPI.importSettings(s),
      exported,
    );

    // Verify original value restored
    const value = await window.evaluate(() =>
      window.electronAPI.getSetting("theme"),
    );
    expect(value).toBe("light");
  });
});
