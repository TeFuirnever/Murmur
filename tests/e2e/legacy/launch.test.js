import { test, expect, _electron } from "@playwright/test";
import path from "path";

test.describe("Electron app launch", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await _electron.launch({
      args: [path.resolve(__dirname, "../../..")],
      env: { ...process.env, NODE_ENV: "test" },
    });
    window = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("should launch and show main window", async () => {
    expect(window).toBeDefined();
    // [20260724_E2E_PlaywrightApiFix] Playwright 1.60 requires selector arg
    const isVisible = await window.isVisible("body");
    // [20260724_E2E_PlaywrightApiFix] END
    expect(isVisible).toBe(true);
  });

  test("should have correct title", async () => {
    const title = await window.title();
    expect(title).toBeTruthy();
  });

  test("should expose electronAPI on window", async () => {
    const hasAPI = await window.evaluate(() => !!window.electronAPI);
    expect(hasAPI).toBe(true);
  });
});
