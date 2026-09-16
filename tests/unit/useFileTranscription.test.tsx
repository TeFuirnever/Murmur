// @vitest-environment jsdom
// [20260729_Test_UseFileTranscription] Integration tests for the
// useFileTranscription hook state machine: idle → selected → transcribing
// → done/error. Uses renderHook from RTL under jsdom.
import "../setup/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileTranscription } from "../../src/hooks/useFileTranscription";

// Typed electronAPI stub.
interface TestElectronAPI {
  validateAudioFile: ReturnType<typeof vi.fn>;
  importAudioFile: ReturnType<typeof vi.fn>;
  transcribeFile: ReturnType<typeof vi.fn>;
  cancelFileTranscription: ReturnType<typeof vi.fn>;
  onFileTranscriptionProgress: ReturnType<typeof vi.fn>;
  processText: ReturnType<typeof vi.fn>;
  getSetting: ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  const api: TestElectronAPI = {
    validateAudioFile: vi.fn(),
    importAudioFile: vi.fn(),
    transcribeFile: vi.fn(),
    cancelFileTranscription: vi.fn(),
    onFileTranscriptionProgress: vi.fn(() => () => {}),
    processText: vi.fn(),
    getSetting: vi.fn().mockResolvedValue(null),
  };
  (window as unknown as { electronAPI: TestElectronAPI }).electronAPI = api;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useFileTranscription", () => {
  it("starts in idle state with null data", () => {
    const { result } = renderHook(() => useFileTranscription());
    expect(result.current.state).toBe("idle");
    expect(result.current.fileInfo).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("selectFileFromPath transitions to selected on valid file", async () => {
    const api = (window as unknown as { electronAPI: TestElectronAPI })
      .electronAPI;
    api.validateAudioFile.mockResolvedValue({
      success: true,
      filePath: "/test/audio.wav",
      fileName: "audio.wav",
      fileSize: 1024,
      extension: ".wav",
    });

    const { result } = renderHook(() => useFileTranscription());

    await act(async () => {
      await result.current.selectFileFromPath("/test/audio.wav");
    });

    expect(result.current.state).toBe("selected");
    expect(result.current.fileInfo?.fileName).toBe("audio.wav");
    expect(result.current.error).toBeNull();
  });

  it("selectFileFromPath transitions to error on invalid file", async () => {
    const api = (window as unknown as { electronAPI: TestElectronAPI })
      .electronAPI;
    api.validateAudioFile.mockResolvedValue({
      success: false,
      error: "Unsupported format",
    });

    const { result } = renderHook(() => useFileTranscription());

    await act(async () => {
      await result.current.selectFileFromPath("/test/file.txt");
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("Unsupported format");
  });

  it("selectFileFromPath errors when electronAPI unavailable", async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = undefined;

    const { result } = renderHook(() => useFileTranscription());

    await act(async () => {
      await result.current.selectFileFromPath("/test/audio.wav");
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toContain("不可用");
  });

  it("selectFile transitions to error when canceled", async () => {
    const api = (window as unknown as { electronAPI: TestElectronAPI })
      .electronAPI;
    api.importAudioFile.mockResolvedValue({
      success: false,
      canceled: true,
    });

    const { result } = renderHook(() => useFileTranscription());

    await act(async () => {
      await result.current.selectFile();
    });

    // Canceled selection stays in idle (not error)
    expect(result.current.state).toBe("idle");
  });

  it("startTranscription transitions to done on success", async () => {
    const api = (window as unknown as { electronAPI: TestElectronAPI })
      .electronAPI;
    api.validateAudioFile.mockResolvedValue({
      success: true,
      filePath: "/test/audio.wav",
      fileName: "audio.wav",
      fileSize: 1024,
      extension: ".wav",
    });
    api.transcribeFile.mockResolvedValue({
      success: true,
      text: "转写结果",
      duration: 10,
    });
    api.getSetting.mockResolvedValue("off"); // AI disabled

    const { result } = renderHook(() => useFileTranscription());

    await act(async () => {
      await result.current.selectFileFromPath("/test/audio.wav");
    });

    await act(async () => {
      await result.current.startTranscription();
    });

    expect(result.current.state).toBe("done");
    expect(result.current.result?.text).toBe("转写结果");
  });

  it("startTranscription transitions to error on failure", async () => {
    const api = (window as unknown as { electronAPI: TestElectronAPI })
      .electronAPI;
    api.validateAudioFile.mockResolvedValue({
      success: true,
      filePath: "/test/audio.wav",
      fileName: "audio.wav",
      fileSize: 1024,
      extension: ".wav",
    });
    api.transcribeFile.mockResolvedValue({
      success: false,
      error: "转录超时",
    });

    const { result } = renderHook(() => useFileTranscription());

    await act(async () => {
      await result.current.selectFileFromPath("/test/audio.wav");
    });

    await act(async () => {
      await result.current.startTranscription();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toContain("转录超时");
  });

  it("cancelTranscription transitions to cancelled", async () => {
    const api = (window as unknown as { electronAPI: TestElectronAPI })
      .electronAPI;
    api.cancelFileTranscription.mockResolvedValue(undefined);

    const { result } = renderHook(() => useFileTranscription());

    await act(async () => {
      await result.current.cancelTranscription();
    });

    expect(result.current.state).toBe("cancelled");
    expect(result.current.progress).toBeNull();
  });

  it("reset returns to idle state", async () => {
    const api = (window as unknown as { electronAPI: TestElectronAPI })
      .electronAPI;
    api.validateAudioFile.mockResolvedValue({
      success: true,
      filePath: "/test/audio.wav",
      fileName: "audio.wav",
      fileSize: 1024,
      extension: ".wav",
    });

    const { result } = renderHook(() => useFileTranscription());

    await act(async () => {
      await result.current.selectFileFromPath("/test/audio.wav");
    });
    expect(result.current.state).toBe("selected");

    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.fileInfo).toBeNull();
  });

  it("startTranscription errors without file selection", async () => {
    const { result } = renderHook(() => useFileTranscription());

    await act(async () => {
      await result.current.startTranscription();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toContain("请先选择");
  });
});

// [20260816_Test_UseFileTranscriptionExpanded] Error-path and progress-detail
// branches that were previously uncovered. Uses the same beforeEach stub as
// above; per-test overrides go through the shared electronAPI object.
const api = () =>
  (window as unknown as { electronAPI: TestElectronAPI }).electronAPI;

const VALID = {
  success: true,
  filePath: "/test/audio.wav",
  fileName: "audio.wav",
  fileSize: 1024,
  extension: ".wav",
};

describe("useFileTranscription — error paths and progress", () => {
  it("selectFileFromPath surfaces a thrown validation error", async () => {
    api().validateAudioFile.mockImplementation(() => {
      throw new Error("校验抛错");
    });
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/x.wav");
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toContain("校验抛错");
  });

  it("startTranscription reports the bridge-missing error", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    // Remove transcribeFile to simulate a missing bridge method.
    delete (api() as Partial<TestElectronAPI>).transcribeFile;
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/ok.wav");
    });
    expect(result.current.state).toBe("selected");
    await act(async () => {
      await result.current.startTranscription();
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toContain("不可用");
  });

  it("startTranscription records a thrown transcription error", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    api().transcribeFile.mockImplementation(() => {
      throw new Error("进程崩溃");
    });
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/crash.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toContain("进程崩溃");
  });

  it("streams progress payloads into state during transcription", async () => {
    let progressCb: ((data: unknown) => void) | undefined;
    api().validateAudioFile.mockResolvedValue(VALID);
    api().onFileTranscriptionProgress.mockImplementation(
      (cb: (data: unknown) => void) => {
        progressCb = cb;
        return () => undefined;
      },
    );
    api().transcribeFile.mockImplementation(() => new Promise(() => undefined));
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/prog.wav");
    });
    await act(async () => {
      void result.current.startTranscription();
    });
    act(() => {
      progressCb?.({ phase: "vad", message: "语音检测中", progress_pct: 30 });
    });
    expect(result.current.progress?.phase).toBe("vad");
    expect(result.current.progress?.progress_pct).toBe(30);
  });
});

// [20260816_Test_BranchPush] Branch-arc coverage for the remaining uncovered
// arcs: generic fallback messages when IPC results omit error fields or
// throw non-Error values, selectFile guard arcs, the legacy AI-optimization
// migration, mode derivation (auto / long text / explicit mode), AI result
// shapes, the missing progress-subscription bridge, cancel bridge arcs, the
// unmount cleanup, and reset from error state.
describe("useFileTranscription — branch arcs [20260816_Test_BranchPush]", () => {
  it("uses the generic validation failure message when the error field is missing", async () => {
    api().validateAudioFile.mockResolvedValue({ success: false });
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/bad.wav");
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("文件验证失败");
  });

  it("uses the generic validation error when a non-Error is thrown", async () => {
    api().validateAudioFile.mockRejectedValue("非错误值");
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/throw.wav");
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("验证文件时出错");
  });

  it("reports the missing bridge when electronAPI is absent for selectFile", async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = undefined;
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFile();
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toContain("不可用");
  });

  it("reports the missing bridge when importAudioFile is unavailable", async () => {
    delete (api() as Partial<TestElectronAPI>).importAudioFile;
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFile();
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toContain("不可用");
  });

  it("uses the generic selection failure message when the error field is missing", async () => {
    api().importAudioFile.mockResolvedValue({ success: false });
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFile();
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("文件选择失败");
  });

  it("uses the generic selection error when a non-Error is thrown", async () => {
    api().importAudioFile.mockRejectedValue("字符串异常");
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFile();
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("选择文件时出错");
  });

  it("optimizes with the legacy enable_ai_optimization flag when default_mode is null", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    api().transcribeFile.mockResolvedValue({
      success: true,
      text: "短文本",
      duration: 1,
    });
    // default_mode null → read the legacy enable_ai_optimization flag (true)
    // and derive the mode automatically (short text → "optimize").
    api().getSetting.mockImplementation((key: string) =>
      key === "default_mode" ? Promise.resolve(null) : Promise.resolve(true),
    );
    api().processText.mockResolvedValue({ success: true, text: "优化完成" });

    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/legacy.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });

    expect(result.current.state).toBe("done");
    expect(api().processText).toHaveBeenCalledWith("短文本", "optimize");
    expect(result.current.optimizedText).toBe("优化完成");
    expect(result.current.isOptimizing).toBe(false);
  });

  it("picks optimize_long for long text when default_mode is auto", async () => {
    const longText = "字".repeat(151);
    api().validateAudioFile.mockResolvedValue(VALID);
    api().transcribeFile.mockResolvedValue({
      success: true,
      text: longText,
      duration: 10,
    });
    api().getSetting.mockResolvedValue("auto");
    api().processText.mockResolvedValue({ success: true, text: "长文优化" });

    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/long.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });

    expect(api().processText).toHaveBeenCalledWith(longText, "optimize_long");
    expect(result.current.optimizedText).toBe("长文优化");
  });

  it("uses an explicit non-auto default_mode as the processing mode", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    api().transcribeFile.mockResolvedValue({
      success: true,
      text: "显式模式",
      duration: 1,
    });
    api().getSetting.mockResolvedValue("optimize_long");
    api().processText.mockResolvedValue({ success: true, text: "显式优化" });

    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/mode.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });

    expect(api().processText).toHaveBeenCalledWith("显式模式", "optimize_long");
  });

  it("skips AI when the transcription succeeds without text", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    api().transcribeFile.mockResolvedValue({ success: true, duration: 2 });
    api().getSetting.mockImplementation((key: string) =>
      key === "default_mode" ? Promise.resolve(null) : Promise.resolve(true),
    );

    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/notext.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });

    // useAI is true but response.text is missing → the AI step never runs.
    expect(api().processText).not.toHaveBeenCalled();
    expect(result.current.state).toBe("done");
    expect(result.current.optimizedText).toBeNull();
    expect(result.current.isOptimizing).toBe(false);
  });

  it("keeps optimizedText null when the AI result is unsuccessful", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    api().transcribeFile.mockResolvedValue({
      success: true,
      text: "失败结果",
      duration: 1,
    });
    api().getSetting.mockResolvedValue("auto");
    api().processText.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/aifail.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });

    expect(api().processText).toHaveBeenCalledTimes(1);
    expect(result.current.optimizedText).toBeNull();
    expect(result.current.state).toBe("done");
  });

  it("keeps optimizedText null when the AI result omits text", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    api().transcribeFile.mockResolvedValue({
      success: true,
      text: "无文本AI",
      duration: 1,
    });
    api().getSetting.mockResolvedValue("auto");
    api().processText.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/ainotext.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });

    expect(api().processText).toHaveBeenCalledTimes(1);
    expect(result.current.optimizedText).toBeNull();
    expect(result.current.state).toBe("done");
  });

  it("completes transcription without a progress-subscription bridge", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    delete (api() as Partial<TestElectronAPI>).onFileTranscriptionProgress;
    api().transcribeFile.mockResolvedValue({
      success: true,
      text: "无进度桥",
      duration: 1,
    });
    api().getSetting.mockResolvedValue("off");

    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/noprog.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });

    expect(result.current.state).toBe("done");
    expect(result.current.result?.text).toBe("无进度桥");
  });

  it("uses the generic transcription failure message when the error field is missing", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    api().transcribeFile.mockResolvedValue({ success: false });
    api().getSetting.mockResolvedValue("off");

    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/noerr.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("转录失败");
  });

  it("uses the generic transcription error when a non-Error is thrown", async () => {
    api().validateAudioFile.mockResolvedValue(VALID);
    api().transcribeFile.mockRejectedValue("进程退出");
    api().getSetting.mockResolvedValue("off");

    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/crashstr.wav");
    });
    await act(async () => {
      await result.current.startTranscription();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("转录过程中出错");
  });

  it("transitions to cancelled without the cancel bridge", async () => {
    delete (api() as Partial<TestElectronAPI>).cancelFileTranscription;
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.cancelTranscription();
    });
    expect(result.current.state).toBe("cancelled");
    expect(result.current.progress).toBeNull();
  });

  it("transitions to cancelled even when the cancel IPC rejects", async () => {
    api().cancelFileTranscription.mockRejectedValue(new Error("取消失败"));
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.cancelTranscription();
    });
    expect(result.current.state).toBe("cancelled");
  });

  it("unsubscribes the progress listener on unmount", async () => {
    const unsubscribe = vi.fn();
    api().validateAudioFile.mockResolvedValue(VALID);
    api().onFileTranscriptionProgress.mockImplementation(() => unsubscribe);
    api().transcribeFile.mockImplementation(() => new Promise(() => undefined));

    const { result, unmount } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/unsub.wav");
    });
    await act(async () => {
      void result.current.startTranscription();
    });
    expect(api().onFileTranscriptionProgress).toHaveBeenCalledTimes(1);

    // Unmounting runs the effect cleanup, which invokes the stored
    // unsubscribe function and clears the ref.
    act(() => {
      unmount();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reset clears a sticky validation error", async () => {
    api().validateAudioFile.mockResolvedValue({
      success: false,
      error: "格式不支持",
    });
    const { result } = renderHook(() => useFileTranscription());
    await act(async () => {
      await result.current.selectFileFromPath("/tmp/err.wav");
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("格式不支持");

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.fileInfo).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });
});
