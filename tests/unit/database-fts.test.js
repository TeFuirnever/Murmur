import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

const DatabaseManager = require("../../src/helpers/database");

describe("FTS5 search", () => {
  let db;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-fts-"));
    db = new DatabaseManager();
    db.initialize(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds results via FTS5 full-text search", () => {
    db.saveTranscription({ text: "今天天气很好" });
    db.saveTranscription({ text: "明天会下雨" });
    db.saveTranscription({ text: "今天天气不错" });

    const results = db.searchTranscriptions("天气");
    expect(results.length).toBeGreaterThanOrEqual(2);
    const texts = results.map((r) => r.text);
    expect(texts).toContain("今天天气很好");
    expect(texts).toContain("今天天气不错");
  });

  it("searches across text, raw_text, and processed_text columns", () => {
    db.saveTranscription({
      text: "original text",
      raw_text: "raw text content",
      processed_text: "processed version here",
    });

    expect(db.searchTranscriptions("raw text")).toHaveLength(1);
    expect(db.searchTranscriptions("processed version")).toHaveLength(1);
    expect(db.searchTranscriptions("original")).toHaveLength(1);
  });

  it("returns empty array for no matches", () => {
    db.saveTranscription({ text: "你好世界" });
    const results = db.searchTranscriptions("nonexistent");
    expect(results).toEqual([]);
  });

  it("indexes new records automatically after save", () => {
    db.saveTranscription({ text: "first record" });
    expect(db.searchTranscriptions("first")).toHaveLength(1);

    db.saveTranscription({ text: "second record" });
    expect(db.searchTranscriptions("second")).toHaveLength(1);
  });

  it("removes index entry when transcription is deleted", () => {
    const { lastInsertRowid } = db.saveTranscription({
      text: "to be deleted",
    });
    db.saveTranscription({ text: "to keep" });

    expect(db.searchTranscriptions("deleted")).toHaveLength(1);
    db.deleteTranscription(lastInsertRowid);
    expect(db.searchTranscriptions("deleted")).toHaveLength(0);
    expect(db.searchTranscriptions("keep")).toHaveLength(1);
  });

  it("rebuilds FTS index on init for existing database", () => {
    // Save some data
    db.saveTranscription({ text: "测试中文搜索" });
    db.saveTranscription({ text: "另一条记录" });
    db.close();

    // Reopen database
    const db2 = new DatabaseManager();
    db2.initialize(tmpDir);
    const results = db2.searchTranscriptions("中文");
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("测试中文搜索");
    db2.close();
  });

  it("handles Chinese word segmentation", () => {
    db.saveTranscription({ text: "人工智能技术发展迅速" });
    db.saveTranscription({ text: "机器学习算法优化" });

    const results = db.searchTranscriptions("人工智能");
    expect(results).toHaveLength(1);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      db.saveTranscription({ text: `测试记录 ${i}` });
    }

    const results = db.searchTranscriptions("测试", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
