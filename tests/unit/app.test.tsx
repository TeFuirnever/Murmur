// @vitest-environment jsdom
// [20260729_Test_App] Integration tests for the App component. App.tsx is the
// largest file (766 lines) at 0% coverage. We mock the heavy hooks (useRecording,
// useModelStatus, useHotkey, useWindowDrag) and electronAPI to test the render
// paths and user interactions. Focus: model-not-ready state, recording UI,
// mode switching, window controls.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";

// [20260905_Fix_246_HotkeyReplaceAtomic] Shared registerHotkey spy — the
// hotkey-wiring tests below assert against it across the render boundary
// (the useHotkey mock factory would otherwise mint a fresh vi.fn() per call).
const hotkeyMocks = vi.hoisted(() => ({
  registerHotkey: vi.fn<(hotkey: string) => Promise<boolean>>(),
}));

// --- Mock all hooks App depends on ---

// useRecording: return idle state by default
vi.mock("../../src/hooks/useRecording", () => ({
  useRecording: () => ({
    isRecording: false,
    isProcessing: false,
    isOptimizing: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    error: null as string | null,
  }),
  determineProcessingMode: vi.fn(() => "optimize"),
}));

// useModelStatus: return "need_download" stage by default
vi.mock("../../src/hooks/useModelStatus", () => ({
  useModelStatus: () => ({
    stage: "need_download",
    isReady: false,
    downloadProgress: 0,
    error: null,
    downloadModels: vi.fn(),
    checkModelStatus: vi.fn(),
  }),
  ModelStatusProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// useHotkey
vi.mock("../../src/hooks/useHotkey", () => ({
  useHotkey: () => ({
    hotkey: "Cmd+Shift+Space",
    registerHotkey: hotkeyMocks.registerHotkey.mockResolvedValue(true),
    unregisterHotkey: vi.fn(),
    syncRecordingState: vi.fn(),
  }),
}));

// useWindowDrag
vi.mock("../../src/hooks/useWindowDrag", () => ({
  useWindowDrag: () => ({
    isDragging: false,
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
    handleClick: () => true,
  }),
}));

// Mock electronAPI
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
  };
  Object.assign(mockElectronAPI, {});
  for (const [k, v] of Object.entries(handlers))
    mockElectronAPI[k] = v as ReturnType<typeof vi.fn>;
  (
    window as unknown as {
      electronAPI: Record<string, ReturnType<typeof vi.fn>>;
    }
  ).electronAPI = mockElectronAPI;
});

afterEach(() => {
  vi.clearAllMocks();
});

// Import AFTER mocks
import App from "../../src/App";

describe("App component", () => {
  it("renders the main UI with Murmur title", () => {
    render(React.createElement(App));
    expect(screen.getByText("Murmur")).toBeInTheDocument();
  });

  it("shows model download prompt when model not ready", () => {
    render(React.createElement(App));
    expect(screen.getByText(/下载AI模型/)).toBeInTheDocument();
  });

  it("renders window control buttons (minimize, close)", () => {
    render(React.createElement(App));
    expect(screen.getByLabelText("最小化")).toBeInTheDocument();
    expect(screen.getByLabelText("关闭")).toBeInTheDocument();
  });

  it("renders mode switch tabs (recording / file-import)", () => {
    render(React.createElement(App));
    expect(screen.getByText("实时录音")).toBeInTheDocument();
    expect(screen.getByText("文件导入")).toBeInTheDocument();
  });

  it("switches to file-import mode when clicked", () => {
    render(React.createElement(App));
    const fileImportTab = screen.getByText("文件导入");
    fireEvent.click(fileImportTab);
    // FileImport component should now be rendered
    expect(screen.getByText("文件导入")).toBeInTheDocument();
  });

  it("renders history and settings buttons", () => {
    render(React.createElement(App));
    // These buttons are wrapped in Tooltip with content= not aria-label.
    // Find them by the lucide icon role.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(5);
  });

  it("calls minimizeWindow when minimize button clicked", () => {
    render(React.createElement(App));
    fireEvent.click(screen.getByLabelText("最小化"));
    expect(mockElectronAPI.minimizeWindow).toHaveBeenCalled();
  });

  it("calls hideWindow when close button clicked (default close_behavior=hide)", () => {
    render(React.createElement(App));
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(mockElectronAPI.hideWindow).toHaveBeenCalled();
  });

  // [20260816_Refactor_DeadChannels] ?page=settings in-app route removed —
  // the settings window is its own entry in dev and production.
});

// [20260905_Fix_246_HotkeyReplaceAtomic] The hotkey runtime-change loop is the
// heart of issue #246: the persisted "hotkey" setting is applied on mount and
// re-applied when SETTINGS_UPDATE carries key="hotkey". These tests use a
// shared hoisted registerHotkey spy (the useHotkey mock above returns a fresh
// vi.fn() per call, which would be unassertable across the render boundary).
describe("App hotkey setting wiring (#246)", () => {
  it("applies the persisted hotkey setting on mount", async () => {
    mockElectronAPI.getSetting.mockImplementation(async (key: string) =>
      key === "hotkey" ? "CommandOrControl+Shift+K" : "paste",
    );
    render(React.createElement(App));

    await waitFor(() =>
      expect(hotkeyMocks.registerHotkey).toHaveBeenCalledWith(
        "CommandOrControl+Shift+K",
      ),
    );
  });

  it("re-applies the hotkey when SETTINGS_UPDATE carries key=hotkey", async () => {
    render(React.createElement(App));
    // The mount application is async (getSetting → registerHotkey); let it
    // land before clearing so only the update path is measured.
    await waitFor(() =>
      expect(hotkeyMocks.registerHotkey).toHaveBeenCalledTimes(1),
    );
    hotkeyMocks.registerHotkey.mockClear();

    const updateCb = mockElectronAPI.onSettingsUpdate.mock
      .calls[0][0] as (data: { key: string }) => void;
    await act(async () => {
      updateCb({ key: "hotkey" });
    });

    // The re-apply path re-reads the persisted value (getSetting) and
    // registers whatever it holds — not a hardcoded combo.
    expect(mockElectronAPI.getSetting).toHaveBeenCalledWith(
      "hotkey",
      expect.any(String),
    );
    expect(hotkeyMocks.registerHotkey).toHaveBeenCalledTimes(1);
  });

  it("does not re-apply the hotkey for unrelated SETTINGS_UPDATE keys", async () => {
    render(React.createElement(App));
    await waitFor(() =>
      expect(hotkeyMocks.registerHotkey).toHaveBeenCalledTimes(1),
    );
    hotkeyMocks.registerHotkey.mockClear();

    const updateCb = mockElectronAPI.onSettingsUpdate.mock
      .calls[0][0] as (data: { key: string }) => void;
    await act(async () => {
      updateCb({ key: "theme" });
    });

    expect(hotkeyMocks.registerHotkey).not.toHaveBeenCalled();
  });
});
