// [20260912_Feat_265_LocalChannel] Stale-socket self-heal tests for the
// local IPC channel (ticket #265 point 4, spec #258). Unix-only behavior —
// every case is gated with it.skipIf(process.platform === "win32") per the
// repo convention. Covered: a dead endpoint (leftover socket/regular file
// from a crashed instance) is probe-connected, found dead, unlinked and
// rebound; a LIVE instance answering the probe makes the second bind
// attempt log and refuse (the first instance keeps serving).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChannelClient,
  createChannelServer,
  type ChannelServices,
  type LocalChannelServer,
} from "../../src/helpers/localChannel";
import type { Logger } from "../../src/helpers/services/transcriptionService";

const TOKEN = "heal-test-token-0123456789abcdefghijklmnop";

function buildServices(): ChannelServices {
  return {
    transcribeFile: vi.fn(async () => ({ success: true, text: "x" })),
    checkEngineStatus: vi.fn(async () => ({ models_downloaded: true })),
  };
}

function asLogger(spy: {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
}): Logger {
  return spy as unknown as Logger;
}

describe("local channel stale-socket self-heal (unix only)", () => {
  let tmpDir: string;
  let endpointPath: string;
  const servers: LocalChannelServer[] = [];
  let spyLogger: ReturnType<typeof makeSpy>;

  function makeSpy() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-265-heal-"));
    endpointPath = path.join(tmpDir, "heal.sock");
    spyLogger = makeSpy();
  });

  afterEach(async () => {
    for (const instance of servers) {
      await instance.stop();
    }
    servers.length = 0;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeServer(logger = asLogger(spyLogger)): LocalChannelServer {
    const instance = createChannelServer({
      endpointPath,
      token: TOKEN,
      services: buildServices(),
      logger,
    });
    servers.push(instance);
    return instance;
  }

  it.skipIf(process.platform === "win32")(
    "unlinks a dead endpoint file and binds fresh",
    async () => {
      // A leftover file at the socket path (crash leftovers): the probe
      // connect must fail, the file gets unlinked, and the bind succeeds.
      fs.writeFileSync(endpointPath, "stale leftover");
      expect(fs.existsSync(endpointPath)).toBe(true);
      const instance = makeServer();
      await instance.listen();
      expect(spyLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("残留"),
        expect.objectContaining({ endpointPath }),
      );
      // The healed endpoint actually serves a client roundtrip.
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      await expect(client.request("status", {})).resolves.toEqual({
        models_downloaded: true,
      });
      client.close();
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses to bind and logs when a live instance owns the endpoint",
    async () => {
      const first = makeServer();
      await first.listen();
      const secondSpy = makeSpy();
      const second = makeServer(asLogger(secondSpy));
      await expect(second.listen()).rejects.toThrow(
        "local-channel-endpoint-in-use",
      );
      expect(secondSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining("占用"),
        expect.objectContaining({ endpointPath }),
      );
      // The original instance is untouched and keeps serving.
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      await expect(client.request("status", {})).resolves.toEqual({
        models_downloaded: true,
      });
      client.close();
    },
  );

  it.skipIf(process.platform === "win32")(
    "removes the socket file on stop()",
    async () => {
      const instance = makeServer();
      await instance.listen();
      expect(fs.existsSync(endpointPath)).toBe(true);
      await instance.stop();
      expect(fs.existsSync(endpointPath)).toBe(false);
      servers.pop();
    },
  );
});
