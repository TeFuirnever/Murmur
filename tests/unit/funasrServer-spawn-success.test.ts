// [20260729_Test_FunasrServerSpawnSuccess] Full spawn lifecycle test using
// vi.mock("child_process"). This is the FIRST child_process mock in the repo.
// Covers _startFunASRServer's spawn success/init/stderr/close/error/timeout
// paths — the main coverage gap in funasrServer.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

vi.mock("../../src/helpers/audioFileHelpers", () => ({
  createTempAudioFile: vi.fn().mockResolvedValue("/tmp/fake.wav"),
  cleanupTempFile: vi.fn().mockResolvedValue(undefined),
}));

// Build a reusable fake ChildProcess that spawn() will return.
function createFakeChild(): {
  child: EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    pid: number;
    killed: boolean;
    kill: (sig?: string) => boolean;
  };
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    pid: number;
    killed: boolean;
    kill: (sig?: string) => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.pid = 99999;
  child.killed = false;
  child.kill = vi.fn((sig?: string) => {
    child.killed = true;
    child.emit("close", sig === "SIGKILL" ? null : 0);
    return true;
  });
  return { child };
}

// Capture the fake child so the mocked spawn returns it.
let mockSpawnChild: ReturnType<typeof createFakeChild>["child"];

vi.mock("child_process", () => ({
  spawn: vi.fn(() => mockSpawnChild),
  spawnSync: vi.fn(),
}));

// Import AFTER mocks are set up.
import { spawn } from "child_process";
import FunASRServer from "../../src/helpers/funasrServer";

interface FunASRServerSurface {
  serverReady: boolean;
  modelsInitialized: boolean;
  serverProcess: unknown;
  initializationPromise: Promise<unknown> | null;
  restartCount: number;
  maxRestarts: number;
  healthMonitorInterval: ReturnType<typeof setInterval> | null;
  _stopping: boolean;
  _startupParams: unknown;
  messageRouter: {
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    sendRaw: ReturnType<typeof vi.fn>;
  };
  _startFunASRServer: (
    env: NodeJS.ProcessEnv,
    cmd: string,
    serverPath: string,
    modelCachePath: string,
  ) => Promise<unknown>;
  _startHealthMonitor: () => void;
  _stopHealthMonitor: () => void;
  _handleServerCrash: () => Promise<void>;
}

function srv(instance: InstanceType<typeof FunASRServer>): FunASRServerSurface {
  return instance as unknown as FunASRServerSurface;
}

interface LoggerStub {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  logFunASR?: (level: string, msg: string, meta?: unknown) => void;
}

describe("FunASRServer _startFunASRServer — spawn lifecycle", () => {
  let server: InstanceType<typeof FunASRServer>;
  let logger: LoggerStub;
  let tmpDir: string;
  let serverScript: string;

  beforeEach(() => {
    vi.useRealTimers();
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      logFunASR: vi.fn(),
    };
    server = new FunASRServer(logger);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "funasr-spawn2-"));
    serverScript = path.join(tmpDir, "server.py");
    fs.writeFileSync(serverScript, "# fake server script");

    const s = srv(server);
    s.messageRouter = {
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(),
      sendRaw: vi.fn(),
    };
    vi.mocked(spawn).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("spawns and resolves when stdout emits success JSON", async () => {
    const { child } = createFakeChild();
    mockSpawnChild = child;

    const s = srv(server);
    const promise = s._startFunASRServer(
      { PATH: "/usr/bin" },
      "python3",
      serverScript,
      "/tmp/models",
    );

    // Simulate server outputting success JSON on stdout.
    child.stdout.emit("data", Buffer.from(JSON.stringify({ success: true })));

    await promise;

    expect(s.serverReady).toBe(true);
    expect(s.modelsInitialized).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "python3",
      [serverScript, "--damo-root", "/tmp/models"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(s.messageRouter.attach).toHaveBeenCalledWith(child);
  });

  it("logs error when server init JSON has success=false", async () => {
    const { child } = createFakeChild();
    mockSpawnChild = child;

    const s = srv(server);
    const promise = s._startFunASRServer(
      {},
      "python3",
      serverScript,
      "/tmp/models",
    );

    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ success: false, error: "model load failed" }),
      ),
    );

    await promise;

    expect(s.serverReady).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it("ignores non-JSON stdout lines", async () => {
    const { child } = createFakeChild();
    mockSpawnChild = child;

    const s = srv(server);
    const promise = s._startFunASRServer(
      {},
      "python3",
      serverScript,
      "/tmp/models",
    );

    // Emit non-JSON first, then valid JSON.
    child.stdout.emit("data", Buffer.from("Starting server...\n"));
    child.stdout.emit("data", Buffer.from(JSON.stringify({ success: true })));

    await promise;

    expect(s.serverReady).toBe(true);
    expect(logger.debug).toHaveBeenCalled();
  });

  it("handles stderr output", async () => {
    const { child } = createFakeChild();
    mockSpawnChild = child;

    const s = srv(server);
    const promise = s._startFunASRServer(
      {},
      "python3",
      serverScript,
      "/tmp/models",
    );

    child.stderr.emit("data", Buffer.from("some warning"));
    child.stdout.emit("data", Buffer.from(JSON.stringify({ success: true })));

    await promise;

    expect(logger.error).toHaveBeenCalled();
    expect(logger.logFunASR).toHaveBeenCalled();
  });

  it("rejects when process exits before init response", async () => {
    const { child } = createFakeChild();
    mockSpawnChild = child;

    const s = srv(server);
    const promise = s._startFunASRServer(
      {},
      "python3",
      serverScript,
      "/tmp/models",
    );

    // Process crashes before sending any JSON.
    child.emit("close", 1);

    await expect(promise).rejects.toThrow("异常退出");
  });

  it("triggers crash restart when process dies after successful init", async () => {
    vi.useFakeTimers();
    const { child } = createFakeChild();
    mockSpawnChild = child;

    const s = srv(server);
    const promise = s._startFunASRServer(
      {},
      "python3",
      serverScript,
      "/tmp/models",
    );

    child.stdout.emit("data", Buffer.from(JSON.stringify({ success: true })));
    await promise;

    // Now the server is running. Simulate crash.
    // _handleServerCrash is called on unexpected close (when !_stopping).
    const crashSpy = vi
      .spyOn(s, "_handleServerCrash")
      .mockResolvedValue(undefined);
    child.emit("close", 1);

    expect(crashSpy).toHaveBeenCalled();
  });

  it("rejects on spawn error event", async () => {
    const { child } = createFakeChild();
    mockSpawnChild = child;

    const s = srv(server);
    const promise = s._startFunASRServer(
      {},
      "python3",
      serverScript,
      "/tmp/models",
    );

    child.emit("error", new Error("ENOENT"));

    await expect(promise).rejects.toThrow("启动失败");
  });

  it("rejects on 120s startup timeout (timeout kills process → close fires)", async () => {
    // [20260817_T4_CiMatrix] This test's semantics ("kill() → close fires
    // → races the timeout reject") are the SIGKILL arm. On real Windows the
    // timeout goes through killProcessTree's taskkill arm, which this
    // suite's inert spawnSync mock does not simulate — force the posix arm
    // here; the win32 arm is covered by funasrServer-killtree.test.ts.
    const ORIG_PLATFORM = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
      writable: true,
    });
    vi.useFakeTimers();
    try {
      const { child } = createFakeChild();
      mockSpawnChild = child;

      const s = srv(server);
      const promise = s._startFunASRServer(
        {},
        "python3",
        serverScript,
        "/tmp/models",
      );

      // No stdout output — simulate timeout. The timeout callback calls kill(),
      // which emits 'close', which races with the timeout reject. Either
      // "超时" or "异常退出" is acceptable — both indicate init never completed.
      vi.advanceTimersByTime(121000);

      await expect(promise).rejects.toThrow();
      expect(child.killed).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", {
        value: ORIG_PLATFORM,
        configurable: true,
        writable: true,
      });
      vi.useRealTimers();
    }
  });
});
