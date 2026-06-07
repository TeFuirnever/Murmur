import { test, expect, _electron } from "playwright-core";
import path from "path";

test.describe("Settings flow", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await _electron.launch({
      args: [path.resolve(__dirname, "../../main.js")],
      env: { ...process.env, NODE_ENV: "test" },
    });
    window = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("should get app version", async () => {
    const version = await window.evaluate(() =>
      window.electronAPI.getAppVersion(),
    );
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("should get all settings", async () => {
    const settings = await window.evaluate(() =>
      window.electronAPI.getAllSettings(),
    );
    expect(settings).toBeDefined();
    expect(typeof settings).toBe("object");
  });

  test("should set and get a setting", async () => {
    await window.evaluate(() => window.electronAPI.setSetting("theme", "dark"));
    const value = await window.evaluate(() =>
      window.electronAPI.getSetting("theme"),
    );
    expect(value).toBe("dark");
    // Reset
    await window.evaluate(() =>
      window.electronAPI.setSetting("theme", "system"),
    );
  });
});
