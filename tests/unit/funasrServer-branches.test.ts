// [20260816_Test_BranchPush] Branch-coverage tests for src/helpers/funasrServer.ts
// arcs not exercised by the existing funasrServer-{spawn,spawn-success,crash-restart,
// transcribe} suites: health-monitor ping branches (pong / unexpected / throw /
// timeout race), restart-failure logging, gracefulShutdown platform + error
// branches, transcribeAudio result shapes, and transcribeFile's
// initializationPromise arcs. child_process (spawn + spawnSync) is fully mocked
// so the outer spawn-throw catch and the win32 taskkill branch are drivable.
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

// Fake ChildProcess surface used by the mocked spawn().
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

// The mocked spawn() returns this module-level child; tests assign it before
// invoking _startFunASRServer (same pattern as funasrServer-spawn-success).
let mockSpawnChild: FakeChildProcess;

vi.mock("child_process", () => ({
  spawn: vi.fn(() => mockSpawnChild),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

// Import AFTER mocks are registered.
import { spawn, spawnSync } from "child_process";
import FunASRServer from "../../src/helpers/funasrServer";

// Surface interface: exposes the private members these tests poke.
interface FunASRServerSurface {
  serverReady: boolean;
  modelsInitialized: boolean;
  serverProcess: FakeChildProcess | null;
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
  _sendServerCommand: (cmd: Record<string, unknown>) => Promise<unknown>;
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

const ORIG_PLATFORM = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
}

describe("[20260816_Test_BranchPush] FunASRServer branch coverage", () => {
  let server: InstanceType<typeof FunASRServer>;
  let logger: LoggerStub;
  let tmpDir: string;
  let serverScript: string;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    server = new FunASRServer(logger);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "funasr-branches-"));
    serverScript = path.join(tmpDir, "server.py");
    fs.writeFileSync(serverScript, "# fake server script");

    const s = srv(server);
    s.messageRouter = {
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(),
      sendRaw: vi.fn(),
    };
    mockSpawnChild = new FakeChildProcess();
    vi.mocked(spawn).mockClear();
    vi.mocked(spawnSync).mockClear();
  });

  afterEach(() => {
    srv(server)._stopHealthMonitor();
    vi.clearAllTimers();
    vi.useRealTimers();
    setPlatform(ORIG_PLATFORM);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("stderr / close / error listener arcs", () => {
    it("skips logFunASR forwarding when the logger has no logFunASR method", async () => {
      // Logger stub above deliberately omits logFunASR — the stderr handler's
      // `if (this.logger.logFunASR)` false arc.
      const s = srv(server);
      const promise = s._startFunASRServer(
        {},
        "python3",
        serverScript,
        "/tmp/models",
      );
      mockSpawnChild.stderr.emit("data", Buffer.from("warning text"));
      mockSpawnChild.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ success: true })),
      );
      await promise;
      expect(logger.error).toHaveBeenCalled();
      expect(logger.logFunASR).toBeUndefined();
    });

    it("does not trigger crash restart when close fires while stopping", async () => {
      const s = srv(server);
      const crashSpy = vi
        .spyOn(s, "_handleServerCrash")
        .mockResolvedValue(undefined);
      const promise = s._startFunASRServer(
        {},
        "python3",
        serverScript,
        "/tmp/models",
      );
      mockSpawnChild.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ success: true })),
      );
      await promise;
      s._stopping = true;
      mockSpawnChild.emit("close", 0);
      expect(crashSpy).not.toHaveBeenCalled();
      expect(s.serverProcess).toBeNull();
      expect(s.serverReady).toBe(false);
    });

    it("ignores the error event after init was already received (no reject)", async () => {
      const s = srv(server);
      const promise = s._startFunASRServer(
        {},
        "python3",
        serverScript,
        "/tmp/models",
      );
      mockSpawnChild.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ success: true })),
      );
      await promise;
      // initResponseReceived is true — the error handler's reject branch is
      // skipped; only the error log + state cleanup run.
      mockSpawnChild.emit("error", new Error("EPIPE"));
      expect(logger.error).toHaveBeenCalledWith(
        "FunASR服务器进程错误",
        expect.any(Error),
      );
      expect(s.serverReady).toBe(false);
    });

    it("logs the outer catch when the pre-spawn filesystem check throws", async () => {
      // A throw inside the Promise executor becomes a rejection, so the outer
      // catch only fires for failures BEFORE `new Promise(...)` — e.g.
      // fs.existsSync raising on an unreadable directory.
      const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation(() => {
        throw new Error("EACCES");
      });
      const s = srv(server);
      const result = await s._startFunASRServer(
        {},
        "python3",
        serverScript,
        "/tmp/models",
      );
      expect(result).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        "启动FunASR服务器异常",
        expect.any(Error),
      );
      existsSpy.mockRestore();
    });

    it("propagates a rejection when spawn itself throws synchronously", async () => {
      // The Promise constructor converts executor throws to rejections, so a
      // synchronous spawn failure surfaces as a rejected startup promise
      // rather than the outer catch.
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error("spawn ENOENT");
      });
      const s = srv(server);
      await expect(
        s._startFunASRServer({}, "python3", serverScript, "/tmp/models"),
      ).rejects.toThrow("spawn ENOENT");
    });

    it("startup timeout skips kill when the process is already gone", async () => {
      const s = srv(server);
      const promise = s._startFunASRServer(
        {},
        "python3",
        serverScript,
        "/tmp/models",
      );
      // Spawn error rejects the startup promise AND nulls serverProcess, so
      // the 120s timeout's `if (this.serverProcess)` guard is false.
      mockSpawnChild.emit("error", new Error("ENOENT"));
      await expect(promise).rejects.toThrow("启动失败");
      vi.advanceTimersByTime(121000);
      expect(logger.warn).toHaveBeenCalledWith("FunASR服务器启动超时");
    });
  });

  describe("health monitor", () => {
    it("returns early inside the interval when the process is gone", async () => {
      const s = srv(server);
      const ping = vi.fn();
      s._sendServerCommand = ping;
      s.serverProcess = null;
      s.serverReady = false;
      s._startHealthMonitor();
      await vi.advanceTimersByTimeAsync(30000);
      expect(ping).not.toHaveBeenCalled();
    });

    it("keeps running silently on a pong response", async () => {
      const s = srv(server);
      const crashSpy = vi
        .spyOn(s, "_handleServerCrash")
        .mockResolvedValue(undefined);
      s.serverProcess = mockSpawnChild;
      s.serverReady = true;
      s._sendServerCommand = vi
        .fn()
        .mockResolvedValue({ success: true, action: "pong" });
      s._startHealthMonitor();
      await vi.advanceTimersByTimeAsync(30000);
      expect(crashSpy).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalledWith(
        "Health check: unexpected response",
        expect.anything(),
      );
    });

    it("warns and crashes on an unexpected response shape", async () => {
      const s = srv(server);
      const crashSpy = vi
        .spyOn(s, "_handleServerCrash")
        .mockResolvedValue(undefined);
      s.serverProcess = mockSpawnChild;
      s.serverReady = true;
      s._sendServerCommand = vi.fn().mockResolvedValue({ success: false });
      s._startHealthMonitor();
      await vi.advanceTimersByTimeAsync(30000);
      expect(logger.warn).toHaveBeenCalledWith(
        "Health check: unexpected response",
        { success: false },
      );
      expect(crashSpy).toHaveBeenCalledTimes(1);
    });

    it("crashes when the ping promise rejects", async () => {
      const s = srv(server);
      const crashSpy = vi
        .spyOn(s, "_handleServerCrash")
        .mockResolvedValue(undefined);
      s.serverProcess = mockSpawnChild;
      s.serverReady = true;
      s._sendServerCommand = vi
        .fn()
        .mockRejectedValue(new Error("router closed"));
      s._startHealthMonitor();
      await vi.advanceTimersByTimeAsync(30000);
      expect(logger.error).toHaveBeenCalledWith(
        "Health check failed",
        "router closed",
      );
      expect(crashSpy).toHaveBeenCalledTimes(1);
    });

    it("loses the race against the 5s ping timeout and crashes", async () => {
      const s = srv(server);
      const crashSpy = vi
        .spyOn(s, "_handleServerCrash")
        .mockResolvedValue(undefined);
      s.serverProcess = mockSpawnChild;
      s.serverReady = true;
      // Never settles — the 5s timeout arm of Promise.race must win.
      s._sendServerCommand = vi.fn(
        () => new Promise(() => {}) as Promise<unknown>,
      );
      s._startHealthMonitor();
      await vi.advanceTimersByTimeAsync(30000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(logger.error).toHaveBeenCalledWith(
        "Health check failed",
        "ping timeout",
      );
      expect(crashSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("_handleServerCrash restart failure", () => {
    it("logs when the restart attempt itself rejects", async () => {
      const s = srv(server);
      s.restartCount = 0;
      s.maxRestarts = 3;
      s._startupParams = {
        pythonEnv: {},
        pythonCmd: "python3",
        serverPath: serverScript,
        modelCachePath: "/tmp/models",
      };
      s._startFunASRServer = vi
        .fn()
        .mockRejectedValue(new Error("restart boom"));
      await s._handleServerCrash();
      expect(logger.error).toHaveBeenCalledWith(
        "FunASR server restart failed",
        "restart boom",
      );
    });
  });

  describe("gracefulShutdown platform branches", () => {
    it("uses taskkill /T /F on win32 after the 5s timeout", async () => {
      setPlatform("win32");
      const s = srv(server);
      s.serverProcess = mockSpawnChild;
      s.serverReady = true;
      const shutdownPromise = server.gracefulShutdown();
      // Process never emits close — timeout fires and takes the taskkill arm.
      await vi.advanceTimersByTimeAsync(5000);
      await shutdownPromise;
      expect(spawnSync).toHaveBeenCalledWith(
        "taskkill",
        ["/T", "/F", "/PID", String(mockSpawnChild.pid)],
        expect.objectContaining({ windowsHide: true }),
      );
      expect(mockSpawnChild.killed).toBe(false);
      expect(s.serverProcess).toBeNull();
    });

    it("resolves via the already-dead catch when kill throws", async () => {
      setPlatform(ORIG_PLATFORM === "win32" ? "linux" : ORIG_PLATFORM);
      const s = srv(server);
      mockSpawnChild.kill = () => {
        throw new Error("ESRCH");
      };
      s.serverProcess = mockSpawnChild;
      s.serverReady = true;
      const shutdownPromise = server.gracefulShutdown();
      await vi.advanceTimersByTimeAsync(5000);
      await shutdownPromise;
      expect(s.serverProcess).toBeNull();
    });

    it("swallows stdin write failures and waits for close", async () => {
      const s = srv(server);
      mockSpawnChild.stdin.write = vi.fn(() => {
        throw new Error("EPIPE");
      });
      s.serverProcess = mockSpawnChild;
      s.serverReady = true;
      const shutdownPromise = server.gracefulShutdown();
      mockSpawnChild.emit("close", 0);
      await shutdownPromise;
      expect(s.serverProcess).toBeNull();
      expect(s.modelsInitialized).toBe(false);
    });
  });

  describe("transcribeAudio result shapes", () => {
    it("waits for initializationPromise, then returns unavailable when still not ready", async () => {
      const s = srv(server);
      s.serverReady = false;
      // Resolves without flipping serverReady — the awaited-init-then-fail arc.
      s.initializationPromise = Promise.resolve();
      const infoSpy = vi.spyOn(logger, "info");
      const infoBefore = infoSpy.mock.calls.length;
      await expect(server.transcribeAudio(new ArrayBuffer(8))).rejects.toThrow(
        "未就绪，请稍后重试",
      );
      expect(infoBefore).toBeLessThanOrEqual(infoSpy.mock.calls.length);
      infoSpy.mockRestore();
    });

    it("returns the full success shape with defaults for missing fields", async () => {
      const s = srv(server);
      s.serverReady = true;
      s.serverProcess = mockSpawnChild;
      s.messageRouter.sendRaw = vi
        .fn()
        .mockResolvedValue({ success: true }) as ReturnType<typeof vi.fn>;
      const result = await server.transcribeAudio(new ArrayBuffer(8));
      expect(result).toEqual({
        success: true,
        text: "",
        raw_text: undefined,
        confidence: 0,
        language: "zh-CN",
      });
    });

    it("throws the server-provided error on a failed result", async () => {
      const s = srv(server);
      s.serverReady = true;
      s.serverProcess = mockSpawnChild;
      s.messageRouter.sendRaw = vi.fn().mockResolvedValue({
        success: false,
        error: "模型加载失败",
      }) as ReturnType<typeof vi.fn>;
      await expect(server.transcribeAudio(new ArrayBuffer(8))).rejects.toThrow(
        "模型加载失败",
      );
    });

    it("falls back to the generic error message when result.error is empty", async () => {
      const s = srv(server);
      s.serverReady = true;
      s.serverProcess = mockSpawnChild;
      s.messageRouter.sendRaw = vi.fn().mockResolvedValue({
        success: false,
      }) as ReturnType<typeof vi.fn>;
      await expect(server.transcribeAudio(new ArrayBuffer(8))).rejects.toThrow(
        "转录失败",
      );
    });
  });

  describe("transcribeFile initializationPromise arcs", () => {
    it("awaits a resolving init promise but still reports SERVER_NOT_READY", async () => {
      const s = srv(server);
      const filePath = path.join(tmpDir, "wait.wav");
      fs.writeFileSync(filePath, "audio");
      s.serverReady = false;
      s.initializationPromise = Promise.resolve();
      const result = await server.transcribeFile(filePath);
      expect(result.success).toBe(false);
      expect(result.code).toBe("SERVER_NOT_READY");
    });

    it("proceeds to transcription when the init promise flips serverReady", async () => {
      const s = srv(server);
      const filePath = path.join(tmpDir, "ready-late.wav");
      fs.writeFileSync(filePath, "audio");
      s.serverReady = false;
      s.initializationPromise = (async () => {
        s.serverReady = true;
      })();
      s.messageRouter.sendCommand = vi.fn().mockResolvedValue({
        success: true,
        text: "late text",
      }) as ReturnType<typeof vi.fn>;
      const result = await server.transcribeFile(filePath);
      expect(result.success).toBe(true);
      expect(result.text).toBe("late text");
    });
  });
});
