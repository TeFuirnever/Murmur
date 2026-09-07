// [20260906_Feat_ManualEditProtection] Spec #193 T2 (ticket #229): S0
// manual-edit protection. Locks the `manually_edited` record-level flag end
// to end at the DB layer:
//   1. the lossless _migrateSchema upgrade path (old DBs keep every value,
//      the new column defaults to 0),
//   2. the UPDATE whitelist extension (the flag is patchable; raw_text still
//      is not),
//   3. the auto-polish skip seam — a write-back marked
//      skipWhenManuallyEdited must never touch a record the user edited,
//      while the manual path (default) stays unrestricted.
// Uses the real node:sqlite driver (spec #226), mirroring database.test.ts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { DatabaseSync } from "node:sqlite";
import DatabaseManager from "../../src/helpers/database";

describe("DatabaseManager — manual-edit protection (spec #193 T2)", () => {
  let db: InstanceType<typeof DatabaseManager>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-edit-test-"));
    db = new DatabaseManager();
    db.initialize(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Save one record and return its row id. */
  function saveRecord(text: string, processedText?: string): number {
    const result = db.saveTranscription({
      text,
      raw_text: text,
      processed_text: processedText,
    });
    return Number(result.lastInsertRowid);
  }

  /** SaveRecord twin bound to an explicit manager (migration test below). */
  function saveRecordOn(
    manager: InstanceType<typeof DatabaseManager>,
    text: string,
  ): number {
    const result = manager.saveTranscription({ text, raw_text: text });
    return Number(result.lastInsertRowid);
  }

  describe("_migrateSchema upgrade path", () => {
    it("adds manually_edited to a fresh database with default 0", () => {
      const id = saveRecord("新库记录");
      const row = db.getTranscriptionById(id)!;
      // SQLite INTEGER lands as a number; a fresh record is never marked.
      expect(row.manually_edited).toBe(0);
    });

    it("migrates an old database losslessly (rows keep values, default 0)", () => {
      // Self-contained legacy dir: the shared beforeEach db must not touch
      // this file first, or the "old" schema would already be migrated.
      const legacyDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "murmur-legacy-"),
      );
      try {
        // Simulate a PRE-T2 database: the base CREATE TABLE shape (all later
        // columns — source_type/source_file_path/segments/manually_edited —
        // are added by _migrateSchema, so the base shape is exactly what an
        // old install has on disk). Seed it with real rows, then let the
        // DatabaseManager migrate it in place.
        const dbPath = path.join(legacyDir, "transcriptions.db");
        const legacy = new DatabaseSync(dbPath);
        legacy.exec(`
          CREATE TABLE transcriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            raw_text TEXT,
            processed_text TEXT,
            confidence REAL,
            language TEXT DEFAULT 'zh-CN',
            duration REAL,
            file_size INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        legacy
          .prepare(
            "INSERT INTO transcriptions (text, raw_text, processed_text) VALUES (?, ?, ?)",
          )
          .run("旧记录一", "旧原始文本", "旧润色文本");
        legacy
          .prepare("INSERT INTO transcriptions (text, raw_text) VALUES (?, ?)")
          .run("旧记录二", "旧原始二");
        legacy.close();

        // Migrating manager takes over the SAME file.
        const migrated = new DatabaseManager();
        migrated.initialize(legacyDir);

        const rows = migrated.getTranscriptions(10, 0);
        expect(rows).toHaveLength(2);

        // Every pre-existing value survived byte-for-byte.
        const byText = new Map(rows.map((r) => [r.text, r]));
        const first = byText.get("旧记录一")!;
        expect(first.raw_text).toBe("旧原始文本");
        expect(first.processed_text).toBe("旧润色文本");
        const second = byText.get("旧记录二")!;
        expect(second.raw_text).toBe("旧原始二");

        // The new column exists with the unmarked default for old rows.
        expect(first.manually_edited).toBe(0);
        expect(second.manually_edited).toBe(0);

        // The migrated table stays writable through the normal save path.
        const newId = saveRecordOn(migrated, "迁移后新记录");
        expect(migrated.getTranscriptionById(newId)?.manually_edited).toBe(0);
        migrated.close();
      } finally {
        fs.rmSync(legacyDir, { recursive: true, force: true });
      }
    });
  });

  describe("updateTranscription whitelist — manually_edited", () => {
    it("accepts manually_edited: true and stores SQLite 1", () => {
      const id = saveRecord("待标记记录");
      const result = db.updateTranscription(id, { manually_edited: true });
      expect(result.changes).toBe(1);
      expect(db.getTranscriptionById(id)?.manually_edited).toBe(1);
    });

    it("accepts manually_edited: false and stores SQLite 0", () => {
      const id = saveRecord("待取消标记记录");
      db.updateTranscription(id, { manually_edited: true });
      const result = db.updateTranscription(id, { manually_edited: false });
      expect(result.changes).toBe(1);
      expect(db.getTranscriptionById(id)?.manually_edited).toBe(0);
    });

    it("accepts explicit 0/1 numbers for the flag", () => {
      const id = saveRecord("数字标记记录");
      db.updateTranscription(id, { manually_edited: 1 });
      expect(db.getTranscriptionById(id)?.manually_edited).toBe(1);
    });

    it("still rejects raw_text (the original ASR output stays immutable)", () => {
      const id = saveRecord("原始文本");
      expect(() => db.updateTranscription(id, { raw_text: "篡改" })).toThrow(
        "不允许更新的字段",
      );
    });

    it("still rejects a SQL injection payload as a column name", () => {
      const id = saveRecord("注入测试");
      expect(() =>
        db.updateTranscription(id, {
          "text = 'x', manually_edited = 1 --": "y",
        }),
      ).toThrow("不允许更新的字段");
    });

    it("still rejects non-boolean garbage values for the flag", () => {
      const id = saveRecord("垃圾值记录");
      expect(() =>
        db.updateTranscription(id, { manually_edited: "yes" }),
      ).toThrow("更新数据无效");
    });
  });

  describe("auto-polish skip seam (skipWhenManuallyEdited)", () => {
    it("does NOT modify a marked record and reports skipped", () => {
      const id = saveRecord("用户编辑后的文本", "用户编辑后的文本");
      db.updateTranscription(id, { manually_edited: true });

      // Second (auto) polish write-back: must be a no-op on the row.
      const result = db.updateTranscription(
        id,
        { processed_text: "AI 二次润色", text: "AI 二次润色" },
        { skipWhenManuallyEdited: true },
      );

      expect(result.skipped).toBe(true);
      expect(result.changes).toBe(0);

      // DB row unchanged — the user's edit survives.
      const row = db.getTranscriptionById(id)!;
      expect(row.text).toBe("用户编辑后的文本");
      expect(row.processed_text).toBe("用户编辑后的文本");
      expect(row.manually_edited).toBe(1);
    });

    it("still writes for an unmarked record (auto-polish regression)", () => {
      const id = saveRecord("原始识别文本", "一次润色");
      const result = db.updateTranscription(
        id,
        { processed_text: "二次润色", text: "二次润色" },
        { skipWhenManuallyEdited: true },
      );
      expect(result.skipped).toBeUndefined();
      expect(result.changes).toBe(1);
      const row = db.getTranscriptionById(id)!;
      expect(row.text).toBe("二次润色");
      expect(row.manually_edited).toBe(0);
    });

    it("keeps the manual path unrestricted on a marked record", () => {
      const id = saveRecord("用户编辑后的文本", "用户编辑后的文本");
      db.updateTranscription(id, { manually_edited: true });

      // No options -> the user-triggered polish/edit path, which MUST work.
      const result = db.updateTranscription(id, {
        processed_text: "用户再次润色",
        text: "用户再次润色",
      });
      expect(result.changes).toBe(1);
      expect(db.getTranscriptionById(id)?.text).toBe("用户再次润色");
    });

    it("treats a missing record as changes 0 without throwing", () => {
      const result = db.updateTranscription(
        9999,
        { text: "不存在" },
        { skipWhenManuallyEdited: true },
      );
      expect(result.changes).toBe(0);
    });
  });

  describe("fresh-record auto-polish regression (no flag involvement)", () => {
    it("persists the polished result for a fresh record exactly as before", () => {
      // The end-of-recording flow saves a brand-new record; the auto-polish
      // write path (fresh INSERT + polish result) must behave exactly as
      // today: the record lands unmarked with both columns populated.
      const id = saveRecord("原始识别", "一次润色结果");
      const row = db.getTranscriptionById(id)!;
      expect(row.text).toBe("原始识别");
      expect(row.processed_text).toBe("一次润色结果");
      expect(row.manually_edited).toBe(0);
    });
  });
});
