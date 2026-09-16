// [20260906_Test_DbStorageErrors] Spec #266 T17 (#294): storage-exhaustion
// regressions for the node:sqlite layer. Murmur deliberately does NOT retry
// on storage errors — busy_timeout (5s) IS the retry, and SQLITE_FULL must
// propagate so callers can surface a clear failure. These tests pin that
// propagation (a regression that swallows or hangs on these errors fails
// here). Design source: deep-test-design-error-paths.md §1.8, adapted to the
// node:sqlite engine (spec #226).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import type { DatabaseSync } from "node:sqlite";
import DatabaseManager from "../../src/helpers/database";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

/** An sqlite-flavoured error (node:sqlite throws Error with code attached). */
function sqliteError(message: string, code: string): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

describe("[20260906_Test_DbStorageErrors] storage exhaustion propagation", () => {
  let db: DatabaseManager;
  let tmpDir: string;
  let realDb: DatabaseSyncAccess;

  type DatabaseSyncAccess = { db: DatabaseSync | null };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-db-storage-"));
    db = new DatabaseManager(
      null as unknown as ConstructorParameters<typeof DatabaseManager>[0],
    );
    db.initialize(tmpDir);
    realDb = db as unknown as DatabaseSyncAccess;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Force `prepare` to hand back a poisoned statement for matching SQL. */
  function poisonInsert(match: string, error: Error): void {
    const database = realDb.db!;
    const originalPrepare = database.prepare.bind(database);
    database.prepare = ((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes(match)) {
        return {
          ...stmt,
          run: vi.fn(() => {
            throw error;
          }),
        };
      }
      return stmt;
    }) as unknown as DatabaseSync["prepare"];
  }

  it("saveTranscription propagates SQLITE_BUSY after the busy timeout", () => {
    poisonInsert(
      "INSERT INTO transcriptions",
      sqliteError("database is locked", "SQLITE_BUSY"),
    );

    // No retry loop: the 5s busy timeout IS the retry — the throw surfaces.
    expect(() => db.saveTranscription({ text: "busy path" })).toThrow(
      "database is locked",
    );
  });

  it("saveTranscription propagates SQLITE_FULL (disk full)", () => {
    poisonInsert(
      "INSERT INTO transcriptions",
      sqliteError("database or disk is full", "SQLITE_FULL"),
    );

    expect(() => db.saveTranscription({ text: "disk full path" })).toThrow(
      "database or disk is full",
    );
  });

  it("setSetting propagates storage errors instead of dropping the value silently", () => {
    poisonInsert(
      "INTO settings",
      sqliteError("database or disk is full", "SQLITE_FULL"),
    );

    expect(() => db.setSetting("theme", "dark")).toThrow(
      "database or disk is full",
    );
  });
});
