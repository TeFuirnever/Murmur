// [20260820_Fix_211_KeychainBootOrder] Regression test for the code-review
// MAJOR on the #211 boot-order fix: main.ts now injects safeStorage
// UNCONDITIONALLY (so crypto state always settles deterministically), which
// means _migrateSettings also runs while encryption is UNAVAILABLE. The
// naive version bumped settings_schema_version to 1 in that case —
// permanently skipping the plaintext→encrypted ai_api_key migration for
// anyone whose keychain reports unavailable at boot but works later.
//
// Contract under test:
//   - plaintext ai_api_key + unavailable encryption → schema version stays
//     0 (migration retried on a later boot with working encryption)
//   - the retry actually happens: a later inject with available encryption
//     migrates the key to encrypted storage and bumps version to 1
//   - no ai_api_key at all + unavailable encryption → version bumps to 1
//     normally (nothing to migrate; don't strand v0 forever)
//
// Harness mirrors database-encryption-failure.test.ts (real DatabaseManager
// on a tmp dir, fake safeStorage objects).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

import DatabaseManager from "../../src/helpers/database";

describe("[20260820_Fix_211_KeychainBootOrder] _migrateSettings vs unavailable encryption", () => {
  let tmpDir: string;
  let db: {
    initialize: (dir: string) => void;
    setSafeStorage: (s: unknown) => void;
    setSetting: (k: string, v: unknown) => unknown;
    getSetting: (k: string, d?: unknown) => unknown;
    close: () => void;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-mig-test-"));
    db = new DatabaseManager() as unknown as typeof db;
    db.initialize(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const unavailableStorage = () => ({
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(() => false),
  });

  const availableStorage = () => ({
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace("enc:", "")),
    isEncryptionAvailable: vi.fn(() => true),
  });

  it("keeps schema version 0 when a plaintext key exists and encryption is unavailable", () => {
    // Seed a plaintext key (no safeStorage → plaintext path).
    db.setSetting("ai_api_key", "sk-plain");

    db.setSafeStorage(unavailableStorage());

    expect(db.getSetting("settings_schema_version", 0)).toBe(0);
    // Key remains readable plaintext.
    expect(db.getSetting("ai_api_key", "")).toBe("sk-plain");
  });

  it("migrates the plaintext key on a later boot once encryption works", () => {
    db.setSetting("ai_api_key", "sk-plain");
    // First boot: unavailable → migration deferred (version stays 0).
    db.setSafeStorage(unavailableStorage());

    // Later boot: encryption available → migration runs and bumps version.
    db.setSafeStorage(availableStorage());

    expect(db.getSetting("settings_schema_version", 0)).toBe(1);
    expect(db.getSetting("ai_api_key", "")).toBe("sk-plain");
    // The stored row must now be ciphertext, not the plaintext JSON.
    const raw = (
      db as unknown as {
        db: {
          prepare: (q: string) => { get: (k: string) => { value: string } };
        };
      }
    ).db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("ai_api_key");
    expect(raw.value).not.toContain("sk-plain");
    expect(raw.value).toContain("_enc");
  });

  it("bumps schema version normally when there is no key to migrate", () => {
    db.setSafeStorage(unavailableStorage());
    expect(db.getSetting("settings_schema_version", 0)).toBe(1);
  });
});
