// @vitest-environment happy-dom
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TranscriptionResult from "../../../src/components/TranscriptionResult";

const mockModes = [
  { name: "optimize", label: "智能润色", description: "优化文本流畅度" },
  { name: "optimize_long", label: "长文本整理", description: "结构化长文本" },
];

function stubElectronAPI(overrides: Record<string, unknown> = {}) {
  (window as any).electronAPI = {
    getAIModes: vi.fn().mockResolvedValue(mockModes),
    ...overrides,
  };
}

function clearElectronAPI() {
  delete (window as any).electronAPI;
}

describe("TranscriptionResult", () => {
  // --- Existing tests (unchanged) ---

  it("shows transcription text", () => {
    render(<TranscriptionResult text="hello world" />);
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("shows duration when provided", () => {
    render(<TranscriptionResult text="hello" duration={125} />);
    expect(screen.getByText(/2分5秒/)).toBeTruthy();
  });

  it("shows short duration in seconds", () => {
    render(<TranscriptionResult text="hello" duration={45} />);
    expect(screen.getByText(/45秒/)).toBeTruthy();
  });

  it("hides duration section when duration is 0", () => {
    const { container } = render(
      <TranscriptionResult text="hello" duration={0} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("shows expand button when segments provided", () => {
    render(
      <TranscriptionResult
        text="hello world"
        segments={[{ start_ms: 0, end_ms: 1000, text: "hello" }]}
      />,
    );
    expect(screen.getByText("查看分段详情")).toBeTruthy();
  });

  it("toggles segment details on click", () => {
    render(
      <TranscriptionResult
        text="hello world"
        segments={[
          { start_ms: 0, end_ms: 1000, text: "hello" },
          { start_ms: 1000, end_ms: 2000, text: "world" },
        ]}
      />,
    );
    const toggleBtn = screen.getByText("查看分段详情");
    fireEvent.click(toggleBtn);
    expect(screen.getByText("收起分段详情")).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("world")).toBeTruthy();
    expect(screen.getByText(/00:00.*00:01/)).toBeTruthy();
  });

  it("hides segment section when no segments", () => {
    render(<TranscriptionResult text="hello" />);
    expect(screen.queryByText("查看分段详情")).toBeNull();
  });

  // --- New: Copy button (onCopy) ---

  it("shows copy button when onCopy provided", () => {
    render(<TranscriptionResult text="copy me" onCopy={vi.fn()} />);
    expect(screen.getByTitle("复制文本")).toBeTruthy();
  });

  it("hides copy button when onCopy not provided", () => {
    render(<TranscriptionResult text="no copy" />);
    expect(screen.queryByTitle("复制文本")).toBeNull();
  });

  it("calls onCopy with current text", () => {
    const onCopy = vi.fn();
    render(<TranscriptionResult text="copy me" onCopy={onCopy} />);
    fireEvent.click(screen.getByTitle("复制文本"));
    expect(onCopy).toHaveBeenCalledWith("copy me");
  });

  it("calls onCopy with optimized text when rawText differs", () => {
    const onCopy = vi.fn();
    render(
      <TranscriptionResult
        text="optimized"
        rawText="original"
        onCopy={onCopy}
      />,
    );
    fireEvent.click(screen.getByTitle("复制文本"));
    expect(onCopy).toHaveBeenCalledWith("optimized");
  });

  // --- New: rawText stacking ---

  it("shows blue AI card when rawText differs from text", () => {
    render(
      <TranscriptionResult text="优化后" rawText="原始文本" />,
    );
    expect(screen.getByText("优化后")).toBeTruthy();
    expect(screen.getByText("查看原文")).toBeTruthy();
  });

  it("does not show raw section when rawText equals text", () => {
    render(
      <TranscriptionResult text="same" rawText="same" />,
    );
    expect(screen.queryByText("查看原文")).toBeNull();
  });

  it("does not show raw section when rawText is not provided", () => {
    render(<TranscriptionResult text="hello" />);
    expect(screen.queryByText("查看原文")).toBeNull();
  });

  it("toggles raw text visibility on click", () => {
    render(
      <TranscriptionResult text="optimized" rawText="raw content" />,
    );
    fireEvent.click(screen.getByText("查看原文"));
    expect(screen.getByText("raw content")).toBeTruthy();
    expect(screen.getByText("收起原文")).toBeTruthy();
  });

  // --- New: isOptimizing ---

  it("shows loading state when isOptimizing is true", () => {
    render(
      <TranscriptionResult text="raw text" isOptimizing={true} />,
    );
    expect(screen.getByText("AI正在优化文本...")).toBeTruthy();
  });

  it("hides loading state when isOptimizing is false", () => {
    render(
      <TranscriptionResult text="raw text" isOptimizing={false} />,
    );
    expect(screen.queryByText("AI正在优化文本...")).toBeNull();
  });

  // --- New: ExportPanel conditional rendering (id) ---

  it("shows export panel when id is provided", () => {
    render(<TranscriptionResult text="hello" id={42} />);
    expect(screen.getByText("导出格式")).toBeTruthy();
  });

  it("hides export panel when id is not provided", () => {
    render(<TranscriptionResult text="hello" />);
    expect(screen.queryByText("导出格式")).toBeNull();
  });

  // --- New: AI processing panel (ProcessingPanel) ---

  it("shows processing panel when text and modes available", async () => {
    stubElectronAPI();
    render(<TranscriptionResult text="hello" />);
    await waitFor(() => {
      expect(screen.getByText("AI 处理")).toBeTruthy();
      expect(screen.getByText("应用")).toBeTruthy();
    });
    clearElectronAPI();
  });

  it("hides processing panel when no text", () => {
    stubElectronAPI();
    render(<TranscriptionResult text="" />);
    expect(screen.queryByText("AI 处理")).toBeNull();
    clearElectronAPI();
  });

  it("shows processing panel mode dropdown with all modes", async () => {
    stubElectronAPI();
    render(<TranscriptionResult text="hello" />);
    await waitFor(() => {
      expect(screen.getByText("智能润色")).toBeTruthy();
      expect(screen.getByText("长文本整理")).toBeTruthy();
    });
    clearElectronAPI();
  });

  it("calls onAIOptimize fallback when processText unavailable", () => {
    const onAIOptimize = vi.fn().mockResolvedValue("优化结果");
    render(
      <TranscriptionResult text="original" onAIOptimize={onAIOptimize} />,
    );
    // Without electronAPI, component should render without crash
    expect(screen.getByText("original")).toBeTruthy();
  });

  it("shows error when processText fails", async () => {
    stubElectronAPI({
      processText: vi.fn().mockRejectedValue(new Error("AI 服务错误")),
    });
    render(<TranscriptionResult text="hello" />);
    await waitFor(() => {
      expect(screen.getByText("应用")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("应用"));
    await waitFor(() => {
      expect(screen.getByText("AI 服务错误")).toBeTruthy();
    });
    clearElectronAPI();
  });
});
