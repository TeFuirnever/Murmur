// [20260724_TS_BigBang_Database] Migrated implementation from .js to .ts
// (ADR-010). Was a type re-export stub; now the full better-sqlite3
// implementation lives here. `module.exports = DatabaseManager` (class)
// became `export default DatabaseManager`.
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { loadFileConfig } from "./fileConfig";
import { saveFileConfig, FILE_CONFIGURABLE_KEYS } from "./fileConfig";

/** A transcription record as stored in SQLite. */
export interface TranscriptionRecord {
  id?: number;
  text: string;
  raw_text?: string;
  processed_text?: string;
  confidence?: number;
  language?: string;
  duration?: number;
  file_size?: number;
  source_type?: string;
  source_file_path?: string;
  segments?: string;
  parsedSegments?: Array<{ start_ms: number; end_ms: number; text: string }>;
  created_at?: string;
  updated_at?: string;
}

/** SafeStorage interface for encryption. */
interface SafeStorage {
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
  isEncryptionAvailable(): boolean;
}

/** Logger interface (accepts console or LogManager). */
interface Logger {
  info?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

type Primitive = string | number | boolean | null | undefined;

// [20260726_TechDebt_TypedRows] Typed helper wrapping better-sqlite3's
// untyped .get()/.all() returns. Eliminates the 10 `as { field: type }`
// casts that were scattered across this file. better-sqlite3 returns
// `unknown` by design (the row shape depends on the query), so a typed
// wrapper is the idiomatic fix per the library docs.
/** Cast a better-sqlite3 row to a typed shape. Use for single-row queries. */
function getRow<T>(
  stmt: Database.Statement,
  ...params: Primitive[]
): T | undefined {
  return stmt.get(...params) as T | undefined;
}
// [20260726_TechDebt_TypedRows] END

class DatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string | null = null;
  private logger: Logger | null;
  private safeStorage: SafeStorage | null = null;
  private _encryptedKeys: Set<string>;
  private _fileConfigPath: string | null = null;
  private _fileConfigCache: Record<string, unknown> | null = null;

  constructor(logger: Logger | null = null) {
    this.db = null;
    this.dbPath = null;
    this.logger = logger;
    this.safeStorage = null;
    this._encryptedKeys = new Set(["ai_api_key"]);
    this._fileConfigPath = null;
    this._fileConfigCache = null;
  }

  setSafeStorage(safeStorage: SafeStorage): void {
    this.safeStorage = safeStorage;
    this._migrateSettings();
  }

  setFileConfigPath(configPath: string): void {
    this._fileConfigPath = configPath;
    this._fileConfigCache = loadFileConfig(configPath);
  }

  // [20260725_Fix_EncryptionFailure] Catch encryptString exceptions and fall
  // back to plaintext. When OS keyring is locked or unavailable, encryptString
  // throws — without this catch, setSetting propagates the error and the
  // setting value is lost entirely. Falling back to plaintext ensures the
  // value persists and can be retrieved (just not encrypted).
  private _encryptValue(value: Primitive): string {
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) {
      return JSON.stringify(value);
    }
    if (typeof value === "string") {
      try {
        const encrypted = this.safeStorage.encryptString(value);
        return JSON.stringify({ _enc: encrypted.toString("base64") });
      } catch {
        // Encryption failed (e.g. keyring locked) — store as plaintext
        return JSON.stringify(value);
      }
    }
    return JSON.stringify(value);
  }
  // [20260725_Fix_EncryptionFailure] END

  private _decryptValue(raw: string | null): unknown {
    if (raw == null) return raw;
    try {
      const parsed = JSON.parse(raw) as { _enc?: string } | unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { _enc?: string })._enc
      ) {
        if (!this.safeStorage) return null;
        return this.safeStorage.decryptString(
          Buffer.from((parsed as { _enc: string })._enc, "base64"),
        );
      }
      return parsed;
    } catch {
      return raw;
    }
  }

  initialize(dataDirectory: string): void {
    // Allow test isolation via env var (e.g. MURMUR_DB_PATH=:memory: or /tmp/test.db)
    this.dbPath =
      process.env.MURMUR_DB_PATH ||
      path.join(dataDirectory, "transcriptions.db");

    // In-memory databases don't need directories
    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    try {
      this.db = new Database(this.dbPath);
    } catch (error) {
      if ((error as Error).message?.includes("NODE_MODULE_VERSION")) {
        throw new Error(
          `SQLite 原生模块版本不匹配。请运行 'npx electron-rebuild' 后重试。\n原始错误: ${(error as Error).message}`,
        );
      }
      throw error;
    }
    this.db!.pragma("journal_mode = WAL");
    this.db!.pragma("busy_timeout = 5000");

    const integrity = this.db!.pragma("integrity_check") as Array<{
      integrity_check: string;
    }>;
    if (integrity[0]?.integrity_check !== "ok") {
      if (this.logger?.warn) {
        this.logger.warn("Database integrity check failed", integrity);
      }
    }

    this.createTables();
    this._migrateSchema();
  }

  createTables(): void {
    // 创建转录记录表
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS transcriptions (
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

    // 创建设置表
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建索引
    this.db!.exec(`
      CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
      ON transcriptions(created_at DESC)
    `);

    // [20260815_Refactor_DeadIpc] The FTS5 virtual table + sync triggers were
    // removed with the dead server-side search pipeline: the renderer never
    // called searchTranscriptions (the history page filters client-side).
  }

  private _migrateSchema(): void {
    const columns = (
      this.db!.prepare("PRAGMA table_info(transcriptions)").all() as Array<{
        name: string;
      }>
    ).map((col) => col.name);

    const migrations = [
      {
        column: "source_type",
        sql: "ALTER TABLE transcriptions ADD COLUMN source_type TEXT DEFAULT 'recording'",
      },
      {
        column: "source_file_path",
        sql: "ALTER TABLE transcriptions ADD COLUMN source_file_path TEXT",
      },
      {
        column: "segments",
        sql: "ALTER TABLE transcriptions ADD COLUMN segments TEXT",
      },
    ];

    for (const migration of migrations) {
      if (!columns.includes(migration.column)) {
        try {
          this.db!.exec(migration.sql);
        } catch (error) {
          if (this.logger && this.logger.warn) {
            this.logger.warn(`Schema迁移失败: ${migration.column}`, error);
          }
        }
      }
    }
  }

  private _migrateSettings(): void {
    const CURRENT_VERSION = 1;
    const version = this.getSetting("settings_schema_version", 0) as number;
    if (version >= CURRENT_VERSION) return;

    if (version < 1) {
      // v1: encrypt api_api_key if stored as plaintext
      const stmt = this.db!.prepare("SELECT value FROM settings WHERE key = ?");
      // [20260726_TechDebt_TypedRows] Using getRow helper instead of cast
      const row = getRow<{ value: string }>(stmt, "ai_api_key");
      if (row && this.safeStorage && this.safeStorage.isEncryptionAvailable()) {
        try {
          const parsed = JSON.parse(row.value);
          if (typeof parsed === "string" && !parsed.startsWith('{"_enc":')) {
            this.setSetting("ai_api_key", parsed);
          }
        } catch (e) {
          this.logger?.warn?.(
            "API key encryption migration failed",
            (e as Error).message,
          );
        }
      } else if (row) {
        // [20260820_Fix_211_KeychainBootOrder] setSafeStorage is now
        // injected unconditionally at boot (issue #211 ordering), so this
        // migration can run while encryption is unavailable. A plaintext
        // ai_api_key exists but cannot be encrypted yet — keep schema
        // version 0 so a later boot with working encryption retries the
        // migration; bumping here would permanently skip it.
        return;
      }
    }

    this.setSetting("settings_schema_version", CURRENT_VERSION);
  }

  saveTranscription(data: Partial<TranscriptionRecord>): Database.RunResult {
    if (!data || typeof data !== "object") {
      throw new Error("转录数据无效");
    }

    // 确保text字段存在且不为空
    const text = data.text || data.raw_text || "";
    if (!text || text.trim().length === 0) {
      throw new Error("转录文本不能为空");
    }

    const stmt = this.db!.prepare(`
      INSERT INTO transcriptions (
        text, raw_text, processed_text, confidence,
        language, duration, file_size, source_type,
        source_file_path, segments
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      text.trim(),
      data.raw_text || null,
      data.processed_text || null,
      data.confidence || 0,
      data.language || "zh-CN",
      data.duration || 0,
      data.file_size || 0,
      data.source_type || "recording",
      data.source_file_path || null,
      data.segments || null,
    );
  }

  getTranscriptions(limit = 50, offset = 0): TranscriptionRecord[] {
    const stmt = this.db!.prepare(`
      SELECT * FROM transcriptions
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset) as TranscriptionRecord[];
  }

  getTranscriptionById(id: number): TranscriptionRecord | undefined {
    const stmt = this.db!.prepare("SELECT * FROM transcriptions WHERE id = ?");
    return stmt.get(id) as TranscriptionRecord | undefined;
  }

  // [20260815_Refactor_DeadIpc] getTranscriptionWithSegments removed — the
  // live path (transcriptionHandlers) reads via getTranscriptionById and
  // parses the segments JSON itself. searchTranscriptions/_searchLike and
  // backup were removed the same day (zero production callers).

  deleteTranscription(id: number): Database.RunResult {
    const stmt = this.db!.prepare("DELETE FROM transcriptions WHERE id = ?");
    return stmt.run(id);
  }

  clearAllTranscriptions(): Database.RunResult {
    const stmt = this.db!.prepare("DELETE FROM transcriptions");
    return stmt.run();
  }

  // [20260816_Refactor_DeadChannels] getTranscriptionStats removed with the
  // zero-caller TRANSCRIPTION.STATS channel (the history page counts its
  // client-side filtered list).

  setSetting(key: string, value: unknown): Database.RunResult {
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    const serialized = this._encryptedKeys.has(key)
      ? this._encryptValue(value as Primitive)
      : JSON.stringify(value);
    return stmt.run(key, serialized);
  }

  getSetting(key: string, defaultValue: unknown = null): unknown {
    const stmt = this.db!.prepare("SELECT value FROM settings WHERE key = ?");
    // [20260726_TechDebt_TypedRows] Using getRow helper instead of cast
    const result = getRow<{ value: string }>(stmt, key);

    if (result) {
      if (this._encryptedKeys.has(key)) {
        const decrypted = this._decryptValue(result.value);
        return decrypted !== null ? decrypted : defaultValue;
      }
      try {
        return JSON.parse(result.value);
      } catch (_error) {
        return result.value;
      }
    }

    if (this._fileConfigCache && key in this._fileConfigCache) {
      return this._fileConfigCache[key];
    }

    return defaultValue;
  }

  getAllSettings(): Record<string, unknown> {
    const stmt = this.db!.prepare("SELECT key, value FROM settings");
    const rows = stmt.all() as Array<{ key: string; value: string }>;

    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      if (this._encryptedKeys.has(row.key)) {
        const decrypted = this._decryptValue(row.value);
        if (decrypted !== null) {
          settings[row.key] = decrypted;
        }
      } else {
        try {
          settings[row.key] = JSON.parse(row.value);
        } catch (_error) {
          settings[row.key] = row.value;
        }
      }
    }

    return settings;
  }

  resetSettings(): Database.RunResult {
    const stmt = this.db!.prepare("DELETE FROM settings");
    return stmt.run();
  }

  syncToFileConfig(): void {
    if (!this._fileConfigPath) return;
    const allSettings = this.getAllSettings();
    const filtered: Record<string, unknown> = {};
    for (const key of FILE_CONFIGURABLE_KEYS) {
      if (key in allSettings) filtered[key] = allSettings[key];
    }
    saveFileConfig(this._fileConfigPath, filtered);
    this._fileConfigCache = loadFileConfig(this._fileConfigPath);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export default DatabaseManager;
