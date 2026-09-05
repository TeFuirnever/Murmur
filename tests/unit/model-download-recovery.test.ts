// [20260905_Fix_216_DownloadRecovery] Regression tests for issues #216/#212.
//
// #216 (server stuck on models_not_downloaded after download): the FunASR
// server is launched with `--damo-root` resolved by Node's getModelCachePath()
// AT SERVER START. On a fresh install that path is userData/models (empty);
// download_models.py then drops the models into modelscope's own cache
// (~/.cache/modelscope/hub/models/damo). Node's checkModelFiles re-resolves
// and sees them, but the RUNNING server keeps its stale --damo-root and
// reports models_not_downloaded forever. Contract: after modelManager
// reports download success, funasrManager MUST restart the server so it
// boots with the freshly-resolved cache root.
//
// #212 (progress stuck at 0%): download_models.py emits
// {stage, model, progress, overall_progress} but modelManager's stdout
// mapper read `result.percentage` — a field the script never sends — so
// every progress event reached the UI as 0%. Contract: the mapper uses the
// fields the script actually sends (overall_progress preferred).
//
// Harness mirrors funasrManager-orchestration.test.ts (makeManager-style
// stubs) and model-download-guards.test.ts (spawn mocking).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

// getDownloadScriptPath lazily require()s electron for app.getAppPath();
// NODE_ENV is "test" (non-dev) in vitest so it takes the resourcesPath
// branch instead — stub both to avoid touching real electron. The property
// is typed read-only, so assign via Object.assign.
if (!process.resourcesPath) {
  Object.assign(process, { resourcesPath: "/fake/resources" });
}
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/fake-userdata"),
    getAppPath: vi.fn(() => "/fake/app"),
  },
}));

import FunASRManager from "../../src/helpers/funasrManager";
import ModelManager from "../../src/helpers/modelManager";

interface FunASRManagerSurface {
  pythonEnv: { findPythonExecutable: ReturnType<typeof vi.fn> };
  modelManager: { downloadModels: ReturnType<typeof vi.fn> };
  restartServer: ReturnType<typeof vi.fn>;
  downloadModels: (
    cb: ((progress: Record<string, unknown>) => void) | null,
  ) => Promise<unknown>;
}

function makeManager(): FunASRManagerSurface {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const manager = new FunASRManager(logger) as unknown as FunASRManagerSurface;
  manager.pythonEnv = {
    findPythonExecutable: vi.fn(async () => "/py/3.11"),
  } as unknown as FunASRManagerSurface["pythonEnv"];
  manager.modelManager = {
    downloadModels: vi.fn(),
  } as unknown as FunASRManagerSurface["modelManager"];
  manager.restartServer = vi.fn(async () => ({ success: true }));
  return manager;
}

describe("[20260905_Fix_216_DownloadRecovery] funasrManager.downloadModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restarts the server after a successful download", async () => {
    const manager = makeManager();
    manager.modelManager.downloadModels.mockResolvedValue({
      success: true,
    });

    await manager.downloadModels(null);

    expect(manager.restartServer).toHaveBeenCalledTimes(1);
  });

  it("does not restart the server when the download fails", async () => {
    const manager = makeManager();
    manager.modelManager.downloadModels.mockRejectedValue(
      new Error("网络错误"),
    );

    await expect(manager.downloadModels(null)).rejects.toThrow("网络错误");
    expect(manager.restartServer).not.toHaveBeenCalled();
  });

  it("still resolves success when the post-download restart fails", async () => {
    const manager = makeManager();
    manager.modelManager.downloadModels.mockResolvedValue({
      success: true,
    });
    manager.restartServer.mockRejectedValue(new Error("重启失败"));

    await expect(manager.downloadModels(null)).resolves.toEqual({
      success: true,
    });
  });

  it("forwards the progress callback to modelManager", async () => {
    const manager = makeManager();
    manager.modelManager.downloadModels.mockResolvedValue({
      success: true,
    });
    const cb = vi.fn();

    await manager.downloadModels(cb);

    expect(manager.modelManager.downloadModels).toHaveBeenCalledWith(
      cb,
      "/py/3.11",
    );
  });
});

describe("[20260905_Fix_216_DownloadRecovery] modelManager progress mapping", () => {
  interface DownloadSurface {
    downloadModels: (
      cb: ((p: Record<string, unknown>) => void) | null,
      pythonCmd: string,
    ) => Promise<{ success: boolean; message?: string }>;
  }

  function spawnFakeProcess(): { proc: EventEmitter; stdout: EventEmitter } {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = new EventEmitter();
    spawnMock.mockReturnValue(proc);
    return { proc, stdout: proc.stdout };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps overall_progress from script output to the progress callback", async () => {
    const mm = new ModelManager() as unknown as DownloadSurface & {
      checkModelFiles: ReturnType<typeof vi.fn>;
      getModelCachePath: () => string;
    };
    mm.checkModelFiles = vi.fn(async () => ({
      success: true,
      models_downloaded: false,
      missing_models: ["asr", "vad", "punc"],
    }));
    mm.getModelCachePath = () => "/tmp/fake-cache";
    // The script-existence guard resolves to
    // <resourcesPath>/app.asar.unpacked/download_models.py under the fake
    // electron paths above — satisfy it without a real file.
    const existsSpy = vi
      .spyOn(fs, "existsSync")
      .mockImplementation(((p: fs.PathLike) =>
        String(p).endsWith("download_models.py")) as typeof fs.existsSync);

    const { stdout, proc } = spawnFakeProcess();
    const cb = vi.fn();
    const done = mm.downloadModels(cb, "/py/3.11");

    // downloadModels awaits checkModelFiles before spawning — wait for the
    // spawn, then drive the fake process's stdout.
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    // Simulate download_models.py emitting the fields it actually sends.
    stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          stage: "downloading",
          model: "asr",
          progress: 35,
          overall_progress: 12.5,
          completed: 0,
          total: 3,
        }),
        "utf8",
      ),
    );
    stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          stage: "completed",
          model: "asr",
          progress: 100,
          overall_progress: 33.3,
          completed: 1,
          total: 3,
        }),
        "utf8",
      ),
    );
    stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ success: true, message: "所有模型下载完成" }),
        "utf8",
      ),
    );
    proc.emit("close", 0);

    await expect(done).resolves.toEqual({
      success: true,
      message: "模型下载完成",
    });
    existsSpy.mockRestore();

    const progressEvents = cb.mock.calls.map((c) => c[0]);
    // The mapper must NOT drop real progress to 0 (the old
    // `result.percentage || 0` bug — the script never sends `percentage`).
    expect(progressEvents[0]).toMatchObject({ percentage: 12.5 });
    expect(progressEvents[1]).toMatchObject({ percentage: 33.3 });
  });
});
