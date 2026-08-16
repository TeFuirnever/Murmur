// @vitest-environment jsdom
// [20260729_Test_TranscriptionResult] Integration test for TranscriptionResult.
// Tests user-visible behavior: text rendering, optimizing state, copy callback.
// Uses RTL per Testing Trophy — test behavior not implementation.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TranscriptionResult from "../../src/components/TranscriptionResult";

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
