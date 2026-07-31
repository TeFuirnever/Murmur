// @vitest-environment jsdom
// [20260731_Test_ModelStatusIndicator] Integration tests for the three exported
// components in src/components/ui/model-status-indicator.tsx, currently at 19%
// coverage. Each component switches on `modelStatus.stage` across many branches
// (checking, need_download, downloading, loading, ready, error, default) plus
// conditional progress text, tooltips, and the download/cancel callbacks.
// Tests follow the established RTL pattern in ui-components.test.tsx:
// render -> query DOM -> fireEvent -> assert callback / text.
import "../setup/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  ModelStatusIndicator,
  ModelStatusIcon,
  ModelDownloadProgress,
} from "../../src/components/ui/model-status-indicator";

afterEach(() => {
  vi.clearAllMocks();
});

describe("[20260731_Test_ModelStatusIndicator] ModelStatusIndicator", () => {
  it("renders the ready stage with the ready text and green color", () => {
    render(
      <ModelStatusIndicator
        modelStatus={{ stage: "ready", isReady: true } as never}
      />,
    );
    expect(screen.getByText("语音识别就绪")).toBeInTheDocument();
    // ready color class is applied to the status span
    const statusSpan = screen.getByText("语音识别就绪");
    expect(statusSpan.className).toContain("text-[#34c759]");
  });

  it("renders the need_download stage and shows a download button when onDownload is provided", () => {
    const onDownload = vi.fn();
    render(
      <ModelStatusIndicator
        modelStatus={{ stage: "need_download" } as never}
        onDownload={onDownload}
      />,
    );
    expect(screen.getByText("需要下载语音模型")).toBeInTheDocument();
    const downloadButton = screen.getByRole("button", { name: "下载" });
    fireEvent.click(downloadButton);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("does not render a download button when onDownload is null", () => {
    render(
      <ModelStatusIndicator
        modelStatus={{ stage: "need_download" } as never}
        onDownload={null}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the downloading stage with download progress percentage", () => {
    render(
      <ModelStatusIndicator
        modelStatus={
          {
            stage: "downloading",
            isDownloading: true,
            downloadProgress: 42,
          } as never
        }
      />,
    );
    expect(screen.getByText("正在下载语音模型...")).toBeInTheDocument();
    // getProgressText renders `${downloadProgress}%` inside parens
    expect(screen.getByText("(42%)")).toBeInTheDocument();
  });

  it("renders the loading stage with loading progress percentage", () => {
    render(
      <ModelStatusIndicator
        modelStatus={
          {
            stage: "loading",
            isLoading: true,
            progress: 88,
          } as never
        }
      />,
    );
    expect(screen.getByText("语音模型加载中...")).toBeInTheDocument();
    expect(screen.getByText("(88%)")).toBeInTheDocument();
  });

  it("renders the error stage with error color and no progress", () => {
    render(
      <ModelStatusIndicator
        modelStatus={{ stage: "error", error: "模型损坏" } as never}
      />,
    );
    expect(screen.getByText("语音识别错误")).toBeInTheDocument();
    const statusSpan = screen.getByText("语音识别错误");
    expect(statusSpan.className).toContain("text-[#ff3b30]");
    // no progress text rendered for error stage
    expect(screen.queryByText(/\(\d+%\)/)).toBeNull();
  });

  it("renders the checking stage", () => {
    render(
      <ModelStatusIndicator modelStatus={{ stage: "checking" } as never} />,
    );
    expect(screen.getByText("检查语音模型...")).toBeInTheDocument();
    const statusSpan = screen.getByText("检查语音模型...");
    expect(statusSpan.className).toContain("text-[#0071e3]");
  });

  it("renders an unknown stage via the default branch", () => {
    render(<ModelStatusIndicator modelStatus={{ stage: "wat" } as never} />);
    expect(screen.getByText("语音模型状态未知")).toBeInTheDocument();
  });

  it("forwards a custom className onto the container", () => {
    const { container } = render(
      <ModelStatusIndicator
        modelStatus={{ stage: "ready" } as never}
        className="my-custom-class"
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("my-custom-class");
  });
});

describe("[20260731_Test_ModelStatusIndicator] ModelStatusIcon", () => {
  it("renders only the icon (no tooltip wrapper) when showTooltip is false", () => {
    const { container } = render(
      <ModelStatusIcon
        modelStatus={{ stage: "ready" } as never}
        showTooltip={false}
      />,
    );
    // No tooltip wrapper div with class model-status-tooltip
    expect(container.querySelector(".model-status-tooltip")).toBeNull();
    // The ready icon carries the model-ready class
    expect(container.querySelector(".model-ready")).not.toBeNull();
  });

  it("renders the tooltip wrapper with tooltip text when showTooltip is true (default)", () => {
    const { container } = render(
      <ModelStatusIcon modelStatus={{ stage: "ready" } as never} />,
    );
    expect(container.querySelector(".model-status-tooltip")).not.toBeNull();
    expect(
      screen.getByText("✅ 语音识别就绪，可以开始录音"),
    ).toBeInTheDocument();
  });

  it("renders the error tooltip including the error message", () => {
    render(
      <ModelStatusIcon
        modelStatus={{ stage: "error", error: "网络异常" } as never}
      />,
    );
    expect(screen.getByText(/语音识别错误: 网络异常/)).toBeInTheDocument();
  });

  it("renders the downloading tooltip with the download progress percentage", () => {
    render(
      <ModelStatusIcon
        modelStatus={
          {
            stage: "downloading",
            downloadProgress: 73,
          } as never
        }
      />,
    );
    expect(screen.getByText(/73%/)).toBeInTheDocument();
  });

  it("honors a custom size class on the icon", () => {
    const { container } = render(
      <ModelStatusIcon
        modelStatus={{ stage: "ready" } as never}
        size="w-2 h-2"
        showTooltip={false}
      />,
    );
    const icon = container.querySelector(".w-2.h-2");
    expect(icon).not.toBeNull();
  });

  it("renders the unknown-stage tooltip via the default branch", () => {
    render(<ModelStatusIcon modelStatus={{ stage: "wat" } as never} />);
    expect(screen.getByText("⏳ 语音模型状态未知")).toBeInTheDocument();
  });
});

describe("[20260731_Test_ModelStatusIndicator] ModelDownloadProgress", () => {
  it("renders the need_download card and calls onDownload when the download button is clicked", () => {
    const onDownload = vi.fn();
    render(
      <ModelDownloadProgress
        modelStatus={{ stage: "need_download", isDownloading: false } as never}
        onDownload={onDownload}
      />,
    );
    expect(screen.getByText("需要下载语音识别模型")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "开始下载" });
    fireEvent.click(button);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("disables the download button and shows 准备下载... when isDownloading is true", () => {
    const onDownload = vi.fn();
    render(
      <ModelDownloadProgress
        modelStatus={{ stage: "need_download", isDownloading: true } as never}
        onDownload={onDownload}
      />,
    );
    const button = screen.getByRole("button", { name: "准备下载..." });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    // disabled button should not invoke the handler
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("renders the downloading card with overall progress and the cancel button when onCancel is provided", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ModelDownloadProgress
        modelStatus={
          {
            stage: "downloading",
            downloadProgress: 55,
            modelProgress: {
              asr: { progress: 60, status: "downloading" },
              vad: { progress: 100, status: "completed" },
            },
          } as never
        }
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("正在下载模型文件")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    // per-model rows: asr shows its live %, vad shows the completed checkmark
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
    // overall progress bar width set from downloadProgress
    const fill = container.querySelector(
      ".bg-\\[\\#0071e3\\].h-2.rounded-full",
    ) as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe("55%");
    // cancel button
    const cancelButton = screen.getByRole("button", { name: "取消" });
    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("omits the cancel button when onCancel is not provided", () => {
    render(
      <ModelDownloadProgress
        modelStatus={
          {
            stage: "downloading",
            downloadProgress: 10,
          } as never
        }
      />,
    );
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
  });

  it("renders per-model progress rows with a completed checkmark for completed models", () => {
    render(
      <ModelDownloadProgress
        modelStatus={
          {
            stage: "downloading",
            downloadProgress: 40,
            modelProgress: {
              asr: { progress: 100, status: "completed" },
              vad: { progress: 50, status: "downloading" },
              punc: { progress: 0, status: "waiting" },
            },
          } as never
        }
      />,
    );
    // completed model shows ✓
    expect(screen.getAllByText("✓").length).toBe(1);
    // downloading model shows its progress %
    expect(screen.getByText("50%")).toBeInTheDocument();
    // waiting model shows 0%
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders nothing for a ready stage (no matching branch)", () => {
    const { container } = render(
      <ModelDownloadProgress modelStatus={{ stage: "ready" } as never} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
