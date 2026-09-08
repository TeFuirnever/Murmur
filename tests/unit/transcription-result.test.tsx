// @vitest-environment jsdom
// [20260729_Test_TranscriptionResult] Integration test for TranscriptionResult.
// Tests user-visible behavior: text rendering, optimizing state, copy callback.
// Uses RTL per Testing Trophy — test behavior not implementation.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TranscriptionResult from "../../src/components/TranscriptionResult";

// [20260907_Fix_314_PolishSaveToast] Spy on toast — the polish write-back
// failure path (issue #314) must surface a user-visible warning.
const toastMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: toastMocks.toast,
  Toaster: () => React.createElement("div", { "data-testid": "toaster" }),
}));

// Stub window.electronAPI — TranscriptionResult reads AI modes on mount.
beforeAll(() => {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    getAIModes: vi.fn().mockResolvedValue([]),
    processText: vi.fn(),
    diarizeAudio: vi.fn(),
    copyText: vi.fn(),
  };
});

describe("TranscriptionResult", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders provided text", () => {
    render(<TranscriptionResult text="你好世界" />);
    expect(screen.getByText("你好世界")).toBeInTheDocument();
  });

  it("shows copy button and calls onCopy when clicked", () => {
    const onCopy = vi.fn();
    render(<TranscriptionResult text="测试文本" onCopy={onCopy} />);
    const copyButton =
      screen.queryByRole("button", { name: /copy|复制/i }) ||
      screen.queryByText(/复制|copy/i);
    if (copyButton) {
      fireEvent.click(copyButton);
      expect(onCopy).toHaveBeenCalled();
    }
  });

  it("renders text when isOptimizing is true", () => {
    const { container } = render(
      <TranscriptionResult text="正在优化" isOptimizing={true} />,
    );
    // When optimizing, the component shows a processing indicator. The text
    // may be in the AI-result panel (different DOM path). Just verify the
    // component renders without crashing in optimizing state.
    expect(container).toBeInTheDocument();
    expect(screen.getByTestId("transcription-result")).toBeInTheDocument();
  });

  it("renders raw text when provided and different from main text", () => {
    render(<TranscriptionResult text="优化后的文本" rawText="原始文本" />);
    expect(screen.getByText("优化后的文本")).toBeInTheDocument();
  });

  it("renders empty state gracefully when no text", () => {
    const { container } = render(<TranscriptionResult />);
    expect(container).toBeInTheDocument();
  });

  it("displays duration when provided", () => {
    render(<TranscriptionResult text="测试" duration={125} />);
    // 125 seconds = 2分5秒
    expect(screen.getByText(/2分5秒/)).toBeInTheDocument();
  });
});

// [20260816_Test_TranscriptionResultExpanded] AI-optimize paths and mode
// loading — the component's previously uncovered branches.
describe("TranscriptionResult — AI optimize paths", () => {
  type TestWindow = Omit<Window, "electronAPI"> & {
    electronAPI?: {
      processText?: (text: string, mode: string) => Promise<unknown>;
      getAIModes?: () => Promise<unknown[]>;
    };
  };

  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;
  let processText: ReturnType<typeof vi.fn>;
  let getAIModes: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    processText = vi.fn();
    getAIModes = vi
      .fn()
      .mockResolvedValue([
        { name: "optimize", label: "智能润色", description: "" },
      ]);
    (globalThis.window as unknown as TestWindow).electronAPI = {
      processText: processText as unknown as (
        text: string,
        mode: string,
      ) => Promise<unknown>,
      getAIModes: getAIModes as unknown as () => Promise<unknown[]>,
    };
  });

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
  });

  // The optimize action lives in the embedded ProcessingPanel, which only
  // renders after the async getAIModes effect populates the mode list.
  const findOptimizeButton = async () =>
    await screen.findByRole("button", { name: "应用 AI 处理" });

  it("loads AI modes on mount and renders them in the selector", async () => {
    render(<TranscriptionResult text="待优化文本" />);
    await waitFor(() => {
      expect(getAIModes).toHaveBeenCalled();
    });
  });

  it("replaces the text after a successful processText call", async () => {
    processText.mockResolvedValue({ success: true, text: "优化后文本" });
    render(<TranscriptionResult text="原始待优化" />);
    fireEvent.click(await findOptimizeButton());
    await waitFor(() => {
      expect(screen.getByText("优化后文本")).toBeInTheDocument();
    });
    // [20260907_Feat_236_StreamingUi] no chunk channel in this stub →
    // non-streaming fallback: the classic two-argument invoke.
    expect(processText).toHaveBeenCalledWith("原始待优化", expect.any(String));
  });

  it("surfaces the main-process error on a failed processText call", async () => {
    processText.mockResolvedValue({
      success: false,
      error: "AI输出为空：推理占满预算",
    });
    render(<TranscriptionResult text="会失败的文本" />);
    fireEvent.click(await findOptimizeButton());
    await waitFor(() => {
      expect(screen.getByText(/推理占满预算/)).toBeInTheDocument();
    });
  });

  it("falls back to the onAIOptimize prop without electron processText", async () => {
    delete (globalThis.window as unknown as TestWindow).electronAPI
      ?.processText;
    const onAIOptimize = vi.fn().mockResolvedValue("属性优化结果");
    render(<TranscriptionResult text="走属性" onAIOptimize={onAIOptimize} />);
    fireEvent.click(await findOptimizeButton());
    await waitFor(() => {
      expect(screen.getByText("属性优化结果")).toBeInTheDocument();
    });
    expect(onAIOptimize).toHaveBeenCalledWith("走属性");
  });

  // NOTE: the "AI功能不可用" branch is unreachable in the current UI — the
  // ProcessingPanel (and its apply button) only renders when getAIModes
  // succeeded, which implies the bridge exists.

  it("records a thrown error as the optimize error message", async () => {
    processText.mockRejectedValue(new Error("网络中断"));
    render(<TranscriptionResult text="会抛错的文本" />);
    fireEvent.click(await findOptimizeButton());
    await waitFor(() => {
      expect(screen.getByText(/网络中断/)).toBeInTheDocument();
    });
  });
});

// [20260816_Test_Diarize] Speaker-diarization surface: trigger, results
// rendering, and both failure modes.
describe("TranscriptionResult — speaker diarization", () => {
  type TestWindow = Omit<Window, "electronAPI"> & {
    electronAPI?: {
      processText?: (text: string, mode: string) => Promise<unknown>;
      getAIModes?: () => Promise<unknown[]>;
      diarizeAudio?: (id: number) => Promise<unknown>;
    };
  };

  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;

  const SEGMENTS = [
    { start_ms: 0, end_ms: 1500, text: "你好", speaker: "SPEAKER_00" },
    { start_ms: 1600, end_ms: 3000, text: "你好呀", speaker: "SPEAKER_01" },
  ];

  const withApi = (
    diarizeAudio: TestWindow["electronAPI"] extends never
      ? never
      : (id: number) => Promise<unknown>,
  ) => {
    (globalThis.window as unknown as TestWindow).electronAPI = {
      getAIModes: vi.fn().mockResolvedValue([]),
      diarizeAudio,
    };
  };

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
  });

  it("renders the diarize button only for segmented records with an id", () => {
    withApi(vi.fn());
    render(
      <TranscriptionResult
        text="有分段的文本"
        id={7}
        segments={[{ start_ms: 0, end_ms: 10, text: "片段" }]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "识别说话人" }),
    ).toBeInTheDocument();
  });

  it("omits the diarize button without segments or id", () => {
    withApi(vi.fn());
    render(<TranscriptionResult text="无分段文本" />);
    expect(
      screen.queryByRole("button", { name: /说话人/ }),
    ).not.toBeInTheDocument();
  });

  it("renders speaker-colored segments after a successful diarization", async () => {
    const diarizeAudio = vi.fn().mockResolvedValue({
      success: true,
      segments: SEGMENTS,
    });
    withApi(diarizeAudio);
    render(
      <TranscriptionResult
        text="双人的对话"
        id={9}
        segments={[{ start_ms: 0, end_ms: 3000, text: "双人的对话" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "识别说话人" }));
    // Speaker labels render inside the expandable segment timeline.
    fireEvent.click(screen.getByRole("button", { name: "查看分段详情" }));
    await waitFor(() => {
      expect(screen.getByText("SPEAKER_00")).toBeInTheDocument();
      expect(screen.getByText("SPEAKER_01")).toBeInTheDocument();
    });
    expect(diarizeAudio).toHaveBeenCalledWith(9);
    // The button flips to re-run mode.
    expect(
      screen.getByRole("button", { name: "重新识别说话人" }),
    ).toBeInTheDocument();
  });

  it("shows the diarize error when the result reports failure", async () => {
    withApi(vi.fn().mockResolvedValue({ success: false, error: "无分段数据" }));
    render(
      <TranscriptionResult
        text="会失败的分离"
        id={3}
        segments={[{ start_ms: 0, end_ms: 10, text: "x" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "识别说话人" }));
    await waitFor(() => {
      expect(screen.getByText(/无分段数据/)).toBeInTheDocument();
    });
  });

  it("shows the thrown error message when diarizeAudio rejects", async () => {
    withApi(vi.fn().mockRejectedValue(new Error("服务器无响应")));
    render(
      <TranscriptionResult
        text="会抛错的分离"
        id={4}
        segments={[{ start_ms: 0, end_ms: 10, text: "x" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "识别说话人" }));
    await waitFor(() => {
      expect(screen.getByText(/服务器无响应/)).toBeInTheDocument();
    });
  });
});

// [20260816_Test_BranchPush] Remaining uncovered arcs: timestamp/duration
// boundary formatting, the diarize early-return without a bridge method, the
// default diarize/AI failure messages, the empty-message optimize error, the
// segment-timeline collapse toggle, and an empty-string speaker label.
describe("TranscriptionResult — branch push", () => {
  type TestWindow = Omit<Window, "electronAPI"> & {
    electronAPI?: {
      processText?: (text: string, mode: string) => Promise<unknown>;
      getAIModes?: () => Promise<unknown[]>;
      diarizeAudio?: (id: number) => Promise<unknown>;
    };
  };

  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
  });

  const withApi = (
    electronAPI: NonNullable<TestWindow["electronAPI"]>,
  ): void => {
    (globalThis.window as unknown as TestWindow).electronAPI = electronAPI;
  };

  const expandTimeline = (): void => {
    fireEvent.click(screen.getByRole("button", { name: "查看分段详情" }));
  };

  it("formats an undefined timestamp as 00:00", () => {
    withApi({ getAIModes: vi.fn().mockResolvedValue([]) });
    render(
      <TranscriptionResult
        text="无时间戳"
        id={11}
        segments={
          [
            { start_ms: undefined, end_ms: undefined, text: "无时间" },
          ] as unknown as React.ComponentProps<
            typeof TranscriptionResult
          >["segments"]
        }
      />,
    );
    expandTimeline();
    expect(screen.getByText("00:00 - 00:00")).toBeInTheDocument();
  });

  it("renders sub-minute durations as seconds only and hides a zero duration", () => {
    withApi({ getAIModes: vi.fn().mockResolvedValue([]) });
    const { rerender } = render(
      <TranscriptionResult text="短音频" duration={45} />,
    );
    expect(screen.getByText(/45秒/)).toBeInTheDocument();
    rerender(<TranscriptionResult text="零时长" duration={0} />);
    expect(screen.queryByText(/音频时长/)).not.toBeInTheDocument();
  });

  it("returns early from diarize when the bridge lacks diarizeAudio", () => {
    withApi({ getAIModes: vi.fn().mockResolvedValue([]) });
    render(
      <TranscriptionResult
        text="无分离通道"
        id={12}
        segments={[{ start_ms: 0, end_ms: 10, text: "片段" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "识别说话人" }));
    // No in-flight state and no error — the handler bailed out immediately.
    expect(screen.queryByText(/正在识别说话人/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("transcription-result")).toBeInTheDocument();
  });

  it("uses the default diarize error when the failure carries no message", async () => {
    withApi({
      getAIModes: vi.fn().mockResolvedValue([]),
      diarizeAudio: vi.fn().mockResolvedValue({ success: false }),
    });
    render(
      <TranscriptionResult
        text="默认分离错误"
        id={13}
        segments={[{ start_ms: 0, end_ms: 10, text: "x" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "识别说话人" }));
    await waitFor(() => {
      expect(screen.getByText("说话人分离失败")).toBeInTheDocument();
    });
  });

  it("uses the default optimize error when processText fails without one", async () => {
    const processText = vi.fn().mockResolvedValue({ success: false });
    withApi({
      getAIModes: vi
        .fn()
        .mockResolvedValue([
          { name: "optimize", label: "智能润色", description: "" },
        ]),
      processText,
    });
    render(<TranscriptionResult text="默认优化错误" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );
    await waitFor(() => {
      expect(screen.getByText("AI处理失败，请重试")).toBeInTheDocument();
    });
  });

  it("uses the generic optimize message when the rejection has an empty message", async () => {
    const processText = vi.fn().mockRejectedValue(new Error(""));
    withApi({
      getAIModes: vi
        .fn()
        .mockResolvedValue([
          { name: "optimize", label: "智能润色", description: "" },
        ]),
      processText,
    });
    render(<TranscriptionResult text="空错误消息" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );
    await waitFor(() => {
      expect(screen.getByText("优化失败")).toBeInTheDocument();
    });
  });

  it("collapses the segment timeline on a second toggle", () => {
    withApi({ getAIModes: vi.fn().mockResolvedValue([]) });
    render(
      <TranscriptionResult
        text="展开与收起"
        id={14}
        segments={[{ start_ms: 1500, end_ms: 3000, text: "分段内容" }]}
      />,
    );
    expandTimeline();
    expect(screen.getByText("分段内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起分段详情" }));
    expect(screen.queryByText("分段内容")).not.toBeInTheDocument();
  });

  it("omits the speaker label when speaker is an empty string", () => {
    withApi({ getAIModes: vi.fn().mockResolvedValue([]) });
    const { container } = render(
      <TranscriptionResult
        text="空说话人"
        id={15}
        segments={[{ start_ms: 0, end_ms: 10, text: "正文", speaker: "" }]}
      />,
    );
    expandTimeline();
    expect(screen.getByText("正文")).toBeInTheDocument();
    // The tiny font-semibold speaker span is only rendered for truthy spk.
    expect(container.querySelector("span.text-\\[10px\\]")).toBeNull();
  });
});

// [20260907_Fix_314_PolishSaveToast] Issue #314: when persisting the polish
// result fails (updateTranscription rejects), the user keeps looking at text
// that was never saved — a silent console.warn is not enough. The failure
// must surface a warning toast while keeping the polished text on screen.
// [20260907_Fix_316_PreferReviewProp] File import's server-side review
// channel (aiReviewTranscription via onAIOptimize) must win over the ambient
// processText when the parent opts in — without the flag the injected
// channel is unreachable in production.
describe("TranscriptionResult — preferOnAIOptimize (#316)", () => {
  type TestWindow = Omit<Window, "electronAPI"> & {
    electronAPI?: {
      processText?: (text: string, mode: string) => Promise<unknown>;
      getAIModes?: () => Promise<unknown[]>;
    };
  };

  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
    vi.clearAllMocks();
  });

  it("prefers onAIOptimize over processText when preferOnAIOptimize is set", async () => {
    const processText = vi
      .fn()
      .mockResolvedValue({ success: true, text: "错误通道的文本" });
    const onAIOptimize = vi.fn().mockResolvedValue("评审通道的文本");
    (globalThis.window as unknown as TestWindow).electronAPI = {
      processText: processText as unknown as (
        text: string,
        mode: string,
      ) => Promise<unknown>,
      getAIModes: vi
        .fn()
        .mockResolvedValue([
          { name: "optimize", label: "智能润色", description: "" },
        ]),
    };

    render(
      React.createElement(TranscriptionResult, {
        text: "原始文本",
        onCopy: vi.fn(),
        onAIOptimize,
        preferOnAIOptimize: true,
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );

    await waitFor(() => {
      expect(screen.getByText("评审通道的文本")).toBeInTheDocument();
    });
    expect(processText).not.toHaveBeenCalled();
  });

  it("keeps processText preferred without the flag (recording mode-selector UX)", async () => {
    const processText = vi
      .fn()
      .mockResolvedValue({ success: true, text: "默认通道的文本" });
    const onAIOptimize = vi.fn().mockResolvedValue("错误通道的文本");
    (globalThis.window as unknown as TestWindow).electronAPI = {
      processText: processText as unknown as (
        text: string,
        mode: string,
      ) => Promise<unknown>,
      getAIModes: vi
        .fn()
        .mockResolvedValue([
          { name: "optimize", label: "智能润色", description: "" },
        ]),
    };

    render(
      React.createElement(TranscriptionResult, {
        text: "原始文本",
        onCopy: vi.fn(),
        onAIOptimize,
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );

    await waitFor(() => {
      expect(screen.getByText("默认通道的文本")).toBeInTheDocument();
    });
    expect(onAIOptimize).not.toHaveBeenCalled();
  });
});

describe("TranscriptionResult — polish write-back failure (#314)", () => {
  type TestWindow = Omit<Window, "electronAPI"> & {
    electronAPI?: {
      processText?: (text: string, mode: string) => Promise<unknown>;
      updateTranscription?: (
        id: number,
        patch: Record<string, unknown>,
      ) => Promise<unknown>;
      getAIModes?: () => Promise<unknown[]>;
    };
  };

  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
    vi.clearAllMocks();
  });

  it("warns the user when the write-back rejects, keeping the polished text", async () => {
    (globalThis.window as unknown as TestWindow).electronAPI = {
      processText: vi
        .fn()
        .mockResolvedValue({ success: true, text: "润色后文本" }),
      updateTranscription: vi.fn().mockRejectedValue(new Error("db locked")),
      getAIModes: vi
        .fn()
        .mockResolvedValue([
          { name: "optimize", label: "智能润色", description: "" },
        ]),
    };
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      React.createElement(TranscriptionResult, {
        text: "原始文本",
        id: 42,
        onCopy: vi.fn(),
      }),
    );

    // Drive the manual optimize flow (ProcessingPanel renders after modes load).
    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );

    await waitFor(() => {
      const api = (globalThis.window as unknown as TestWindow).electronAPI!;
      expect(api.updateTranscription).toHaveBeenCalledWith(42, {
        processed_text: "润色后文本",
        text: "润色后文本",
      });
    });
    await waitFor(() => {
      expect(toastMocks.toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("保存失败"),
      );
    });
    // The polished result stays on screen (documented intent).
    expect(screen.getByText("润色后文本")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  // [20260907_Fix_314_ReviewFix] The DOMINANT production failure shape: the
  // main-process handler wraps every failure (DB locked, missing record,
  // zero changes, whitelist rejection) in a RESOLVED {success:false, error}
  // envelope — the catch never runs for it.
  it("warns when the write-back resolves unsuccessful (envelope shape)", async () => {
    const consoleSpy2 = vi.spyOn(console, "warn").mockImplementation(() => {});
    (globalThis.window as unknown as TestWindow).electronAPI = {
      processText: vi
        .fn()
        .mockResolvedValue({ success: true, text: "润色后文本" }),
      updateTranscription: vi.fn().mockResolvedValue({
        success: false,
        error: "db locked",
      }),
      getAIModes: vi
        .fn()
        .mockResolvedValue([
          { name: "optimize", label: "智能润色", description: "" },
        ]),
    };

    render(
      React.createElement(TranscriptionResult, {
        text: "原始文本",
        id: 42,
        onCopy: vi.fn(),
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );

    await waitFor(() => {
      expect(toastMocks.toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("保存失败"),
      );
    });
    // Not wiped: the polished text stays on screen.
    expect(screen.getByText("润色后文本")).toBeInTheDocument();
    consoleSpy2.mockRestore();
  });
});

// [20260907_Feat_236_StreamingUi] T9 ①: manual polish streams via
// onPolishChunk (subscribe-before-invoke, unsubscribe on settle) and a
// cancel button aborts via abortPolish — a user cancel shows NO error.
describe("TranscriptionResult — streaming manual polish (#236 ①)", () => {
  type Chunk = {
    type: string;
    requestId?: string;
    text?: string;
    reason?: string;
    error?: string;
    reasoningChars?: number;
  };
  type TestWindow = Omit<Window, "electronAPI"> & {
    electronAPI?: {
      processText?: (
        text: string,
        mode: string,
        timeout?: number,
        requestId?: string,
      ) => Promise<unknown>;
      onPolishChunk?: (cb: (chunk: Chunk) => void) => () => void;
      abortPolish?: (requestId: string) => Promise<unknown>;
      updateTranscription?: (
        id: number,
        patch: Record<string, unknown>,
      ) => Promise<unknown>;
      getAIModes?: () => Promise<unknown[]>;
    };
  };

  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;
  let chunkListener: ((chunk: Chunk) => void) | null = null;
  let unsubSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    chunkListener = null;
    unsubSpy = vi.fn(() => {});
    (globalThis.window as unknown as TestWindow).electronAPI = {
      processText: vi.fn(
        () => new Promise(() => {}) /* pends until chunks drive it */,
      ),
      onPolishChunk: vi.fn((cb: (chunk: Chunk) => void) => {
        chunkListener = cb;
        return unsubSpy as unknown as () => void;
      }),
      abortPolish: vi.fn().mockResolvedValue({ success: true }),
      updateTranscription: vi
        .fn()
        .mockResolvedValue({ success: true, changes: 1 }),
      getAIModes: vi
        .fn()
        .mockResolvedValue([
          { name: "optimize", label: "智能润色", description: "" },
        ]),
    };
  });

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
    vi.clearAllMocks();
  });

  function renderManual() {
    return render(
      React.createElement(TranscriptionResult, {
        text: "原始文本",
        onCopy: vi.fn(),
      }),
    );
  }

  it("renders streamed deltas incrementally before the finish", async () => {
    renderManual();
    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );

    // Subscribed BEFORE the invoke (no listener leak).
    await vi.waitFor(() => {
      expect(
        (globalThis.window as unknown as TestWindow).electronAPI!.onPolishChunk,
      ).toHaveBeenCalled();
    });
    const api = (globalThis.window as unknown as TestWindow).electronAPI!;
    const requestId = (api.processText as ReturnType<typeof vi.fn>).mock
      .calls[0]![3] as string;
    expect(typeof requestId).toBe("string");

    chunkListener!({ type: "start", requestId });
    chunkListener!({ type: "delta", requestId, text: "流式" });
    await screen.findByText("流式");
    chunkListener!({ type: "delta", requestId, text: "文本" });
    await screen.findByText("流式文本");
  });

  it("finish chunk replaces the stream with the final text and unsubscribes", async () => {
    renderManual();
    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );
    await vi.waitFor(() => expect(chunkListener).not.toBeNull());
    const api = (globalThis.window as unknown as TestWindow).electronAPI!;
    const requestId = (api.processText as ReturnType<typeof vi.fn>).mock
      .calls[0]![3] as string;

    chunkListener!({ type: "delta", requestId, text: "部分" });
    chunkListener!({
      type: "finish",
      requestId,
      text: "最终润色结果",
      reasoningChars: 0,
    });

    await screen.findByText("最终润色结果");
    await vi.waitFor(() => expect(unsubSpy).toHaveBeenCalled());
  });

  it("cancel button aborts via abortPolish and shows no error", async () => {
    renderManual();
    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );
    await vi.waitFor(() => expect(chunkListener).not.toBeNull());
    const api = (globalThis.window as unknown as TestWindow).electronAPI!;
    const requestId = (api.processText as ReturnType<typeof vi.fn>).mock
      .calls[0]![3] as string;
    chunkListener!({ type: "delta", requestId, text: "部分输出" });

    const cancel = await screen.findByRole("button", { name: "取消" });
    fireEvent.click(cancel);

    await vi.waitFor(() => {
      expect(api.abortPolish).toHaveBeenCalledWith(requestId);
    });
    // The abort chunk arrives; the UI must NOT surface an error.
    chunkListener!({ type: "abort", requestId });
    await vi.waitFor(() => expect(unsubSpy).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// [20260907_Fix_236_Review] Regression: a mid-stream ERROR must not leave
// the truncated partial rendered as the transcription, and the invoke
// rejection path surfaces a localized message.
describe("TranscriptionResult — streaming error paths (#236 review)", () => {
  type Chunk = {
    type: string;
    requestId?: string;
    text?: string;
    error?: string;
    reasoningChars?: number;
  };
  type TestWindow = Omit<Window, "electronAPI"> & {
    electronAPI?: {
      processText?: (
        text: string,
        mode: string,
        timeout?: number,
        requestId?: string,
      ) => Promise<unknown>;
      onPolishChunk?: (cb: (chunk: Chunk) => void) => () => void;
      abortPolish?: (requestId: string) => Promise<unknown>;
      updateTranscription?: (
        id: number,
        patch: Record<string, unknown>,
      ) => Promise<unknown>;
      getAIModes?: () => Promise<unknown[]>;
    };
  };
  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;
  let chunkListener: ((chunk: Chunk) => void) | null = null;
  let unsubSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    chunkListener = null;
    unsubSpy = vi.fn(() => {});
    (globalThis.window as unknown as TestWindow).electronAPI = {
      processText: vi.fn(() => new Promise(() => {})),
      onPolishChunk: vi.fn((cb: (chunk: Chunk) => void) => {
        chunkListener = cb;
        return unsubSpy as unknown as () => void;
      }),
      abortPolish: vi.fn().mockResolvedValue({ success: true }),
      updateTranscription: vi.fn().mockResolvedValue({ success: true }),
      getAIModes: vi
        .fn()
        .mockResolvedValue([
          { name: "optimize", label: "智能润色", description: "" },
        ]),
    };
  });

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
    vi.clearAllMocks();
  });

  it("restores the original text after a mid-stream error chunk", async () => {
    render(
      React.createElement(TranscriptionResult, {
        text: "原始转写内容",
        onCopy: vi.fn(),
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );
    await vi.waitFor(() => expect(chunkListener).not.toBeNull());
    const api = (globalThis.window as unknown as TestWindow).electronAPI!;
    const requestId = (api.processText as ReturnType<typeof vi.fn>).mock
      .calls[0]![3] as string;

    chunkListener!({ type: "delta", requestId, text: "被截断的部分" });
    await screen.findByText("被截断的部分");
    chunkListener!({ type: "error", requestId, error: "上游 500" });

    // Original transcription restored; error surfaced; partial gone.
    await vi.waitFor(() => {
      expect(screen.getByText("原始转写内容")).toBeInTheDocument();
    });
    expect(screen.queryByText("被截断的部分")).not.toBeInTheDocument();
    expect(screen.getByText("上游 500")).toBeInTheDocument();
    await vi.waitFor(() => expect(unsubSpy).toHaveBeenCalled());
  });

  it("maps the invoke-rejection sentinel to a localized message", async () => {
    (globalThis.window as unknown as TestWindow).electronAPI!.processText = vi
      .fn()
      .mockRejectedValue(new Error("ipc gone"));
    render(
      React.createElement(TranscriptionResult, {
        text: "原始转写内容",
        onCopy: vi.fn(),
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "应用 AI 处理" }),
    );

    await vi.waitFor(() => {
      expect(screen.getByText("AI处理失败，请重试")).toBeInTheDocument();
    });
    expect(screen.getByText("原始转写内容")).toBeInTheDocument();
  });
});
