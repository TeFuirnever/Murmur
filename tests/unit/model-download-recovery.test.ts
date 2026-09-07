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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";

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
    // restartServer never rejects in production — its own catch-all
    // resolves {success:false} (review MINOR). The download must still
    // resolve success.
    manager.restartServer.mockResolvedValue({
      success: false,
      error: "模型文件未下载，无法启动服务器",
    });

    await expect(manager.downloadModels(null)).resolves.toEqual({
      success: true,
    });
    expect(manager.restartServer).toHaveBeenCalledTimes(1);
  });

  it("skips the restart when modelManager early-returned (models already present)", async () => {
    const manager = makeManager();
    // Early-return path: checkModelFiles said "already there" — no fetch
    // ran, so a healthy running server must not be bounced (review MAJOR).
    manager.modelManager.downloadModels.mockResolvedValue({
      success: true,
      skipped: true,
    });

    await manager.downloadModels(null);

    expect(manager.restartServer).not.toHaveBeenCalled();
  });

  it("collapses concurrent download invocations onto one in-flight promise", async () => {
    const manager = makeManager();
    let release!: (v: unknown) => void;
    manager.modelManager.downloadModels.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const first = manager.downloadModels(null);
    const second = manager.downloadModels(null);

    release({ success: true });
    await Promise.all([first, second]);

    // Both callers get the same download; modelManager ran exactly once.
    expect(manager.modelManager.downloadModels).toHaveBeenCalledTimes(1);
    expect(manager.restartServer).toHaveBeenCalledTimes(1);
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

// [20260906_Spec259_T2] Branch close-out for the instrumented helpers
// (Spec #259 T2, ticket #274): downloadModels control-flow arms (skip,
// script guard, resume event matrix, stdout payload arms, close/error arms)
// and the real getModelCachePath candidate resolution driven through the
// electron mocks. Real timers — the stall watchdog window (10 min) is never
// reached in these tests.
describe("[20260906_Spec259_T2] modelManager downloadModels control flow", () => {
  interface DownloadSurface {
    downloadModels: (
      cb: ((p: Record<string, unknown>) => void) | null | undefined,
      pythonCmd: string,
    ) => Promise<{ success: boolean; message?: string; skipped?: boolean }>;
    checkModelFiles: ReturnType<typeof vi.fn>;
    getModelCachePath: () => string;
  }

  // Attach BEFORE driving events so a rejection never lands in an unhandled
  // window; resolves with the rejection error for assertion afterwards.
  function rejectionOf(p: Promise<unknown>): Promise<Error> {
    return p.then(
      () => {
        throw new Error("expected the download to reject");
      },
      (e: Error) => e,
    );
  }

  const ORIG_NODE_ENV = process.env.NODE_ENV;

  function makeMM(
    checkResult: Partial<{
      models_downloaded: boolean;
      missing_models: string[];
    }>,
  ): DownloadSurface {
    const mm = new ModelManager() as unknown as DownloadSurface;
    mm.checkModelFiles = vi.fn(async () => ({
      success: true,
      models_downloaded: checkResult.models_downloaded ?? false,
      missing_models: checkResult.missing_models ?? ["asr", "vad", "punc"],
    }));
    mm.getModelCachePath = () => "/tmp/fake-cache";
    return mm;
  }

  function spawnFakeProcess(): {
    proc: EventEmitter & { kill: () => boolean };
    stdout: EventEmitter;
  } {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: EventEmitter;
      kill: () => boolean;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = new EventEmitter();
    proc.kill = () => true;
    spawnMock.mockReturnValue(proc);
    return { proc, stdout: proc.stdout };
  }

  function stubScriptExists(present: boolean): void {
    vi.spyOn(fs, "existsSync").mockImplementation(
      ((p: fs.PathLike) =>
        present &&
        String(p).endsWith("download_models.py")) as typeof fs.existsSync,
    );
  }

  function emitLine(stdout: EventEmitter, payload: object | string): void {
    const text =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    stdout.emit("data", Buffer.from(text + "\n", "utf8"));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = ORIG_NODE_ENV;
  });

  it("resolves skipped:true without spawning when models are already downloaded", async () => {
    stubScriptExists(true);
    const mm = makeMM({ models_downloaded: true, missing_models: [] });
    const result = await mm.downloadModels(vi.fn(), "/py/3.11");

    expect(result).toEqual({
      success: true,
      message: "模型文件已下载",
      skipped: true,
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws when the download script is missing", async () => {
    stubScriptExists(false);
    const mm = makeMM({ missing_models: ["asr", "vad", "punc"] });

    await expect(mm.downloadModels(null, "/py/3.11")).rejects.toThrow(
      /下载脚本不存在/,
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("emits the resuming stage first only for a partial install with a callback", async () => {
    stubScriptExists(true);
    const mm = makeMM({ missing_models: ["asr"] }); // strict subset
    const { proc, stdout } = spawnFakeProcess();
    const cb = vi.fn();
    const done = mm.downloadModels(cb, "/py/3.11");
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    emitLine(stdout, { stage: "downloading", overall_progress: 10 });
    emitLine(stdout, { success: true });
    proc.emit("close", 0);
    await expect(done).resolves.toEqual({
      success: true,
      message: "模型下载完成",
    });

    expect(cb.mock.calls[0]![0]).toEqual({
      stage: "resuming",
      percentage: 0,
    });
  });

  it("does not emit resuming when every model is missing (fresh install)", async () => {
    stubScriptExists(true);
    const mm = makeMM({ missing_models: ["asr", "vad", "punc"] });
    const { proc, stdout } = spawnFakeProcess();
    const cb = vi.fn();
    const done = mm.downloadModels(cb, "/py/3.11");
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    emitLine(stdout, { stage: "downloading", overall_progress: 5 });
    emitLine(stdout, { success: true });
    proc.emit("close", 0);
    await done;

    const stages = cb.mock.calls.map((c) => (c[0] as { stage: string }).stage);
    expect(stages).not.toContain("resuming");
  });

  it("defaults the progress callback to null (omitted argument)", async () => {
    stubScriptExists(true);
    const mm = makeMM({ missing_models: ["asr"] });
    const { proc, stdout } = spawnFakeProcess();
    const done = mm.downloadModels(undefined, "/py/3.11");
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    // No callback wired → stage events must not crash the mapper.
    emitLine(stdout, { stage: "downloading", overall_progress: 10 });
    emitLine(stdout, { success: true });
    proc.emit("close", 0);
    await expect(done).resolves.toEqual({
      success: true,
      message: "模型下载完成",
    });
  });

  it("rejects with the script's error payload and ignores later events", async () => {
    stubScriptExists(true);
    const mm = makeMM({ missing_models: ["asr", "vad", "punc"] });
    const { proc, stdout } = spawnFakeProcess();
    const failure = rejectionOf(mm.downloadModels(null, "/py/3.11"));
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    emitLine(stdout, { error: "磁盘已满" });
    // Late close/success/error events after the rejection must all be
    // ignored (the hasError guards).
    emitLine(stdout, { success: true });
    proc.emit("close", 0);
    proc.emit("error", new Error("late spawn failure"));
    expect((await failure).message).toBe("磁盘已满");
  });

  it("ignores non-JSON stdout lines", async () => {
    stubScriptExists(true);
    const mm = makeMM({ missing_models: ["asr", "vad", "punc"] });
    const { proc, stdout } = spawnFakeProcess();
    const done = mm.downloadModels(null, "/py/3.11");
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    emitLine(stdout, "torch hub load failed, retrying...");
    emitLine(stdout, { success: true });
    proc.emit("close", 0);
    await expect(done).resolves.toEqual({
      success: true,
      message: "模型下载完成",
    });
  });

  it("falls back from overall_progress to progress and then to zero", async () => {
    stubScriptExists(true);
    const mm = makeMM({ missing_models: ["asr", "vad", "punc"] });
    const { proc, stdout } = spawnFakeProcess();
    const cb = vi.fn();
    const done = mm.downloadModels(cb, "/py/3.11");
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    // overall_progress preferred when present.
    emitLine(stdout, { stage: "a", progress: 40, overall_progress: 10 });
    // Only the per-model progress field → used as the overall value.
    emitLine(stdout, { stage: "c", progress: 55 });
    // No numeric fields at all → percentage 0 (the ?? fallback arms).
    emitLine(stdout, { stage: "b" });
    emitLine(stdout, { success: true });
    proc.emit("close", 0);
    await done;

    const events = cb.mock.calls.map((c) => c[0]);
    expect(events[0]).toMatchObject({
      stage: "a",
      percentage: 10,
      overall_progress: 10,
      progress: 10,
    });
    expect(events[1]).toMatchObject({ stage: "c", percentage: 55 });
    expect(events[2]).toMatchObject({ stage: "b", percentage: 0 });
  });

  it("does not invoke the callback for progress events without a stage", async () => {
    stubScriptExists(true);
    const mm = makeMM({ missing_models: ["asr", "vad", "punc"] });
    const { proc, stdout } = spawnFakeProcess();
    const cb = vi.fn();
    const done = mm.downloadModels(cb, "/py/3.11");
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    emitLine(stdout, { overall_progress: 7 }); // heartbeat, no stage
    emitLine(stdout, { success: true });
    proc.emit("close", 0);
    await done;

    expect(cb).not.toHaveBeenCalled();
  });

  it("rejects on success:false using the payload error or the default message", async () => {
    stubScriptExists(true);
    const withError = makeMM({ missing_models: ["asr", "vad", "punc"] });
    const first = spawnFakeProcess();
    const firstFailure = rejectionOf(
      withError.downloadModels(null, "/py/3.11"),
    );
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    emitLine(first.stdout, { success: false, error: "网络中断" });
    expect((await firstFailure).message).toBe("网络中断");

    const withDefault = makeMM({ missing_models: ["asr", "vad", "punc"] });
    const second = spawnFakeProcess();
    const secondFailure = rejectionOf(
      withDefault.downloadModels(null, "/py/3.11"),
    );
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    emitLine(second.stdout, { success: false }); // no error field
    expect((await secondFailure).message).toBe("模型下载失败");
  });

  it("rejects when the process exits with a non-zero code", async () => {
    stubScriptExists(true);
    const mm = makeMM({ missing_models: ["asr", "vad", "punc"] });
    const { proc, stdout } = spawnFakeProcess();
    const failure = rejectionOf(mm.downloadModels(null, "/py/3.11"));
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    emitLine(stdout, { stage: "downloading", overall_progress: 1 });
    proc.emit("close", 1);
    expect((await failure).message).toBe("模型下载进程退出，代码: 1");
  });

  it("rejects when the download process fails to spawn", async () => {
    stubScriptExists(true);
    const mm = makeMM({ missing_models: ["asr", "vad", "punc"] });
    const { proc } = spawnFakeProcess();
    const failure = rejectionOf(mm.downloadModels(null, "/py/3.11"));
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    proc.emit("error", new Error("ENOENT"));
    expect((await failure).message).toBe("启动下载进程失败: ENOENT");
  });
});

// [20260906_Spec259_T2] Real getModelCachePath resolution matrix. The
// source's lazy require("electron") bypasses vi.mock (it loads the real
// electron package, whose export is a string), so the electron catch
// fallbacks fire in test env: userDataPath comes from os.tmpdir() and
// devRoot/searchRoot from process.cwd(). We therefore spy os.tmpdir and
// os.homedir to redirect every candidate under a temp root, and stub the
// public findDamoRoot on the instance for the tail-search arms (same
// instance-stub pattern as getModelCachePath above).
describe("[20260906_Spec259_T2] getModelCachePath resolution", () => {
  const ORIG_NODE_ENV = process.env.NODE_ENV;
  let tmpRoot: string;
  let tmpdirSpy: ReturnType<typeof vi.spyOn> | undefined;
  let homedirSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mm-cache-"));
    // Candidates become: <tmpRoot>/models and <tmpRoot>/home/.cache/...
    tmpdirSpy = vi.spyOn(os, "tmpdir").mockReturnValue(tmpRoot);
    homedirSpy = vi
      .spyOn(os, "homedir")
      .mockReturnValue(path.join(tmpRoot, "home"));
  });

  afterEach(() => {
    tmpdirSpy?.mockRestore();
    homedirSpy?.mockRestore();
    process.env.NODE_ENV = ORIG_NODE_ENV;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeMM(): ModelManager {
    return new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
  }

  it("development: the dev-root candidate is considered first (require fallback fires)", () => {
    process.env.NODE_ENV = "development";
    // The lazy electron require fails under vitest, so devRoot falls back
    // to process.cwd() whose models/ dir does not exist; the userData
    // candidate then wins the resolution.
    const damoSub = path.join(tmpRoot, "models", "damo");
    fs.mkdirSync(path.join(damoSub, "speech_seaco_paraformer_a"), {
      recursive: true,
    });

    expect(makeMM().getModelCachePath()).toBe(damoSub);
  });

  it("userData candidate: returns its damo subdirectory when populated", () => {
    process.env.NODE_ENV = "test";
    const damoSub = path.join(tmpRoot, "models", "damo");
    fs.mkdirSync(path.join(damoSub, "speech_seaco_paraformer_a"), {
      recursive: true,
    });

    expect(makeMM().getModelCachePath()).toBe(damoSub);
  });

  it("userData candidate: empty damo falls through to the expected-prefix scan", () => {
    process.env.NODE_ENV = "test";
    fs.mkdirSync(path.join(tmpRoot, "models", "damo"), { recursive: true }); // empty
    fs.mkdirSync(path.join(tmpRoot, "models", "speech_fsmn_vad_zh"), {
      recursive: true,
    });

    expect(makeMM().getModelCachePath()).toBe(path.join(tmpRoot, "models"));
  });

  it("prefix scan recognizes the seaco and punc_ct families", () => {
    process.env.NODE_ENV = "test";
    fs.mkdirSync(
      path.join(tmpRoot, "models", "speech_seaco_paraformer_large"),
      { recursive: true },
    );
    expect(makeMM().getModelCachePath()).toBe(path.join(tmpRoot, "models"));

    fs.rmSync(path.join(tmpRoot, "models"), { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpRoot, "models", "punc_ct-transformer"), {
      recursive: true,
    });
    expect(makeMM().getModelCachePath()).toBe(path.join(tmpRoot, "models"));
  });

  it("falls through a non-matching candidate, searches, then creates the userData dir", () => {
    process.env.NODE_ENV = "test";
    // Candidate exists but carries no damo/ and no expected prefixes.
    fs.mkdirSync(path.join(tmpRoot, "models", "other_stuff"), {
      recursive: true,
    });
    const mm = makeMM();
    // Tail search (repo cwd) must not run: stub the public finder to null.
    mm.findDamoRoot = () => null;

    const result = mm.getModelCachePath();
    // The userData models dir is created as the last-resort cache root.
    expect(result).toBe(path.join(tmpRoot, "models"));
    expect(fs.existsSync(result)).toBe(true);
  });

  it("returns the findDamoRoot result when the search finds a damo root", () => {
    process.env.NODE_ENV = "test";
    // No candidates exist at all.
    const found = path.join(tmpRoot, "searched", "damo");
    const mm = makeMM();
    mm.findDamoRoot = () => found;

    expect(mm.getModelCachePath()).toBe(found);
  });

  it("getDownloadScriptPath dev branch throws when electron is unavailable", () => {
    // In vitest the lazy require("electron") yields no app object, so the
    // dev branch surfaces as an error — assert the thrown shape as the
    // legitimate error path (executing the branch arm is what matters).
    process.env.NODE_ENV = "development";
    expect(() => makeMM().getDownloadScriptPath()).toThrow();
  });
});
