// @vitest-environment jsdom
// [20260905_Feat_BloubFileLift] Integration pin for the ticket 4 P0: App must
// inject its OWN useFileTranscription controller into FileImport, so the
// title-bar mascot tracks file-transcription state. The hook module is mocked
// to a transcribing controller; if the injection is severed, FileImport falls
// back to an internal idle instance and both assertions below fail (no orbit
// pose, no cancel control).

import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const controller = {
  state: "transcribing",
  fileInfo: { filePath: "/a.mp3", fileName: "a.mp3", fileSize: 1 },
  progress: { phase: "transcribing", message: "处理中", progress_pct: 42 },
  result: null,
  error: null,
  isOptimizing: false,
  optimizedText: null,
  selectFile: vi.fn(),
  selectFileFromPath: vi.fn(),
  startTranscription: vi.fn(),
  cancelTranscription: vi.fn(),
  reset: vi.fn(),
};

vi.mock("../../src/hooks/useFileTranscription", () => ({
  useFileTranscription: () => controller,
}));

vi.mock("../../src/hooks/useRecording", () => ({
  useRecording: () => ({
    isRecording: false,
    isProcessing: false,
    isOptimizing: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    error: null,
  }),
  determineProcessingMode: vi.fn(() => "optimize"),
}));

vi.mock("../../src/hooks/useModelStatus", () => ({
  useModelStatus: () => ({
    stage: "ready",
    isReady: true,
    downloadProgress: 0,
    error: null,
    downloadModels: vi.fn(),
    checkModelStatus: vi.fn(),
  }),
  ModelStatusProvider: ({ children }: { children: React.ReactNode }) =>
    children,
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

beforeEach(() => {
  const handlers: Record<string, unknown> = {
    getSetting: vi.fn().mockResolvedValue("paste"),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getAllSettings: vi.fn().mockResolvedValue({}),
    copyText: vi.fn().mockResolvedValue(undefined),
    onHotkeyTriggered: vi.fn(() => () => {}),
    onWindowMaximizeChange: vi.fn(() => () => {}),
    onSettingsUpdate: vi.fn(() => () => {}),
    onModelStatusUpdate: vi.fn(() => () => {}),
    getAIModes: vi.fn().mockResolvedValue([]),
    setAlwaysOnTop: vi.fn(),
  };
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI =
    handlers;
});

// Import AFTER mocks
import App from "../../src/App";

describe("[20260905_Feat_BloubFileLift] App injects the lifted controller", () => {
  it("mascot shows orbit and FileImport shows progress while transcribing", async () => {
    render(React.createElement(App));
    fireEvent.click(screen.getByText("文件导入"));
    // the injected transcribing state drives both the mascot pose ...
    await waitFor(() =>
      expect(
        document.querySelector('svg[data-bot-state="orbit"]'),
      ).not.toBeNull(),
    );
    // ... and the injected progress UI (cancel control from the controller)
    expect(screen.getByText("取消转录")).toBeInTheDocument();
  });
});
