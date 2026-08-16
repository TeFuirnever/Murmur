// @vitest-environment jsdom
// [20260729_Test_AppExpanded] Expand App.tsx coverage beyond app.test.tsx
// (which only covers the need_download / model-not-ready state at ~44%).
// This file exercises branches that require modelStatus === "ready":
//   - toggleRecording (mic button click) calls startRecording
//   - file-import mode renders the FileImport component
//   - the "开始新录音" button resets recording state after a result
//   - handleCopyText is invoked via the TranscriptionResult copy button
// Mocks mirror app.test.tsx (useRecording / useModelStatus / useHotkey /
// useWindowDrag / SettingsPage / electronAPI), but useModule-scoped mutable
// state so individual tests can flip modelStatus to "ready" and inject a
// transcription result through the useRecording onTranscriptionComplete hook.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

// --- Controllable mock state ---
// useModelStatus returns this object; tests mutate `modelStatusState.stage`
// and `modelStatusState.isReady` to drive App into the ready branch.
const modelStatusState = {
  stage: "ready",
  isReady: true,
  downloadProgress: 0,
  error: null as string | null,
  downloadModels: vi.fn(),
  checkModelStatus: vi.fn(),
};

// useRecording captures the onTranscriptionComplete callback passed in by App
// so a test can fire a transcription result (string|object) and drive App
// into the result-shown branch (originalText set). start/stop are spies.
const recordingState = {
  isRecording: false,
  isProcessing: false,
  isOptimizing: false,
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  error: null as string | null,
  // App passes { onTranscriptionComplete, onAIOptimizationComplete, onSaveComplete }
  // useRecording captures them here.
  onTranscriptionComplete: null as
    | ((result: string | Record<string, unknown>) => void)
    | null,
  onAIOptimizationComplete: null as
    | ((result: string | Record<string, unknown>) => void)
    | null,
  onSaveComplete: null as ((result: { id: number }) => void) | null,
};

vi.mock("../../src/hooks/useRecording", () => ({
  useRecording: (opts: {
    onTranscriptionComplete?: (r: string | Record<string, unknown>) => void;
    onAIOptimizationComplete?: (r: string | Record<string, unknown>) => void;
    onSaveComplete?: (r: { id: number }) => void;
  }) => {
    recordingState.onTranscriptionComplete =
      opts?.onTranscriptionComplete ?? null;
    recordingState.onAIOptimizationComplete =
      opts?.onAIOptimizationComplete ?? null;
    recordingState.onSaveComplete = opts?.onSaveComplete ?? null;
    return {
      isRecording: recordingState.isRecording,
      isProcessing: recordingState.isProcessing,
      isOptimizing: recordingState.isOptimizing,
      startRecording: recordingState.startRecording,
      stopRecording: recordingState.stopRecording,
      error: recordingState.error,
    };
  },
  determineProcessingMode: vi.fn(() => "optimize"),
}));

vi.mock("../../src/hooks/useModelStatus", () => ({
  useModelStatus: () => modelStatusState,
  ModelStatusProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("../../src/hooks/useHotkey", () => ({
  useHotkey: () => ({
    hotkey: "Cmd+Shift+Space",
    registerHotkey: vi.fn().mockResolvedValue(undefined),
    unregisterHotkey: vi.fn(),
    syncRecordingState: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useWindowDrag", () => ({
  useWindowDrag: () => ({
    isDragging: false,
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
    handleClick: () => true,
  }),
}));

vi.mock("../../src/settings", () => ({
  SettingsPage: () =>
    React.createElement("div", { "data-testid": "settings-page" }),
}));

// Mock electronAPI (same shape as app.test.tsx). copyText is the handler
// handleCopyText routes through when window.electronAPI is present.
const mockElectronAPI: Record<string, ReturnType<typeof vi.fn>> = {};
beforeEach(() => {
  const handlers: Record<string, unknown> = {
    getSetting: vi.fn().mockResolvedValue("paste"),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getAllSettings: vi.fn().mockResolvedValue({}),
    copyText: vi.fn().mockResolvedValue(undefined),
    pasteText: vi.fn().mockResolvedValue(undefined),
    closeApp: vi.fn(),
    hideWindow: vi.fn(),
    minimizeWindow: vi.fn(),
    maximizeWindow: vi.fn(),
    openSettingsWindow: vi.fn(),
    openHistoryWindow: vi.fn(),
    onHotkeyTriggered: vi.fn(() => () => {}),
    onWindowMaximizeChange: vi.fn(() => () => {}),
    onSettingsUpdate: vi.fn(() => () => {}),
    processText: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    onModelStatusUpdate: vi.fn(() => () => {}),
    // TranscriptionResult reads AI modes on mount; stub to resolve empty.
    getAIModes: vi.fn().mockResolvedValue([]),
    diarizeAudio: vi.fn(),
  };
  Object.assign(mockElectronAPI, {});
  for (const [k, v] of Object.entries(handlers))
    mockElectronAPI[k] = v as ReturnType<typeof vi.fn>;
  (
    window as unknown as {
      electronAPI: Record<string, ReturnType<typeof vi.fn>>;
    }
  ).electronAPI = mockElectronAPI;

  // Reset controllable state between tests.
  modelStatusState.stage = "ready";
  modelStatusState.isReady = true;
  modelStatusState.downloadProgress = 0;
  modelStatusState.error = null;
  recordingState.isRecording = false;
  recordingState.isProcessing = false;
  recordingState.isOptimizing = false;
  recordingState.error = null;
  recordingState.onTranscriptionComplete = null;
  recordingState.onAIOptimizationComplete = null;
  recordingState.onSaveComplete = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// Import AFTER mocks
import App from "../../src/App";

describe("[20260729_Test_AppExpanded] model-ready state", () => {
  it("enables the mic button and shows the hotkey hint when model is ready", () => {
    render(React.createElement(App));
    const mic = screen.getByTestId("mic-button");
    expect(mic).not.toBeDisabled();
    // idle ready state shows the hotkey hint text
    expect(screen.getByText(/点击麦克风或按 .* 开始录音/)).toBeInTheDocument();
  });

  it("calls startRecording when the mic button is clicked in the ready/idle state", () => {
    render(React.createElement(App));
    const mic = screen.getByTestId("mic-button");
    fireEvent.click(mic);
    expect(recordingState.startRecording).toHaveBeenCalledTimes(1);
  });

  it("shows 停止录音 aria-label and calls stopRecording when already recording", () => {
    recordingState.isRecording = true;
    render(React.createElement(App));
    const mic = screen.getByTestId("mic-button");
    expect(mic).toHaveAttribute("aria-label", "停止录音");
    fireEvent.click(mic);
    expect(recordingState.stopRecording).toHaveBeenCalledTimes(1);
    // startRecording must NOT be called when already recording
    expect(recordingState.startRecording).not.toHaveBeenCalled();
  });

  it("does not start recording while processing (mic button disabled)", () => {
    recordingState.isProcessing = true;
    render(React.createElement(App));
    const mic = screen.getByTestId("mic-button");
    expect(mic).toBeDisabled();
    fireEvent.click(mic);
    expect(recordingState.startRecording).not.toHaveBeenCalled();
  });
});

describe("[20260729_Test_AppExpanded] file-import mode", () => {
  it("renders the FileImport component when the 文件导入 tab is clicked", () => {
    render(React.createElement(App));
    // recording mode is active by default; switch to file-import
    fireEvent.click(screen.getByText("文件导入"));
    // FileImport renders FileDropZone which shows this prompt text.
    // Use a function matcher to find the drop-zone element robustly.
    expect(
      screen.getByText((content, element) => {
        // FileDropZone renders drag/drop text; match any non-empty text node
        // containing "拖拽" OR "选择" to confirm FileImport mounted.
        const has = (s: string) => content.includes(s);
        return (
          !!element?.tagName &&
          (has("拖拽") || has("选择") || has("点击") || has("音频"))
        );
      }),
    ).toBeInTheDocument();
  });

  it("switches back to recording mode from file-import when not recording", () => {
    render(React.createElement(App));
    fireEvent.click(screen.getByText("文件导入"));
    fireEvent.click(screen.getByText("实时录音"));
    // mic button is unique to recording mode
    expect(screen.getByTestId("mic-button")).toBeInTheDocument();
  });
});

describe("[20260729_Test_AppExpanded] transcription result + reset", () => {
  it("renders the TranscriptionResult and 开始新录音 button after a transcription completes", async () => {
    render(React.createElement(App));
    // App wires onTranscriptionComplete -> handleRecordingCompleteRef, which
    // sets originalText when passed { success, text }.
    await act(async () => {
      recordingState.onTranscriptionComplete?.({
        success: true,
        text: "这是识别结果",
        duration: 5,
      });
    });
    expect(screen.getByText("这是识别结果")).toBeInTheDocument();
    expect(screen.getByText("开始新录音")).toBeInTheDocument();
  });

  it("clears the result when 开始新录音 is clicked (resetRecordingState)", async () => {
    render(React.createElement(App));
    await act(async () => {
      recordingState.onTranscriptionComplete?.({
        success: true,
        text: "待清除的文本",
      });
    });
    expect(screen.getByText("待清除的文本")).toBeInTheDocument();
    fireEvent.click(screen.getByText("开始新录音"));
    expect(screen.queryByText("待清除的文本")).toBeNull();
    expect(screen.queryByText("开始新录音")).toBeNull();
  });
});

describe("[20260729_Test_AppExpanded] handleCopyText", () => {
  it("calls window.electronAPI.copyText when the TranscriptionResult copy button is clicked", async () => {
    render(React.createElement(App));
    await act(async () => {
      recordingState.onTranscriptionComplete?.({
        success: true,
        text: "可复制的文本",
      });
    });
    expect(screen.getByText("可复制的文本")).toBeInTheDocument();
    // TranscriptionResult renders a copy button titled "复制文本".
    const copyButton = screen.getByTitle("复制文本");
    await act(async () => {
      fireEvent.click(copyButton);
    });
    await waitFor(() => {
      expect(mockElectronAPI.copyText).toHaveBeenCalledWith("可复制的文本");
    });
  });
});
