// [20260729_Test_FunasrManagerOrchestration] Comprehensive unit tests for the
// orchestration + delegation surface of funasrManager.ts. Coverage target:
// raise funasrManager.ts from ~21% to 90%+. Reuses the established test-only
// structural surface (`asSurface` cast through `unknown`, no `any`) and the
// `vi.mock("electron")` top-level shim pattern from updateManager-behavioral
// and the funasrManager-init-race suites. The manager's three private
// collaborators (pythonEnv, modelManager, server) are exposed via the surface
// so delegation can be verified by spying on the collaborator and asserting
// the manager forwards args + return values.
// [20260729_Test_FunasrManagerOrchestration] END
import { describe, it, expect, vi, beforeEach } from "vitest";

// funasrManager.ts itself has no electron import, but its collaborators
// (pythonEnvironment / modelManager) lazily `require("electron")` inside
// try/catch guarded by NODE_ENV === "development". Provide a minimal stub so
// the lazy requires resolve if they are hit, matching the project-wide mock
// convention.
vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "0.0.0"),
    getPath: vi.fn(() => "/tmp"),
    getAppPath: vi.fn(() => "/tmp"),
  },
  shell: { openPath: vi.fn() },
}));

import FunASRManager from "../../src/helpers/funasrManager";

// [20260729_Test_FunasrManagerOrchestration] Test-only structural surface.
// Widened return types (Promise<unknown> / unknown) let vi.fn() mocks assign
// cleanly while keeping call-site args type-checked. No `any`.
interface ServerSurface {
  modelsInitialized: boolean;
  serverReady: boolean;
  initializationPromise: Promise<unknown> | null;
  restartCount: number;
  serverProcess: unknown;
  _startFunASRServer: (...args: never[]) => Promise<unknown>;
  _stopFunASRServer: (...args: never[]) => Promise<unknown>;
  _sendServerCommand: (...args: never[]) => Promise<unknown>;
  resetState: () => void;
  transcribeAudio: (...args: never[]) => Promise<unknown>;
  transcribeFile: (...args: never[]) => Promise<unknown>;
  diarizeAudio: (...args: never[]) => Promise<unknown>;
  cancelTranscription: (...args: never[]) => Promise<unknown>;
  gracefulShutdown: (...args: never[]) => Promise<unknown>;
}

interface PythonEnvSurface {
  pythonCmd: string | null;
  funasrInstalled: unknown;
  getFunASRServerPath: () => string;
  getEmbeddedPythonPath: () => string;
  setupIsolatedEnvironment: () => boolean;
  buildPythonEnvironment: () => NodeJS.ProcessEnv;
  findPythonExecutable: () => Promise<string>;
  checkPythonInstallation: () => Promise<{ installed: boolean }>;
  installPython: (
    cb: ((progress: Record<string, unknown>) => void) | null,
  ) => Promise<unknown>;
  checkFunASRInstallation: () => Promise<unknown>;
  installFunASR: (
    cb: ((progress: Record<string, unknown>) => void) | null,
  ) => Promise<unknown>;
  clearFunASRInstallCache: () => void;
}

interface ModelManagerSurface {
  modelsDownloaded: boolean | null;
  getModelCachePath: () => string;
  checkModelFiles: () => Promise<unknown>;
  getDownloadProgress: () => Promise<unknown>;
  downloadModels: (
    cb: ((progress: Record<string, unknown>) => void) | null,
    pythonCmd: string,
  ) => Promise<unknown>;
  clearCache: () => void;
}

interface FunASRManagerTestSurface {
  isInitialized: boolean;
  pythonEnv: PythonEnvSurface;
  modelManager: ModelManagerSurface;
  server: ServerSurface;
  // Public property accessors (getters) declared on the class.
  pythonCmd: string | null;
  funasrInstalled: unknown;
  modelsInitialized: boolean;
  serverReady: boolean;
  modelsDownloaded: boolean | null;
  initializationPromise: Promise<unknown> | null;
  // Public delegation methods.
  getFunASRServerPath: () => string;
  getEmbeddedPythonPath: () => string;
  setupIsolatedEnvironment: () => boolean;
  buildPythonEnvironment: () => NodeJS.ProcessEnv;
  findPythonExecutable: (...args: never[]) => Promise<string>;
  checkPythonInstallation: (
    ...args: never[]
  ) => Promise<{ installed: boolean }>;
  installPython: (
    cb: ((progress: Record<string, unknown>) => void) | null,
  ) => Promise<unknown>;
  checkFunASRInstallation: (...args: never[]) => Promise<unknown>;
  installFunASR: (
    cb: ((progress: Record<string, unknown>) => void) | null,
  ) => Promise<unknown>;
  getModelCachePath: () => string;
  checkModelFiles: () => Promise<unknown>;
  getDownloadProgress: () => Promise<unknown>;
  downloadModels: (
    cb: ((progress: Record<string, unknown>) => void) | null,
  ) => Promise<unknown>;
  transcribeAudio: (
    audioBlob: unknown,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  transcribeFile: (
    audioPath: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  diarizeAudio: (audioPath: string, segments: unknown) => Promise<unknown>;
  cancelTranscription: () => Promise<unknown>;
  gracefulShutdown: () => Promise<unknown>;
  // Orchestration methods under test.
  restartServer: () => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  initializeAtStartup: () => Promise<void>;
  preInitializeModels: () => Promise<unknown>;
  checkStatus: () => Promise<Record<string, unknown>>;
}

function asSurface(
  m: InstanceType<typeof FunASRManager>,
): FunASRManagerTestSurface {
  return m as unknown as FunASRManagerTestSurface;
}

/** Build a manager with a recording logger so we can assert call counts/args. */
function makeManager() {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const manager = new FunASRManager(logger);
  return { manager: asSurface(manager), logger };
}

describe("funasrManager property accessors", () => {
  it("pythonCmd delegates to pythonEnv.pythonCmd (defaults to null)", () => {
    const { manager } = makeManager();
    expect(manager.pythonCmd).toBeNull();
    // setter writes through to the collaborator
    manager.pythonCmd = "python3.11";
    expect(manager.pythonEnv.pythonCmd).toBe("python3.11");
    expect(manager.pythonCmd).toBe("python3.11");
  });

  it("funasrInstalled mirrors pythonEnv.funasrInstalled", () => {
    const { manager } = makeManager();
    expect(manager.funasrInstalled).toBeNull();
    manager.pythonEnv.funasrInstalled = { installed: true, working: true };
    expect(manager.funasrInstalled).toEqual({ installed: true, working: true });
  });

  it("modelsInitialized mirrors server.modelsInitialized", () => {
    const { manager } = makeManager();
    expect(manager.modelsInitialized).toBe(false);
    manager.server.modelsInitialized = true;
    expect(manager.modelsInitialized).toBe(true);
  });

  it("serverReady mirrors server.serverReady", () => {
    const { manager } = makeManager();
    expect(manager.serverReady).toBe(false);
    manager.server.serverReady = true;
    expect(manager.serverReady).toBe(true);
  });

  it("modelsDownloaded mirrors modelManager.modelsDownloaded", () => {
    const { manager } = makeManager();
    expect(manager.modelsDownloaded).toBeNull();
    manager.modelManager.modelsDownloaded = true;
    expect(manager.modelsDownloaded).toBe(true);
    manager.modelManager.modelsDownloaded = false;
    expect(manager.modelsDownloaded).toBe(false);
  });

  it("initializationPromise mirrors server.initializationPromise", async () => {
    const { manager } = makeManager();
    expect(manager.initializationPromise).toBeNull();
    const p = Promise.resolve();
    manager.server.initializationPromise = p;
    expect(manager.initializationPromise).toBe(p);
    await p;
  });
});

describe("funasrManager delegation methods", () => {
  it("getFunASRServerPath forwards to pythonEnv and returns its value", () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.pythonEnv, "getFunASRServerPath")
      .mockReturnValue("/srv/funasr_server.py");
    expect(manager.getFunASRServerPath()).toBe("/srv/funasr_server.py");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("findPythonExecutable forwards to pythonEnv and returns its resolved value", async () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.pythonEnv, "findPythonExecutable")
      .mockResolvedValue("/usr/local/bin/python3.11");
    await expect(manager.findPythonExecutable()).resolves.toBe(
      "/usr/local/bin/python3.11",
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("installPython forwards the callback to pythonEnv.installPython", async () => {
    const { manager } = makeManager();
    const cb = vi.fn();
    const spy = vi
      .spyOn(manager.pythonEnv, "installPython")
      .mockResolvedValue({ done: true });
    await expect(manager.installPython(cb)).resolves.toEqual({ done: true });
    expect(spy).toHaveBeenCalledWith(cb);
  });

  it("downloadModels resolves pythonCmd then forwards cb+pythonCmd to modelManager", async () => {
    const { manager } = makeManager();
    const cb = vi.fn();
    // downloadModels internally calls pythonEnv.findPythonExecutable to obtain
    // the pythonCmd it hands to modelManager.downloadModels.
    vi.spyOn(manager.pythonEnv, "findPythonExecutable").mockResolvedValue(
      "/py/3.11",
    );
    const dlSpy = vi
      .spyOn(manager.modelManager, "downloadModels")
      .mockResolvedValue({ success: true });
    await expect(manager.downloadModels(cb)).resolves.toEqual({
      success: true,
    });
    expect(dlSpy).toHaveBeenCalledWith(cb, "/py/3.11");
  });

  it("transcribeAudio forwards (blob, options) to server.transcribeAudio", async () => {
    const { manager } = makeManager();
    const blob = { size: 10 };
    const opts = { hotwords: "x" };
    const spy = vi
      .spyOn(manager.server, "transcribeAudio")
      .mockResolvedValue({ success: true, text: "hi" });
    await expect(manager.transcribeAudio(blob, opts)).resolves.toEqual({
      success: true,
      text: "hi",
    });
    expect(spy).toHaveBeenCalledWith(blob, opts);
  });

  it("transcribeFile forwards (path, options) to server.transcribeFile", async () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.server, "transcribeFile")
      .mockResolvedValue({ success: true });
    await expect(
      manager.transcribeFile("/audio/a.wav", { hotwords: "y" }),
    ).resolves.toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith("/audio/a.wav", { hotwords: "y" });
  });

  it("diarizeAudio forwards (path, segments) to server.diarizeAudio", async () => {
    const { manager } = makeManager();
    const segments = [{ start: 0, end: 1 }];
    const spy = vi
      .spyOn(manager.server, "diarizeAudio")
      .mockResolvedValue({ success: true });
    await expect(
      manager.diarizeAudio("/audio/a.wav", segments),
    ).resolves.toEqual({
      success: true,
    });
    expect(spy).toHaveBeenCalledWith("/audio/a.wav", segments);
  });

  it("cancelTranscription forwards to server.cancelTranscription", async () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.server, "cancelTranscription")
      .mockResolvedValue({ success: true });
    await expect(manager.cancelTranscription()).resolves.toEqual({
      success: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gracefulShutdown forwards to server.gracefulShutdown", async () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.server, "gracefulShutdown")
      .mockResolvedValue(undefined);
    await expect(manager.gracefulShutdown()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // Additional thin delegations to lift statement coverage above 90%.
  it("getEmbeddedPythonPath forwards to pythonEnv", () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.pythonEnv, "getEmbeddedPythonPath")
      .mockReturnValue("/py/bin/python3.11");
    expect(manager.getEmbeddedPythonPath()).toBe("/py/bin/python3.11");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("setupIsolatedEnvironment forwards to pythonEnv and returns its bool", () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.pythonEnv, "setupIsolatedEnvironment")
      .mockReturnValue(true);
    expect(manager.setupIsolatedEnvironment()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("buildPythonEnvironment forwards to pythonEnv and returns its env", () => {
    const { manager } = makeManager();
    const env: NodeJS.ProcessEnv = { PYTHONUTF8: "1" };
    const spy = vi
      .spyOn(manager.pythonEnv, "buildPythonEnvironment")
      .mockReturnValue(env);
    expect(manager.buildPythonEnvironment()).toBe(env);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("checkPythonInstallation forwards to pythonEnv", async () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.pythonEnv, "checkPythonInstallation")
      .mockResolvedValue({ installed: true });
    await expect(manager.checkPythonInstallation()).resolves.toEqual({
      installed: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("checkFunASRInstallation forwards to pythonEnv", async () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.pythonEnv, "checkFunASRInstallation")
      .mockResolvedValue({ installed: true, working: true });
    await expect(manager.checkFunASRInstallation()).resolves.toEqual({
      installed: true,
      working: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("installFunASR forwards the callback to pythonEnv.installFunASR", async () => {
    const { manager } = makeManager();
    const cb = vi.fn();
    const spy = vi
      .spyOn(manager.pythonEnv, "installFunASR")
      .mockResolvedValue({ success: true });
    await expect(manager.installFunASR(cb)).resolves.toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith(cb);
  });

  it("getModelCachePath forwards to modelManager", () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.modelManager, "getModelCachePath")
      .mockReturnValue("/cache/damo");
    expect(manager.getModelCachePath()).toBe("/cache/damo");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("getDownloadProgress forwards to modelManager", async () => {
    const { manager } = makeManager();
    const spy = vi
      .spyOn(manager.modelManager, "getDownloadProgress")
      .mockResolvedValue({
        progress: 50,
        stage: "downloading",
        downloaded: 1,
        total: 2,
      });
    await expect(manager.getDownloadProgress()).resolves.toEqual({
      progress: 50,
      stage: "downloading",
      downloaded: 1,
      total: 2,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("funasrManager restartServer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("success path: awaits init promise, stops running server, resets state, restarts", async () => {
    const { manager, logger } = makeManager();

    // Force the serverProcess-truthy branch so _stopFunASRServer is invoked.
    manager.server.serverProcess = { pid: 1234 };
    // A pre-existing initialization promise that must be awaited first.
    const initAwaited = vi.fn();
    manager.server.initializationPromise = Promise.resolve(initAwaited());

    // Orchestration dependency stubs (manager-level overrides).
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({ minimum_ready: true, models_downloaded: false }),
    );
    manager.findPythonExecutable = vi.fn(() => Promise.resolve("/py/3.11"));
    manager.getFunASRServerPath = vi.fn(() => "/srv/funasr_server.py");
    manager.setupIsolatedEnvironment = vi.fn(() => true);
    manager.buildPythonEnvironment = vi.fn(() => ({ PYTHONUTF8: "1" }));
    manager.getModelCachePath = vi.fn(() => "/cache/models");

    const stopSpy = vi
      .spyOn(manager.server, "_stopFunASRServer")
      .mockResolvedValue(undefined);
    const resetSpy = vi.spyOn(manager.server, "resetState");
    const clearModelCacheSpy = vi.spyOn(manager.modelManager, "clearCache");
    const clearFunasrCacheSpy = vi.spyOn(
      manager.pythonEnv,
      "clearFunASRInstallCache",
    );
    const startSpy = vi
      .spyOn(manager.server, "_startFunASRServer")
      .mockResolvedValue("started");

    manager.server.restartCount = 2; // should be reset to 0 on success

    const result = await manager.restartServer();

    expect(result).toEqual({ success: true, message: "FunASR服务器重启成功" });

    // init promise awaited first
    expect(initAwaited).toHaveBeenCalledTimes(1);
    // running server stopped
    expect(stopSpy).toHaveBeenCalledTimes(1);
    // state reset + caches cleared
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(clearModelCacheSpy).toHaveBeenCalledTimes(1);
    expect(clearFunasrCacheSpy).toHaveBeenCalledTimes(1);
    // models rechecked
    expect(manager.checkModelFiles).toHaveBeenCalledTimes(1);
    // server restarted with the resolved python/server/env/cache values
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith(
      { PYTHONUTF8: "1" },
      "/py/3.11",
      "/srv/funasr_server.py",
      "/cache/models",
    );
    // restartCount reset
    expect(manager.server.restartCount).toBe(0);
    // info logs emitted (start + stopped + complete)
    expect(logger.info).toHaveBeenCalled();
  });

  it("skips _stopFunASRServer when no serverProcess is running", async () => {
    const { manager } = makeManager();
    manager.server.serverProcess = null; // falsy → stop branch skipped
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({ minimum_ready: true, models_downloaded: true }),
    );
    manager.findPythonExecutable = vi.fn(() => Promise.resolve("/py"));
    manager.getFunASRServerPath = vi.fn(() => "/srv");
    manager.setupIsolatedEnvironment = vi.fn();
    manager.buildPythonEnvironment = vi.fn(() => ({}));
    manager.getModelCachePath = vi.fn(() => "/cache");

    const stopSpy = vi.spyOn(manager.server, "_stopFunASRServer");
    vi.spyOn(manager.server, "_startFunASRServer").mockResolvedValue(undefined);

    await manager.restartServer();

    expect(stopSpy).not.toHaveBeenCalled();
  });

  it("awaits a rejecting init promise without propagating the error", async () => {
    const { manager } = makeManager();
    manager.server.serverProcess = null;
    // rejecting init promise must be swallowed (restart continues)
    manager.server.initializationPromise = Promise.reject(
      new Error("init failed earlier"),
    );
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({ minimum_ready: true, models_downloaded: false }),
    );
    manager.findPythonExecutable = vi.fn(() => Promise.resolve("/py"));
    manager.getFunASRServerPath = vi.fn(() => "/srv");
    manager.setupIsolatedEnvironment = vi.fn();
    manager.buildPythonEnvironment = vi.fn(() => ({}));
    manager.getModelCachePath = vi.fn(() => "/cache");
    vi.spyOn(manager.server, "_startFunASRServer").mockResolvedValue(undefined);

    const result = await manager.restartServer();
    expect(result).toEqual({ success: true, message: "FunASR服务器重启成功" });
  });

  it("error path: missing models throws → returns {success:false, error}", async () => {
    const { manager, logger } = makeManager();
    manager.server.serverProcess = null;
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({ minimum_ready: false, models_downloaded: false }),
    );

    const result = await manager.restartServer();

    expect(result.success).toBe(false);
    expect(result.error).toBe("模型文件未下载，无法启动服务器");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("error path: _startFunASRServer rejects → caught and surfaced", async () => {
    const { manager, logger } = makeManager();
    manager.server.serverProcess = null;
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({ minimum_ready: false, models_downloaded: true }),
    );
    manager.findPythonExecutable = vi.fn(() => Promise.resolve("/py"));
    manager.getFunASRServerPath = vi.fn(() => "/srv");
    manager.setupIsolatedEnvironment = vi.fn();
    manager.buildPythonEnvironment = vi.fn(() => ({}));
    manager.getModelCachePath = vi.fn(() => "/cache");
    vi.spyOn(manager.server, "_startFunASRServer").mockRejectedValue(
      new Error("boom"),
    );

    const result = await manager.restartServer();

    expect(result).toEqual({ success: false, error: "boom" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("funasrManager initializeAtStartup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("success path: sets isInitialized=true and triggers preInitializeModels", async () => {
    const { manager, logger } = makeManager();
    let preCalled = false;
    manager.findPythonExecutable = vi.fn(() => Promise.resolve("/py/3.11"));
    manager.checkFunASRInstallation = vi.fn(() =>
      Promise.resolve({ installed: true, working: true }),
    );
    // Stub preInitializeModels to detect it was invoked; suppress real startup.
    vi.spyOn(
      manager as unknown as { preInitializeModels: () => Promise<unknown> },
      "preInitializeModels",
    ).mockImplementation(() => {
      preCalled = true;
      return Promise.resolve(null);
    });

    await manager.initializeAtStartup();

    expect(manager.isInitialized).toBe(true);
    expect(preCalled).toBe(true);
    // start + python-found + funasr-check-done + complete info logs
    expect(logger.info).toHaveBeenCalled();
  });

  it("failure path: findPythonExecutable rejects → warns but still calls preInitializeModels", async () => {
    const { manager, logger } = makeManager();
    let preCalled = false;
    manager.findPythonExecutable = vi.fn(() =>
      Promise.reject(new Error("no python")),
    );
    vi.spyOn(
      manager as unknown as { preInitializeModels: () => Promise<unknown> },
      "preInitializeModels",
    ).mockImplementation(() => {
      preCalled = true;
      return Promise.resolve(null);
    });

    await manager.initializeAtStartup();

    // isInitialized stays false because the try-block threw before assignment
    expect(manager.isInitialized).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "FunASR启动初始化失败，但不影响应用启动",
      expect.any(Error),
    );
    expect(preCalled).toBe(true);
  });
});

describe("funasrManager checkStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("serverReady=true: forwards {action:'status'} to server._sendServerCommand", async () => {
    const { manager } = makeManager();
    manager.server.serverReady = true;
    const spy = vi
      .spyOn(manager.server, "_sendServerCommand")
      .mockResolvedValue({ success: true, models: 3 });

    const status = await manager.checkStatus();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ action: "status" });
    expect(status).toEqual({ success: true, models: 3 });
  });

  it("not ready, installed + minimum_ready: returns starting status", async () => {
    const { manager } = makeManager();
    manager.server.serverReady = false;
    manager.server.initializationPromise = Promise.resolve();
    manager.checkFunASRInstallation = vi.fn(() =>
      Promise.resolve({ installed: true }),
    );
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({
        minimum_ready: true,
        models_downloaded: false,
        missing_models: ["punc"],
      }),
    );

    const status = (await manager.checkStatus()) as Record<string, unknown>;

    expect(status).toMatchObject({
      success: true,
      error: "FunASR服务器正在启动中...",
      installed: true,
      models_downloaded: false,
      minimum_ready: true,
      missing_models: ["punc"],
      initializing: true,
    });
  });

  it("not ready, installed, only models_downloaded (no minimum_ready): starting branch", async () => {
    const { manager } = makeManager();
    manager.server.serverReady = false;
    manager.server.initializationPromise = null;
    manager.checkFunASRInstallation = vi.fn(() =>
      Promise.resolve({ installed: true }),
    );
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({
        minimum_ready: false,
        models_downloaded: true,
        missing_models: [],
      }),
    );

    const status = (await manager.checkStatus()) as Record<string, unknown>;

    // installed + (minimum_ready || models_downloaded) → success true, starting
    expect(status.success).toBe(true);
    expect(status.error).toBe("FunASR服务器正在启动中...");
    expect(status.minimum_ready).toBe(false);
    expect(status.initializing).toBe(false);
  });

  it("not ready, installed, but no models at all: returns models-missing error", async () => {
    const { manager } = makeManager();
    manager.server.serverReady = false;
    manager.checkFunASRInstallation = vi.fn(() =>
      Promise.resolve({ installed: true }),
    );
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({
        minimum_ready: false,
        models_downloaded: false,
        missing_models: ["asr", "vad", "punc"],
      }),
    );

    const status = (await manager.checkStatus()) as Record<string, unknown>;

    expect(status).toMatchObject({
      success: false,
      error: "模型文件未下载，请先下载模型",
      installed: true,
      models_downloaded: false,
      minimum_ready: false,
      missing_models: ["asr", "vad", "punc"],
    });
  });

  it("not ready and not installed: returns default 'FunASR未安装' error", async () => {
    const { manager } = makeManager();
    manager.server.serverReady = false;
    manager.checkFunASRInstallation = vi.fn(() =>
      Promise.resolve({ installed: false }),
    );
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({
        minimum_ready: false,
        models_downloaded: false,
        missing_models: ["all"],
      }),
    );

    const status = (await manager.checkStatus()) as Record<string, unknown>;

    expect(status).toMatchObject({
      success: false,
      error: "FunASR未安装",
      installed: false,
      minimum_ready: false,
      missing_models: ["all"],
    });
  });

  it("missing_models undefined falls back to empty array", async () => {
    const { manager } = makeManager();
    manager.server.serverReady = false;
    manager.checkFunASRInstallation = vi.fn(() =>
      Promise.resolve({ installed: false }),
    );
    // checkModelFiles omits missing_models entirely → `|| []` fallback
    manager.checkModelFiles = vi.fn(() =>
      Promise.resolve({ minimum_ready: false, models_downloaded: false }),
    );

    const status = (await manager.checkStatus()) as Record<string, unknown>;

    expect(status.missing_models).toEqual([]);
    expect(status.minimum_ready).toBe(false);
  });

  it("catch path: checkFunASRInstallation throws → returns generic failure", async () => {
    const { manager } = makeManager();
    manager.server.serverReady = false;
    manager.checkFunASRInstallation = vi.fn(() =>
      Promise.reject(new Error("spawn failed")),
    );

    const status = (await manager.checkStatus()) as Record<string, unknown>;

    expect(status).toEqual({
      success: false,
      error: "spawn failed",
      installed: false,
      models_downloaded: false,
    });
  });
});
