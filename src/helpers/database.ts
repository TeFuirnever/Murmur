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

  private _encryptValue(value: Primitive): string {
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) {
      return JSON.stringify(value);
    }
    if (typeof value === "string") {
      const encrypted = this.safeStorage.encryptString(value);
      return JSON.stringify({ _enc: encrypted.toString("base64") });
    }
    return JSON.stringify(value);
  }

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

    this._createFtsIndex();
  }

  private _createFtsIndex(): void {
    try {
      this.db!.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS transcriptions_fts
        USING fts5(text, raw_text, processed_text, content=transcriptions, content_rowid=id, tokenize="trigram")
      `);

      this.db!.exec(`
        CREATE TRIGGER IF NOT EXISTS transcriptions_ai AFTER INSERT ON transcriptions BEGIN
          INSERT INTO transcriptions_fts(rowid, text, raw_text, processed_text)
          VALUES (new.id, new.text, new.raw_text, new.processed_text);
        END
      `);

      this.db!.exec(`
        CREATE TRIGGER IF NOT EXISTS transcriptions_ad AFTER DELETE ON transcriptions BEGIN
          INSERT INTO transcriptions_fts(transcriptions_fts, rowid, text, raw_text, processed_text)
          VALUES ('delete', old.id, old.text, old.raw_text, old.processed_text);
        END
      `);

      this.db!.exec(`
        CREATE TRIGGER IF NOT EXISTS transcriptions_au AFTER UPDATE ON transcriptions BEGIN
          INSERT INTO transcriptions_fts(transcriptions_fts, rowid, text, raw_text, processed_text)
          VALUES ('delete', old.id, old.text, old.raw_text, old.processed_text);
          INSERT INTO transcriptions_fts(rowid, text, raw_text, processed_text)
          VALUES (new.id, new.text, new.raw_text, new.processed_text);
        END
      `);

      // Rebuild only if FTS index is empty (first creation after migration)
      const ftsCount = this.db!.prepare(
        "SELECT count(*) AS cnt FROM transcriptions_fts",
      ).get() as { cnt: number };
      if (ftsCount.cnt === 0) {
        const baseCount = this.db!.prepare(
          "SELECT count(*) AS cnt FROM transcriptions",
        ).get() as { cnt: number };
        if (baseCount.cnt > 0) {
          this.db!.exec(
            "INSERT INTO transcriptions_fts(transcriptions_fts) VALUES ('rebuild')",
          );
        }
      }
    } catch (_e) {
      // FTS5 not available — searchTranscriptions will use LIKE fallback
    }
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
      const row = stmt.get("ai_api_key") as { value: string } | undefined;
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

  getTranscriptionWithSegments(
    id: number,
  ): TranscriptionRecord | null | undefined {
    try {
      const row = this.db!.prepare(
        "SELECT * FROM transcriptions WHERE id = ?",
      ).get(id) as TranscriptionRecord | undefined;
      if (row && row.segments) {
        try {
          row.parsedSegments = JSON.parse(row.segments);
        } catch (e) {
          this.logger?.warn &&
            this.logger.warn("segments JSON解析失败", {
              id,
              error: (e as Error).message,
            });
          row.parsedSegments = [];
        }
      } else if (row) {
        row.parsedSegments = [];
      }
      // [20260724_TS_BigBang_DbFix] Preserve original .js behavior: return
      // `row` directly (undefined when not found), NOT `row || null`. Two
      // database-coverage tests assert .toBeUndefined() for missing ids.
      return row;
    } catch (error) {
      this.logger?.error && this.logger.error("获取转录详情失败", error);
      return null;
    }
  }

  deleteTranscription(id: number): Database.RunResult {
    const stmt = this.db!.prepare("DELETE FROM transcriptions WHERE id = ?");
    return stmt.run(id);
  }

  clearAllTranscriptions(): Database.RunResult {
    const stmt = this.db!.prepare("DELETE FROM transcriptions");
    return stmt.run();
  }

  searchTranscriptions(query: string, limit = 50): TranscriptionRecord[] {
    // Short queries (< 3 chars) use LIKE — trigram tokenizer needs 3+ chars
    if (query.length < 3) {
      return this._searchLike(query, limit);
    }

    try {
      const safeQuery = '"' + query.replace(/"/g, '""') + '"';
      const stmt = this.db!.prepare(`
        SELECT t.* FROM transcriptions t
        JOIN transcriptions_fts f ON t.id = f.rowid
        WHERE transcriptions_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      return stmt.all(safeQuery, limit) as TranscriptionRecord[];
    } catch (_e) {
      return this._searchLike(query, limit);
    }
  }

  private _searchLike(query: string, limit: number): TranscriptionRecord[] {
    const stmt = this.db!.prepare(`
      SELECT * FROM transcriptions
      WHERE text LIKE ? ESCAPE '\\' OR raw_text LIKE ? ESCAPE '\\' OR processed_text LIKE ? ESCAPE '\\'
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const escaped = query
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    const searchTerm = `%${escaped}%`;
    return stmt.all(
      searchTerm,
      searchTerm,
      searchTerm,
      limit,
    ) as TranscriptionRecord[];
  }

  getTranscriptionStats(): { total: number; today: number; week: number } {
    const totalStmt = this.db!.prepare(
      "SELECT COUNT(*) as total FROM transcriptions",
    );
    const todayStmt = this.db!.prepare(`
      SELECT COUNT(*) as today FROM transcriptions
      WHERE date(created_at) = date('now')
    `);
    const weekStmt = this.db!.prepare(`
      SELECT COUNT(*) as week FROM transcriptions
      WHERE created_at >= date('now', '-7 days')
    `);

    return {
      total: (totalStmt.get() as { total: number }).total,
      today: (todayStmt.get() as { today: number }).today,
      week: (weekStmt.get() as { week: number }).week,
    };
  }

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
    const result = stmt.get(key) as { value: string } | undefined;

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

  backup(backupPath: string): boolean {
    if (!this.db) return false;

    try {
      const result = this.db.backup(backupPath);
      result?.catch?.((error: Error) => {
        if (this.logger && this.logger.error) {
          this.logger.error("数据库备份失败:", error);
        }
      });
      return true;
    } catch (error) {
      if (this.logger && this.logger.error) {
        this.logger.error("数据库备份失败:", error);
      }
      return false;
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export default DatabaseManager;
