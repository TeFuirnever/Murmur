import { test, expect, _electron } from "playwright-core";
import path from "path";

test.describe("IPC bridge communication", () => {
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

  test("should get system info via IPC", async () => {
    const info = await window.evaluate(
      () => window.electronAPI.getSystemInfo()
    );
    expect(info).toBeDefined();
    expect(info).toHaveProperty("platform");
    expect(info).toHaveProperty("arch");
  });

  test("should check permissions via IPC", async () => {
    const perms = await window.evaluate(
      () => window.electronAPI.checkPermissions()
    );
    expect(perms).toBeDefined();
    expect(perms).toHaveProperty("microphone");
    expect(perms).toHaveProperty("accessibility");
  });

  test("should read and write clipboard", async () => {
    const testText = "E2E clipboard test " + Date.now();
    await window.evaluate(
      (t) => window.electronAPI.writeClipboard(t),
      testText
    );
    const result = await window.evaluate(
      () => window.electronAPI.readClipboard()
    );
    expect(result).toBe(testText);
  });
});
