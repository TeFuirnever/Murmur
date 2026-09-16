// [20260816_Test_BranchPush] Branch tests for DatabaseManager.initialize
// error paths that the real driver cannot produce deterministically: the
// generic constructor rethrow, a failed integrity_check, and schema-migration
// exec failures (with and without a logger attached).
// [20260905_Feat_NodeSqlite] Migrated with the engine swap (spec #226): the
// fake now replaces node:sqlite's DatabaseSync. The NODE_MODULE_VERSION
// rewrite case was deleted — that branch existed only for the better-sqlite3
// native addon and is gone with it; node:sqlite ships inside the runtime, so
// the ABI-mismatch failure mode no longer exists.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

// Knobs read inside the fake's methods (NOT at vi.mock factory time, so the
// hoisted factory never touches these before initialization).
let ctorBehavior: "ok" | "generic-error" = "ok";
let integrityStatus = "ok";
let alterFails = false;

vi.mock("node:sqlite", () => ({
  DatabaseSync: class FakeSqlite {
    constructor() {
      if (ctorBehavior === "generic-error") {
        throw new Error("SQLITE_CANTOPEN");
      }
    }

    close = vi.fn();
    exec(sql: string): void {
      if (alterFails && sql.includes("ALTER TABLE")) {
        throw new Error("duplicate column name: source_type");
      }
    }
    prepare(sql: string) {
      if (sql.includes("integrity_check")) {
        return {
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
          all: () => [{ integrity_check: integrityStatus }],
          get: () => undefined,
        };
      }
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
