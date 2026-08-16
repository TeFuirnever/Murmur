// [20260816_Test_BranchPush] Branch-coverage tests for src/helpers/database.ts
// arcs not hit by the existing database/database-coverage/database-error-paths
// suites: non-string values on an encrypted key, a NULL stored value, the
// schema-migration string-shape guard, text falling back to raw_text, the
// file-config cache fallback in getSetting, and _migrateSchema's
// column-already-present skip. Uses the real better-sqlite3 driver.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import DatabaseManager from "../../src/helpers/database";

// Surface for poking private members (suite-standard `as unknown as` cast).
interface DatabaseManagerSurface {
  db: {
    prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
  };
}

function dbp(d: InstanceType<typeof DatabaseManager>): DatabaseManagerSurface {
  return d as unknown as DatabaseManagerSurface;
}

/** Insert a raw settings row bypassing the serialization in setSetting. */
function insertRawSetting(
  db: InstanceType<typeof DatabaseManager>,
  key: string,
  value: string | null,
): void {
  dbp(db)
    .db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
    )
    .run(key, value);
}

describe("[20260816_Test_BranchPush] DatabaseManager branch coverage", () => {
  let db: InstanceType<typeof DatabaseManager>;
  let tmpDir: string;
  let logger: {
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-db-branch-"));
    logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    db = new DatabaseManager(
      logger as unknown as ConstructorParameters<typeof DatabaseManager>[0],
    );
    db.initialize(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("encryption value shapes", () => {
    it("stores a non-string encrypted-key value as plain JSON", () => {
      // _encryptValue's `typeof value === "string"` false arm with encryption
      // available — non-strings never reach encryptString.
      const encryptString = vi.fn((s: string) => Buffer.from(`enc:${s}`));
      db.setSafeStorage({
        encryptString,
        decryptString: vi.fn(),
        isEncryptionAvailable: vi.fn(() => true),
      });
      db.setSetting("ai_api_key", 42);
      expect(encryptString).not.toHaveBeenCalled();
      expect(db.getSetting("ai_api_key")).toBe(42);
    });

    it("returns the default when an encrypted row stores NULL", () => {
      // _decryptValue's `raw == null` early return feeds the getSetting
      // `decrypted !== null ? ... : defaultValue` fallback.
      insertRawSetting(db, "ai_api_key", null);
      expect(db.getSetting("ai_api_key", "default-key")).toBe("default-key");
    });
  });

  describe("_migrateSettings value-shape guard", () => {
    it("skips re-encryption when the stored value parses to a non-string", () => {
      db.setSetting("settings_schema_version", 0);
      insertRawSetting(db, "ai_api_key", JSON.stringify(12345));
      const encryptString = vi.fn((s: string) => Buffer.from(`enc:${s}`));
      db.setSafeStorage({
        encryptString,
        decryptString: vi.fn(),
        isEncryptionAvailable: vi.fn(() => true),
      });
      expect(encryptString).not.toHaveBeenCalled();
      expect(db.getSetting("settings_schema_version")).toBe(1);
    });

    it("skips re-encryption when the stored string already looks encrypted", () => {
      db.setSetting("settings_schema_version", 0);
      // A string whose CONTENT starts with {"_enc": — the raw prefix check.
      insertRawSetting(db, "ai_api_key", JSON.stringify('{"_enc":"abc"}'));
      const encryptString = vi.fn((s: string) => Buffer.from(`enc:${s}`));
      db.setSafeStorage({
        encryptString,
        decryptString: vi.fn(),
        isEncryptionAvailable: vi.fn(() => true),
      });
      expect(encryptString).not.toHaveBeenCalled();
    });
  });

  describe("saveTranscription raw_text fallback", () => {
    it("persists raw_text when text is empty", () => {
      // `data.text || data.raw_text || ""` middle arm.
      const result = db.saveTranscription({
        text: "",
        raw_text: "原始文本",
      });
      const row = db.getTranscriptionById(Number(result.lastInsertRowid));
      expect(row?.text).toBe("原始文本");
    });
  });

  describe("getSetting file-config cache fallback", () => {
    it("serves an unknown-to-DB key from the file config cache", () => {
      const configPath = path.join(tmpDir, "murmur.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({ theme: "dark", ignored_key: 1 }),
      );
      db.setFileConfigPath(configPath);
      // No DB row for theme — the cache answers instead.
      expect(db.getSetting("theme", "fallback")).toBe("dark");
      // Keys absent from both DB and cache fall through to the default.
      expect(db.getSetting("never-stored", "fallback")).toBe("fallback");
    });
  });

  describe("_migrateSchema column-present skip", () => {
    it("does not re-run ALTER statements on a second initialize", () => {
      db.close();
      // Re-initialize the SAME database file: source_type/source_file_path/
      // segments already exist, so all three ALTERs must be skipped — any
      // attempted ALTER would fail ("duplicate column") and log a warning.
      const second = new DatabaseManager(
        logger as unknown as ConstructorParameters<typeof DatabaseManager>[0],
      );
      second.initialize(tmpDir);
      expect(logger.warn).not.toHaveBeenCalled();
      // And the table remains queryable.
      const r = second.saveTranscription({ text: "ok" });
      expect(r.changes).toBe(1);
      second.close();
    });
  });
});
