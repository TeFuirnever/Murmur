// [20260906_Feat_TranscriptionUpdate] TDD tests for the manual-polish
// write-back channel (spec #193 T1, ticket #228): DatabaseManager
// .updateTranscription() persists polished text into an EXISTING
// transcription record (UPDATE processed_text AND text). The column
// whitelist is the security contract: only processed_text and text may be
// written; raw_text ALWAYS keeps the original ASR output, and any other
// key — including a SQL fragment disguised as a column name — must be
// rejected before it can reach the SQL string. Harness mirrors
// database-coverage.test.ts (in-memory DB via MURMUR_DB_PATH).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import DatabaseManager from "../../src/helpers/database";

// [20260906_Feat_TranscriptionUpdate] Minimal private-surface type for
// seeding raw SQL (same cast-through-unknown pattern as the coverage suite's
// dbp() helper) — used only to force a stale updated_at value.
interface RawDbSurface {
  db: {
    prepare: (sql: string) => {
      run: (...args: unknown[]) => unknown;
    };
  } | null;
}

function rawDb(d: InstanceType<typeof DatabaseManager>): RawDbSurface["db"] {
  return (d as unknown as RawDbSurface).db;
}

describe("DatabaseManager.updateTranscription", () => {
  let db: InstanceType<typeof DatabaseManager>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
    process.env.MURMUR_DB_PATH = ":memory:";
    db = new DatabaseManager();
    db.initialize(tmpDir);
    delete process.env.MURMUR_DB_PATH;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Seed one record the way the transcription seams do: text + raw_text
  // hold the (identical) ASR output; processed_text starts empty.
  function seedRow(): number {
    const r = db.saveTranscription({
      text: "原始文本",
      raw_text: "原始文本",
    });
    return Number(r.lastInsertRowid);
  }

  it("updates the whitelisted columns (processed_text, text)", () => {
    const id = seedRow();
    const result = db.updateTranscription(id, {
      processed_text: "润色后",
      text: "润色后",
    });
    expect(result.changes).toBe(1);
    const row = db.getTranscriptionById(id)!;
    expect(row.text).toBe("润色后");
    expect(row.processed_text).toBe("润色后");
  });

  it("never touches raw_text", () => {
    const id = seedRow();
    db.updateTranscription(id, { processed_text: "润色后", text: "润色后" });
    expect(db.getTranscriptionById(id)!.raw_text).toBe("原始文本");
  });

  it("updates only the provided columns", () => {
    const id = seedRow();
    db.updateTranscription(id, { processed_text: "仅润色列" });
    const row = db.getTranscriptionById(id)!;
    expect(row.processed_text).toBe("仅润色列");
    expect(row.text).toBe("原始文本");
  });

  it("rejects columns outside the whitelist (raw_text is immutable here)", () => {
    const id = seedRow();
    expect(() =>
      db.updateTranscription(id, { raw_text: "tampered" }),
    ).toThrow();
    // The rejected update must not have modified the row.
    expect(db.getTranscriptionById(id)!.raw_text).toBe("原始文本");
  });

  it("rejects a SQL injection payload used as a column name", () => {
    const id = seedRow();
    const injection = "text = 'x'; DROP TABLE transcriptions";
    expect(() => db.updateTranscription(id, { [injection]: "y" })).toThrow();
    // Table still exists and the row is intact.
    expect(db.getTranscriptionById(id)!.text).toBe("原始文本");
  });

  it("rejects an empty patch", () => {
    const id = seedRow();
    expect(() => db.updateTranscription(id, {})).toThrow();
  });

  it("rejects non-primitive values", () => {
    const id = seedRow();
    expect(() =>
      db.updateTranscription(id, { text: { nested: "object" } }),
    ).toThrow();
  });

  it("returns changes 0 for a non-existent id without throwing", () => {
    const result = db.updateTranscription(99999, { text: "ghost" });
    expect(result.changes).toBe(0);
  });

  it("refreshes updated_at on update", () => {
    const id = seedRow();
    const STALE_TIMESTAMP = "2000-01-01 00:00:00";
    rawDb(db)!
      .prepare("UPDATE transcriptions SET updated_at = ? WHERE id = ?")
      .run(STALE_TIMESTAMP, id);
    expect(db.getTranscriptionById(id)!.updated_at).toBe(STALE_TIMESTAMP);

    db.updateTranscription(id, { text: "润色后" });
    expect(db.getTranscriptionById(id)!.updated_at).not.toBe(STALE_TIMESTAMP);
  });
});
