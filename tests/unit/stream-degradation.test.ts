// [20260910_Feat_237_StreamDegradation] TDD for Spec #193 T10 (ticket #237):
// the stream-degradation memory. A gateway that fails a streaming request
// (non-SSE content-type or immediate 4xx) is remembered by NORMALIZED
// base_url hash so later runs skip the doomed streaming attempt; local
// addresses are never remembered (their streaming quirks get fixed, not
// bypassed); the table is capped (see STREAM_DEGRADATION_MAX_ENTRIES in the
// module) with oldest-first eviction.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import DatabaseManager from "../../src/helpers/database";
import {
  isStreamDegradationRemembered,
  listStreamDegradations,
  rememberStreamDegradation,
  resetStreamDegradations,
} from "../../src/helpers/streamDegradation";

let db: InstanceType<typeof DatabaseManager>;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stream-degradation-test-"));
  db = new DatabaseManager();
  db.initialize(tmpDir);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("[20260910_Feat_237_StreamDegradation] memory store", () => {
  it("remembers a gateway and reports it remembered", async () => {
    const written = await rememberStreamDegradation(
      db,
      "https://gateway.example.com/v1",
    );
    expect(written).toBe(true);
    await expect(
      isStreamDegradationRemembered(db, "https://gateway.example.com/v1"),
    ).resolves.toBe(true);
    const entries = await listStreamDegradations(db);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.baseUrl).toBe("https://gateway.example.com/v1");
    expect(typeof entries[0]!.at).toBe("number");
  });

  it("normalizes base_url before keying (scheme/host case, trailing slash)", async () => {
    await rememberStreamDegradation(db, "HTTPS://GATEWAY.EXAMPLE.COM/v1/");
    await expect(
      isStreamDegradationRemembered(db, "https://gateway.example.com/v1"),
    ).resolves.toBe(true);
    // A DIFFERENT path is a different gateway.
    await expect(
      isStreamDegradationRemembered(db, "https://gateway.example.com/v2"),
    ).resolves.toBe(false);
  });

  it("never remembers local addresses", async () => {
    for (const local of [
      "http://localhost:8317/v1",
      "http://127.0.0.1:8317/v1",
      "http://[::1]:8317/v1",
    ]) {
      await expect(rememberStreamDegradation(db, local)).resolves.toBe(false);
      await expect(isStreamDegradationRemembered(db, local)).resolves.toBe(
        false,
      );
    }
    await expect(listStreamDegradations(db)).resolves.toHaveLength(0);
  });

  it("caps the memory at 50 entries, evicting the oldest first", async () => {
    for (let i = 0; i < 55; i++) {
      await rememberStreamDegradation(
        db,
        `https://gw-${i}.example.com/v1`,
        1_000 + i,
      );
    }
    const entries = await listStreamDegradations(db);
    expect(entries).toHaveLength(50);
    // The first five gateways were evicted; the newest survived.
    await expect(
      isStreamDegradationRemembered(db, "https://gw-0.example.com/v1"),
    ).resolves.toBe(false);
    await expect(
      isStreamDegradationRemembered(db, "https://gw-54.example.com/v1"),
    ).resolves.toBe(true);
  });

  it("reset clears every remembered gateway and reports the count", async () => {
    await rememberStreamDegradation(db, "https://a.example.com/v1");
    await rememberStreamDegradation(db, "https://b.example.com/v1");
    await expect(resetStreamDegradations(db)).resolves.toBe(2);
    await expect(listStreamDegradations(db)).resolves.toHaveLength(0);
    // A second reset is a clean no-op.
    await expect(resetStreamDegradations(db)).resolves.toBe(0);
  });

  it("re-remembering the same gateway refreshes it without duplicating", async () => {
    await rememberStreamDegradation(db, "https://gw.example.com/v1", 1_000);
    await rememberStreamDegradation(db, "https://gw.example.com/v1", 2_000);
    const entries = await listStreamDegradations(db);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.at).toBe(2_000);
  });
});
