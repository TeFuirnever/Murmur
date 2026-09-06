// [20260905_Fix_254_DownloadStallTimeout] Regression tests for issue #254.
//
// modelManager.downloadModels used a 10-minute ABSOLUTE watchdog: on a slow
// network a >1.2GB model download was killed mid-flight even while bytes
// kept flowing (one of the #212 symptom chains: "下载→到点→重来").
// snapshot_download supports resume, so the watchdog must be STALL-based:
// only idle time (no forward progress) may trip it, and the timeout error
// must tell the user the partial download is kept and a retry resumes.
//
// Contracts locked here:
// 1. Growing progress events keep re-arming the watchdog — a download that
//    streams progress for >10 minutes total must NOT be killed.
// 2. A plateau (same percentage repeated) does NOT re-arm the watchdog —
//    only strict growth counts as progress.
// 3. A stall (no growth) for the stall window kills the process and the
//    rejection message mentions the retained partial download + resume.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

// Same electron stub approach as model-download-recovery.test.ts —
// getDownloadScriptPath reads app paths through lazy electron require.
if (!process.resourcesPath) {
  Object.assign(process, { resourcesPath: "/fake/resources" });
}
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/fake-userdata"),
    getAppPath: vi.fn(() => "/fake/app"),
  },
}));

import ModelManager from "../../src/helpers/modelManager";

interface DownloadSurface {
  downloadModels: (
    cb: ((p: Record<string, unknown>) => void) | null,
    pythonCmd: string,
  ) => Promise<{ success: boolean; message?: string }>;
  checkModelFiles: ReturnType<typeof vi.fn>;
  getModelCachePath: () => string;
}

const STALL_WINDOW_MS = 10 * 60 * 1000;

function makeManager(): DownloadSurface {
  const mm = new ModelManager() as unknown as DownloadSurface;
  mm.checkModelFiles = vi.fn(async () => ({
    success: true,
    models_downloaded: false,
    missing_models: ["asr", "vad", "punc"],
  }));
  mm.getModelCachePath = () => "/tmp/fake-cache";
  return mm;
}

function spawnFakeProcess(): { proc: EventEmitter; stdout: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter;
    killed: boolean;
    kill: () => boolean;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
    return true;
  };
  spawnMock.mockReturnValue(proc);
  return { proc, stdout: proc.stdout };
}

function emitProgress(stdout: EventEmitter, overall: number): void {
  stdout.emit(
    "data",
    Buffer.from(
      JSON.stringify({
        stage: "downloading",
        progress: overall,
        overall_progress: overall,
      }),
      "utf8",
    ),
  );
}

describe("[20260905_Fix_254_DownloadStallTimeout] modelManager stall watchdog", () => {
  let existsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    existsSpy = vi
      .spyOn(fs, "existsSync")
      .mockImplementation(((p: fs.PathLike) =>
        String(p).endsWith("download_models.py")) as typeof fs.existsSync);
  });

  afterEach(() => {
    vi.useRealTimers();
    existsSpy.mockRestore();
  });

  async function spawnDownload(): Promise<{
    proc: EventEmitter;
    stdout: EventEmitter;
    done: Promise<{ success: boolean; message?: string }>;
  }> {
    const mm = makeManager();
    const { proc, stdout } = spawnFakeProcess();
    const done = mm.downloadModels(null, "/py/3.11");
    // downloadModels awaits checkModelFiles (async) before spawning — flush
    // the microtask queue so the fake timers can drive the watchdog.
    await vi.advanceTimersByTimeAsync(0);
    expect(spawnMock).toHaveBeenCalled();
    return { proc, stdout, done };
  }

  it("does not kill a download that keeps making progress past the old absolute 10-minute cap", async () => {
    const { stdout, proc, done } = await spawnDownload();

    // One progress tick per minute of real growth, for 12 total minutes of
    // wall time — the old absolute watchdog would have killed this at 10.
    for (let minute = 1; minute <= 12; minute++) {
      await vi.advanceTimersByTimeAsync(60 * 1000);
      emitProgress(stdout, minute * 5);
    }
    emitProgress(stdout, 100);
    stdout.emit("data", Buffer.from(JSON.stringify({ success: true }), "utf8"));
    proc.emit("close", 0);

    await expect(done).resolves.toEqual({
      success: true,
      message: "模型下载完成",
    });
  });

  it("still times out when progress plateaus — repeated equal values do not re-arm the watchdog", async () => {
    const { stdout, done } = await spawnDownload();
    // Attach the catch handler BEFORE advancing timers so the rejection
    // never lands in an unhandled window; the assertion happens after.
    // (Inline `expect(done).rejects.*` attachment is reserved for direct
    // awaits by the rejection-assertions-awaited suite rule.)
    let stallError: Error | undefined;
    const settled = done.catch((error: Error) => {
      stallError = error;
    });

    emitProgress(stdout, 50);
    // Heartbeat-style events at the SAME value every minute: no growth, so
    // the watchdog must keep its original deadline.
    for (let minute = 1; minute <= 9; minute++) {
      await vi.advanceTimersByTimeAsync(60 * 1000);
      emitProgress(stdout, 50);
    }

    await vi.advanceTimersByTimeAsync(STALL_WINDOW_MS);
    await settled;
    expect(stallError?.message).toMatch(/保留|续传/);

    const spawned = spawnMock.mock.results[0]?.value as EventEmitter & {
      killed: boolean;
    };
    expect(spawned.killed).toBe(true);
  });

  it("rejects with a resume hint when the download stalls past the window", async () => {
    const { done } = await spawnDownload();
    let stallError: Error | undefined;
    const settled = done.catch((error: Error) => {
      stallError = error;
    });

    // No progress event ever arrives (hang at start) — pure idle timeout.
    await vi.advanceTimersByTimeAsync(STALL_WINDOW_MS + 1000);
    await settled;
    expect(stallError?.message).toMatch(/已保留.*续传|保留.*续传/);

    // The stale process must have been killed, not left running.
    const spawned = spawnMock.mock.results[0]?.value as EventEmitter & {
      killed: boolean;
    };
    expect(spawned.killed).toBe(true);
  });
});
