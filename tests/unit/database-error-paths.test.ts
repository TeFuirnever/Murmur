// [20260725_TDD_DbErrorPaths] TDD tests for src/helpers/database.ts error
// paths. database.ts had the worst branch coverage in the project (67.18%).
// These tests target the previously-uncovered branches:
//   - getSetting decryption fallback path (line 458 -> : defaultValue)
//
// [20260815_Refactor_DeadIpc] The getTranscriptionWithSegments describe was
// removed with the zero-production-caller method.
//
// Setup mirrors the existing database.test.js / database-coverage.test.js
// pattern: temp dir, initialize, close + cleanup.
//
// [20260726_TypeGate_DbErrorPaths] Re-enabled in the tsconfig.test.json
// typecheck gate. The mock `logger` (vi.fn() returning Mock<Procedure>) is not
// structurally assignable to DatabaseManager's local `Logger` interface
// (its methods are `(...args: unknown[]) => void`). Cast at the constructor
// call via the source's own parameter type — `unknown` bridge, no `any`.
// Template reference: tests/unit/modelHandlers.test.ts (as unknown as ...).
// [20260726_TypeGate_DbErrorPaths] END
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import DatabaseManager from "../../src/helpers/database";

// Mock electron — database.ts itself does not import electron (only
// better-sqlite3 / fs / path / fileConfig), but this matches the documented
// test setup pattern and keeps the test hermetic against transitive deps.
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

/** A fake safeStorage whose encrypt/decrypt roundtrip via an "enc:" prefix. */
function makeSafeStorage(
  overrides: Record<string, unknown> = {} as Record<string, unknown>,
) {
  return {
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace("enc:", "")),
    isEncryptionAvailable: vi.fn(() => true),
    ...overrides,
  };
}

describe("DatabaseManager - error paths (TDD)", () => {
  let db: DatabaseManager;
  let tmpDir: string;
  let logger: {
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-db-err-"));
    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    // [20260726_TypeGate_DbErrorPaths] Cast the vi.fn()-based logger to the
    // DatabaseManager constructor's expected parameter type — Mock<Procedure>
    // is not structurally assignable to the source's local Logger interface.
    db = new DatabaseManager(
      logger as unknown as ConstructorParameters<typeof DatabaseManager>[0],
    );
    db.initialize(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------- getSetting ----------

  describe("getSetting", () => {
    it("5. returns defaultValue for non-existent key", () => {
      expect(db.getSetting("does-not-exist", "fallback")).toBe("fallback");
    });

    it("6. decrypts encrypted keys when safeStorage available", () => {
      const ss = makeSafeStorage();
      db.setSafeStorage(ss);

      db.setSetting("ai_api_key", "my-secret-key");

      // Encryption path taken for ai_api_key.
      expect(ss.encryptString).toHaveBeenCalledWith("my-secret-key");
      // Decryption path returns the plaintext.
      expect(db.getSetting("ai_api_key")).toBe("my-secret-key");
      expect(ss.decryptString).toHaveBeenCalled();
    });

    it("7. returns defaultValue when decryption fails (encrypted value undecryptable)", () => {
      // Line 458-459 fallback (`: defaultValue`) fires when `_decryptValue`
      // returns null. The only null-return in `_decryptValue` is the
      // `if (!this.safeStorage) return null` branch (line 95): an `_enc`-
      // shaped value exists but there is no safeStorage to decrypt it.
      // (If decryptString *throws*, the outer catch returns the raw string
      //  instead of null - a different, non-default path.)
      const encB64 = Buffer.from("enc:lost-key").toString("base64");
      const raw = JSON.stringify({ _enc: encB64 });
      (
        db as unknown as {
          db: { prepare: (sql: string) => { run: (...a: unknown[]) => void } };
        }
      ).db
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        )
        .run("ai_api_key", raw);

      // safeStorage NOT set -> _decryptValue returns null -> defaultValue.
      expect(db.getSetting("ai_api_key", "default-key")).toBe("default-key");
    });

    it("8. returns plaintext for non-encrypted keys", () => {
      db.setSetting("theme", "dark");
      expect(db.getSetting("theme")).toBe("dark");
    });
  });

  // ---------- getAllSettings ----------

  describe("getAllSettings", () => {
    it("9. decrypts encrypted keys", () => {
      const ss = makeSafeStorage();
      db.setSafeStorage(ss);
      db.setSetting("ai_api_key", "top-secret");
      db.setSetting("theme", "dark");

      const all = db.getAllSettings();

      expect(all.ai_api_key).toBe("top-secret");
      expect(all.theme).toBe("dark");
      expect(ss.decryptString).toHaveBeenCalled();
    });

    it("10. omits encrypted key when decryption fails (line 458 path)", () => {
      // Same null-return trigger as test 7, applied to getAllSettings: when
      // _decryptValue yields null the key is dropped from the result object.
      const encB64 = Buffer.from("enc:lost-key").toString("base64");
      const raw = JSON.stringify({ _enc: encB64 });
      (
        db as unknown as {
          db: { prepare: (sql: string) => { run: (...a: unknown[]) => void } };
        }
      ).db
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        )
        .run("ai_api_key", raw);
      db.setSetting("theme", "dark"); // plaintext key still present

      const all = db.getAllSettings();

      // ai_api_key undecryptable -> omitted; theme survives.
      expect(all).not.toHaveProperty("ai_api_key");
      expect(all.theme).toBe("dark");
    });
  });

  // ---------- roundtrips ----------

  describe("roundtrips", () => {
    it("11. setSetting + getSetting roundtrip for regular key", () => {
      db.setSetting("language", "zh-CN");
      expect(db.getSetting("language")).toBe("zh-CN");

      // Overwrite via INSERT OR REPLACE.
      db.setSetting("language", "en-US");
      expect(db.getSetting("language")).toBe("en-US");
    });

    it("12. encryptValue/decryptValue roundtrip with safeStorage", () => {
      const ss = makeSafeStorage();
      db.setSafeStorage(ss);

      const encrypted = (
        db as unknown as {
          _encryptValue: (v: unknown) => string;
          _decryptValue: (r: string) => unknown;
        }
      )._encryptValue("hello-secret");

      // Stored form must be a JSON envelope, not the plaintext.
      expect(encrypted).not.toBe("hello-secret");
      const parsed = JSON.parse(encrypted) as { _enc?: string };
      expect(parsed).toHaveProperty("_enc");

      const decrypted = (
        db as unknown as { _decryptValue: (r: string) => unknown }
      )._decryptValue(encrypted);
      expect(decrypted).toBe("hello-secret");
    });
  });
});
