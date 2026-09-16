// [20260725_Fix_EncryptionFailure] TDD test for database.ts encryption bug.
// Bug: _encryptValue doesn't catch encryptString exceptions. When OS keyring
// is locked, setSetting("ai_api_key", ...) throws and the setting is lost.
// Fix: catch encryption failure, fall back to plaintext JSON.stringify.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

// [20260726_Tier32_DatabaseEncryptionFailure] Convert require() +
// vi.resetModules() to a top-level ESM default import. vi.mock is hoisted
// and applies to this import; the require shim was only needed for .ts
// loading. database.ts uses `export default DatabaseManager`.
import DatabaseManager from "../../src/helpers/database";

describe("DatabaseManager — encryption failure resilience", () => {
  let tmpDir: string;
  let db: {
    initialize: (dir: string) => void;
    setSafeStorage: (s: unknown) => void;
    setSetting: (k: string, v: unknown) => unknown;
    getSetting: (k: string, d?: unknown) => unknown;
    close: () => void;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-enc-test-"));
    // [20260726_Tier32_DatabaseEncryptionFailure] Cast through unknown: the
    // previous require() binding was `any` (ReturnType<typeof require>), so
    // the hand-written `db` interface above was effectively unenforced. With
    // the typed default import the real DatabaseManager's setSafeStorage
    // accepts SafeStorage (not unknown), which is narrower — structurally
    // incompatible with this local interface even though the runtime shape is
    // identical. The `as unknown` mirrors the FunASRSurface/dbp() cast
    // pattern used across the other suites for private-field access.
    db = new DatabaseManager() as unknown as {
      initialize: (dir: string) => void;
      setSafeStorage: (s: unknown) => void;
      setSetting: (k: string, v: unknown) => unknown;
      getSetting: (k: string, d?: unknown) => unknown;
      close: () => void;
    };
    db.initialize(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to plaintext when encryptString throws", () => {
    // [20260725_Fix_EncryptionFailure] RED: setSetting should not throw
    // when encryption fails. It should fall back to plaintext.
    db.setSafeStorage({
      encryptString: vi.fn(() => {
        throw new Error("Keyring locked");
      }),
      decryptString: vi.fn(),
      isEncryptionAvailable: vi.fn(() => true),
    });

    // This should NOT throw — should fall back to plaintext
    expect(() => db.setSetting("ai_api_key", "sk-test-key")).not.toThrow();

    // The value should be retrievable (as plaintext, since encryption failed)
    // Remove safeStorage so getSetting reads raw value
    db.setSafeStorage(null);
    const result = db.getSetting("ai_api_key", "");
    expect(result).toBe("sk-test-key");
  });

  it("preserves setting value when safeStorage becomes unavailable after save", () => {
    // Save with working encryption
    db.setSafeStorage({
      encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
      decryptString: vi.fn((b: Buffer) => b.toString().replace("enc:", "")),
      isEncryptionAvailable: vi.fn(() => true),
    });
    db.setSetting("ai_api_key", "sk-secret");

    // Now safeStorage disappears — should still get defaultValue, not crash
    db.setSafeStorage(null);
    const result = db.getSetting("ai_api_key", "fallback");
    // Encrypted value can't be decrypted without safeStorage → return default
    expect(result).toBe("fallback");
  });
});
