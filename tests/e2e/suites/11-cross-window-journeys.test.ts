/**
 * Suite 11: Cross-window feature journeys (P1-P3 batch)
 *
 * Covers the user journeys shipped in the #246/#247/#248 batch that cross
 * window or process boundaries — the layer the unit suites below Playwright
 * deliberately do not reach:
 *  - language switch propagates live to the MAIN window (#247)
 *  - a persisted hotkey change re-registers the global shortcut (#246)
 *  - the history window's clear-all + export toolbar work end-to-end (#248)
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { mockIpcHandler } from "../helpers/ipc-mock";
import {
  launchElectronApp,
  closeElectronApp,
} from "../helpers/electron-launch";
import { mockModelReady } from "../helpers/ipc-mock";

test.describe("Suite 11: cross-window journeys", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
    await mockModelReady(electronApp);
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    // Leave the persisted settings clean for other suites.
    // [20260906_Refactor_DeadChannelCleanup] Ticket #250 removed the
    // zero-renderer-caller resetSettings binding; isolation now restores the
    // keys this suite wrote ("hotkey", "language") to their defaults.
    await window.evaluate(() =>
      window.electronAPI.setSetting("hotkey", "CommandOrControl+Shift+Space"),
    );
    await window.evaluate(() =>
      window.electronAPI.setSetting("language", "zh-CN"),
    );
    await closeElectronApp(electronApp);
  });

  test("11.1 — a persisted hotkey change re-registers the global shortcut", async () => {
    // The full chain: SET → DB → SETTINGS_UPDATE broadcast → App re-applies
    // → atomic replace in hotkeyHandlers → real globalShortcut.
    await window.evaluate(() =>
      window.electronAPI.setSetting("hotkey", "CommandOrControl+Shift+K"),
    );

    // GET_CURRENT reads the manager's registered list — after the atomic
    // replace only the new combo may remain.
    await expect
      .poll(
        async () => {
          return await window.evaluate(() =>
            window.electronAPI.getCurrentHotkey(),
          );
        },
        { timeout: 5000 },
      )
      .toBe("CommandOrControl+Shift+K");
  });

  test("11.2 — language switch propagates live to the main window", async () => {
    // The window may boot in either locale (navigator language). Switch to
    // zh-CN explicitly and assert the flip happens WITHOUT a reload — that
    // is the live-propagation contract (#247).
    await window.evaluate(() =>
      window.electronAPI.setSetting("language", "zh-CN"),
    );

    await expect(window.getByLabel("最小化")).toBeAttached({
      timeout: 5000,
    });
    await expect(window.getByLabel("Minimize")).toHaveCount(0);
    await expect(
      window.getByRole("button", { name: "实时录音" }),
    ).toBeVisible();
  });

  test("11.3 — history window clear-all wipes records behind a confirm", async () => {
    // Seed one record so the window has content to clear.
    const saved = await window.evaluate(() =>
      window.electronAPI.saveTranscription({
        text: "Suite11 清空测试记录",
        raw_text: "Suite11 清空测试记录",
        confidence: 0.9,
        duration: 2.0,
        source_type: "recording",
      }),
    );
    expect(saved.success).toBe(true);

    await window.evaluate(() => window.electronAPI.openHistoryWindow());
    const historyPage = await (async () => {
      for (let i = 0; i < 50; i++) {
        const pages = electronApp.windows();
        const hit = pages.find((p) => p.url().includes("history.html"));
        if (hit) return hit;
        await window.waitForTimeout(100);
      }
      return null;
    })();
    expect(historyPage).toBeTruthy();

    // The window's language depends on the persisted choice / navigator —
    // accept either locale title.
    await expect(
      historyPage.getByText(/Murmur - (转录历史|Transcription History)/),
    ).toBeVisible({ timeout: 10_000 });
    await expect(historyPage.getByText("Suite11 清空测试记录")).toBeVisible();

    // Accept the native confirm dialog.
    historyPage.once("dialog", (dialog) => dialog.accept());
    await historyPage.getByTestId("clear-all").click();

    await expect(historyPage.getByText("暂无转录历史")).toBeVisible({
      timeout: 5000,
    });

    // The empty state renders in the window's active locale.
    await expect(
      historyPage.getByText(/暂无转录历史|No transcriptions yet/),
    ).toBeVisible({ timeout: 5000 });

    // The wipe reached the database, not just the UI list.
    const remaining = await window.evaluate(() =>
      window.electronAPI.getTranscriptions(100, 0),
    );
    const items = remaining.transcriptions || remaining || [];
    expect(items.map((r) => r.text)).not.toContain("Suite11 清空测试记录");

    await historyPage.close();
  });

  test("11.4 — history export uses the selected format; a cancelled save is silent", async () => {
    // Seed a record so the export path has data.
    await window.evaluate(() =>
      window.electronAPI.saveTranscription({
        text: "Suite11 导出测试记录",
        raw_text: "Suite11 导出测试记录",
        confidence: 0.9,
        duration: 2.0,
        source_type: "recording",
      }),
    );

    await window.evaluate(() => window.electronAPI.openHistoryWindow());
    const historyPage = await (async () => {
      for (let i = 0; i < 50; i++) {
        const pages = electronApp.windows();
        const hit = pages.find((p) => p.url().includes("history.html"));
        if (hit) return hit;
        await window.waitForTimeout(100);
      }
      return null;
    })();
    expect(historyPage).toBeTruthy();

    // Patch the MAIN-process save dialog to report "cancelled" — proves the
    // renderer's cancelled-silent branch without a native dialog.
    await electronApp.evaluate(({ dialog }) => {
      (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog =
        async () => ({ canceled: true, filePath: undefined });
    });

    await historyPage.getByTestId("export-format").selectOption("md");
    await historyPage.getByTestId("export-all").click();

    // Cancelled → no success toast appears within the settle window.
    await window.waitForTimeout(1500);
    const body = await historyPage.textContent("body");
    expect(body).not.toContain("导出成功");
    expect(body).not.toContain("Export successful");

    await historyPage.close();
  });
});

// [20260906_Test_ExportContentReadback] Spec #266 T16 (#293): export is not
// just a clickable button — read the exported files back and assert their
// CONTENT. Drives the REAL single-record export path (result-card panel →
// formatter → dialog → file): srt is plain text; docx is a zip whose
// word/document.xml is DEFLATE-compressed, inflated here with node zlib.
test.describe("Suite 11b: Export content readback", () => {
  let electronApp;
  let window;
  let wavPath;

  function makeSilentWav() {
    const sampleRate = 16000;
    const dataSize = sampleRate * 2;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, Buffer.alloc(dataSize)]);
  }

  function inflateStoredEntry(zip, entryName) {
    const nameBuf = Buffer.from(entryName, "utf8");
    let offset = 0;
    while (offset < zip.length - 4) {
      if (zip.readUInt32LE(offset) !== 0x04034b50) {
        offset += 1;
        continue;
      }
      const method = zip.readUInt16LE(offset + 8);
      const compressedSize = zip.readUInt32LE(offset + 18);
      const nameLen = zip.readUInt16LE(offset + 26);
      const extraLen = zip.readUInt16LE(offset + 28);
      const name = zip.slice(offset + 30, offset + 30 + nameLen);
      if (name.equals(nameBuf)) {
        const payload = zip.slice(
          offset + 30 + nameLen + extraLen,
          offset + 30 + nameLen + extraLen + compressedSize,
        );
        const zlib = require("zlib");
        return String(method === 8 ? zlib.inflateRawSync(payload) : payload);
      }
      offset += 30 + nameLen + extraLen + compressedSize;
    }
    return "";
  }

  test.beforeAll(async () => {
    ({ app: electronApp, window } = await launchElectronApp());
    wavPath = path.join(os.tmpdir(), `murmur-e2e-export-${Date.now()}.wav`);
    fs.writeFileSync(wavPath, makeSilentWav());
  });

  test.afterAll(async () => {
    await closeElectronApp(electronApp);
    fs.rmSync(wavPath, { force: true });
  });

  test("11.5 — exported srt/docx carry the record content and timeline", async () => {
    test.setTimeout(60_000);
    // Seed a REAL record (with server-shape segments) so the export path
    // formats genuine data; the file journey then lands on a result card
    // whose id points at this record.
    const seedResult: unknown = await window.evaluate(() =>
      window.electronAPI.saveTranscription({
        text: "Suite11b 导出内容校验",
        raw_text: "Suite11b 导出内容校验",
        confidence: 0.9,
        duration: 3.0,
        source_type: "recording",
        segments: JSON.stringify([
          { text: "第一段", start_ms: 0, end_ms: 1500, speaker: 0 },
          { text: "第二段", start_ms: 1500, end_ms: 3000, speaker: 1 },
        ]),
      }),
    );
    const recordId = Number(
      (seedResult as { lastInsertRowid?: number })?.lastInsertRowid,
    );

    await mockIpcHandler(electronApp, "transcribe-file", {
      success: true,
      text: "Suite11b 导出内容校验",
      segments: [
        { text: "第一段", start_ms: 0, end_ms: 1500, speaker: 0 },
        { text: "第二段", start_ms: 1500, end_ms: 3000, speaker: 1 },
      ],
      duration: 3.0,
      id: recordId,
    });

    await window.locator('button:has-text("文件导入")').click();
    await mockIpcHandler(electronApp, "import-audio-file", {
      success: true,
      filePath: wavPath,
      fileName: "silence-1s.wav",
      fileSize: 32044,
      extension: ".wav",
    });
    await window.locator('[data-testid="file-drop-zone"]').click();
    await window.locator('button:has-text("开始转录")').click();
    const result = window.locator('[data-testid="transcription-result"]');
    await expect(result).toBeVisible();

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-export-"));
    const srtPath = path.join(outDir, "record.srt");
    const docxPath = path.join(outDir, "record.docx");
    try {
      // SRT: patch the save dialog to our tmp path, click the SRT button
      await electronApp.evaluate(({ dialog }, filePath) => {
        (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog =
          async () => ({ canceled: false, filePath });
      }, srtPath);
      await result.locator('button:has-text("SRT")').click();
      await window.waitForTimeout(1200);
      expect(fs.existsSync(srtPath)).toBe(true);
      const srt = fs.readFileSync(srtPath, "utf8");
      // adjacent segments come out smart-merged into one cue (formatter
      // behavior) — assert the merged timeline and combined text
      expect(srt).toContain("00:00:00,000 --> 00:00:03,000");
      expect(srt).toContain("第一段第二段");

      // DOCX: inflate word/document.xml out of the zip and assert the text
      await electronApp.evaluate(({ dialog }, filePath) => {
        (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog =
          async () => ({ canceled: false, filePath });
      }, docxPath);
      await result.locator('button:has-text("DOCX")').click();
      await window.waitForTimeout(1200);
      expect(fs.existsSync(docxPath)).toBe(true);
      const documentXml = String(
        inflateStoredEntry(fs.readFileSync(docxPath), "word/document.xml"),
      );
      expect(documentXml).toContain("Suite11b 导出内容校验");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
