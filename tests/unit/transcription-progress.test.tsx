// @vitest-environment jsdom
// [20260816_Test_TranscriptionProgress] TranscriptionProgress.tsx was 0% —
// render coverage for phase labels, ETA estimation, done state, and cancel.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TranscriptionProgress from "../../src/components/TranscriptionProgress";

describe("[20260816_Test_TranscriptionProgress] TranscriptionProgress", () => {
  it("shows the mapped label for a known phase", () => {
    render(<TranscriptionProgress phase="asr" onCancel={vi.fn()} />);
    expect(screen.getByText("语音识别中")).toBeInTheDocument();
  });

  it.each(["convert", "vad", "punc"] as const)(
    "maps the %s phase to its Chinese label",
    (phase) => {
      render(<TranscriptionProgress phase={phase} onCancel={vi.fn()} />);
      expect(
        screen.getByText(
          {
            convert: "格式转换中",
            vad: "语音检测中",
            punc: "标点恢复中",
          }[phase],
        ),
      ).toBeInTheDocument();
    },
  );

  it("falls back to the custom message for an unknown phase", () => {
    render(
      <TranscriptionProgress
        phase="weird"
        message="自定义阶段"
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("自定义阶段")).toBeInTheDocument();
  });

  it("falls back to the generic label with no phase and no message", () => {
    render(<TranscriptionProgress onCancel={vi.fn()} />);
    expect(screen.getByText("正在处理...")).toBeInTheDocument();
  });

  it("shows the file name context when provided", () => {
    render(
      <TranscriptionProgress
        phase="asr"
        fileName="meeting.wav"
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("meeting.wav")).toBeInTheDocument();
  });

  it("shows the audio duration from totalMs on the asr phase", () => {
    render(
      <TranscriptionProgress phase="asr" totalMs={65_000} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("音频时长 1:05")).toBeInTheDocument();
  });

  it("omits the duration row entirely without totalMs", () => {
    render(<TranscriptionProgress phase="asr" onCancel={vi.fn()} />);
    expect(screen.queryByText(/音频时长/)).not.toBeInTheDocument();
  });

  it("renders the done state: completion label, no cancel button", () => {
    render(<TranscriptionProgress phase="done" onCancel={vi.fn()} />);
    expect(screen.getByText("转录完成")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /取消/ }),
    ).not.toBeInTheDocument();
  });

  it("renders the indeterminate bar area when pct is unknown", () => {
    render(
      <TranscriptionProgress phase="asr" totalMs={5_000} onCancel={vi.fn()} />,
    );
    // Indeterminate branch still shows the duration.
    expect(screen.getByText("音频时长 0:05")).toBeInTheDocument();
  });

  it("invokes onCancel from the cancel button", () => {
    const onCancel = vi.fn();
    render(<TranscriptionProgress phase="asr" onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("estimates remaining time once enough progress and time elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00Z"));
    try {
      // 50% after 10s elapsed → total ≈ 20s → remaining ≈ 10s → "预计 10秒".
      vi.advanceTimersByTime(0);
      render(
        <TranscriptionProgress
          phase="asr"
          progressPct={50}
          onCancel={vi.fn()}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(10_500);
      });
      expect(screen.getByText(/预计/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Local act wrapper to avoid importing RTL act separately.
function act(fn: () => void) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { act: rtlAct } = require("@testing-library/react") as {
    act: (f: () => void) => void;
  };
  rtlAct(fn);
}
