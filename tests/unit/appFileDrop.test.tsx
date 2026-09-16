// @vitest-environment jsdom
// [20260911_Fix_338_DragDropImport] Issue #338 regression: dragging an audio
// file from Finder/Explorer onto the Murmur main window did NOTHING — the
// drop zone only existed inside file-import mode, and outside it no renderer
// code preventDefault()ed dragover, so Chromium discarded the drop before any
// business logic (and an unprevented drop can navigate the window to file://).
// These tests pin the window-level drop target: any drop on the window feeds
// the SAME import pipeline as the dialog button (validateAudioFile IPC ->
// audioPathValidator) and switches to file-import mode to show the result.

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

const validateAudioFile = vi.fn();
const getPathForFile = vi.fn();
const importAudioFile = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  validateAudioFile.mockResolvedValue({
    success: true,
    filePath: "/dropped.wav",
    fileName: "dropped.wav",
    fileSize: 2048,
    extension: ".wav",
  });
  getPathForFile.mockReturnValue("/dropped.wav");
  importAudioFile.mockResolvedValue({ success: false, canceled: true });
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI =
    {
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
      validateAudioFile,
      getPathForFile,
      importAudioFile,
      onFileTranscriptionProgress: vi.fn(() => () => {}),
      transcribeFile: vi.fn(() => new Promise(() => {})),
    };
});

// Import AFTER mocks
import App from "../../src/App";

function fireWindowDrop(files: File[]): Event {
  const evt = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: { files } });
  fireEvent(window, evt);
  return evt;
}

describe("[20260911_Fix_338_DragDropImport] window-level audio drop", () => {
  it("prevents the default on window dragover so the drop is not discarded", () => {
    render(React.createElement(App));
    const evt = new Event("dragover", { bubbles: true, cancelable: true });
    fireEvent(window, evt);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("prevents the default on window drop so Chromium never navigates to file://", () => {
    render(React.createElement(App));
    const evt = fireWindowDrop([]);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("imports a file dropped anywhere on the window through the shared pipeline", async () => {
    render(React.createElement(App));
    // App boots in recording mode: the FileDropZone is NOT mounted, so this
    // drop can only be handled by the window-level target.
    const file = new File(["audio"], "dropped.wav", { type: "audio/wav" });
    fireWindowDrop([file]);

    await waitFor(() =>
      expect(validateAudioFile).toHaveBeenCalledWith("/dropped.wav"),
    );
    // The dialog import path must NOT be used as a fallback.
    expect(importAudioFile).not.toHaveBeenCalled();
    // Mode switched to file-import and the validated file is selected.
    expect(await screen.findByText("dropped.wav")).toBeInTheDocument();
  });
});
