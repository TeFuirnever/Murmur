// [20260912_Feat_CliSkeleton] Read-only transcriptions reader for the murmur
// CLI (ticket #264). Opens the same SQLite file the app creates
// (src/helpers/database.ts, node:sqlite per spec #226) with
// `new DatabaseSync(path, { readOnly: true })`: SQLite read-only mode never
// takes the writer lock, so a running Murmur instance is never blocked, and
// a missing database fails the open instead of being created as a side
// effect. The column list mirrors the app's transcriptions schema
// (database.ts createTables + _migrateSchema).
import { DatabaseSync } from "node:sqlite";

/** Default page size — mirrors getTranscriptions(limit = 50) in database.ts. */
export const DEFAULT_HISTORY_LIMIT = 50;

const LIST_COLUMNS =
  "id, text, processed_text, language, duration, source_type, created_at";

/**
 * Escape LIKE wildcards so --query matches literally, for use with the
 * `ESCAPE '\'` clause in the statements below.
 */
function escapeLikePattern(text) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * List transcription records, newest first (same ORDER BY as
 * getTranscriptions). `query` does a literal substring match over text and
 * processed_text; `limit` must be a positive integer.
 *
 * Throws when the database cannot be opened or queried — the CLI maps that
 * to exit code 1 (runtime error).
 */
export function listTranscriptions(
  dbPath,
  { query = null, limit = DEFAULT_HISTORY_LIMIT } = {},
) {
  // [20260912_Feat_CliSkeleton] readOnly: true is the whole point of the
  // direct-read design (see file header). Open/close per invocation: a CLI
  // run is one-shot, there is nothing to pool.
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (query === null) {
      const stmt = db.prepare(
        `SELECT ${LIST_COLUMNS} FROM transcriptions ORDER BY created_at DESC LIMIT ?`,
      );
      return stmt.all(limit);
    }

    const pattern = `%${escapeLikePattern(query)}%`;
    const stmt = db.prepare(
      `SELECT ${LIST_COLUMNS} FROM transcriptions
       WHERE text LIKE ? ESCAPE '\\' OR processed_text LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`,
    );
    return stmt.all(pattern, pattern, limit);
  } finally {
    db.close();
  }
}
