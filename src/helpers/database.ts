// [20260724_TS_Migration_Database] Type wrapper (ADR-010 Phase 4).
// Implementation (471 lines, better-sqlite3) stays in .js for runtime.

/** A transcription record as stored in SQLite. */
interface TranscriptionRecord {
  id?: number;
  text: string;
  raw_text?: string;
  processed_text?: string;
  confidence?: number;
  duration?: number;
  audio_format?: string;
  created_at: string;
  updated_at?: string;
  tags?: string;
}

/** Search options for transcription queries. */
interface SearchOptions {
  query?: string;
  limit?: number;
  offset?: number;
}

/** SafeStorage interface for encryption. */
interface SafeStorage {
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
  isEncryptionAvailable(): boolean;
}

const DatabaseManager = require("./database.js") as {
  new (): {
    initialize: (dbDir?: string) => void;
    setSafeStorage: (storage: SafeStorage) => void;
    saveTranscription: (record: Partial<TranscriptionRecord>) => number;
    getTranscription: (id: number) => TranscriptionRecord | null;
    getTranscriptions: (limit: number, offset: number) => TranscriptionRecord[];
    searchTranscriptions: (opts: SearchOptions) => TranscriptionRecord[];
    deleteTranscription: (id: number) => boolean;
    clearAllTranscriptions: () => void;
    getStats: () => Record<string, unknown>;
    encryptValue: (key: string, value: unknown) => unknown;
    decryptValue: (key: string, value: unknown) => unknown;
    close: () => void;
  };
};

export default DatabaseManager;
