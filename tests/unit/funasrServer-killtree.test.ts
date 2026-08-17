// [20260817_T2_KillTree] Ticket #179 (spec #177 T2): every path that kills
// the Python subprocess must terminate the whole process tree through one
// shared helper — crash-restart previously dropped the handle without killing
// (orphan process, ~1GB RSS leaked per crash on Windows), and the
// stop-fallback + startup-timeout paths used bare proc.kill() which leaves
// the Python child tree alive on Windows. RED first: these fail until the
// shared killProcessTree helper exists and all four call sites use it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

vi.mock("../../src/helpers/audioFileHelpers", () => ({
  createTempAudioFile: vi.fn().mockResolvedValue("/tmp/fake-audio.wav"),
  cleanupTempFile: vi.fn().mockResolvedValue(undefined),
}));

// Fake ChildProcess surface (same pattern as funasrServer-branches.test.ts).
class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  pid = 4242;
  killed = false;
  kill(signal?: string): boolean {
    this.killed = true;
    this.emit("close", signal === "SIGKILL" ? null : 0);
    return true;
  }
}

let mockSpawnChild: FakeChildProcess;

vi.mock("child_process", () => ({
  spawn: vi.fn(() => mockSpawnChild),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

import { spawnSync } from "child_process";
import * as funasrServerModule from "../../src/helpers/funasrServer";
import FunASRServer from "../../src/helpers/funasrServer";

interface StartupParams {
  pythonEnv: NodeJS.ProcessEnv;
  pythonCmd: string;
  serverPath: string;
  modelCachePath: string;
}

interface FunASRServerSurface {
  serverReady: boolean;
  serverProcess: FakeChildProcess | null;
  restartCount: number;
  maxRestarts: number;
  _startupParams: StartupParams;
  _startFunASRServer: (...args: unknown[]) => Promise<unknown>;
  _startHealthMonitor: () => void;
  _stopHealthMonitor: () => void;
  _stopFunASRServer: () => Promise<void>;
  _handleServerCrash: () => Promise<void>;
  messageRouter: {
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    sendRaw: ReturnType<typeof vi.fn>;
  };
}

function srv(instance: InstanceType<typeof FunASRServer>): FunASRServerSurface {
  return instance as unknown as FunASRServerSurface;
}

interface LoggerStub {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}

const ORIG_PLATFORM = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
}

describe("[20260817_T2_KillTree] killProcessTree helper", () => {
  it("exports a shared killProcessTree helper", () => {
    expect(typeof funasrServerModule.killProcessTree).toBe("function");
  });

  it("is a no-op for a null process handle", () => {
    expect(() =>
      (funasrServerModule.killProcessTree as (p: unknown) => void)(null),
    ).not.toThrow();
  });

  it("taskkill /T /F on win32, SIGKILL elsewhere", () => {
    vi.mocked(spawnSync).mockClear();
    const child = new FakeChildProcess();

    setPlatform("win32");
    funasrServerModule.killProcessTree(child as never);
    expect(spawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/T", "/F", "/PID", String(child.pid)],
      expect.objectContaining({ windowsHide: true }),
    );

    setPlatform("darwin");
    funasrServerModule.killProcessTree(child as never);
    expect(child.killed).toBe(true);
  });
});

describe("[20260817_T2_KillTree] crash-restart kills the old tree first", () => {
  let logger: LoggerStub;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  });

  it("win32: taskkill old pid before respawning", async () => {
    setPlatform("win32");
    vi.mocked(spawnSync).mockClear();
    const server = srv(new FunASRServer(logger));
    const oldProc = new FakeChildProcess();
    server.serverProcess = oldProc;
    server.restartCount = 0;
    server.maxRestarts = 3;
    server._startupParams = {
      pythonEnv: {},
      pythonCmd: "python3",
      serverPath: "/path",
      modelCachePath: "/models",
    };
    server._startFunASRServer = vi.fn().mockResolvedValue({});

    await server._handleServerCrash();

    expect(spawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/T", "/F", "/PID", String(oldProc.pid)],
      expect.objectContaining({ windowsHide: true }),
    );
    // Kill must happen BEFORE the respawn.
    const [killOrder] = vi.mocked(spawnSync).mock.invocationCallOrder;
    const [respawnOrder] = vi.mocked(server._startFunASRServer).mock
      .invocationCallOrder;
    if (killOrder === undefined || respawnOrder === undefined) {
      throw new Error("expected both kill and respawn to have been called");
    }
    expect(killOrder).toBeLessThan(respawnOrder);
    // Bare proc.kill() must NOT be the mechanism on win32.
    expect(oldProc.killed).toBe(false);
  });

  it("posix: SIGKILL old process before respawning", async () => {
    setPlatform("darwin");
    vi.mocked(spawnSync).mockClear();
    const server = srv(new FunASRServer(logger));
    const oldProc = new FakeChildProcess();
    server.serverProcess = oldProc;
    server.restartCount = 0;
    server.maxRestarts = 3;
    server._startupParams = {
      pythonEnv: {},
      pythonCmd: "python3",
      serverPath: "/path",
      modelCachePath: "/models",
    };
    server._startFunASRServer = vi.fn().mockResolvedValue({});

    await server._handleServerCrash();

    expect(oldProc.killed).toBe(true);
    const respawnOrder = vi.mocked(server._startFunASRServer).mock
      .invocationCallOrder[0];
    expect(respawnOrder).toBeGreaterThan(0);
  });
});

describe("[20260817_T2_KillTree] stop-fallback and startup timeout", () => {
  let logger: LoggerStub;
  let server: InstanceType<typeof FunASRServer>;
  let tmpDir: string;
  let serverScript: string;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    server = new FunASRServer(logger);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "funasr-killtree-"));
    serverScript = path.join(tmpDir, "server.py");
    fs.writeFileSync(serverScript, "# test");
    mockSpawnChild = new FakeChildProcess();
  });

  afterEach(() => {
    setPlatform(ORIG_PLATFORM);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("win32: stop fallback uses taskkill tree when the exit command fails", async () => {
    setPlatform("win32");
    vi.mocked(spawnSync).mockClear();
    const s = srv(server);
    const child = new FakeChildProcess();
    s.serverProcess = child;
    s.serverReady = true;
    s.messageRouter.sendRaw = vi.fn().mockRejectedValue(new Error("dead pipe"));

    await s._stopFunASRServer();

    expect(spawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/T", "/F", "/PID", String(child.pid)],
      expect.objectContaining({ windowsHide: true }),
    );
    expect(child.killed).toBe(false);
  });

  it("win32: 120s startup timeout uses taskkill tree, not bare kill", async () => {
    vi.useFakeTimers();
    try {
      setPlatform("win32");
      vi.mocked(spawnSync).mockClear();
      const s = srv(server);
      // spawn() returns mockSpawnChild which never emits an init response,
      // so the 120s startup timeout arm fires.
      const startPromise = s._startFunASRServer(
        {},
        "python3",
        serverScript,
        "/models",
      );
      // Attach the rejection assertion BEFORE firing the timer so the
      // rejection is never momentarily unhandled.
      const rejection = expect(startPromise).rejects.toThrow("启动超时");
      // Let the promise callbacks settle without advancing the timeout yet.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(120_000);
      await rejection;
      expect(spawnSync).toHaveBeenCalledWith(
        "taskkill",
        ["/T", "/F", "/PID", String(mockSpawnChild.pid)],
        expect.objectContaining({ windowsHide: true }),
      );
      expect(mockSpawnChild.killed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("posix: killing the wedged process during crash handling does not re-enter crash handling", async () => {
    vi.useFakeTimers();
    try {
      setPlatform("darwin");
      const s = srv(server);
      // Boot once for real so the close listener is attached, then init ok.
      const startPromise = s._startFunASRServer(
        {},
        "python3",
        serverScript,
        "/models",
      );
      mockSpawnChild.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ success: true, action: "init" }) + "\n"),
      );
      await startPromise;
      s._startHealthMonitor();
      // Respawn is mocked — we only count invocations.
      s._startFunASRServer = vi.fn().mockResolvedValue({});
      s.restartCount = 0;

      await s._handleServerCrash();
      // killProcessTree SIGKILLs mockSpawnChild → its close listener fires
      // synchronously; without the _crashHandling guard it would call
      // _handleServerCrash again (2nd respawn + restartCount=2).
      expect(s._startFunASRServer).toHaveBeenCalledTimes(1);
      expect(s.restartCount).toBe(1);
      s._stopHealthMonitor();
    } finally {
      vi.useRealTimers();
    }
  });
});
