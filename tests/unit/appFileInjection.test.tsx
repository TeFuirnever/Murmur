// @vitest-environment jsdom
// [20260905_Feat_BloubFileLift] Integration pin for the ticket 4 P0: App must
// inject its OWN useFileTranscription controller into FileImport, so the
// title-bar mascot tracks file-transcription state.
//
// Deliberately uses the REAL hook and drives the pipeline through mocked
// electronAPI, with `transcribeFile` pending forever: App's instance and
// FileImport's fallback instance are then separate useState stores, and the
// mascot's orbit pose is a true discriminator — with the injection severed
// FileImport still shows its own progress UI, but App's instance stays idle
// and svg[data-bot-state="orbit"] never appears. (The first version of this
// test shared one mocked controller object across both call sites and passed
// on the broken commit — it guarded nothing.)

import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
    // the file pipeline: dialog resolves a file, transcription hangs so the
    // transcribing pose (and its mascot orbit mirror) is stable to assert
    importAudioFile: vi.fn().mockResolvedValue({
      success: true,
      filePath: "/a.mp3",
      fileName: "a.mp3",
      fileSize: 1,
    }),
    onFileTranscriptionProgress: vi.fn(() => () => {}),
    transcribeFile: vi.fn(() => new Promise(() => {})),
  };
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI =
    handlers;
});

// Import AFTER mocks
import App from "../../src/App";

describe("[20260905_Feat_BloubFileLift] App injects the lifted controller", () => {
  it("driving the real file pipeline turns the mascot to orbit", async () => {
    render(React.createElement(App));
    fireEvent.click(screen.getByText("文件导入"));

    // select a file through the (mocked) dialog, then start transcription
    fireEvent.click(screen.getByText("点击选择音频文件或拖拽到此处"));
    const start = await screen.findByText("开始转录");
    fireEvent.click(start);

    // App's own controller must be the one transcribing: the mascot pose is
    // the discriminator between injected and fallback instances
    await waitFor(() =>
      expect(
        document.querySelector('svg[data-bot-state="orbit"]'),
      ).not.toBeNull(),
    );
    expect(screen.getByText("取消转录")).toBeInTheDocument();
  });
});
