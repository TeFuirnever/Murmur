// [20260912_Feat_CliSkeleton] `murmur history list` tests (ticket #264).
// History reads go DIRECT to the app's SQLite file via node:sqlite with a
// readOnly open, so every test builds a temp transcriptions.db mirroring the
// real app schema (src/helpers/database.ts createTables + _migrateSchema,
// post-migration shape). Locked here: newest-first ordering, the exact
// --json record schema, --query literal substring matching (LIKE wildcards
// escaped), --limit validation, default limit 50 (app parity), and the
// readonly-open guarantee (a missing DB is an error, never created).
// All function-level via runCli — no process spawn, no Electron.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runCli } from "../../cli/lib/cliRunner.mjs";

/** One seed row; unspecified columns use the app's defaults. */
interface SeedRow {
  text: string;
  processed_text?: string | null;
  language?: string;
  duration?: number;
  source_type?: string;
  created_at: string;
}

/**
 * Create a transcriptions DB with the app's post-migration schema
 * (database.ts createTables + the source_type/source_file_path/segments/
 * manually_edited ALTERs) and insert the given rows in order.
 */
function createAppDb(
  dbPath: string,
  rows: SeedRow[],
  options?: { wal?: boolean },
): void {
  const db = new DatabaseSync(dbPath);
  try {
    // The app sets WAL in initialize(); exercised by a dedicated test below.
    if (options?.wal) db.exec("PRAGMA journal_mode = WAL");
    db.exec(`
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        source_type TEXT DEFAULT 'recording',
        source_file_path TEXT,
        segments TEXT,
        manually_edited INTEGER DEFAULT 0
      )
    `);
    const insert = db.prepare(`
      INSERT INTO transcriptions
        (text, processed_text, language, duration, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        row.text,
        row.processed_text ?? null,
        row.language ?? "zh-CN",
        row.duration ?? 0,
        row.source_type ?? "recording",
        row.created_at,
      );
    }
  } finally {
    db.close();
  }
}

describe("cli history list", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cli-history-"));
    dbPath = path.join(dir, "transcriptions.db");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists records newest-first in text mode with #id/created/preview lines", () => {
    createAppDb(dbPath, [
      { text: "first note", created_at: "2026-09-12 10:00:01" },
      { text: "second note", created_at: "2026-09-12 10:00:02" },
      { text: "third note", created_at: "2026-09-12 10:00:03" },
    ]);
    const result = runCli(["history", "list"], { dbPath });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "#3\t2026-09-12 10:00:03\tthird note",
        "#2\t2026-09-12 10:00:02\tsecond note",
        "#1\t2026-09-12 10:00:01\tfirst note",
      ].join("\n") + "\n",
    );
  });

  it("--json emits the exact stable records schema", () => {
    createAppDb(dbPath, [
      {
        text: "raw speech",
        processed_text: "polished speech",
        language: "zh-CN",
        duration: 3.5,
        source_type: "file",
        created_at: "2026-09-12 10:00:01",
      },
      { text: "second", created_at: "2026-09-12 10:00:02" },
    ]);
    const result = runCli(["history", "list", "--json"], { dbPath });
    expect(result.code).toBe(0);
    // toEqual locks the schema exactly: no extra/missing fields allowed.
    expect(JSON.parse(result.stdout)).toEqual({
      records: [
        {
          id: 2,
          text: "second",
          processed_text: null,
          language: "zh-CN",
          duration: 0,
          source_type: "recording",
          created_at: "2026-09-12 10:00:02",
        },
        {
          id: 1,
          text: "raw speech",
          processed_text: "polished speech",
          language: "zh-CN",
          duration: 3.5,
          source_type: "file",
          created_at: "2026-09-12 10:00:01",
        },
      ],
    });
  });

  it("text mode flattens newlines and truncates long text to a preview", () => {
    const longText = `${"word ".repeat(40)}\nsecond line`;
    createAppDb(dbPath, [
      { text: longText, created_at: "2026-09-12 10:00:01" },
    ]);
    const result = runCli(["history", "list"], { dbPath });
    expect(result.code).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines).toHaveLength(2); // the record line + trailing newline
    const preview = lines[0];
    expect(preview).toMatch(/^#1\t2026-09-12 10:00:01\t/);
    expect(preview).toContain("…");
    expect(preview).not.toContain("\nsecond line");
  });

  // [20260912_Fix_264_WindowsHostTests] 55 inserts + first SQLite open on a
  // cold Windows CI runner can exceed the 5s default (precedent: #341).
  it("defaults to the app's limit of 50 records", { timeout: 15000 }, () => {
    const rows: SeedRow[] = Array.from({ length: 55 }, (_, i) => ({
      text: `note ${i}`,
      created_at: `2026-09-12 10:00:${String(i).padStart(2, "0")}`,
    }));
    createAppDb(dbPath, rows);
    const result = runCli(["history", "list", "--json"], { dbPath });
    const records = JSON.parse(result.stdout).records as Array<{
      text: string;
    }>;
    expect(records).toHaveLength(50);
    // Newest first: note 54 is the newest, note 5 the oldest kept.
    expect(records[0]?.text).toBe("note 54");
    expect(records[49]?.text).toBe("note 5");
  });

  it("--limit N truncates the result", () => {
    const rows: SeedRow[] = Array.from({ length: 10 }, (_, i) => ({
      text: `note ${i}`,
      created_at: `2026-09-12 10:00:${String(i).padStart(2, "0")}`,
    }));
    createAppDb(dbPath, rows);
    const result = runCli(["history", "list", "--json", "--limit", "3"], {
      dbPath,
    });
    const records = JSON.parse(result.stdout).records as Array<{
      text: string;
    }>;
    expect(records).toHaveLength(3);
    expect(records.map((record) => record.text)).toEqual([
      "note 9",
      "note 8",
      "note 7",
    ]);
  });

  it("--query filters by substring over text AND processed_text", () => {
    createAppDb(dbPath, [
      { text: "meeting minutes topic", created_at: "2026-09-12 10:00:01" },
      {
        text: "raw chatter",
        processed_text: "polished budget talk",
        created_at: "2026-09-12 10:00:02",
      },
      { text: "unrelated", created_at: "2026-09-12 10:00:03" },
    ]);
    const textHit = runCli(
      ["history", "list", "--json", "--query", "meeting"],
      { dbPath },
    );
    expect(
      (JSON.parse(textHit.stdout).records as Array<{ id: number }>).map(
        (record) => record.id,
      ),
    ).toEqual([1]);

    const processedHit = runCli(
      ["history", "list", "--json", "--query", "budget"],
      { dbPath },
    );
    expect(
      (JSON.parse(processedHit.stdout).records as Array<{ id: number }>).map(
        (record) => record.id,
      ),
    ).toEqual([2]);
  });

  it("--query treats LIKE wildcards literally (%, _ escaped)", () => {
    createAppDb(dbPath, [
      { text: "price is 50% off", created_at: "2026-09-12 10:00:01" },
      { text: "column_a_value", created_at: "2026-09-12 10:00:02" },
      { text: "plain note", created_at: "2026-09-12 10:00:03" },
    ]);
    // Unescaped, "%" and "_" are LIKE wildcards and would match everything.
    const percent = runCli(["history", "list", "--json", "--query", "%"], {
      dbPath,
    });
    expect(
      (JSON.parse(percent.stdout).records as Array<{ id: number }>).map(
        (record) => record.id,
      ),
    ).toEqual([1]);

    const underscore = runCli(["history", "list", "--json", "--query", "_"], {
      dbPath,
    });
    expect(
      (JSON.parse(underscore.stdout).records as Array<{ id: number }>).map(
        (record) => record.id,
      ),
    ).toEqual([2]);
  });

  it("--query with no matches returns empty output (exit 0, never an error)", () => {
    createAppDb(dbPath, [
      { text: "something", created_at: "2026-09-12 10:00:01" },
    ]);
    const jsonResult = runCli(["history", "list", "--json", "--query", "zzz"], {
      dbPath,
    });
    expect(jsonResult.code).toBe(0);
    expect(JSON.parse(jsonResult.stdout)).toEqual({ records: [] });

    const textResult = runCli(["history", "list", "--query", "zzz"], {
      dbPath,
    });
    expect(textResult.code).toBe(0);
    expect(textResult.stdout).toBe("");
  });

  it("combines --query with --limit", () => {
    const rows: SeedRow[] = Array.from({ length: 5 }, (_, i) => ({
      text: `kv heartbeat ${i}`,
      created_at: `2026-09-12 10:00:${String(i).padStart(2, "0")}`,
    }));
    createAppDb(dbPath, rows);
    const result = runCli(
      ["history", "list", "--json", "--query", "heartbeat", "--limit", "2"],
      { dbPath },
    );
    const records = JSON.parse(result.stdout).records as Array<{
      text: string;
    }>;
    expect(records).toHaveLength(2);
    expect(records[0]?.text).toBe("kv heartbeat 4");
  });

  it("rejects invalid --limit values as usage errors (exit 2)", () => {
    createAppDb(dbPath, [{ text: "x", created_at: "2026-09-12 10:00:00" }]);
    for (const bad of ["0", "-1", "abc", "1.5"]) {
      const result = runCli(["history", "list", "--limit", bad], { dbPath });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("--limit");
    }
  });

  it("rejects extra positional arguments (exit 2)", () => {
    const result = runCli(["history", "list", "extra"], { dbPath });
    expect(result.code).toBe(2);
  });

  it("missing database: runtime error (exit 1) and the file is never created", () => {
    const missingPath = path.join(dir, "does-not-exist.db");
    const result = runCli(["history", "list"], { dbPath: missingPath });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(missingPath);
    // readOnly open must not materialise an empty DB as a side effect.
    expect(fs.existsSync(missingPath)).toBe(false);
  });

  it("reads a WAL-mode database (the app runs with journal_mode=WAL)", () => {
    createAppDb(
      dbPath,
      [{ text: "wal row", created_at: "2026-09-12 10:00:01" }],
      { wal: true },
    );
    const result = runCli(["history", "list", "--json"], { dbPath });
    expect(result.code).toBe(0);
    expect(
      (JSON.parse(result.stdout).records as Array<{ text: string }>).map(
        (record) => record.text,
      ),
    ).toEqual(["wal row"]);
  });

  it("resolves the DB from ELECTRON_USER_DATA when no explicit path is given", () => {
    createAppDb(path.join(dir, "transcriptions.db"), [
      { text: "via env", created_at: "2026-09-12 10:00:01" },
    ]);
    const result = runCli(["history", "list", "--json"], {
      env: { ELECTRON_USER_DATA: dir },
      platform: "darwin",
      homedir: () => "/home/tester",
    });
    expect(result.code).toBe(0);
    expect(
      (JSON.parse(result.stdout).records as Array<{ text: string }>).map(
        (record) => record.text,
      ),
    ).toEqual(["via env"]);
  });

  it("resolves the DB from the MURMUR_DB_PATH override (app env parity)", () => {
    createAppDb(dbPath, [
      { text: "override", created_at: "2026-09-12 10:00:01" },
    ]);
    const result = runCli(["history", "list", "--json"], {
      env: { MURMUR_DB_PATH: dbPath },
      platform: "darwin",
      homedir: () => "/home/tester",
    });
    expect(result.code).toBe(0);
    expect(
      (JSON.parse(result.stdout).records as Array<{ text: string }>).map(
        (record) => record.text,
      ),
    ).toEqual(["override"]);
  });
});
