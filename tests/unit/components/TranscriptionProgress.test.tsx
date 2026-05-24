// @vitest-environment happy-dom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TranscriptionProgress from "../../../src/components/TranscriptionProgress";

describe("TranscriptionProgress", () => {
  it("shows default message when none provided", () => {
    render(<TranscriptionProgress onCancel={() => {}} />);
    expect(screen.getByText("正在处理...")).toBeTruthy();
  });

  it("shows custom message when phase not in PHASE_LABELS", () => {
    render(<TranscriptionProgress message="识别中..." onCancel={() => {}} />);
    expect(screen.getByText("识别中...")).toBeTruthy();
  });

  it("shows phase label for known phase", () => {
    render(<TranscriptionProgress phase="asr" onCancel={() => {}} />);
    expect(screen.getByText("语音识别中")).toBeTruthy();
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(<TranscriptionProgress onCancel={onCancel} />);
    fireEvent.click(screen.getByText("取消转录"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("hides cancel button when done", () => {
    render(<TranscriptionProgress phase="done" onCancel={() => {}} />);
    expect(screen.getByText("转录完成")).toBeTruthy();
    expect(screen.queryByText("取消转录")).toBeNull();
  });

  it("shows indeterminate progress bar during ASR phase without progressPct", () => {
    const { container } = render(
      <TranscriptionProgress phase="asr" totalMs={10000} onCancel={() => {}} />,
    );
    expect(screen.getByText(/音频时长/)).toBeTruthy();
    expect(container.querySelector(".animate-indeterminate")).toBeTruthy();
  });

  it("shows progress bar with correct width for ASR with progressPct", () => {
    const { container } = render(
      <TranscriptionProgress phase="asr" totalMs={60000} progressPct={50} onCancel={() => {}} />,
    );
    expect(screen.getByText(/音频时长/)).toBeTruthy();
    expect(container.querySelector(".animate-indeterminate")).toBeNull();
    const bar = container.querySelector("[style]");
    expect(bar?.getAttribute("style")).toContain("width: 50%");
  });

  it("shows progress bar without percentage text", () => {
    const { container } = render(
      <TranscriptionProgress phase="asr" totalMs={5000} progressPct={50} onCancel={() => {}} />,
    );
    expect(screen.getByText(/音频时长/)).toBeTruthy();
    expect(screen.queryByText(/50%/)).toBeNull();
    const bar = container.querySelector("[style]");
    expect(bar?.getAttribute("style")).toContain("width: 50%");
  });

  it("shows progress bar for VAD phase with progressPct", () => {
    const { container } = render(
      <TranscriptionProgress phase="vad" progressPct={8} onCancel={() => {}} />,
    );
    expect(screen.getByText("语音检测中")).toBeTruthy();
    const bar = container.querySelector("[style]");
    expect(bar?.getAttribute("style")).toContain("width: 8%");
  });

  it("shows progress bar for punc phase with progressPct", () => {
    const { container } = render(
      <TranscriptionProgress phase="punc" progressPct={96} onCancel={() => {}} />,
    );
    expect(screen.getByText("标点恢复中")).toBeTruthy();
    const bar = container.querySelector("[style]");
    expect(bar?.getAttribute("style")).toContain("width: 96%");
  });

  it("shows progress bar for convert phase with progressPct", () => {
    const { container } = render(
      <TranscriptionProgress phase="convert" progressPct={2} onCancel={() => {}} />,
    );
    expect(screen.getByText("格式转换中")).toBeTruthy();
    const bar = container.querySelector("[style]");
    expect(bar?.getAttribute("style")).toContain("width: 2%");
  });

  it("shows no progress bar when not in ASR phase and no progressPct", () => {
    const { container } = render(
      <TranscriptionProgress phase="vad" totalMs={10000} onCancel={() => {}} />,
    );
    expect(container.querySelector("[style]")).toBeNull();
    expect(container.querySelector(".animate-indeterminate")).toBeNull();
  });

  it("shows green checkmark and bar when done", () => {
    const { container } = render(
      <TranscriptionProgress phase="done" progressPct={100} onCancel={() => {}} />,
    );
    expect(screen.getByText("转录完成")).toBeTruthy();
    const bar = container.querySelector("[style]");
    expect(bar?.getAttribute("style")).toContain("width: 100%");
    expect(bar?.classList.contains("bg-[#30d158]")).toBe(true);
  });

  it("shows fileName when provided", () => {
    render(
      <TranscriptionProgress fileName="test.m4a" onCancel={() => {}} />,
    );
    expect(screen.getByText("test.m4a")).toBeTruthy();
  });
});
