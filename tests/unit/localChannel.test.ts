// [20260912_Feat_265_LocalChannel] Black-box tests for the local IPC
// channel server + client helper (ticket #265, spec #258). The server is
// constructed WITHOUT Electron (deps-injected services/token/logger) and
// exercised over REAL loopback sockets: handshake red line (zero business
// frames before the token is validated), endpoint dispatch, progress
// streaming, handshake timeout, session idle TTL, connection cap, and the
// startLocalChannel wiring (token file + real service binding). Stale
// unix-socket self-heal lives in localChannelHeal.test.ts.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChannelClient,
  createChannelServer,
  createFrameSplitter,
  startLocalChannel,
  type ChannelServices,
  type LocalChannelServer,
} from "../../src/helpers/localChannel";
import type { Logger } from "../../src/helpers/services/transcriptionService";

// [20260912_Feat_265_LocalChannel] Opaque test token — the server treats
// it as an opaque string; logs must never echo it (asserted below).
const TOKEN = "local-channel-test-token-0123456789abcdef";
const WRONG_TOKEN = "definitely-not-the-token";

type MockFn = ReturnType<typeof vi.fn>;

interface SpyLogger {
  info: MockFn;
  warn: MockFn;
  error: MockFn;
  debug: MockFn;
}

function makeSpyLogger(): SpyLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

/** Spy logger satisfying the services Logger interface. */
function asLogger(spy: SpyLogger): Logger {
  return spy as unknown as Logger;
}

function buildServices(
  overrides: Partial<ChannelServices> = {},
): ChannelServices {
  return {
    transcribeFile: vi.fn(async () => ({
      success: true,
      text: "转录结果",
      raw_text: "raw",
      segments: [],
    })),
    checkEngineStatus: vi.fn(async () => ({ models_downloaded: true })),
    ...overrides,
  };
}

describe("localChannel (ticket #265)", () => {
  let tmpDir: string;
  let endpointPath: string;
  let server: LocalChannelServer | null;
  let spyLogger: SpyLogger;
  let endpointCounter = 0;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-265-"));
    server = null;
    spyLogger = makeSpyLogger();
    endpointCounter += 1;
    // [20260912_Fix_265_ReviewHardening] Platform-aware endpoint: Node on
    // Windows only accepts \\.\pipe\ paths for IPC listening — a DOS tmp
    // path fails uv_pipe_bind with EACCES. Pipes are flat-namespaced, so
    // pid+counter keeps vitest parallel workers unique.
    endpointPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\murmur-test-${process.pid}-${endpointCounter}`
        : path.join(tmpDir, `chan-${endpointCounter}.sock`);
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startTestServer(
    services: ChannelServices,
    options: Partial<Parameters<typeof createChannelServer>[0]> = {},
  ): Promise<LocalChannelServer> {
    const instance = createChannelServer({
      endpointPath,
      token: TOKEN,
      services,
      logger: asLogger(spyLogger),
      ...options,
    });
    server = instance;
    await instance.listen();
    return instance;
  }

  function expectNoTokenInLogs(): void {
    for (const spy of [
      spyLogger.info,
      spyLogger.warn,
      spyLogger.error,
      spyLogger.debug,
    ]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(TOKEN);
          expect(String(arg)).not.toContain(WRONG_TOKEN);
        }
      }
    }
  }

  describe("handshake", () => {
    it("accepts a correct token and answers a status request with a result frame", async () => {
      const services = buildServices();
      await startTestServer(services);
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      const result = await client.request("status", {});
      expect(result).toEqual({ models_downloaded: true });
      expect(services.checkEngineStatus).toHaveBeenCalledTimes(1);
      client.close();
      expectNoTokenInLogs();
    });

    it("rejects a wrong token with token-rejected and destroys the connection", async () => {
      await startTestServer(buildServices());
      const client = createChannelClient({ endpointPath, token: WRONG_TOKEN });
      await expect(client.connect()).rejects.toThrow("token-rejected");
      // The server must have torn the socket down (client observes close).
      await expect(client.request("status", {})).rejects.toThrow(
        /not-connected|closed/,
      );
      expectNoTokenInLogs();
    });

    it("rejects a connection whose first frame is a request instead of a token", async () => {
      await startTestServer(buildServices());
      const raw = await rawConnect(endpointPath);
      const { frames, closed } = readFrames(raw);
      raw.write(`${JSON.stringify({ id: "1", method: "status" })}\n`);
      await closed;
      expect(frames).toEqual([{ error: "token-rejected" }]);
      raw.destroy();
    });

    it("RED LINE: emits zero frames before the token frame is validated", async () => {
      await startTestServer(buildServices());
      // Connect and stay silent: a server that "speaks first" would leak
      // business data to any local process (named-pipe PoC P2).
      const silent = await rawConnect(endpointPath);
      const silentFrames = readFrames(silent);
      await sleep(150);
      expect(silentFrames.frames).toEqual([]);
      // A wrong token yields EXACTLY one frame — the rejection — then close.
      const wrong = await rawConnect(endpointPath);
      const wrongFrames = readFrames(wrong);
      wrong.write(`${JSON.stringify({ token: WRONG_TOKEN })}\n`);
      await wrongFrames.closed;
      expect(wrongFrames.frames).toEqual([{ error: "token-rejected" }]);
      silent.destroy();
      wrong.destroy();
      expectNoTokenInLogs();
    });

    it("destroys the connection when no token frame arrives before the handshake timeout", async () => {
      await startTestServer(buildServices(), { handshakeTimeoutMs: 80 });
      const raw = await rawConnect(endpointPath);
      const { frames, closed } = readFrames(raw);
      const timedOut = await withTimeout(closed, 2000);
      expect(timedOut).toBe(true);
      expect(frames).toEqual([]);
      raw.destroy();
    });
  });

  describe("endpoints", () => {
    it("transcribe_file: happy path forwards params to the service and returns its result", async () => {
      // Explicit params so mock.calls exposes a typed tuple for the
      // forwarding assertions below.
      const transcribeFile = vi.fn(
        async (
          _audioPath: string,
          _options: Record<string, unknown>,
          _onProgress?: (progress: unknown) => void,
        ) => ({ success: true, text: "ok", id: 7 }),
      );
      await startTestServer(buildServices({ transcribeFile }));
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      const audioPath = path.join(os.tmpdir(), "murmur-265-nonexistent.wav");
      const options = { hotword: "" };
      const result = (await client.request("transcribe_file", {
        audioPath,
        options,
      })) as Record<string, unknown>;
      expect(result).toEqual({ success: true, text: "ok", id: 7 });
      expect(transcribeFile).toHaveBeenCalledTimes(1);
      const call = transcribeFile.mock.calls[0]!;
      expect(call[0]).toBe(audioPath);
      expect(call[1]).toEqual(options);
      client.close();
    });

    it("transcribe_file: answers an error frame for an invalid path and never calls the service", async () => {
      const transcribeFile = vi.fn(async () => ({ success: true }));
      await startTestServer(buildServices({ transcribeFile }));
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      await expect(
        client.request("transcribe_file", { audioPath: "/definitely/not.txt" }),
      ).rejects.toThrow("不支持的音频格式");
      expect(transcribeFile).not.toHaveBeenCalled();
      client.close();
    });

    it("transcribe_file: missing audioPath answers audioPath-required without calling the service", async () => {
      const transcribeFile = vi.fn(async () => ({ success: true }));
      await startTestServer(buildServices({ transcribeFile }));
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      await expect(client.request("transcribe_file", {})).rejects.toThrow(
        "audioPath-required",
      );
      expect(transcribeFile).not.toHaveBeenCalled();
      client.close();
    });

    it("transcribe_file: streams progress frames before the result frame", async () => {
      const transcribeFile = vi.fn(
        async (
          _audioPath: string,
          _options: Record<string, unknown>,
          onProgress?: (progress: unknown) => void,
        ) => {
          onProgress?.({ percent: 40 });
          onProgress?.({ percent: 90 });
          return { success: true, text: "done" };
        },
      );
      await startTestServer(buildServices({ transcribeFile }));
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      const sequence: string[] = [];
      const payloads: unknown[] = [];
      const requestPromise = client.request(
        "transcribe_file",
        { audioPath: path.join(os.tmpdir(), "murmur-265-nonexistent.wav") },
        (progress) => {
          sequence.push("progress");
          payloads.push(progress);
        },
      );
      void requestPromise.then(
        () => sequence.push("result"),
        () => sequence.push("error"),
      );
      const result = await requestPromise;
      expect(result).toEqual({ success: true, text: "done" });
      expect(sequence).toEqual(["progress", "progress", "result"]);
      expect(payloads).toEqual([{ percent: 40 }, { percent: 90 }]);
      client.close();
    });

    it("answers unknown-method for an unregistered method", async () => {
      await startTestServer(buildServices());
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      await expect(client.request("frobnicate", {})).rejects.toThrow(
        "unknown-method",
      );
      client.close();
    });

    it("keeps serving new clients after one disconnects mid-transcription", async () => {
      let releaseTranscription: (() => void) | null = null;
      const gate = new Promise<void>((resolve) => {
        releaseTranscription = resolve;
      });
      const transcribeFile = vi.fn(async () => {
        await gate;
        return { success: true, text: "late" };
      });
      await startTestServer(buildServices({ transcribeFile }));
      // Client 1 issues a long task, then vanishes before the result.
      const gone = createChannelClient({ endpointPath, token: TOKEN });
      await gone.connect();
      const resultPromise = gone.request("transcribe_file", {
        audioPath: path.join(os.tmpdir(), "murmur-265-nonexistent.wav"),
      });
      resultPromise.catch(() => {
        // expected: the client leaves before the result frame
      });
      gone.close();
      releaseTranscription!();
      await expect(resultPromise).rejects.toThrow();
      // The server writes the orphaned result into the void, then serves
      // client 2 normally (writeFrame guards on the destroyed socket).
      const stay = createChannelClient({ endpointPath, token: TOKEN });
      await stay.connect();
      await expect(stay.request("status", {})).resolves.toEqual({
        models_downloaded: true,
      });
      stay.close();
    });
  });

  describe("session lifecycle", () => {
    it("closes an idle session after the injectable TTL", async () => {
      await startTestServer(buildServices(), { sessionIdleTtlMs: 120 });
      const raw = await rawConnect(endpointPath);
      const { frames, closed } = readFrames(raw);
      raw.write(`${JSON.stringify({ token: TOKEN })}\n`);
      await waitFor(() => frames.length > 0);
      expect(frames).toEqual([{ accepted: true }]);
      const timedOut = await withTimeout(closed, 2000);
      expect(timedOut).toBe(true);
      raw.destroy();
    });

    it("rejects the connection beyond the injectable cap (9th of 8)", async () => {
      await startTestServer(buildServices(), { maxConnections: 8 });
      const holders: net.Socket[] = [];
      try {
        for (let i = 0; i < 8; i += 1) {
          const holder = await rawConnect(endpointPath);
          holders.push(holder);
          // Let the server process the connection event before the next.
          await sleep(15);
        }
        const ninth = await rawConnect(endpointPath);
        const { frames, closed } = readFrames(ninth);
        const rejected = await withTimeout(closed, 2000);
        expect(rejected).toBe(true);
        expect(frames).toEqual([{ error: "connection-limit-rejected" }]);
        ninth.destroy();
      } finally {
        for (const holder of holders) holder.destroy();
      }
    });

    it("stop() tears down sessions and releases the endpoint for a fresh bind", async () => {
      const first = createChannelServer({
        endpointPath,
        token: TOKEN,
        services: buildServices(),
        logger: asLogger(spyLogger),
      });
      server = first;
      await first.listen();
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      await first.stop();
      // The client observes the server going away.
      await expect(client.request("status", {})).rejects.toThrow();
      if (process.platform !== "win32") {
        expect(fs.existsSync(endpointPath)).toBe(false);
      }
      // A fresh bind on the same endpoint succeeds after stop().
      const second = createChannelServer({
        endpointPath,
        token: TOKEN,
        services: buildServices(),
        logger: asLogger(spyLogger),
      });
      await second.listen();
      const client2 = createChannelClient({ endpointPath, token: TOKEN });
      await client2.connect();
      await expect(client2.request("status", {})).resolves.toEqual({
        models_downloaded: true,
      });
      client2.close();
      await second.stop();
      server = null;
    });
  });

  // [20260912_Fix_265_ReviewHardening] Review-driven hardening locks.
  describe("hardening (review #265)", () => {
    it("destroys the connection when a frame exceeds MAX_FRAME_BYTES", async () => {
      await startTestServer(buildServices());
      const raw = await rawConnect(endpointPath);
      const { closed } = readFrames(raw);
      // Handshake first (small frame), then dribble an oversized no-newline
      // payload — the server must destroy instead of buffering forever.
      raw.write(`${JSON.stringify({ token: TOKEN })}\n`);
      let payload = "";
      while (payload.length <= 1024 * 1024 + 1) {
        payload += "x".repeat(100000);
      }
      raw.write(
        `${JSON.stringify({ id: "1", method: "status", pad: payload })}\n`,
      );
      await closed;
      raw.destroy();
    });

    it("keeps a long in-flight request alive past the idle TTL", async () => {
      // TTL 200ms; the transcription service settles after ~600ms. The
      // pre-fix behavior destroyed the session mid-task (idle fires on
      // inbound-frame silence), failing the request.
      let resolveTranscribe: (value: unknown) => void = () => {};
      const services = buildServices({
        transcribeFile: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveTranscribe = resolve;
            }),
        ),
      });
      await startTestServer(services, { sessionIdleTtlMs: 200 });
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      const audioPath = path.join(os.tmpdir(), "murmur-265-nonexistent.wav");
      const requestPromise = client.request("transcribe_file", {
        audioPath,
      });
      // Let the idle TTL elapse while the request is still in flight.
      await new Promise((resolve) => setTimeout(resolve, 400));
      resolveTranscribe({ success: true, text: "迟到但完整" });
      const result = (await requestPromise) as Record<string, unknown>;
      expect(result.success).toBe(true);
      client.close();
    });

    it("does not idle-destroy an authenticated idle session before the TTL", async () => {
      const services = buildServices();
      await startTestServer(buildServices(), { sessionIdleTtlMs: 200 });
      void services;
      const client = createChannelClient({ endpointPath, token: TOKEN });
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Well before the 200ms TTL the session must still serve requests.
      const result = (await client.request("status", {})) as Record<
        string,
        unknown
      >;
      expect(result.models_downloaded).toBe(true);
      client.close();
    });
  });

  describe("wiring (startLocalChannel)", () => {
    it("writes the token file, serves the status endpoint with the real service binding", async () => {
      const serviceDeps = {
        funasrManager: {
          transcribeFile: vi.fn(async () => ({ success: true })),
          checkModelFiles: vi.fn(async () => ({
            models_downloaded: true,
            extra: "field",
          })),
        },
        databaseManager: {
          saveTranscription: vi.fn(),
          getSetting: vi.fn(() => null),
        },
        logger: asLogger(spyLogger),
      };
      const handle = await startLocalChannel({
        userDataPath: tmpDir,
        serviceDeps,
        logger: asLogger(spyLogger),
      });
      server = {
        endpointPath: handle.endpointPath,
        listen: async () => undefined,
        stop: () => handle.stop(),
      };
      expect(serviceDeps.funasrManager.checkModelFiles).not.toHaveBeenCalled();
      const token = fs.readFileSync(handle.tokenPath, "utf8");
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      const client = createChannelClient({
        endpointPath: handle.endpointPath,
        token,
      });
      await client.connect();
      const result = (await client.request("status", {})) as Record<
        string,
        unknown
      >;
      expect(result.models_downloaded).toBe(true);
      expect(serviceDeps.funasrManager.checkModelFiles).toHaveBeenCalledTimes(
        1,
      );
      client.close();
      expectNoTokenInLogs();
    });

    // [20260912_Fix_265_ReviewHardening] Windows discovery contract (PoC):
    // the per-launch random pipe name must be persisted for #267 clients.
    it("persists the endpoint file on start and removes it on stop", async () => {
      const serviceDeps = {
        funasrManager: {
          transcribeFile: vi.fn(async () => ({ success: true })),
          checkModelFiles: vi.fn(async () => ({ models_downloaded: true })),
        },
        databaseManager: {
          saveTranscription: vi.fn(),
          getSetting: vi.fn(() => null),
        },
        logger: asLogger(spyLogger),
      };
      const handle = await startLocalChannel({
        userDataPath: tmpDir,
        serviceDeps,
        logger: asLogger(spyLogger),
      });
      server = {
        endpointPath: handle.endpointPath,
        listen: async () => undefined,
        stop: () => handle.stop(),
      };
      const endpointFilePath = path.join(tmpDir, "murmur-channel-endpoint");
      expect(fs.readFileSync(endpointFilePath, "utf8")).toBe(
        `${handle.endpointPath}\n`,
      );
      await handle.stop();
      expect(fs.existsSync(endpointFilePath)).toBe(false);
    });

    it("regenerates the token file on every launch", async () => {
      const serviceDeps = {
        funasrManager: {
          transcribeFile: vi.fn(async () => ({ success: true })),
          checkModelFiles: vi.fn(async () => ({ models_downloaded: true })),
        },
        databaseManager: {
          saveTranscription: vi.fn(),
          getSetting: vi.fn(() => null),
        },
        logger: asLogger(spyLogger),
      };
      const first = await startLocalChannel({
        userDataPath: tmpDir,
        serviceDeps,
        logger: asLogger(spyLogger),
      });
      const firstToken = fs.readFileSync(first.tokenPath, "utf8");
      await first.stop();
      const second = await startLocalChannel({
        userDataPath: tmpDir,
        serviceDeps,
        logger: asLogger(spyLogger),
      });
      server = {
        endpointPath: second.endpointPath,
        listen: async () => undefined,
        stop: () => second.stop(),
      };
      const secondToken = fs.readFileSync(second.tokenPath, "utf8");
      expect(secondToken).toMatch(/^[0-9a-f]{64}$/);
      expect(secondToken).not.toBe(firstToken);
      await second.stop();
      server = null;
    });

    it.skipIf(process.platform === "win32")(
      "writes the token file with owner-only permissions (0600)",
      async () => {
        const serviceDeps = {
          funasrManager: {
            transcribeFile: vi.fn(async () => ({ success: true })),
            checkModelFiles: vi.fn(async () => ({ models_downloaded: true })),
          },
          databaseManager: {
            saveTranscription: vi.fn(),
            getSetting: vi.fn(() => null),
          },
          logger: asLogger(spyLogger),
        };
        const handle = await startLocalChannel({
          userDataPath: tmpDir,
          serviceDeps,
          logger: asLogger(spyLogger),
        });
        server = {
          endpointPath: handle.endpointPath,
          listen: async () => undefined,
          stop: () => handle.stop(),
        };
        const mode = fs.statSync(handle.tokenPath).mode & 0o777;
        expect(mode).toBe(0o600);
        await handle.stop();
        server = null;
      },
    );
  });

  describe("framing helpers", () => {
    it("createFrameSplitter buffers partial frames and emits complete ones", () => {
      const split = createFrameSplitter();
      expect(split('{"a":')).toEqual([]);
      expect(split('1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
      expect(split("tail-without-newline")).toEqual([]);
    });
  });
});

// --- raw-socket test helpers (the client helper covers the happy paths;
// these expose exact wire frames for the red-line/auth assertions). ---

function rawConnect(target: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(target);
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
  });
}

function readFrames(sock: net.Socket): {
  frames: unknown[];
  closed: Promise<void>;
} {
  const frames: unknown[] = [];
  const split = createFrameSplitter();
  sock.on("data", (chunk: Buffer) => {
    for (const raw of split(chunk.toString("utf8"))) {
      if (!raw.trim()) continue;
      frames.push(JSON.parse(raw) as unknown);
    }
  });
  const closed = new Promise<void>((resolve) => {
    sock.once("close", () => resolve());
  });
  return { frames, closed };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve true when the promise settles before timeoutMs, false otherwise. */
async function withTimeout(
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  const winner = await Promise.race([
    promise.then(
      () => "settled" as const,
      () => "settled" as const,
    ),
    sleep(timeoutMs).then(() => "timeout" as const),
  ]);
  return winner === "settled";
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await sleep(5);
  }
}
