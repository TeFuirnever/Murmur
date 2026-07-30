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
