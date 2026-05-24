// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelDownloadProgress } from "../../../src/components/ui/model-status-indicator";

describe("ModelDownloadProgress", () => {
  it("shows download prompt when models needed", () => {
    const onDownload = vi.fn();
    render(
      <ModelDownloadProgress
        modelStatus={{ stage: "need_download" }}
        onDownload={onDownload}
      />,
    );
    expect(screen.getByText("开始下载")).toBeTruthy();
  });

  it("shows overall progress bar during download", () => {
    render(
      <ModelDownloadProgress
        modelStatus={{ stage: "downloading", downloadProgress: 45 }}
      />,
    );
    expect(screen.getByText("45%")).toBeTruthy();
  });

  it("shows per-model progress when modelProgress is provided", () => {
    render(
      <ModelDownloadProgress
        modelStatus={{
          stage: "downloading",
          downloadProgress: 33,
          modelProgress: {
            asr: { progress: 10, status: "downloading" },
            vad: { progress: 100, status: "completed" },
            punc: { progress: 0, status: "waiting" },
          },
        }}
      />,
    );
    expect(screen.getByText(/ASR/)).toBeTruthy();
    expect(screen.getByText(/VAD/)).toBeTruthy();
    expect(screen.getByText(/标点/)).toBeTruthy();
  });

  it("shows completed checkmark for finished models", () => {
    render(
      <ModelDownloadProgress
        modelStatus={{
          stage: "downloading",
          downloadProgress: 60,
          modelProgress: {
            asr: { progress: 30, status: "downloading" },
            vad: { progress: 100, status: "completed" },
            punc: { progress: 50, status: "downloading" },
          },
        }}
      />,
    );
    // VAD should show completed state
    expect(screen.getByText(/VAD/).closest("div")?.querySelector(".model-done")).toBeTruthy();
  });

  it("returns null for non-download stages", () => {
    const { container } = render(
      <ModelDownloadProgress modelStatus={{ stage: "ready" }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows estimated download size in prompt", () => {
    render(
      <ModelDownloadProgress
        modelStatus={{ stage: "need_download" }}
        onDownload={vi.fn()}
      />,
    );
    expect(screen.getByText(/1\.1GB/)).toBeTruthy();
  });
});
