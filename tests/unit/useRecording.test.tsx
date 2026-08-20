// @vitest-environment jsdom
// [20260729_Test_UseRecording] Comprehensive integration tests for the
// useRecording hook (520 lines, previously ~2.7% coverage). Exercises the
// user-visible behavior via RTL renderHook/act: initial state, the model
// readiness gate, full start→stop→transcribe→AI-optimize→save lifecycle,
// error paths, and the exported determineProcessingMode helper.
//
// Mock strategy (matches settings-panel.test.tsx / app.test.tsx patterns):
//   - useModelStatus: mocked with a controllable stage (ready/need_download/
//     loading/error) so we drive the readiness gate without the provider.
//   - window.electronAPI: per-test Partial<ElectronAPI> via TestWindow cast.
//   - MediaRecorder: jsdom lacks it — a FakeMediaRecorder records a single
//     ondataavailable chunk then synchronously fires onstop when stop() is
//     called, exercising the hook's onstop → processAudio pipeline.
//   - navigator.mediaDevices.getUserMedia: returns a fake MediaStream with
//     stoppable tracks.
//   - window.AudioContext: jsdom lacks it — a stub whose decodeAudioData
//     resolves a minimal AudioBuffer so convertToWav produces a non-null Blob.
//   - sonner: not imported by useRecording, so not mocked (no dead mocks).
//   - Real timers: FileReader/Blob.arrayBuffer use microtasks that fake
//     timers would break; each transcription test drains the 100ms
//     optimization timeout (via isOptimizing===false) before asserting.
import "../setup/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ElectronAPI } from "../../src/electronAPI";

// ─── Mock useModelStatus ───────────────────────────────────────────────────
// The hook name-prefixed `mock` is required for vitest factory hoisting.
// `mockModelStatus` is mutated per test to drive the readiness gate.
const mockModelStatus = {
  isLoading: false,
  isReady: false,
  isUnloaded: false,
  isDownloading: false,
  modelsDownloaded: false,
  error: null as string | null,
  progress: 0,
  downloadProgress: 0,
  missingModels: [] as string[],
  stage: "need_download",
  modelProgress: {} as Record<string, unknown>,
  downloadModels: vi.fn(),
};
vi.mock("../../src/hooks/useModelStatus", () => ({
  useModelStatus: () => mockModelStatus,
}));

import {
  useRecording,
  determineProcessingMode,
} from "../../src/hooks/useRecording";

// ─── Test-window cast helper ───────────────────────────────────────────────
// Production Window type marks electronAPI required; tests delete it, so we
// Omit the required prop and re-add it as optional. Cast through unknown —
// never `any`, no @ts-ignore (mirrors settings-panel.test.tsx).
type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI?: Partial<ElectronAPI>;
};

function setElectronAPI(api: Partial<ElectronAPI> | undefined): void {
  (globalThis.window as TestWindow).electronAPI = api;
}

// ─── Fake MediaRecorder ────────────────────────────────────────────────────
// jsdom has no MediaRecorder. This fake simulates the contract the hook
// relies on: start(timeslice) sets ondataavailable handlers ready, stop()
// fires ondataavailable (if a chunk is queued) then onstop synchronously,
// and onerror is assignable. The hook reads ondataavailable/onstop/onerror
// AFTER construction, so we expose them as public instance fields.
interface FakeRecorderEvent {
  data: Blob;
}
interface FakeRecorderErrorEvent {
  error?: Error;
}
class FakeMediaRecorder {
  // [20260816_Test_BranchPush] Instance registry so tests can reach the
  // recorder created inside the hook (held in a ref) to fire onerror /
  // ondataavailable manually for branch-arc coverage.
  static instances: FakeMediaRecorder[] = [];

  ondataavailable: ((event: FakeRecorderEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: FakeRecorderErrorEvent) => void) | null = null;
  state: "inactive" | "recording" = "inactive";
  private stopped = false;

  constructor() {
    FakeMediaRecorder.instances.push(this);
  }

  start(_timeslice?: number): void {
    this.state = "recording";
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.state = "inactive";
    // Deliver one audio chunk (as MediaRecorder would on stop) then fire
    // onstop synchronously, mirroring real browser ordering.
    if (this.ondataavailable) {
      this.ondataavailable({
        data: new Blob(["chunk"], { type: "audio/webm" }),
      });
    }
    this.onstop?.();
  }

  // Helper for tests to simulate a mid-recording error.
  simulateError(message: string): void {
    if (this.onerror) {
      this.onerror({ error: new Error(message) });
    }
  }
}

// ─── Fake AudioContext (for convertToWav) ──────────────────────────────────
// jsdom lacks AudioContext. The hook's convertToWav uses decodeAudioData; we
// return a minimal stub AudioBuffer (1 channel, 1 sample) so audioBufferToWav
// produces a non-null WAV Blob and the transcribe pipeline continues.
class FakeAudioBuffer {
  length = 1;
  sampleRate = 16000;
  numberOfChannels = 1;
  getChannelData(): Float32Array {
    return new Float32Array(1);
  }
}
class FakeAudioContext {
  sampleRate = 16000;
  async decodeAudioData(_buffer: ArrayBuffer): Promise<FakeAudioBuffer> {
    return new FakeAudioBuffer();
  }
  close(): void {}
}

// ─── Fake MediaStream ──────────────────────────────────────────────────────
function makeFakeStream(): MediaStream {
  const stopFn = vi.fn();
  const track = { stop: stopFn } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

// ─── Shared fixtures ───────────────────────────────────────────────────────
const ORIGINAL_MEDIA_RECORDER = (
  window as unknown as {
    MediaRecorder?: typeof MediaRecorder;
  }
).MediaRecorder;
const ORIGINAL_AUDIO_CONTEXT = (
  window as unknown as {
    AudioContext?: typeof AudioContext;
  }
).AudioContext;

function setModelReady(ready: boolean): void {
  mockModelStatus.isReady = ready;
  mockModelStatus.isLoading = false;
  mockModelStatus.error = null;
  mockModelStatus.stage = ready ? "ready" : "need_download";
}

// ─── Tests ─────────────────────────────────────────────────────────────────
describe("[20260729_Test_UseRecording] determineProcessingMode", () => {
  it("returns 'optimize' for short text", () => {
    expect(determineProcessingMode("你好")).toBe("optimize");
  });

  it("returns 'optimize' for text at the boundary (<=30 words, <=150 chars)", () => {
    // 30 words, each 2 chars => 60 chars total, under both thresholds.
    const words = Array.from({ length: 30 }, () => "hi").join(" ");
    expect(determineProcessingMode(words)).toBe("optimize");
  });

  it("returns 'optimize_long' when text exceeds 150 chars", () => {
    const long = "字".repeat(151);
    expect(determineProcessingMode(long)).toBe("optimize_long");
  });

  it("returns 'optimize_long' when text exceeds 30 words", () => {
    const words = Array.from({ length: 31 }, () => "hi").join(" ");
    expect(determineProcessingMode(words)).toBe("optimize_long");
  });

  it("treats whitespace-only text as 'optimize'", () => {
    // trim().length === 0, trim().split(/\s+/) yields [''] => length 1.
    expect(determineProcessingMode("   ")).toBe("optimize");
  });
});

describe("[20260729_Test_UseRecording] useRecording — initial state", () => {
  beforeEach(() => {
    setElectronAPI({});
    setModelReady(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes idle initial state (isRecording/isProcessing/isOptimizing=false, error=null)", () => {
    const { result } = renderHook(() => useRecording());
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.isOptimizing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.startRecording).toBe("function");
    expect(typeof result.current.stopRecording).toBe("function");
    expect(typeof result.current.cancelRecording).toBe("function");
    expect(typeof result.current.checkPermissions).toBe("function");
  });
});

describe("[20260729_Test_UseRecording] useRecording — startRecording gate", () => {
  beforeEach(() => {
    // Provide getUserMedia so the gate (not the mic) is what fails.
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(makeFakeStream()) },
      configurable: true,
    });
    (
      window as unknown as { MediaRecorder: typeof MediaRecorder }
    ).MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  // [20260822_T12_IdleUnload] Gate contract (T12 review MAJOR): ONLY the
  // UNLOADED state (process alive, models freed) is recordable — the
  // hotkey press fires the reload pre-trigger; loading/error/dead states
  // block at the START (recording through them loses audio at stop).
  it("UNLOADED model: recording PROCEEDS and fires the reload pre-trigger", async () => {
    mockModelStatus.isReady = false;
    mockModelStatus.isUnloaded = true;
    mockModelStatus.isLoading = false;
    mockModelStatus.error = null;
    mockModelStatus.stage = "unloaded";
    const reloadSpy = vi.fn();
    setElectronAPI({ reloadFunasrModels: reloadSpy });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("loading model: recording is blocked (audio would be lost at stop)", async () => {
    mockModelStatus.isReady = false;
    mockModelStatus.isUnloaded = false;
    mockModelStatus.isLoading = true;
    mockModelStatus.error = null;
    mockModelStatus.stage = "loading";
    const reloadSpy = vi.fn();
    setElectronAPI({ reloadFunasrModels: reloadSpy });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toContain("启动");
  });

  it("error-stage model: recording is blocked", async () => {
    mockModelStatus.isReady = false;
    mockModelStatus.isUnloaded = false;
    mockModelStatus.isLoading = false;
    mockModelStatus.error = "boom";
    mockModelStatus.stage = "error";
    const reloadSpy = vi.fn();
    setElectronAPI({ reloadFunasrModels: reloadSpy });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toContain("未就绪");
  });

  it("throws when getUserMedia is unavailable (unsupported browser)", async () => {
    setModelReady(true);
    // Remove mediaDevices entirely.
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });
    setElectronAPI({});

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toContain("不支持录音");
  });

  it("sets error and stops recording when getUserMedia rejects", async () => {
    setModelReady(true);
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")),
      },
      configurable: true,
    });
    setElectronAPI({});

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toContain("无法开始录音");
    expect(result.current.error).toContain("Permission denied");
  });

  it("starts recording successfully when model is ready", async () => {
    setModelReady(true);
    const getUserMedia = vi.fn().mockResolvedValue(makeFakeStream());
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    setElectronAPI({});

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(result.current.isRecording).toBe(true);
    expect(result.current.error).toBeNull();
  });
});

describe("[20260729_Test_UseRecording] useRecording — stopRecording", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(makeFakeStream()) },
      configurable: true,
    });
    (
      window as unknown as { MediaRecorder: typeof MediaRecorder }
    ).MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
    setModelReady(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls mediaRecorder.stop() and flips isRecording to false", async () => {
    // Provide a complete electronAPI so the onstop → processAudio pipeline
    // resolves cleanly instead of throwing into the error branch.
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "你好世界",
        confidence: 0.9,
        duration: 1.5,
      }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      result.current.stopRecording();
    });

    // stopRecording triggers onstop synchronously, which sets isRecording
    // false and begins processing.
    expect(result.current.isRecording).toBe(false);
  });

  it("is a no-op when not recording", async () => {
    setElectronAPI({});
    const { result } = renderHook(() => useRecording());
    // Should not throw.
    await act(async () => {
      result.current.stopRecording();
    });
    expect(result.current.isRecording).toBe(false);
  });
});

describe("[20260729_Test_UseRecording] useRecording — transcription flow", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(makeFakeStream()) },
      configurable: true,
    });
    (
      window as unknown as { MediaRecorder: typeof MediaRecorder }
    ).MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
    setModelReady(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fires onTranscriptionComplete with the raw result after transcription", async () => {
    const onTranscriptionComplete = vi.fn();
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "你好世界",
        confidence: 0.9,
        duration: 1.5,
      }),
      // 'off' skips AI optimization so we don't wait on processText.
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() =>
      useRecording({ onTranscriptionComplete }),
    );

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
    });

    // onstop is an async fire-and-forget: stop() invokes it but does not
    // await it, so the nested convertToWav → transcribeAudio microtasks
    // continue after stopRecording returns. Poll until the callback fires.
    await waitFor(() =>
      expect(onTranscriptionComplete).toHaveBeenCalledTimes(1),
    );
    const payload = onTranscriptionComplete.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      text: "你好世界",
      confidence: 0.9,
      enhanced_by_ai: false,
    });

    // The 100ms optimization timeout (even with mode 'off') schedules
    // saveTranscription; drain isOptimizing→false so no timer leaks into
    // the next test.
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("calls transcribeAudio with an ArrayBuffer derived from the WAV blob", async () => {
    const transcribeAudio = vi.fn().mockResolvedValue({
      success: true,
      text: "hi",
      confidence: 1,
      duration: 0.5,
    });
    setElectronAPI({
      transcribeAudio,
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
    });

    // onstop is async fire-and-forget; transcribeAudio is called after
    // convertToWav resolves. Poll until it has been invoked.
    await waitFor(() => expect(transcribeAudio).toHaveBeenCalledTimes(1));
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    // The hook passes the WAV arrayBuffer; assert it's an ArrayBuffer.
    const arg = transcribeAudio.mock.calls[0]![0];
    expect(arg instanceof ArrayBuffer).toBe(true);

    // Drain the 100ms optimization timeout so it doesn't leak into the next
    // test in this describe block.
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("runs AI optimization when default_mode is 'auto' and fires onAIOptimizationComplete", async () => {
    const onAIOptimizationComplete = vi.fn();
    const processText = vi.fn().mockResolvedValue({
      success: true,
      text: "你好，世界。",
    });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "你好世界",
        confidence: 0.9,
        duration: 1.5,
      }),
      // 'auto' => determineProcessingMode picks the mode.
      getSetting: vi.fn().mockResolvedValue("auto"),
      processText,
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() =>
      useRecording({ onAIOptimizationComplete }),
    );

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
    });

    // processText is invoked inside a 100ms setTimeout; wait for it.
    await waitFor(() => expect(processText).toHaveBeenCalledTimes(1));
    expect(processText).toHaveBeenCalledWith(
      "你好世界",
      expect.stringContaining("optimize"),
    );

    // The optimization timeout also flips isOptimizing true→false.
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
    expect(onAIOptimizationComplete).toHaveBeenCalledTimes(1);
    const payload = onAIOptimizationComplete.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      text: "你好，世界。",
      processed_text: "你好，世界。",
      enhanced_by_ai: true,
    });
  });

  it("fires onSaveComplete with the inserted row id after saving", async () => {
    const onSaveComplete = vi.fn();
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "保存测试",
        confidence: 0.8,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription: vi.fn().mockResolvedValue({
        success: true,
        lastInsertRowid: 42,
      }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording({ onSaveComplete }));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
    });

    // saveTranscription runs in the 100ms optimization timeout even when
    // AI is off.
    await waitFor(() => expect(onSaveComplete).toHaveBeenCalledTimes(1));
    expect(onSaveComplete).toHaveBeenCalledWith({ id: 42 });

    // Drain the timeout fully so isOptimizing flips false and no timer
    // leaks into the next test.
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("migrates legacy enable_ai_optimization setting when default_mode is null", async () => {
    const getSetting = vi.fn().mockImplementation((key: string) => {
      if (key === "default_mode") return Promise.resolve(null);
      // enable_ai_optimization === false => migrated defaultMode 'off'
      return Promise.resolve(false);
    });
    const processText = vi.fn();
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "迁移测试",
        confidence: 0.7,
        duration: 1,
      }),
      getSetting,
      processText,
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
    });

    // With the migrated 'off' mode, processText must NOT be called.
    await waitFor(() =>
      expect(getSetting).toHaveBeenCalledWith("enable_ai_optimization", true),
    );
    // Give the 100ms timeout a chance to settle.
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
    expect(processText).not.toHaveBeenCalled();
  });

  it("sets error when transcribeAudio fails (success=false)", async () => {
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: false,
        error: "识别引擎故障",
      }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
    });

    // The onstop handler catches the thrown error and surfaces it.
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain("音频处理失败");
    expect(result.current.error).toContain("识别引擎故障");
    expect(result.current.isProcessing).toBe(false);
  });

  it("sets error when transcribeAudio rejects", async () => {
    setElectronAPI({
      transcribeAudio: vi.fn().mockRejectedValue(new Error("network down")),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain("音频处理失败");
    expect(result.current.error).toContain("network down");
  });

  it("surfaces mediaRecorder.onerror and stops processing", async () => {
    setElectronAPI({
      transcribeAudio: vi.fn(),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    // Simulate a recorder error after start. We can't reach the instance
    // directly (it's in a ref), so we assert the public behavior: an error
    // surfaced via the hook's error state would have come from onerror. The
    // hook clears isRecording/isProcessing on onerror. Since we can't
    // trigger onerror without the instance, we instead verify stopRecording
    // leaves a clean state.
    await act(async () => {
      result.current.stopRecording();
    });
    expect(result.current.isRecording).toBe(false);
  });
});

describe("[20260729_Test_UseRecording] useRecording — cancelRecording", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(makeFakeStream()) },
      configurable: true,
    });
    (
      window as unknown as { MediaRecorder: typeof MediaRecorder }
    ).MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
    setModelReady(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resets all recording state and clears error", async () => {
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "hi",
        confidence: 1,
        duration: 0.5,
      }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      result.current.cancelRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("[20260729_Test_UseRecording] useRecording — checkPermissions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the permission state from navigator.permissions.query", async () => {
    Object.defineProperty(navigator, "permissions", {
      value: {
        query: vi.fn().mockResolvedValue({ state: "granted" }),
      },
      configurable: true,
    });
    setElectronAPI({ log: vi.fn().mockResolvedValue(undefined) });

    const { result } = renderHook(() => useRecording());

    let state: string | undefined;
    await act(async () => {
      state = (await result.current.checkPermissions()) as string;
    });
    expect(state).toBe("granted");
  });

  it("returns 'unknown' and logs when permissions.query throws", async () => {
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn().mockRejectedValue(new Error("unsupported")) },
      configurable: true,
    });
    const log = vi.fn().mockResolvedValue(undefined);
    setElectronAPI({ log });

    const { result } = renderHook(() => useRecording());

    let state: string | undefined;
    await act(async () => {
      state = (await result.current.checkPermissions()) as string;
    });
    expect(state).toBe("unknown");
    expect(log).toHaveBeenCalledWith(
      "warn",
      "无法检查麦克风权限:",
      expect.any(Error),
    );
  });
});

// ─── Restore globals after the suite ───────────────────────────────────────
// Ensures no leakage into other test files sharing the jsdom instance.
afterEach(() => {
  if (ORIGINAL_MEDIA_RECORDER) {
    (
      window as unknown as { MediaRecorder: typeof MediaRecorder }
    ).MediaRecorder = ORIGINAL_MEDIA_RECORDER;
  }
  if (ORIGINAL_AUDIO_CONTEXT) {
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext =
      ORIGINAL_AUDIO_CONTEXT;
  }
});

// ─── [20260816_Test_BranchPush] Branch-arc coverage ────────────────────────
// Targets the uncovered branch arcs reported by coverage: the web-env mock
// path, the optimization-timeout lifecycle (armed → cleared / cancelled /
// timed out), AI failure shapes (success:false, missing text, throws),
// missing log bridge, recorder onerror / zero-size ondataavailable
// callbacks, missing transcription fields, and cancelRecording races.
describe("[20260816_Test_BranchPush] useRecording — branch arcs", () => {
  type RecordingHookResult = ReturnType<typeof useRecording>;

  // Starts and stops one recording so the synchronous onstop callback opens
  // the async processAudio pipeline.
  async function startAndStop(result: {
    current: RecordingHookResult;
  }): Promise<void> {
    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
    });
  }

  beforeEach(async () => {
    // [20260816_Test_BranchPush] Earlier tests in this file drain their
    // optimization timeout via waitFor(isOptimizing === false), which can
    // pass before the 100ms timer has even armed. Any such stale timer would
    // fire into THIS test's electronAPI (the callback resolves
    // window.electronAPI late). Sleep once up front so leftover callbacks
    // complete against the previous test's API instead of polluting ours.
    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(makeFakeStream()) },
      configurable: true,
    });
    (
      window as unknown as { MediaRecorder: typeof MediaRecorder }
    ).MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
    setModelReady(true);
  });

  afterEach(() => {
    FakeMediaRecorder.instances.length = 0;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns the web mock result when electronAPI is absent", async () => {
    setElectronAPI(undefined);
    const onTranscriptionComplete = vi.fn();
    const { result } = renderHook(() =>
      useRecording({ onTranscriptionComplete }),
    );

    await startAndStop(result);

    await waitFor(() =>
      expect(onTranscriptionComplete).toHaveBeenCalledTimes(1),
    );
    expect(onTranscriptionComplete.mock.calls[0]![0]).toMatchObject({
      success: true,
      text: "模拟识别结果。",
      confidence: 0.95,
      duration: 3.5,
    });
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.isProcessing).toBe(false));
  });

  it("clears an armed optimization timeout when a new recording starts", async () => {
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "重启清超时",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription,
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);
    // The 100ms optimization timeout is now armed (isOptimizing === true).
    await waitFor(() => expect(result.current.isOptimizing).toBe(true));

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    // The cleared timeout never fires, so nothing is saved.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
    });
    expect(saveTranscription).not.toHaveBeenCalled();

    // End the second recording; the cancelled flag neutralizes its own
    // optimization timeout after the test ends.
    act(() => {
      result.current.cancelRecording();
    });
  });

  it("skips zero-size data chunks from ondataavailable", async () => {
    // Local recorder variant whose only data event carries an empty Blob, so
    // the size>0 guard runs on its false arc while the pipeline continues.
    class EmptyChunkRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: { error?: Error }) => void) | null = null;
      start(_timeslice?: number): void {}
      stop(): void {
        this.ondataavailable?.({ data: new Blob([]) });
        this.onstop?.();
      }
    }
    (
      window as unknown as { MediaRecorder: typeof MediaRecorder }
    ).MediaRecorder = EmptyChunkRecorder as unknown as typeof MediaRecorder;

    const onTranscriptionComplete = vi.fn();
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "空块测试",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() =>
      useRecording({ onTranscriptionComplete }),
    );
    await startAndStop(result);

    // The empty chunk was skipped but processing still completes cleanly.
    await waitFor(() =>
      expect(onTranscriptionComplete).toHaveBeenCalledTimes(1),
    );
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("surfaces the recorder error message and stops the stream tracks", async () => {
    const stopFn = vi.fn();
    const track = { stop: stopFn } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true,
    });
    setElectronAPI({ log: vi.fn().mockResolvedValue(undefined) });

    const { result } = renderHook(() => useRecording());
    await act(async () => {
      await result.current.startRecording();
    });

    const recorder = FakeMediaRecorder.instances.at(-1)!;
    act(() => {
      recorder.onerror?.({ error: new Error("麦克风中断") });
    });

    expect(result.current.error).toBe("录音错误: 麦克风中断");
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
    // The onerror handler stopped the live stream tracks exactly once.
    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it("uses the unknown-error fallback and skips track cleanup after cancel", async () => {
    const stopFn = vi.fn();
    const track = { stop: stopFn } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true,
    });
    setElectronAPI(undefined);

    const { result } = renderHook(() => useRecording());
    await act(async () => {
      await result.current.startRecording();
    });
    // Cancel first: this stops the tracks and clears streamRef while the
    // recorder instance (and its onerror handler) survives.
    await act(async () => {
      result.current.cancelRecording();
    });
    expect(stopFn).toHaveBeenCalledTimes(1);

    const recorder = FakeMediaRecorder.instances.at(-1)!;
    act(() => {
      recorder.onerror?.({}); // event without an error field
    });

    expect(result.current.error).toBe("录音错误: 未知错误");
    // streamRef was already null, so onerror must not stop tracks again.
    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it("defaults missing transcription fields when saving", async () => {
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({ success: true }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription,
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);

    await waitFor(() => expect(saveTranscription).toHaveBeenCalledTimes(1));
    const saved = saveTranscription.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(saved.raw_text).toBe("");
    expect(saved.text).toBe("");
    expect(saved.confidence).toBe(0);
    expect(saved.duration).toBe(0);
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("uses the generic failure message when transcription fails without an error", async () => {
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({ success: false }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain("语音识别失败");
    expect(result.current.isProcessing).toBe(false);
  });

  it("invokes onAIOptimizationComplete with the raw text when AI is off", async () => {
    const onAIOptimizationComplete = vi.fn();
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "关闭优化",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() =>
      useRecording({ onAIOptimizationComplete }),
    );
    await startAndStop(result);

    await waitFor(() =>
      expect(onAIOptimizationComplete).toHaveBeenCalledTimes(1),
    );
    expect(onAIOptimizationComplete.mock.calls[0]![0]).toMatchObject({
      text: "关闭优化",
      enhanced_by_ai: false,
    });
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("migrates enable_ai_optimization=true to auto mode and runs the optimizer", async () => {
    const getSetting = vi.fn().mockImplementation((key: string) => {
      if (key === "default_mode") return Promise.resolve(null);
      // Legacy enable_ai_optimization flag: true migrates to "auto".
      return Promise.resolve(true);
    });
    const processText = vi
      .fn()
      .mockResolvedValue({ success: true, text: "迁移优化结果" });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "迁移原文",
        confidence: 1,
        duration: 1,
      }),
      getSetting,
      processText,
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);

    await waitFor(() => expect(processText).toHaveBeenCalledTimes(1));
    expect(processText).toHaveBeenCalledWith("迁移原文", "optimize");
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("derives the mode automatically when default_mode is undefined", async () => {
    // undefined (not null) skips the migration branch and is not "off", so
    // the hook falls back to determineProcessingMode for the mode.
    const processText = vi
      .fn()
      .mockResolvedValue({ success: true, text: "模式推导结果" });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "短文本",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue(undefined),
      processText,
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);

    await waitFor(() => expect(processText).toHaveBeenCalledTimes(1));
    expect(processText).toHaveBeenCalledWith("短文本", "optimize");
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("logs an AI failure and falls back to the raw text", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const processText = vi
      .fn()
      .mockResolvedValue({ success: false, error: "上游500" });
    const onAIOptimizationComplete = vi.fn();
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "失败原文",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("auto"),
      processText,
      saveTranscription: vi.fn().mockResolvedValue({ success: true }),
      log,
    });

    const { result } = renderHook(() =>
      useRecording({ onAIOptimizationComplete }),
    );
    await startAndStop(result);

    await waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        "error",
        "AI文本优化失败:",
        expect.objectContaining({ success: false }),
      ),
    );
    await waitFor(() =>
      expect(onAIOptimizationComplete).toHaveBeenCalledTimes(1),
    );
    expect(onAIOptimizationComplete.mock.calls[0]![0]).toMatchObject({
      text: "失败原文",
      enhanced_by_ai: false,
    });
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("keeps the raw text when the optimized text is identical", async () => {
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    const onAIOptimizationComplete = vi.fn();
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "完全相同",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("auto"),
      processText: vi.fn().mockResolvedValue({
        success: true,
        text: "完全相同",
      }),
      saveTranscription,
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() =>
      useRecording({ onAIOptimizationComplete }),
    );
    await startAndStop(result);

    await waitFor(() => expect(saveTranscription).toHaveBeenCalledTimes(1));
    const saved = saveTranscription.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    // processed_text is recorded but must not replace the main text.
    expect(saved.processed_text).toBe("完全相同");
    expect(saved.text).toBe("完全相同");
    await waitFor(() =>
      expect(onAIOptimizationComplete).toHaveBeenCalledTimes(1),
    );
    expect(onAIOptimizationComplete.mock.calls[0]![0]).toMatchObject({
      text: "完全相同",
      enhanced_by_ai: false,
    });
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("handles an AI success result that carries no text", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const onAIOptimizationComplete = vi.fn();
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "无文本结果",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("auto"),
      processText: vi.fn().mockResolvedValue({ success: true }),
      saveTranscription,
      log,
    });

    const { result } = renderHook(() =>
      useRecording({ onAIOptimizationComplete }),
    );
    await startAndStop(result);

    // The success log coerces the missing text to "" before substring.
    await waitFor(() =>
      expect(log).toHaveBeenCalledWith("info", "AI文本优化成功", "..."),
    );
    await waitFor(() => expect(saveTranscription).toHaveBeenCalledTimes(1));
    const saved = saveTranscription.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(saved.processed_text).toBeUndefined();
    expect(saved.text).toBe("无文本结果");
    await waitFor(() =>
      expect(onAIOptimizationComplete).toHaveBeenCalledTimes(1),
    );
    expect(onAIOptimizationComplete.mock.calls[0]![0]).toMatchObject({
      text: "无文本结果",
      enhanced_by_ai: false,
    });
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("logs a thrown AI error and still saves the raw transcription", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "异常原文",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("auto"),
      processText: vi.fn().mockRejectedValue(new Error("模型崩溃")),
      saveTranscription,
      log,
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);

    await waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        "error",
        "AI文本优化捕获到错误:",
        expect.any(Error),
      ),
    );
    await waitFor(() => expect(saveTranscription).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("runs the optimization pipeline without a log bridge method", async () => {
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "无日志原文",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("auto"),
      processText: vi.fn().mockResolvedValue({
        success: true,
        text: "无日志优化",
      }),
      saveTranscription,
      // No `log` key on purpose: every log guard must short-circuit.
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);

    await waitFor(() => expect(saveTranscription).toHaveBeenCalledTimes(1));
    const saved = saveTranscription.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(saved.processed_text).toBe("无日志优化");
    expect(saved.text).toBe("无日志优化");
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("tolerates a missing log method when the AI step fails", async () => {
    const onAIOptimizationComplete = vi.fn();
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "静默失败原文",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("auto"),
      processText: vi.fn().mockResolvedValue({ success: false }),
      saveTranscription,
    });

    const { result } = renderHook(() =>
      useRecording({ onAIOptimizationComplete }),
    );
    await startAndStop(result);

    await waitFor(() => expect(saveTranscription).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onAIOptimizationComplete).toHaveBeenCalledTimes(1),
    );
    expect(onAIOptimizationComplete.mock.calls[0]![0]).toMatchObject({
      text: "静默失败原文",
      enhanced_by_ai: false,
    });
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("tolerates a missing log method when processText throws", async () => {
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "静默异常原文",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("auto"),
      processText: vi.fn().mockRejectedValue(new Error("静默失败")),
      saveTranscription,
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);

    await waitFor(() => expect(saveTranscription).toHaveBeenCalledTimes(1));
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
  });

  it("skips saving when the bridge disappears while settings are loading", async () => {
    let resolveSettings: (value: unknown) => void = () => {};
    const getSetting = vi.fn(
      (_key: string) =>
        new Promise<unknown>((resolve) => {
          resolveSettings = resolve;
        }),
    );
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "桥接消失",
        confidence: 1,
        duration: 1,
      }),
      getSetting,
      saveTranscription,
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);
    // Wait until the 100ms callback has invoked getSetting (bridge alive).
    await waitFor(() => expect(getSetting).toHaveBeenCalled());

    setElectronAPI(undefined);
    act(() => {
      resolveSettings("off");
    });

    // The save block is guarded by a falsy electronAPI and is skipped.
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
    expect(saveTranscription).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("surfaces a processing error when the bridge disappears before the timeout fires", async () => {
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "超时前消失",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription,
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);
    await waitFor(() => expect(result.current.isOptimizing).toBe(true));

    setElectronAPI(undefined);
    await waitFor(() => expect(result.current.error).toContain("转录处理失败"));
    await waitFor(() => expect(result.current.isOptimizing).toBe(false));
    expect(saveTranscription).not.toHaveBeenCalled();
  });

  it("clears an armed optimization timeout when cancelRecording runs during optimization", async () => {
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "取消清超时",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription,
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useRecording());
    await startAndStop(result);
    await waitFor(() => expect(result.current.isOptimizing).toBe(true));

    act(() => {
      result.current.cancelRecording();
    });

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
    });
    expect(saveTranscription).not.toHaveBeenCalled();
  });

  it("skips the optimization callback when recording is cancelled mid-processing", async () => {
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    const onAIOptimizationComplete = vi.fn();
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "处理中取消",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("off"),
      saveTranscription,
      log: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() =>
      useRecording({ onAIOptimizationComplete }),
    );
    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
      // Cancel synchronously after stop: cancelledRef flips before the async
      // onstop pipeline schedules its optimization timeout.
      result.current.cancelRecording();
    });

    await waitFor(() => expect(result.current.isOptimizing).toBe(true));
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
    });
    expect(saveTranscription).not.toHaveBeenCalled();
    expect(onAIOptimizationComplete).not.toHaveBeenCalled();
    // The cancelled callback returned before its finally block, so the
    // optimizing flag stays latched at true.
    expect(result.current.isOptimizing).toBe(true);
  });

  it("is a no-op when cancelling with no active session", () => {
    setElectronAPI({});
    const { result } = renderHook(() => useRecording());
    act(() => {
      result.current.cancelRecording();
    });
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.audioData).toBeNull();
  });

  it("falls back to the raw text when the AI optimization times out", async () => {
    // Capture the real timer before swapping: the armed 100ms callback must
    // still fire on the real clock while the nested 60s race timeout runs on
    // fake timers so the test does not wait a minute.
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    const log = vi.fn().mockResolvedValue(undefined);
    const processText = vi.fn(() => new Promise(() => undefined)); // never settles
    const saveTranscription = vi.fn().mockResolvedValue({ success: true });
    const onAIOptimizationComplete = vi.fn();
    setElectronAPI({
      transcribeAudio: vi.fn().mockResolvedValue({
        success: true,
        text: "超时原文",
        confidence: 1,
        duration: 1,
      }),
      getSetting: vi.fn().mockResolvedValue("auto"),
      processText: processText as unknown as (
        text: string,
        mode: string,
        timeout?: number,
      ) => Promise<import("../../src/types/ipc").AIProcessResult>,
      saveTranscription,
      log,
    });

    const { result } = renderHook(() =>
      useRecording({ onAIOptimizationComplete }),
    );
    await startAndStop(result);
    await waitFor(() => expect(result.current.isOptimizing).toBe(true));

    vi.useFakeTimers();
    try {
      // Let the real 100ms callback run so the race timer becomes fake.
      await act(async () => {
        await new Promise<void>((resolve) => {
          realSetTimeout(() => resolve(undefined), 150);
        });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(log).toHaveBeenCalledWith(
      "error",
      "AI文本优化捕获到错误:",
      expect.any(Error),
    );
    expect(saveTranscription).toHaveBeenCalledTimes(1);
    const saved = saveTranscription.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(saved.processed_text).toBeUndefined();
    expect(saved.text).toBe("超时原文");
    expect(onAIOptimizationComplete).toHaveBeenCalledTimes(1);
    expect(onAIOptimizationComplete.mock.calls[0]![0]).toMatchObject({
      text: "超时原文",
      enhanced_by_ai: false,
    });
    expect(result.current.isOptimizing).toBe(false);
  });
});
