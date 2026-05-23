import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

const DatabaseManager = require("../../src/helpers/database");

describe("DatabaseManager - extended coverage", () => {
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

  describe("constructor", () => {
    it("accepts a logger", () => {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const d = new DatabaseManager(logger);
      expect(d.logger).toBe(logger);
    });

    it("defaults logger to null", () => {
      const d = new DatabaseManager();
      expect(d.logger).toBeNull();
    });
  });

  describe("setSafeStorage", () => {
    it("stores safeStorage reference", () => {
      const ss = {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn(),
        decryptString: vi.fn(),
      };
      db.setSafeStorage(ss);
      expect(db.safeStorage).toBe(ss);
    });
  });

  describe("encryption", () => {
    it("encrypts and decrypts ai_api_key", () => {
      const encrypted = Buffer.from("encrypted-value");
      const ss = {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn().mockReturnValue(encrypted),
        decryptString: vi.fn().mockReturnValue("my-secret-key"),
      };
      db.setSafeStorage(ss);

      db.setSetting("ai_api_key", "my-secret-key");
      expect(ss.encryptString).toHaveBeenCalledWith("my-secret-key");

      const val = db.getSetting("ai_api_key");
      expect(val).toBe("my-secret-key");
      expect(ss.decryptString).toHaveBeenCalled();
    });

    it("falls back to plaintext when safeStorage not available", () => {
      db.setSetting("ai_api_key", "plain-key");
      expect(db.getSetting("ai_api_key")).toBe("plain-key");
    });

    it("handles non-string values in encryptValue", () => {
      db.setSetting("some_number", 42);
      expect(db.getSetting("some_number")).toBe(42);
    });

    it("returns default when encrypted value cannot be decrypted without safeStorage", () => {
      const encrypted = Buffer.from("enc").toString("base64");
      const raw = JSON.stringify({ _enc: encrypted });
      db.db
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        )
        .run("ai_api_key", raw);

      expect(db.getSetting("ai_api_key", "default")).toBe("default");
    });

    it("getAllSettings decrypts encrypted keys", () => {
      const ss = {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn().mockReturnValue(Buffer.from("enc")),
        decryptString: vi.fn().mockReturnValue("secret"),
      };
      db.setSafeStorage(ss);
      db.setSetting("ai_api_key", "secret");
      db.setSetting("theme", "dark");

      const all = db.getAllSettings();
      expect(all.ai_api_key).toBe("secret");
      expect(all.theme).toBe("dark");
    });
  });

  describe("_migrateSettings", () => {
    it("sets schema version on first run", () => {
      const ss = {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn(),
        decryptString: vi.fn(),
      };
      db.setSafeStorage(ss);
      expect(db.getSetting("settings_schema_version")).toBe(1);
    });

    it("migrates plaintext api key to encrypted", () => {
      const ss1 = {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn(),
        decryptString: vi.fn(),
      };
      db.setSafeStorage(ss1);

      db.setSetting("settings_schema_version", 0);
      db.db
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        )
        .run("ai_api_key", JSON.stringify("plaintext-key"));

      const ss2 = {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn().mockReturnValue(Buffer.from("enc")),
        decryptString: vi.fn().mockReturnValue("plaintext-key"),
      };
      db.safeStorage = ss2;
      db._migrateSettings();

      expect(db.getSetting("settings_schema_version")).toBe(1);
      expect(ss2.encryptString).toHaveBeenCalledWith("plaintext-key");
    });

    it("skips migration if already at current version", () => {
      const ss1 = {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn(),
        decryptString: vi.fn(),
      };
      db.setSafeStorage(ss1);
      db.setSetting("settings_schema_version", 1);

      const ss2 = {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn(),
        decryptString: vi.fn(),
      };
      db.safeStorage = ss2;
      db._migrateSettings();
      expect(ss2.encryptString).not.toHaveBeenCalled();
    });
  });

  describe("saveTranscription", () => {
    it("rejects non-object input", () => {
      expect(() => db.saveTranscription(null)).toThrow("转录数据无效");
      expect(() => db.saveTranscription("string")).toThrow("转录数据无效");
    });

    it("saves with all optional fields defaulted", () => {
      const r = db.saveTranscription({ text: "test" });
      const row = db.getTranscriptionById(r.lastInsertRowid);
      expect(row.language).toBe("zh-CN");
      expect(row.source_type).toBe("recording");
    });
  });

  describe("getTranscriptionWithSegments", () => {
    it("returns parsed segments", () => {
      const r = db.saveTranscription({
        text: "test",
        segments: JSON.stringify([{ start_ms: 0, text: "test" }]),
      });
      const row = db.getTranscriptionWithSegments(r.lastInsertRowid);
      expect(row.parsedSegments).toEqual([{ start_ms: 0, text: "test" }]);
    });

    it("returns empty array when no segments", () => {
      const r = db.saveTranscription({ text: "no segs" });
      const row = db.getTranscriptionWithSegments(r.lastInsertRowid);
      expect(row.parsedSegments).toEqual([]);
    });

    it("handles invalid JSON segments with logger", () => {
      db.close();
      const logDb = new DatabaseManager({ warn: vi.fn(), error: vi.fn() });
      logDb.initialize(tmpDir);
      const r = logDb.saveTranscription({ text: "bad segs" });
      logDb.db
        .prepare("UPDATE transcriptions SET segments = ? WHERE id = ?")
        .run("not-json", r.lastInsertRowid);
      const row = logDb.getTranscriptionWithSegments(r.lastInsertRowid);
      expect(row.parsedSegments).toEqual([]);
      logDb.close();
    });

    it("returns undefined for missing id", () => {
      expect(db.getTranscriptionWithSegments(99999)).toBeUndefined();
    });

    it("returns undefined for non-existent row with logger", () => {
      db.close();
      const logDb = new DatabaseManager({ warn: vi.fn(), error: vi.fn() });
      logDb.initialize(tmpDir);
      expect(logDb.getTranscriptionWithSegments(1)).toBeUndefined();
      logDb.close();
    });

    it("returns null on DB error with logger", () => {
      const log = { warn: vi.fn(), error: vi.fn() };
      const logDb = new DatabaseManager(log);
      logDb.initialize(tmpDir);
      logDb.db.close();
      expect(logDb.getTranscriptionWithSegments(1)).toBeNull();
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe("clearAllTranscriptions", () => {
    it("removes all transcriptions", () => {
      db.saveTranscription({ text: "a" });
      db.saveTranscription({ text: "b" });
      db.clearAllTranscriptions();
      expect(db.getTranscriptions(50, 0)).toHaveLength(0);
    });
  });

  describe("getTranscriptionStats", () => {
    it("returns total, today, and week counts", () => {
      db.saveTranscription({ text: "stat test" });
      const stats = db.getTranscriptionStats();
      expect(stats.total).toBe(1);
      expect(stats.today).toBe(1);
      expect(stats.week).toBe(1);
    });
  });

  describe("searchTranscriptions", () => {
    it("searches raw_text and processed_text columns", () => {
      db.saveTranscription({ text: "visible", raw_text: "hidden data" });
      const results = db.searchTranscriptions("hidden");
      expect(results).toHaveLength(1);
    });
  });

  describe("backup", () => {
    it("returns false when db is null", () => {
      db.close();
      const d = new DatabaseManager();
      expect(d.backup("/tmp/none.db")).toBe(false);
    });

    it("starts backup and returns true", async () => {
      db.saveTranscription({ text: "backup test" });
      const backupPath = path.join(tmpDir, "backup.db");
      expect(db.backup(backupPath)).toBe(true);
      await new Promise((r) => setTimeout(r, 500));
      expect(fs.existsSync(backupPath)).toBe(true);
    });

    it("logs error on async backup failure", async () => {
      const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
      const logDb = new DatabaseManager(logger);
      logDb.initialize(tmpDir);
      logDb.saveTranscription({ text: "test" });
      logDb.db.backup = () => {
        const p = Promise.reject(new Error("test backup error"));
        p.catch(() => {});
        return p;
      };
      logDb.backup(path.join(tmpDir, "backup.db"));
      await new Promise((r) => setTimeout(r, 50));
      expect(logger.error).toHaveBeenCalled();
      logDb.close();
    });
  });

  describe("close", () => {
    it("sets db to null after close", () => {
      db.close();
      expect(db.db).toBeNull();
    });

    it("is safe to call twice", () => {
      db.close();
      db.close();
      expect(db.db).toBeNull();
    });
  });

  describe("initialize", () => {
    it("creates data directory if missing", () => {
      const newDir = path.join(tmpDir, "nested", "db");
      const d = new DatabaseManager();
      d.initialize(newDir);
      expect(fs.existsSync(newDir)).toBe(true);
      d.close();
    });

    it("schema migration runs via setSafeStorage not initialize", () => {
      const d = new DatabaseManager();
      const dir = path.join(tmpDir, "no-log");
      d.initialize(dir);
      expect(d.getSetting("settings_schema_version")).toBeNull();
      const ss = {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn(),
        decryptString: vi.fn(),
      };
      d.setSafeStorage(ss);
      expect(d.getSetting("settings_schema_version")).toBe(1);
      d.close();
    });
  });

  describe("getSetting", () => {
    it("handles non-JSON stored value", () => {
      db.db
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        )
        .run("raw", "not-json");
      expect(db.getSetting("raw")).toBe("not-json");
    });
  });

  describe("getAllSettings", () => {
    it("handles non-JSON stored value", () => {
      db.db
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        )
        .run("bad", "not-json");
      const all = db.getAllSettings();
      expect(all.bad).toBe("not-json");
    });
  });
});
