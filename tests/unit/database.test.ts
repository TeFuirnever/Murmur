// [20260726_Tier3_DatabaseMigrate] Migrated from .js to .ts as part of Tier 3
// batch 3. Pattern: type the module-level `const DatabaseManager` via
// `typeof import("...").default` (the source's default-exported class); type
// the `let db` instance via `InstanceType<typeof DatabaseManager>` and the
// `let tmpDir` as string, both assigned in beforeEach (TS7034). The
// _tsresolve.setup unwraps the ESM default to the class at runtime, so
// `new DatabaseManager()` works unchanged. Template reference:
// phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
// [20260726_Tier32_Database] Convert CJS require() → ESM default import.
import DatabaseManager from "../../src/helpers/database";

describe("DatabaseManager", () => {
  let db: InstanceType<typeof DatabaseManager>;
  let tmpDir: string;

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

      // [20260726_Tier3_DatabaseMigrate] lastInsertRowid is number | bigint
      // (better-sqlite3 RunResult); getTranscriptionById takes number, so
      // coerce. row is TranscriptionRecord | undefined — non-null after the
      // defined assertion (suite convention, no @ts-ignore).
      const row = db.getTranscriptionById(Number(result.lastInsertRowid));
      expect(row).toBeDefined();
      expect(row!.text).toBe("你好世界");
      expect(row!.confidence).toBeCloseTo(0.95);
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
      // [20260726_Tier3_DatabaseMigrate] Coerce number | bigint → number.
      db.deleteTranscription(Number(lastInsertRowid));

      expect(db.getTranscriptionById(Number(lastInsertRowid))).toBeUndefined();
    });
  });

  // [20260815_Refactor_DeadIpc] searchTranscriptions describe removed with
  // the dead FTS search pipeline (zero renderer callers; history filters
  // client-side).

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

  describe("SQLite pragmas", () => {
    it("sets journal_mode to WAL and busy_timeout", () => {
      // [20260726_Tier3_DatabaseMigrate] DatabaseManager.db is private, but
      // this test asserts the pragma state set during initialize(). Access
      // via a structural cast through `unknown` (no `any`) exposing only the
      // `pragma` method used here. File-based temp DB (not :memory:), so WAL
      // pragma takes effect.
      const rawDb = (
        db as unknown as {
          db: {
            pragma: (name: string, opts?: { simple?: boolean }) => unknown;
          };
        }
      ).db;
      const mode = rawDb.pragma("journal_mode", { simple: true });
      expect(mode).toBe("wal");

      const timeout = rawDb.pragma("busy_timeout", { simple: true });
      expect(timeout).toBe(5000);
    });
  });

  describe("syncToFileConfig", () => {
    it("does nothing when no file config path set", () => {
      expect(() => db.syncToFileConfig()).not.toThrow();
    });

    it("writes settings to file config", () => {
      const configPath = path.join(tmpDir, "murmur.json");
      db.setFileConfigPath(configPath);
      db.setSetting("theme", "dark");
      db.setSetting("ai_base_url", "https://api.example.com");
      db.syncToFileConfig();
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(content.theme).toBe("dark");
      expect(content.ai_base_url).toBe("https://api.example.com");
    });
  });

  // [20260815_Refactor_DeadIpc] backup describe removed with the zero-caller
  // DatabaseManager.backup method.
});
