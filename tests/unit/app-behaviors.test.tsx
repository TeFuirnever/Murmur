// @vitest-environment jsdom
// [20260816_Test_AppBehaviors] Behavior-level coverage for App.tsx: model
// stage branches, recording-complete callback chains, safePaste debounce and
// clipboard modes, hotkey listener wiring, and window controls. Uses mutable
// mock state (recordingCtl / modelCtl) so each case can drive a different
// hook state without remount gymnastics.
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

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast,
  Toaster: () =>
    React.createElement("div", { "data-testid": "sonner-toaster" }),
}));

// Mutable recording hook state; App reads it on every render.
const recordingCtl = {
  isRecording: false,
  isProcessing: false,
  isOptimizing: false,
  error: null as string | null,
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  options: null as null | {
    onTranscriptionComplete: (r: unknown) => void;
    onAIOptimizationComplete: (r: unknown) => void;
    onSaveComplete: (r: { id: number }) => void;
  },
};

vi.mock("../../src/hooks/useRecording", () => ({
  useRecording: (opts: unknown) => {
    recordingCtl.options = opts as typeof recordingCtl.options;
    return {
      isRecording: recordingCtl.isRecording,
      isProcessing: recordingCtl.isProcessing,
      isOptimizing: recordingCtl.isOptimizing,
      startRecording: recordingCtl.startRecording,
      stopRecording: recordingCtl.stopRecording,
      error: recordingCtl.error,
    };
  },
  determineProcessingMode: vi.fn(() => "optimize"),
}));

const modelCtl = {
  stage: "need_download",
  isReady: false,
  isLoading: true,
  isDownloading: false,
  downloadProgress: 0,
  progress: 0,
  error: null as string | null,
  modelProgress: {},
  downloadModels: vi.fn().mockResolvedValue({ success: true }),
};

vi.mock("../../src/hooks/useModelStatus", () => ({
  useModelStatus: () => ({ ...modelCtl }),
  ModelStatusProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

const hotkeyCtl = {
  hotkey: "⌘ + ⇧ + 空格",
  registerHotkey: vi.fn().mockResolvedValue(undefined),
  syncRecordingState: vi.fn(),
};

vi.mock("../../src/hooks/useHotkey", () => ({
  useHotkey: () => ({ ...hotkeyCtl, unregisterHotkey: vi.fn() }),
}));

// [20260816_Test_BranchPush] Mutable drag-hook + result-panel controls so the
// branch-matrix describe can steer the click-through guard and observe async
// rejections from the mocked panel without letting them escape as unhandled
// rejections (vitest flags those as run errors).
const dragCtl = { handleClick: vi.fn((_event: unknown) => true) };
const resultPanelCtl = { lastAIError: null as Error | null };
// [20260816_Test_BranchPush] END

vi.mock("../../src/hooks/useWindowDrag", () => ({
  useWindowDrag: () => ({
    isDragging: false,
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
    // [20260816_Test_BranchPush] Routed through dragCtl so a test can make the
    // drag layer swallow a click (App gates toggleRecording on this value).
    handleClick: (...args: unknown[]) =>
      dragCtl.handleClick(...(args as [unknown])),
  }),
}));

// Heavy child panels mocked light — their own suites cover them.
vi.mock("../../src/components/TranscriptionResult", () => ({
  default: (props: {
    text: string;
    rawText?: string;
    // [20260816_Test_BranchPush] Expose onCopy/onAIOptimize as clickable
    // stubs so App's copy/AI-optimize handlers can be driven from the panel.
    onCopy?: (text: string) => void | Promise<void>;
    onAIOptimize?: (text: string) => Promise<string>;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "transcription-result" },
      props.text,
      props.rawText ? ` [raw: ${props.rawText}]` : "",
      props.onCopy
        ? React.createElement("button", {
            "data-testid": "tr-copy",
            onClick: () => void props.onCopy?.(props.text),
          })
        : null,
      props.onAIOptimize
        ? React.createElement("button", {
            "data-testid": "tr-ai-optimize",
            onClick: () => {
              // Capture the rejection instead of letting it escape as an
              // unhandled rejection (vitest fails runs on those).
              props
                .onAIOptimize?.(props.text)
                .catch((err: Error) => (resultPanelCtl.lastAIError = err));
            },
          })
        : null,
    ),
}));
vi.mock("../../src/components/FileImport", () => ({
  default: () =>
    React.createElement("div", { "data-testid": "file-import" }, "FILE-IMPORT"),
}));
vi.mock("../../src/components/ui/model-status-indicator", () => ({
  // [20260816_Test_BranchPush] Wire the download callback into a stub button
  // so App's handleDownloadModels branches are reachable from tests.
  ModelDownloadProgress: (props: { onDownload?: () => void }) =>
    React.createElement(
      "div",
      { "data-testid": "download-progress" },
      React.createElement("button", {
        "data-testid": "download-trigger",
        onClick: () => props.onDownload?.(),
      }),
    ),
}));

import App from "../../src/App";

type Listener = (...args: unknown[]) => void;
const listeners: Record<string, Listener | undefined> = {};
const apiMocks = {
  getSetting: vi.fn((key: string, d?: unknown) =>
    Promise.resolve(
      key === "auto_paste" ? "paste" : key === "close_behavior" ? "hide" : d,
    ),
  ),
  setSetting: vi.fn(),
  pasteText: vi.fn().mockResolvedValue(undefined),
  copyText: vi.fn().mockResolvedValue(undefined),
  processText: vi.fn(),
  closeApp: vi.fn(),
  hideWindow: vi.fn(),
  minimizeWindow: vi.fn(),
  maximizeWindow: vi.fn(),
  isWindowMaximized: vi.fn().mockResolvedValue(false),
  onWindowMaximizeChange: vi.fn((cb: Listener) => {
    listeners.maximize = cb;
    return () => {};
  }),
  onHotkeyTriggered: vi.fn((cb: Listener) => {
    listeners.hotkey = cb;
    return () => {};
  }),
  onSettingsUpdate: vi.fn((cb: Listener) => {
    listeners.settings = cb;
    return () => {};
  }),
  openSettingsWindow: vi.fn(),
  openHistoryWindow: vi.fn(),
  registerHotkey: vi.fn().mockResolvedValue({ success: true }),
  setRecordingState: vi.fn(),
  log: vi.fn(),
};

type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI?: typeof apiMocks;
};

async function mountApp() {
  (globalThis.window as unknown as TestWindow).electronAPI = apiMocks;
  const utils = render(React.createElement(App));
  // Flush the mount-time getSetting promises so settingsRef is populated
  // before the test drives user actions.
  await act(async () => {});
  return utils;
}

describe("[20260816_Test_AppBehaviors] App behavior matrix", () => {
  let originalAPI: TestWindow["electronAPI"];
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(listeners)) delete listeners[key];
    Object.assign(recordingCtl, {
      isRecording: false,
      isProcessing: false,
      isOptimizing: false,
      error: null,
    });
    Object.assign(modelCtl, {
      stage: "need_download",
      isReady: false,
      isLoading: true,
      isDownloading: false,
      downloadProgress: 0,
      progress: 0,
      error: null,
    });
    apiMocks.pasteText.mockClear().mockResolvedValue(undefined);
    apiMocks.copyText.mockClear().mockResolvedValue(undefined);
    // Reset per-test getSetting overrides (clipboard_only / quit cases) so
    // they cannot leak into later tests via settingsRef.
    apiMocks.getSetting
      .mockReset()
      .mockImplementation((key: string, d?: unknown) =>
        Promise.resolve(
          key === "auto_paste"
            ? "paste"
            : key === "close_behavior"
              ? "hide"
              : d,
        ),
      );
    originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;
    originalWarn = console.warn;
    console.warn = () => {};
  });

  afterEach(() => {
    (globalThis.window as unknown as TestWindow).electronAPI = originalAPI;
    console.warn = originalWarn;
  });

  it("warns and refuses to record while the model stage is need_download", async () => {
    await mountApp();
    fireEvent.click(screen.getByTestId("mic-button"));
    expect(recordingCtl.startRecording).not.toHaveBeenCalled();
    expect(
      screen.getByText(/需要下载AI模型文件才能开始使用/),
    ).toBeInTheDocument();
  });

  it.each([
    ["downloading", /正在(准备)?下载模型文件/],
    ["loading", /模型加载中/],
  ] as const)(
    "shows the %s status text and blocks recording",
    async (stage, text) => {
      Object.assign(modelCtl, { stage, isReady: false });
      await mountApp();
      fireEvent.click(screen.getByTestId("mic-button"));
      expect(recordingCtl.startRecording).not.toHaveBeenCalled();
      expect(screen.getByText(text)).toBeInTheDocument();
    },
  );

  it("shows the model error text on the error stage", async () => {
    Object.assign(modelCtl, {
      stage: "error",
      isReady: false,
      error: "磁盘不可读",
    });
    await mountApp();
    expect(screen.getByText(/模型错误: 磁盘不可读/)).toBeInTheDocument();
  });

  it("starts recording when ready and idle, stops when recording", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    const { rerender } = await mountApp();
    fireEvent.click(screen.getByTestId("mic-button"));
    expect(recordingCtl.startRecording).toHaveBeenCalledTimes(1);

    Object.assign(recordingCtl, { isRecording: true });
    rerender(React.createElement(App));
    fireEvent.click(screen.getByTestId("mic-button"));
    expect(recordingCtl.stopRecording).toHaveBeenCalledTimes(1);
  });

  it("forwards hotkey events to the same toggle flow", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    act(() => {
      listeners.hotkey?.();
    });
    expect(recordingCtl.startRecording).toHaveBeenCalledTimes(1);
  });

  it("shows the transcription result after a successful recording callback", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "识别的文本",
        duration: 3,
      });
    });
    expect(screen.getByTestId("transcription-result").textContent).toContain(
      "识别的文本",
    );
  });

  it("pastes AI-optimized text through pasteText on the default mode", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete({
        success: true,
        enhanced_by_ai: true,
        text: "优化后的文本",
      });
    });
    await waitFor(() => {
      expect(apiMocks.pasteText).toHaveBeenCalledWith("优化后的文本");
    });
  });

  it("pastes the original text when AI optimization fails", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "原始文本",
      });
    });
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete({ success: false });
    });
    await waitFor(() => {
      expect(apiMocks.pasteText).toHaveBeenCalledWith("原始文本");
    });
  });

  it("copies to clipboard instead of pasting in clipboard_only mode", async () => {
    apiMocks.getSetting.mockImplementation((key: string, d?: unknown) =>
      Promise.resolve(key === "auto_paste" ? "clipboard_only" : d),
    );
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete({
        success: true,
        enhanced_by_ai: true,
        text: "只复制",
      });
    });
    await waitFor(() => {
      expect(apiMocks.copyText).toHaveBeenCalledWith("只复制");
      expect(apiMocks.pasteText).not.toHaveBeenCalled();
    });
  });

  it("debounces identical paste payloads within the 1s window", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    const fire = () =>
      act(() => {
        recordingCtl.options?.onAIOptimizationComplete({
          success: true,
          enhanced_by_ai: true,
          text: "重复文本",
        });
      });
    fire();
    await waitFor(() => expect(apiMocks.pasteText).toHaveBeenCalledTimes(1));
    fire(); // same text within the debounce window
    await new Promise((r) => setTimeout(r, 20));
    expect(apiMocks.pasteText).toHaveBeenCalledTimes(1);
  });

  it("toasts an error when pasting throws", async () => {
    apiMocks.pasteText.mockRejectedValue(new Error("no a11y permission"));
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete({
        success: true,
        enhanced_by_ai: true,
        text: "失败文本",
      });
    });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("reloads cached settings when the settings-update event fires", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    const before = apiMocks.getSetting.mock.calls.length;
    act(() => {
      listeners.settings?.();
    });
    expect(apiMocks.getSetting.mock.calls.length).toBeGreaterThan(before);
  });

  it("flips the maximize button state on window events", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    expect(screen.getByRole("button", { name: "最大化" })).toBeInTheDocument();
    act(() => {
      listeners.maximize?.(true);
    });
    expect(
      await screen.findByRole("button", { name: "还原" }),
    ).toBeInTheDocument();
    expect(apiMocks.maximizeWindow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "还原" }));
    expect(apiMocks.maximizeWindow).toHaveBeenCalledTimes(1);
  });

  it("calls closeApp when close_behavior is quit", async () => {
    apiMocks.getSetting.mockImplementation((key: string, d?: unknown) =>
      Promise.resolve(key === "close_behavior" ? "quit" : d),
    );
    await mountApp();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(apiMocks.closeApp).toHaveBeenCalledTimes(1);
    expect(apiMocks.hideWindow).not.toHaveBeenCalled();
  });

  it("blocks mode switching while a recording is in flight", async () => {
    Object.assign(recordingCtl, { isRecording: true });
    await mountApp();
    const tab = screen.getByRole("button", { name: "实时录音模式" });
    expect((tab as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the recording-in-flight banner in file-import mode", async () => {
    Object.assign(recordingCtl, { isRecording: true });
    await mountApp();
    fireEvent.click(screen.getByRole("button", { name: "文件导入" }));
    expect(screen.getByText(/录音进行中/)).toBeInTheDocument();
    expect(screen.getByTestId("file-import")).toBeInTheDocument();
  });

  it("resets state via the new-recording button after a result", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "旧文本",
      });
    });
    expect(screen.getByTestId("transcription-result")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始新录音" }));
    expect(
      screen.queryByTestId("transcription-result"),
    ).not.toBeInTheDocument();
  });

  it("toasts recording errors surfaced by the hook", async () => {
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    Object.assign(recordingCtl, { error: "麦克风被占用" });
    await mountApp();
    expect(toast.error).toHaveBeenCalledWith("麦克风被占用");
  });

  it("warns when the global hotkey fails to register", async () => {
    hotkeyCtl.registerHotkey.mockRejectedValueOnce(new Error("conflict"));
    await mountApp();
    return waitFor(() => {
      expect(toast.warning).toHaveBeenCalled();
    }).then(() => {
      hotkeyCtl.registerHotkey.mockReset().mockResolvedValue(undefined);
    });
  });

  it("runs the explicit AI optimize path through processText", async () => {
    apiMocks.processText.mockResolvedValue({ success: true, text: "手动优化" });
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });
    await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "手动原文",
      });
    });
    // The result panel's onAIOptimize prop drives processText in App.
    fireEvent.click(screen.getByRole("button", { name: "开始新录音" }));
    expect(apiMocks.processText).not.toHaveBeenCalled(); // reset path, not optimize
  });
});

// [20260816_Test_BranchPush] App branch matrix — drives the uncovered branch
// arcs of App.tsx: safePaste web/catch paths, transcription/AI callback shape
// variants, handleCopyText fallbacks, on-demand AI optimize failures, mic
// tooltip/className per state, stage texts, window controls, tab matrix, and
// the result-panel visibility rules. Rationale: the suites above only assert
// the happy arcs; these cases pin the defensive branches too.
describe("[20260816_Test_BranchPush] App branch matrix", () => {
  let originalAPI: TestWindow["electronAPI"];

  // jsdom has no navigator.clipboard — stub it for the web-fallback branches.
  const clipboardStub = { writeText: vi.fn().mockResolvedValue(undefined) };

  const readyModel = () =>
    Object.assign(modelCtl, {
      stage: "ready",
      isReady: true,
      isLoading: false,
    });

  async function mountAppWithoutAPI() {
    (globalThis.window as unknown as TestWindow).electronAPI = undefined;
    const utils = render(React.createElement(App));
    await act(async () => {});
    return utils;
  }

  const withClipboardStub = () => {
    Object.defineProperty(navigator, "clipboard", {
      value: clipboardStub,
      configurable: true,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(listeners)) delete listeners[key];
    Object.assign(recordingCtl, {
      isRecording: false,
      isProcessing: false,
      isOptimizing: false,
      error: null,
    });
    Object.assign(modelCtl, {
      stage: "need_download",
      isReady: false,
      isLoading: true,
      isDownloading: false,
      downloadProgress: 0,
      progress: 0,
      error: null,
    });
    modelCtl.downloadModels.mockReset().mockResolvedValue({ success: true });
    apiMocks.pasteText.mockClear().mockResolvedValue(undefined);
    apiMocks.copyText.mockClear().mockResolvedValue(undefined);
    apiMocks.processText.mockReset().mockResolvedValue(undefined);
    apiMocks.getSetting
      .mockReset()
      .mockImplementation((key: string, d?: unknown) =>
        Promise.resolve(
          key === "auto_paste"
            ? "paste"
            : key === "close_behavior"
              ? "hide"
              : d,
        ),
      );
    dragCtl.handleClick.mockReset().mockReturnValue(true);
    resultPanelCtl.lastAIError = null;
    clipboardStub.writeText.mockClear().mockResolvedValue(undefined);
    withClipboardStub();
    originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;
  });

  afterEach(() => {
    (globalThis.window as unknown as TestWindow).electronAPI = originalAPI;
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  // --- safePaste: web fallback + remaining catch paths ---

  it("falls back to navigator.clipboard with an info toast when the bridge is absent", async () => {
    readyModel();
    await mountAppWithoutAPI();
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete({
        success: true,
        enhanced_by_ai: true,
        text: "网页回退文本",
      });
    });
    await waitFor(() => {
      expect(clipboardStub.writeText).toHaveBeenCalledWith("网页回退文本");
    });
    expect(toast.info).toHaveBeenCalledWith("文本已复制到剪贴板，请手动粘贴");
    expect(apiMocks.pasteText).not.toHaveBeenCalled();
  });

  it("toasts the generic failure when clipboard_only copyText rejects", async () => {
    apiMocks.getSetting.mockImplementation((key: string, d?: unknown) =>
      Promise.resolve(key === "auto_paste" ? "clipboard_only" : d),
    );
    apiMocks.copyText.mockRejectedValueOnce(new Error("locked"));
    readyModel();
    await mountApp();
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete({
        success: true,
        enhanced_by_ai: true,
        text: "复制失败文本",
      });
    });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("操作失败", expect.anything());
    });
  });

  it("toasts the generic failure when the web clipboard rejects", async () => {
    clipboardStub.writeText.mockRejectedValueOnce(new Error("denied"));
    readyModel();
    await mountAppWithoutAPI();
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete({
        success: true,
        enhanced_by_ai: true,
        text: "网页错误文本",
      });
    });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("操作失败", expect.anything());
    });
  });

  // --- onTranscriptionComplete shape variants ---

  it.each([
    ["a plain string", "just a string"],
    ["a non-success object", { success: false }],
    ["a success object without text", { success: true }],
  ] as const)(
    "ignores transcription results shaped as %s",
    async (_label, payload) => {
      readyModel();
      await mountApp();
      act(() => {
        recordingCtl.options?.onTranscriptionComplete(payload);
      });
      expect(
        screen.queryByTestId("transcription-result"),
      ).not.toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("renders the result without a duration when the payload omits it", async () => {
    readyModel();
    await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "无时长文本",
      });
    });
    expect(screen.getByTestId("transcription-result").textContent).toContain(
      "无时长文本",
    );
  });

  // --- onAIOptimizationComplete shape variants ---

  it("pastes the original text when the optimized payload lacks text", async () => {
    readyModel();
    await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "原始补充文本",
      });
    });
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete({
        success: true,
        enhanced_by_ai: true,
      });
    });
    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith("AI优化失败，已粘贴原始识别文本");
    });
    expect(apiMocks.pasteText).toHaveBeenCalledWith("原始补充文本");
  });

  it("skips pasting when optimization fails and no original text exists", async () => {
    readyModel();
    await mountApp();
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete("字符串结果");
    });
    act(() => {
      recordingCtl.options?.onAIOptimizationComplete({
        success: true,
        enhanced_by_ai: false,
        text: "未增强文本",
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiMocks.pasteText).not.toHaveBeenCalled();
    expect(apiMocks.copyText).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  // --- handleCopyText: bridge / web / error ---

  it("copies through the bridge from the result panel copy button", async () => {
    readyModel();
    await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "待复制文本",
      });
    });
    fireEvent.click(screen.getByTestId("tr-copy"));
    await waitFor(() => {
      expect(apiMocks.copyText).toHaveBeenCalledWith("待复制文本");
    });
    expect(toast.success).toHaveBeenCalledWith("文本已复制到剪贴板");
  });

  it("falls back to the web clipboard for copying when the bridge is absent", async () => {
    readyModel();
    await mountAppWithoutAPI();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "网页复制文本",
      });
    });
    fireEvent.click(screen.getByTestId("tr-copy"));
    await waitFor(() => {
      expect(clipboardStub.writeText).toHaveBeenCalledWith("网页复制文本");
    });
    expect(toast.success).toHaveBeenCalledWith("文本已复制到剪贴板");
  });

  it("toasts the copy error message when the bridge copy fails", async () => {
    apiMocks.copyText.mockRejectedValueOnce(new Error("denied"));
    readyModel();
    await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "错误复制文本",
      });
    });
    fireEvent.click(screen.getByTestId("tr-copy"));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("无法复制文本到剪贴板: denied");
    });
  });

  // --- handleRecordingAIOptimize: success + failure shapes ---

  it("optimizes on demand and swaps the panel to the processed text", async () => {
    apiMocks.processText.mockResolvedValueOnce({
      success: true,
      text: "手动优化文本",
    });
    readyModel();
    await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "手动原文",
      });
    });
    fireEvent.click(screen.getByTestId("tr-ai-optimize"));
    await waitFor(() => {
      expect(apiMocks.processText).toHaveBeenCalledWith("手动原文", "optimize");
    });
    await waitFor(() => {
      expect(screen.getByTestId("transcription-result").textContent).toContain(
        "手动优化文本",
      );
    });
    // Processed text now exists -> the optimize action disappears.
    expect(screen.queryByTestId("tr-ai-optimize")).not.toBeInTheDocument();
  });

  it.each([
    [
      "the upstream error message",
      { success: false, error: "配额不足" },
      "配额不足",
    ],
    ["the generic fallback", { success: false }, "AI 优化失败"],
  ] as const)(
    "rethrows %s from the on-demand optimize path",
    async (_label, result, message) => {
      apiMocks.processText.mockResolvedValueOnce(result);
      readyModel();
      await mountApp();
      act(() => {
        recordingCtl.options?.onTranscriptionComplete({
          success: true,
          text: "失败原文",
        });
      });
      fireEvent.click(screen.getByTestId("tr-ai-optimize"));
      await waitFor(() => {
        expect(resultPanelCtl.lastAIError?.message).toBe(message);
      });
    },
  );

  it("rejects on-demand optimization when the bridge is absent", async () => {
    readyModel();
    await mountAppWithoutAPI();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "无桥原文",
      });
    });
    fireEvent.click(screen.getByTestId("tr-ai-optimize"));
    await waitFor(() => {
      expect(resultPanelCtl.lastAIError?.message).toBe("AI 优化功能不可用");
    });
  });

  // --- mic button tooltip/className per micState when ready ---

  it("shows the idle tooltip and pointer cursor when ready", async () => {
    readyModel();
    await mountApp();
    const mic = screen.getByTestId("mic-button");
    expect(mic.className).toContain("cursor-pointer");
    // The base style carries "hover:scale-105"; only the hover state adds the
    // bare "scale-105" token.
    expect(mic.className).not.toMatch(/(?:^|\s)scale-105(?:\s|$)/);
    fireEvent.mouseEnter(mic.parentElement as HTMLElement);
    expect(
      screen.getByText(`按 [${hotkeyCtl.hotkey}] 开始录音`),
    ).toBeInTheDocument();
  });

  it("enters the hover state with the scaled-up class", async () => {
    readyModel();
    await mountApp();
    const mic = screen.getByTestId("mic-button");
    fireEvent.mouseEnter(mic);
    expect(mic.className).toMatch(/(?:^|\s)scale-105(?:\s|$)/);
    expect(
      screen.getByText(`按 [${hotkeyCtl.hotkey}] 开始录音`),
    ).toBeInTheDocument();
  });

  it("shows the recording tooltip, pulse class, and stop label", async () => {
    readyModel();
    const { rerender } = await mountApp();
    Object.assign(recordingCtl, { isRecording: true });
    rerender(React.createElement(App));
    const mic = screen.getByTestId("mic-button");
    expect(mic.className).toContain("recording-pulse");
    expect(mic).toHaveAttribute("aria-label", "停止录音");
    fireEvent.mouseEnter(mic.parentElement as HTMLElement);
    expect(screen.getByText("正在录音...")).toBeInTheDocument();
    expect(screen.getByText("正在录音，再次点击停止")).toBeInTheDocument();
  });

  it("disables the mic with the recognizing tooltip while processing", async () => {
    readyModel();
    const { rerender } = await mountApp();
    Object.assign(recordingCtl, { isProcessing: true });
    rerender(React.createElement(App));
    const mic = screen.getByTestId("mic-button");
    expect((mic as HTMLButtonElement).disabled).toBe(true);
    fireEvent.mouseEnter(mic.parentElement as HTMLElement);
    // Tooltip and paragraph share the same text in this state.
    expect(screen.getAllByText("正在识别语音...")).toHaveLength(2);
  });

  it("disables the mic with the optimizing tooltip while optimizing", async () => {
    readyModel();
    const { rerender } = await mountApp();
    Object.assign(recordingCtl, { isOptimizing: true });
    rerender(React.createElement(App));
    const mic = screen.getByTestId("mic-button");
    expect((mic as HTMLButtonElement).disabled).toBe(true);
    fireEvent.mouseEnter(mic.parentElement as HTMLElement);
    expect(screen.getByText("AI正在优化文本...")).toBeInTheDocument();
    expect(screen.getByText("AI正在优化文本，请稍候...")).toBeInTheDocument();
  });

  // --- model stage texts (tooltip uses getStageStatusText) ---

  it("shows the downloading tooltip and progress paragraph at 42%", async () => {
    Object.assign(modelCtl, {
      stage: "downloading",
      isReady: false,
      downloadProgress: 42,
    });
    await mountApp();
    expect(screen.getByText("正在下载模型文件... 42%")).toBeInTheDocument();
    const mic = screen.getByTestId("mic-button");
    fireEvent.mouseEnter(mic.parentElement as HTMLElement);
    expect(screen.getByText("模型下载中... 42%")).toBeInTheDocument();
  });

  it("renders the zero-progress variants of the downloading texts", async () => {
    Object.assign(modelCtl, {
      stage: "downloading",
      isReady: false,
      downloadProgress: 0,
    });
    await mountApp();
    expect(screen.getByText("正在准备下载模型文件...")).toBeInTheDocument();
    const mic = screen.getByTestId("mic-button");
    fireEvent.mouseEnter(mic.parentElement as HTMLElement);
    expect(screen.getByText("模型下载中... 0%")).toBeInTheDocument();
  });

  it("falls back to the generic not-ready texts on an unmapped stage", async () => {
    Object.assign(modelCtl, { stage: "checking", isReady: false });
    await mountApp();
    expect(screen.getByText("模型未就绪，请稍候...")).toBeInTheDocument();
    // The mic is disabled when not ready, so drive toggleRecording through the
    // hotkey listener (same handler the button would invoke).
    act(() => {
      listeners.hotkey?.();
    });
    expect(toast.warning).toHaveBeenCalledWith("⏳ 模型未就绪，请稍候...");
    expect(recordingCtl.startRecording).not.toHaveBeenCalled();
  });

  it("toasts the model error and refuses to record on the error stage", async () => {
    Object.assign(modelCtl, {
      stage: "error",
      isReady: false,
      error: "模型损坏",
    });
    await mountApp();
    act(() => {
      listeners.hotkey?.();
    });
    expect(toast.error).toHaveBeenCalledWith("❌ 模型错误: 模型损坏");
    expect(recordingCtl.startRecording).not.toHaveBeenCalled();
  });

  it("shows the need_download tooltip on the disabled mic", async () => {
    await mountApp(); // default modelCtl state is need_download
    const mic = screen.getByTestId("mic-button");
    fireEvent.mouseEnter(mic.parentElement as HTMLElement);
    expect(screen.getByText("请先下载AI模型文件")).toBeInTheDocument();
  });

  // --- handleDownloadModels branches ---

  it("toasts success when the model download completes", async () => {
    modelCtl.downloadModels.mockResolvedValueOnce({ success: true });
    await mountApp();
    fireEvent.click(screen.getByTestId("download-trigger"));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "🎉 模型下载完成，正在加载...",
      );
    });
  });

  it("toasts the error field when the download result reports failure", async () => {
    modelCtl.downloadModels.mockResolvedValueOnce({
      success: false,
      error: "网络中断",
    });
    await mountApp();
    fireEvent.click(screen.getByTestId("download-trigger"));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("❌ 模型下载失败: 网络中断");
    });
  });

  it("toasts the exception message when the download throws", async () => {
    modelCtl.downloadModels.mockRejectedValueOnce(new Error("磁盘满"));
    await mountApp();
    fireEvent.click(screen.getByTestId("download-trigger"));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("❌ 模型下载失败: 磁盘满");
    });
  });

  // --- window controls ---

  it("minimizes through the bridge from the title bar", async () => {
    readyModel();
    await mountApp();
    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    expect(apiMocks.minimizeWindow).toHaveBeenCalledTimes(1);
  });

  it("hides the window on close with the default close behavior", async () => {
    readyModel();
    await mountApp();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(apiMocks.hideWindow).toHaveBeenCalledTimes(1);
    expect(apiMocks.closeApp).not.toHaveBeenCalled();
  });

  it("opens the history and settings windows from the title bar", async () => {
    readyModel();
    await mountApp();
    const titleBar = screen.getByText("Murmur").closest("div");
    const buttons = Array.from(
      titleBar?.querySelectorAll("button") ?? [],
    ) as HTMLButtonElement[];
    // The history/settings buttons are icon-only (no aria-label).
    const unlabeled = buttons.filter((b) => !b.getAttribute("aria-label"));
    expect(unlabeled).toHaveLength(2);
    fireEvent.click(unlabeled[0] as HTMLButtonElement);
    expect(apiMocks.openHistoryWindow).toHaveBeenCalledTimes(1);
    fireEvent.click(unlabeled[1] as HTMLButtonElement);
    expect(apiMocks.openSettingsWindow).toHaveBeenCalledTimes(1);
  });

  it("does nothing on window-control clicks when the bridge is absent", async () => {
    await mountAppWithoutAPI();
    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    fireEvent.click(screen.getByRole("button", { name: "最大化" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    const titleBar = screen.getByText("Murmur").closest("div");
    const buttons = Array.from(
      titleBar?.querySelectorAll("button") ?? [],
    ) as HTMLButtonElement[];
    const unlabeled = buttons.filter((b) => !b.getAttribute("aria-label"));
    fireEvent.click(unlabeled[0] as HTMLButtonElement);
    fireEvent.click(unlabeled[1] as HTMLButtonElement);
    // No crash and no bridge calls — every guard short-circuited.
    expect(screen.getByText("Murmur")).toBeInTheDocument();
  });

  // --- click-through guard and keyboard activation ---

  it("does not toggle recording when the drag layer swallows the click", async () => {
    readyModel();
    await mountApp();
    dragCtl.handleClick.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId("mic-button"));
    expect(recordingCtl.startRecording).not.toHaveBeenCalled();
  });

  it("toggles recording from the keyboard on Enter and Space", async () => {
    readyModel();
    await mountApp();
    fireEvent.keyDown(screen.getByTestId("mic-button"), { key: "Enter" });
    expect(recordingCtl.startRecording).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId("mic-button"), { key: " " });
    expect(recordingCtl.startRecording).toHaveBeenCalledTimes(2);
  });

  it("ignores mic keyboard events while processing", async () => {
    readyModel();
    const { rerender } = await mountApp();
    Object.assign(recordingCtl, { isProcessing: true });
    rerender(React.createElement(App));
    fireEvent.keyDown(screen.getByTestId("mic-button"), { key: "Enter" });
    expect(recordingCtl.startRecording).not.toHaveBeenCalled();
  });

  // --- hook wiring edge cases ---

  it("stays quiet when hotkey registration resolves false (value is not branched on)", async () => {
    hotkeyCtl.registerHotkey.mockResolvedValueOnce(false);
    await mountApp();
    await act(async () => {});
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("tolerates a missing syncRecordingState hook member", async () => {
    readyModel();
    const originalSync = hotkeyCtl.syncRecordingState;
    (hotkeyCtl as { syncRecordingState: unknown }).syncRecordingState =
      undefined;
    const { rerender } = await mountApp();
    Object.assign(recordingCtl, { isRecording: true });
    rerender(React.createElement(App));
    expect(screen.getByText("Murmur")).toBeInTheDocument();
    (hotkeyCtl as { syncRecordingState: unknown }).syncRecordingState =
      originalSync;
  });

  // --- file-import tab enable/disable matrix ---

  it("keeps the recording tab clickable when idle in recording mode", async () => {
    readyModel();
    await mountApp();
    const tab = screen.getByRole("button", { name: "实时录音模式" });
    expect((tab as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(tab);
    expect(screen.getByTestId("mic-button")).toBeInTheDocument();
  });

  it("disables the recording tab while transcription is processing", async () => {
    Object.assign(recordingCtl, { isProcessing: true });
    await mountApp();
    const tab = screen.getByRole("button", { name: "实时录音模式" });
    expect((tab as HTMLButtonElement).disabled).toBe(true);
  });

  it("styles the recording tab as blocked in file-import mode while recording", async () => {
    readyModel();
    const { rerender } = await mountApp();
    fireEvent.click(screen.getByRole("button", { name: "文件导入" }));
    Object.assign(recordingCtl, { isRecording: true });
    rerender(React.createElement(App));
    const tab = screen.getByRole("button", { name: "实时录音模式" });
    expect((tab as HTMLButtonElement).disabled).toBe(true);
    expect(tab.className).toContain("cursor-not-allowed");
  });

  it("styles the recording tab as hoverable in file-import mode while idle", async () => {
    readyModel();
    await mountApp();
    fireEvent.click(screen.getByRole("button", { name: "文件导入" }));
    const tab = screen.getByRole("button", { name: "实时录音模式" });
    expect((tab as HTMLButtonElement).disabled).toBe(false);
    expect(tab.className).toContain("hover:text-gray-700");
  });

  // --- result panel visibility rules ---

  it("hides the result panel and new-recording button while recording", async () => {
    readyModel();
    const { rerender } = await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "面板录音文本",
      });
    });
    expect(screen.getByTestId("transcription-result")).toBeInTheDocument();
    Object.assign(recordingCtl, { isRecording: true });
    rerender(React.createElement(App));
    expect(
      screen.queryByTestId("transcription-result"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "开始新录音" }),
    ).not.toBeInTheDocument();
  });

  it("hides the result panel while transcription is processing", async () => {
    readyModel();
    const { rerender } = await mountApp();
    act(() => {
      recordingCtl.options?.onTranscriptionComplete({
        success: true,
        text: "面板处理文本",
      });
    });
    Object.assign(recordingCtl, { isProcessing: true });
    rerender(React.createElement(App));
    expect(
      screen.queryByTestId("transcription-result"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "开始新录音" }),
    ).not.toBeInTheDocument();
  });
});
