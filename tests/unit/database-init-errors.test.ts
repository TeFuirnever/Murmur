// [20260816_Test_BranchPush] Branch tests for DatabaseManager.initialize error
// and pragma paths that the real better-sqlite3 driver cannot produce
// deterministically: the NODE_MODULE_VERSION ABI-mismatch wrap, the generic
// rethrow, a failed integrity_check, and schema-migration exec failures
// (with and without a logger attached). better-sqlite3 is replaced by a
// configurable fake driven by module-level knobs read at call time.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

// Knobs read inside the fake's methods (NOT at vi.mock factory time, so the
// hoisted factory never touches these before initialization).
let ctorBehavior: "ok" | "node-module-version" | "generic-error" = "ok";
let integrityStatus = "ok";
let alterFails = false;

vi.mock("better-sqlite3", () => ({
  default: class FakeSqlite {
    constructor() {
      if (ctorBehavior === "node-module-version") {
        throw new Error(
          "was compiled against a different Node.js version using NODE_MODULE_VERSION 115. This version requires 108.",
        );
      }
      if (ctorBehavior === "generic-error") {
        throw new Error("SQLITE_CANTOPEN");
      }
    }

    close = vi.fn();
    pragma(name: string): unknown {
      if (name === "integrity_check") {
        return [{ integrity_check: integrityStatus }];
      }
      return null;
    }
    exec(sql: string): void {
      if (alterFails && sql.includes("ALTER TABLE")) {
        throw new Error("duplicate column name: source_type");
      }
    }
    prepare() {
      // _migrateSchema's PRAGMA table_info(...).all() reports no columns, so
      // the ALTER statements always "need" to run.
      return {
        run: () => ({ lastInsertRowid: 1, changes: 1 }),
        all: () => [],
        get: () => undefined,
      };
    }
  },
}));

// Import AFTER the mock is registered.
import DatabaseManager from "../../src/helpers/database";

const SET_DATA_DIR = path.join(os.tmpdir(), "murmur-db-init-");

describe("[20260816_Test_BranchPush] DatabaseManager.initialize error paths", () => {
  let tmpDir: string;
  let logger: {
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let db: InstanceType<typeof DatabaseManager>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(SET_DATA_DIR);
    ctorBehavior = "ok";
    integrityStatus = "ok";
    alterFails = false;
    logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    db = new DatabaseManager(
      logger as unknown as ConstructorParameters<typeof DatabaseManager>[0],
    );
  });

  afterEach(() => {
    // The fake driver has no real handles; nothing to close when initialize
    // threw. Only attempt close when construction succeeded.
    try {
      db.close();
    } catch {
      /* db handle never opened */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rewrites a NODE_MODULE_VERSION constructor failure", () => {
    ctorBehavior = "node-module-version";
    expect(() => db.initialize(tmpDir)).toThrow(
      /SQLite 原生模块版本不匹配[\s\S]*NODE_MODULE_VERSION/,
    );
    expect(() => db.initialize(tmpDir)).toThrow(/electron-rebuild/);
  });

  it("rethrows a generic constructor failure unchanged", () => {
    ctorBehavior = "generic-error";
    expect(() => db.initialize(tmpDir)).toThrow("SQLITE_CANTOPEN");
  });

  it("logs a warning when integrity_check does not report ok", () => {
    integrityStatus = "corrupt";
    db.initialize(tmpDir);
    expect(logger.warn).toHaveBeenCalledWith(
      "Database integrity check failed",
      [{ integrity_check: "corrupt" }],
    );
  });

  it("logs a schema-migration warning when the ALTER fails", () => {
    alterFails = true;
    db.initialize(tmpDir);
    // All three migration columns warn; assert on the first.
    expect(logger.warn).toHaveBeenCalledWith(
      "Schema迁移失败: source_type",
      expect.any(Error),
    );
  });

  it("swallows schema-migration failures silently without a logger", () => {
    alterFails = true;
    const silent = new DatabaseManager(null);
    expect(() => silent.initialize(tmpDir)).not.toThrow();
    silent.close();
  });
});
