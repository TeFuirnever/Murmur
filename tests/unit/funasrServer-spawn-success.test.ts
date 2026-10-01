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
    // [20261002_T6b_HeartbeatWatchdog] Real ChildProcess contract: both
    // stay null while the process runs.
    exitCode: number | null;
    signalCode: string | null;
    kill: (sig?: string) => boolean;
  };
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    pid: number;
    killed: boolean;
    // [20261002_T6b_HeartbeatWatchdog] Real ChildProcess contract: both
    // stay null while the process runs — the watchdog's liveness heartbeat
    // reads them.
    exitCode: number | null;
    signalCode: string | null;
    kill: (sig?: string) => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.pid = 99999;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn((sig?: string) => {
    child.killed = true;
    // [20261002_T6b_HeartbeatWatchdog] Real ChildProcess NEVER emits close
    // synchronously from kill() — the async emit (setImmediate, same
    // discipline as funasrServer-killtree's fake) keeps the watchdog's own
    // rejection first in the race, as on real processes.
    setImmediate(() => child.emit("close", sig === "SIGKILL" ? null : 0));
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

  // [20261002_T6b_HeartbeatWatchdog] The old "rejects on 120s startup
  // timeout" test is replaced by the three heartbeat tests below: liveness
  // is the process (exitCode/signalCode), not protocol silence.

  function forcePosixKillArm(): () => void {
    // [20260817_T4_CiMatrix] The kill-arm assertions below ("kill() → close
    // fires") are the SIGKILL arm. On real Windows the watchdog goes
    // through killProcessTree's taskkill arm, which this suite's inert
    // spawnSync mock does not simulate — force the posix arm here; the
    // win32 arm is covered by funasrServer-killtree.test.ts.
    const ORIG_PLATFORM = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
      writable: true,
    });
    return () => {
      Object.defineProperty(process, "platform", {
        value: ORIG_PLATFORM,
        configurable: true,
        writable: true,
      });
    };
  }

  it("slow init far past 120s is NOT killed while the process is alive", async () => {
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

    // Cold-disk + antivirus first load: no init JSON for minutes while the
    // process is healthy — the heartbeat watchdog must keep waiting (the
    // old 120s one-shot killed exactly this startup).
    vi.advanceTimersByTime(400_000);
    expect(child.killed).toBe(false);

    // Init finally completes → resolves normally.
    child.stdout.emit("data", Buffer.from(JSON.stringify({ success: true })));
    await promise;
    expect(s.serverReady).toBe(true);
    vi.useRealTimers();
  });

  it("watchdog tree-kills and rejects when the process dies mid-init", async () => {
    const restorePlatform = forcePosixKillArm();
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

      // The process exited but close has not delivered yet (Windows pipe
      // teardown lag): the next liveness poll must catch the dead process.
      child.exitCode = 1;
      vi.advanceTimersByTime(31_000);

      await expect(promise).rejects.toThrow("初始化期间退出");
      expect(child.killed).toBe(true);
    } finally {
      restorePlatform();
      vi.useRealTimers();
    }
  });

  it("outer cap kills an alive-but-never-initializing process", async () => {
    const restorePlatform = forcePosixKillArm();
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

      // Wedged-alive: no init JSON, process still running. Bounded by the
      // 600s outer cap (≥ 2× Python's own 300s loader-join ceiling).
      vi.advanceTimersByTime(601_000);

      await expect(promise).rejects.toThrow("启动超时");
      expect(child.killed).toBe(true);
    } finally {
      restorePlatform();
      vi.useRealTimers();
    }
  });
});
