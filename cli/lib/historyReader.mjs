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

// [20260912_Feat_270_McpFullTools] Ticket #270: single-row read + the
// not-found wording mirror. The MCP server (src/helpers/mcp/mcpServer.ts,
// bundled by build:mcp) imports BOTH from here so the CLI's read model stays
// the single source for local history reads:
//   - getTranscriptionById mirrors the app's DatabaseManager
//     .getTranscriptionById (database.ts: SELECT * WHERE id = ?) with the
//     same readonly open discipline as listTranscriptions above.
//   - TRANSCRIPTION_NOT_FOUND_MESSAGE mirrors historyService's TS constant
//     of the same name (importing the TS file here is impossible — cli/ is
//     plain ESM with zero deps — so the value is mirrored and the parity is
//     locked by a test in tests/unit/mcpServer.test.ts).
export const TRANSCRIPTION_NOT_FOUND_MESSAGE = "转录记录不存在";

/**
 * Read ONE transcription record by id (mirrors the app's
 * getTranscriptionById columns via SELECT *), newest-independent.
 * Returns the row object, or undefined when the id matches nothing.
 *
 * Throws when the database cannot be opened — same contract as
 * listTranscriptions (the caller decides how to surface it).
 *
 * @param {string} dbPath Path to the app's transcriptions.db.
 * @param {number} id Transcription record id.
 * @returns {object | undefined} The full row, or undefined when absent.
 */
export function getTranscriptionById(dbPath, id) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const stmt = db.prepare("SELECT * FROM transcriptions WHERE id = ?");
    return stmt.get(id);
  } finally {
    db.close();
  }
}
// [20260912_Feat_270_McpFullTools] END

/**
 * List transcription records, newest first (same ORDER BY as
 * getTranscriptions). `query` does a literal substring match over text and
 * processed_text; `limit` must be a positive integer.
 *
 * Throws when the database cannot be opened or queried — the CLI maps that
 * to exit code 1 (runtime error).
 *
 * @param {string} dbPath Path to the app's transcriptions.db.
 * @param {object} [options]
 * @param {string | null} [options.query] Literal substring filter over text
 *   and processed_text (null disables the filter).
 * @param {number} [options.limit] Positive integer page size
 *   (default DEFAULT_HISTORY_LIMIT).
 * @returns {Array<object>} Rows newest-first.
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
