/**
 * Suite 8: History Management E2E Tests
 *
 * Tests history window, search, and delete operations.
 * Inserts test records via IPC mock, then verifies UI behavior.
 */
import { test, expect } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";

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

  test("8.2 — History search finds the record (client-side filter)", async () => {
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

    // [20260815_Refactor_DeadIpc] searchTranscriptions IPC removed (the
    // history page filters client-side). Mirror that behavior: fetch the
    // recent records and filter by the query in the page.
    const results = await window.evaluate(
      (query) =>
        Promise.resolve(window.electronAPI.getTranscriptions(100, 0)).then(
          (rows) => {
            const items = rows.transcriptions || rows || [];
            return items.filter(
              (item) =>
                (item.text || "").includes(query) ||
                (item.processed_text || "").includes(query),
            );
          },
        ),
      "人工智能",
    );
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThanOrEqual(1);
    const text = results[0].text || results[0].raw_text;
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
    // [20260816_Refactor_DeadChannels] Assert the id shape up front so the
    // delete+verify block below can never be silently skipped.
    expect(typeof id).toBe("number");

    // Delete it
    if (typeof id === "number") {
      await window.evaluate(
        (deleteId) => window.electronAPI.deleteTranscription(deleteId),
        id,
      );

      // Verify it's gone
      // [20260816_Refactor_DeadChannels] getTranscription (single-record)
      // was removed; verify via the list endpoint like the UI does.
      const remaining = await window.evaluate(() =>
        window.electronAPI.getTranscriptions(100, 0),
      );
      const items = remaining.transcriptions || remaining || [];
      const ids = items.map((item: { id?: number }) => item.id);
      expect(ids).not.toContain(id);
    }
  });
});
