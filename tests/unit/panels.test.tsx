// @vitest-environment jsdom
// [20260729_Test_Panels] React component integration tests for the four panel
// components. Each describe block exercises user-visible behavior via RTL
// (Testing Trophy): rendering of state-driven UI and callback wiring. No
// implementation details are asserted. Mocks follow the established pattern in
// general-section-effects.test.tsx and useSettings-hook.test.tsx:
//   - react-i18next -> t echoes the fallback string
//   - sonner -> toast no-op
//   - window.electronAPI -> per-test stub
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock react-i18next: return the fallback string so we can assert label text
// without depending on i18n resource files.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback,
  }),
}));

// Mock sonner: ExportPanel toasts on export result. No-op to keep DOM clean.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import ExportPanel from "../../src/components/ExportPanel";
import ProcessingPanel from "../../src/components/ProcessingPanel";
import TranscriptionProgress from "../../src/components/TranscriptionProgress";
import { TextDisplay } from "../../src/components/TextDisplay";
import type { AIMode } from "../../src/types/ipc";

// Minimal window shape with the electronAPI methods these components use.
// Cast through unknown — never `any`, never @ts-ignore.
type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI?: {
    exportTranscription?: (
      id: number,
      format: string,
    ) => Promise<{ success: boolean; error?: string }>;
  };
};

function setElectronAPI(api: TestWindow["electronAPI"]): void {
  (globalThis.window as TestWindow).electronAPI = api;
}

describe("[20260729_Test_Panels] ExportPanel", () => {
  let originalAPI: TestWindow["electronAPI"];

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow).electronAPI;
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) {
      delete win.electronAPI;
    } else {
      win.electronAPI = originalAPI;
    }
    vi.clearAllMocks();
  });

  it("renders one export button per supported format", () => {
    setElectronAPI({
      exportTranscription: vi.fn().mockResolvedValue({ success: true }),
    });
    render(<ExportPanel transcriptionId={42} />);

    for (const label of ["TXT", "SRT", "VTT", "MD", "DOCX"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("invokes exportTranscription with the transcription id and format on click", async () => {
    const exportTranscription = vi.fn().mockResolvedValue({ success: true });
    setElectronAPI({ exportTranscription });

    render(<ExportPanel transcriptionId={7} />);
    await userEvent.click(screen.getByRole("button", { name: "SRT" }));

    expect(exportTranscription).toHaveBeenCalledTimes(1);
    expect(exportTranscription).toHaveBeenCalledWith(7, "srt");
  });

  it("toasts an error and does not call exportTranscription when electronAPI is missing", async () => {
    const { toast } = await import("sonner");
    // No electronAPI on window.
    render(<ExportPanel transcriptionId={1} />);
    await userEvent.click(screen.getByRole("button", { name: "TXT" }));

    expect(toast.error).toHaveBeenCalledWith("导出功能不可用");
  });

  it("toasts an error when export resolves with success: false", async () => {
    const { toast } = await import("sonner");
    const exportTranscription = vi
      .fn()
      .mockResolvedValue({ success: false, error: "磁盘已满" });
    setElectronAPI({ exportTranscription });

    render(<ExportPanel transcriptionId={2} />);
    await userEvent.click(screen.getByRole("button", { name: "DOCX" }));

    expect(toast.error).toHaveBeenCalledWith("磁盘已满");
  });
});

describe("[20260729_Test_Panels] ProcessingPanel", () => {
  const MODES: AIMode[] = [
    {
      name: "polish",
      label: "润色",
      description: "优化文字流畅度",
    },
    {
      name: "summary",
      label: "总结",
      description: "生成摘要",
    },
  ];

  it("renders the select populated with all mode labels", () => {
    render(
      <ProcessingPanel
        modes={MODES}
        currentMode="polish"
        onModeChange={() => {}}
        onApply={() => {}}
        isProcessing={false}
        error={null}
        onDismissError={() => {}}
      />,
    );

    const select = screen.getByLabelText(
      "选择 AI 处理模式",
    ) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    // Options reflect every mode label.
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "润色",
      "总结",
    ]);
  });

  it("disables select and apply button and shows processing text while isProcessing", () => {
    render(
      <ProcessingPanel
        modes={MODES}
        currentMode="polish"
        onModeChange={() => {}}
        onApply={() => {}}
        isProcessing={true}
        error={null}
        onDismissError={() => {}}
      />,
    );

    expect(screen.getByLabelText("选择 AI 处理模式")).toBeDisabled();
    expect(screen.getByLabelText("应用 AI 处理")).toBeDisabled();
    expect(screen.getByText("处理中")).toBeInTheDocument();
  });

  it("calls onModeChange with the selected value when the select changes", () => {
    const onModeChange = vi.fn();
    render(
      <ProcessingPanel
        modes={MODES}
        currentMode="polish"
        onModeChange={onModeChange}
        onApply={() => {}}
        isProcessing={false}
        error={null}
        onDismissError={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("选择 AI 处理模式"), {
      target: { value: "summary" },
    });

    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith("summary");
  });

  it("calls onApply when the apply button is clicked", () => {
    const onApply = vi.fn();
    render(
      <ProcessingPanel
        modes={MODES}
        currentMode="polish"
        onModeChange={() => {}}
        onApply={onApply}
        isProcessing={false}
        error={null}
        onDismissError={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("应用 AI 处理"));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("renders the selected mode description when present", () => {
    render(
      <ProcessingPanel
        modes={MODES}
        currentMode="summary"
        onModeChange={() => {}}
        onApply={() => {}}
        isProcessing={false}
        error={null}
        onDismissError={() => {}}
      />,
    );

    expect(screen.getByText("生成摘要")).toBeInTheDocument();
  });

  it("renders the error alert and calls onDismissError when the dismiss button is clicked", () => {
    const onDismissError = vi.fn();
    render(
      <ProcessingPanel
        modes={MODES}
        currentMode="polish"
        onModeChange={() => {}}
        onApply={() => {}}
        isProcessing={false}
        error="请求超时"
        onDismissError={onDismissError}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("请求超时");
    fireEvent.click(screen.getByLabelText("关闭错误提示"));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});

describe("[20260729_Test_Panels] TranscriptionProgress", () => {
  it("renders the spinner and phase label during processing", () => {
    render(
      <TranscriptionProgress
        phase="asr"
        progressPct={30}
        totalMs={60000}
        onCancel={() => {}}
      />,
    );

    // PHASE_LABELS["asr"] === "语音识别中".
    expect(screen.getByText("语音识别中")).toBeInTheDocument();
  });

  it("renders a determinate progress bar whose width tracks progressPct", () => {
    render(
      <TranscriptionProgress
        phase="asr"
        progressPct={40}
        totalMs={60000}
        onCancel={() => {}}
      />,
    );

    // The filled portion is the inner div with an inline width style.
    const bar = screen
      .getByText("语音识别中")
      .closest("div")
      ?.parentElement?.querySelector(
        'div[style*="width"]',
      ) as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar?.style.width).toBe("40%");
  });

  it("shows the completion state (100% bar, no cancel button) when phase is done", () => {
    render(
      <TranscriptionProgress
        phase="done"
        progressPct={100}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText("转录完成")).toBeInTheDocument();
    const bar = document.querySelector(
      'div[style*="width"]',
    ) as HTMLElement | null;
    expect(bar?.style.width).toBe("100%");
    // Cancel button only renders while not done.
    expect(
      screen.queryByRole("button", { name: "取消转录" }),
    ).not.toBeInTheDocument();
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <TranscriptionProgress
        phase="asr"
        progressPct={50}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "取消转录" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders the file name when provided", () => {
    render(
      <TranscriptionProgress
        phase="asr"
        progressPct={10}
        fileName="meeting-2026-07-29.wav"
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText("meeting-2026-07-29.wav")).toBeInTheDocument();
  });
});

describe("[20260729_Test_Panels] TextDisplay", () => {
  it("renders nothing when both texts are empty", () => {
    const { container } = render(
      <TextDisplay
        originalText=""
        processedText=""
        isProcessing={false}
        onCopy={() => {}}
        onExport={() => {}}
        onPaste={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the original text", () => {
    render(
      <TextDisplay
        originalText="原始识别文本"
        processedText=""
        isProcessing={false}
        onCopy={() => {}}
        onExport={() => {}}
        onPaste={() => {}}
      />,
    );

    expect(screen.getByText("原始识别文本")).toBeInTheDocument();
  });

  it("renders the processed text and the AI-optimized heading", () => {
    render(
      <TextDisplay
        originalText="原文"
        processedText="AI 优化后的文本"
        isProcessing={false}
        onCopy={() => {}}
        onExport={() => {}}
        onPaste={() => {}}
      />,
    );

    expect(screen.getByText("AI优化后")).toBeInTheDocument();
    expect(screen.getByText("AI 优化后的文本")).toBeInTheDocument();
  });

  it("shows the processing message instead of processed text while isProcessing", () => {
    // TextDisplay early-returns null when both texts are empty, so supply an
    // originalText so the component renders and the processing branch shows.
    render(
      <TextDisplay
        originalText="原始文本"
        processedText=""
        isProcessing={true}
        onCopy={() => {}}
        onExport={() => {}}
        onPaste={() => {}}
      />,
    );

    expect(screen.getByText("AI正在优化文本...")).toBeInTheDocument();
  });

  it("calls onCopy, onPaste and onExport with the processed text when their buttons are clicked", () => {
    const onCopy = vi.fn();
    const onPaste = vi.fn();
    const onExport = vi.fn();
    render(
      <TextDisplay
        originalText=""
        processedText="优化文本"
        isProcessing={false}
        onCopy={onCopy}
        onExport={onExport}
        onPaste={onPaste}
      />,
    );

    fireEvent.click(screen.getByTitle("复制优化文本"));
    fireEvent.click(screen.getByTitle("粘贴优化文本"));
    fireEvent.click(screen.getByTitle("导出文本"));

    expect(onCopy).toHaveBeenCalledWith("优化文本");
    expect(onPaste).toHaveBeenCalledWith("优化文本");
    expect(onExport).toHaveBeenCalledWith("优化文本");
  });

  it("calls onCopy with the original text when the original copy button is clicked", () => {
    const onCopy = vi.fn();
    render(
      <TextDisplay
        originalText="原始文本"
        processedText=""
        isProcessing={false}
        onCopy={onCopy}
        onExport={() => {}}
        onPaste={() => {}}
      />,
    );

    fireEvent.click(screen.getByTitle("复制识别文本"));
    expect(onCopy).toHaveBeenCalledWith("原始文本");
  });
});
