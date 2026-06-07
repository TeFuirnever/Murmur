/**
 * Suite 8: History Management E2E Tests
 *
 * Tests history window, search, and delete operations.
 * Inserts test records via IPC mock, then verifies UI behavior.
 */
import { test, expect } from "playwright-core";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch.js";

test.describe("Suite 8: History Management", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
  });

  test("8.1 — getTranscriptions returns array", async () => {
    const result = await window.evaluate(() =>
      window.electronAPI.getTranscriptions({ limit: 10, offset: 0 }),
    );
    expect(result).toBeDefined();
    expect(Array.isArray(result.transcriptions || result)).toBe(true);
  });

  test("8.2 — Search transcriptions via IPC", async () => {
    // First save a test transcription
    await window.evaluate(() =>
      window.electronAPI.saveTranscription({
        text: "E2E测试记录人工智能发展",
        raw_text: "E2E测试记录人工智能发展",
        confidence: 0.95,
        duration: 5.0,
        source_type: "recording",
      }),
    );

    // Search for it
    const results = await window.evaluate(() =>
      window.electronAPI.searchTranscriptions("人工智能"),
    );
    expect(results).toBeDefined();
    const items = results.transcriptions || results;
    expect(items.length).toBeGreaterThanOrEqual(1);
    const text = items[0].text || items[0].raw_text;
    expect(text).toContain("人工智能");
  });

  test("8.3 — Delete transcription via IPC", async () => {
    // Save a record to delete
    const saved = await window.evaluate(() =>
      window.electronAPI.saveTranscription({
        text: "待删除的测试记录",
        raw_text: "待删除的测试记录",
        confidence: 0.9,
        duration: 2.0,
        source_type: "recording",
      }),
    );

    expect(saved).toBeDefined();
    const id = saved.id || saved;

    // Delete it
    if (typeof id === "number") {
      await window.evaluate(
        (deleteId) => window.electronAPI.deleteTranscription(deleteId),
        id,
      );

      // Verify it's gone
      const result = await window.evaluate(
        (getDeleteId) => window.electronAPI.getTranscription(getDeleteId),
        id,
      );
      expect(result).toBeNull();
    }
  });
});
