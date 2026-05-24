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

  it("shows custom message", () => {
    render(<TranscriptionProgress message="识别中..." onCancel={() => {}} />);
    expect(screen.getByText("识别中...")).toBeTruthy();
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(<TranscriptionProgress onCancel={onCancel} />);
    fireEvent.click(screen.getByText("取消转录"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders all 3 phase labels", () => {
    render(<TranscriptionProgress onCancel={() => {}} />);
    expect(screen.getByText("语音检测")).toBeTruthy();
    expect(screen.getByText("语音识别")).toBeTruthy();
    expect(screen.getByText("标点恢复")).toBeTruthy();
  });

  it("highlights current phase", () => {
    const { container } = render(
      <TranscriptionProgress phase="asr" onCancel={() => {}} />,
    );
    const phases = container.querySelectorAll(".rounded-full");
    // phase index 1 (asr) should have animate-pulse
    expect(phases[1].classList.contains("animate-pulse")).toBe(true);
    // phase index 0 (vad) should be completed — no animate-pulse, not default gray
    expect(phases[0].classList.contains("animate-pulse")).toBe(false);
  });

  it("shows progress bar during ASR phase with time info", () => {
    render(
      <TranscriptionProgress
        phase="asr"
        processedMs={5000}
        totalMs={10000}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/已处理/)).toBeTruthy();
    expect(screen.getByText(/0:05/)).toBeTruthy();
    expect(screen.getByText(/0:10/)).toBeTruthy();
  });

  it("hides progress bar when not in ASR phase", () => {
    render(
      <TranscriptionProgress
        phase="vad"
        processedMs={5000}
        totalMs={10000}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/已处理/)).toBeNull();
  });
});
