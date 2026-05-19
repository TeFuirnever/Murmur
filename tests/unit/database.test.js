import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

const DatabaseManager = require("../../src/helpers/database");

describe("DatabaseManager", () => {
  let db;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
    db = new DatabaseManager();
    db.initialize(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("saveTranscription / getTranscriptionById", () => {
    it("saves and retrieves a transcription", () => {
      const result = db.saveTranscription({
        text: "你好世界",
        raw_text: "你好世界",
        confidence: 0.95,
        language: "zh-CN",
      });

      expect(result.changes).toBe(1);

      const row = db.getTranscriptionById(result.lastInsertRowid);
      expect(row).toBeDefined();
      expect(row.text).toBe("你好世界");
      expect(row.confidence).toBeCloseTo(0.95);
    });

    it("rejects empty text", () => {
      expect(() => db.saveTranscription({ text: "  " })).toThrow(
        "转录文本不能为空",
      );
    });
  });

  describe("getTranscriptions", () => {
    it("returns transcriptions with limit and offset", () => {
      db.saveTranscription({ text: "first" });
      db.saveTranscription({ text: "second" });
      db.saveTranscription({ text: "third" });

      const rows = db.getTranscriptions(2, 0);
      expect(rows).toHaveLength(2);

      const all = db.getTranscriptions(50, 0);
      expect(all).toHaveLength(3);
    });
  });

  describe("deleteTranscription", () => {
    it("deletes a transcription by id", () => {
      const { lastInsertRowid } = db.saveTranscription({ text: "to delete" });
      db.deleteTranscription(lastInsertRowid);

      expect(db.getTranscriptionById(lastInsertRowid)).toBeUndefined();
    });
  });

  describe("searchTranscriptions", () => {
    it("finds transcriptions matching query", () => {
      db.saveTranscription({ text: "hello world" });
      db.saveTranscription({ text: "goodbye world" });
      db.saveTranscription({ text: "nothing here" });

      const results = db.searchTranscriptions("world");
      expect(results).toHaveLength(2);
    });
  });

  describe("settings CRUD", () => {
    it("set and get a setting", () => {
      db.setSetting("theme", "dark");
      expect(db.getSetting("theme")).toBe("dark");
    });

    it("returns default for missing key", () => {
      expect(db.getSetting("missing", "fallback")).toBe("fallback");
    });

    it("getAllSettings returns all entries", () => {
      db.setSetting("a", 1);
      db.setSetting("b", "two");

      const all = db.getAllSettings();
      expect(all.a).toBe(1);
      expect(all.b).toBe("two");
    });

    it("resetSettings clears all settings", () => {
      db.setSetting("key", "value");
      db.resetSettings();
      expect(db.getSetting("key")).toBeNull();
    });
  });
});
