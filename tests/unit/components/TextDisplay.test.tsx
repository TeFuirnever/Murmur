// @vitest-environment happy-dom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TextDisplay } from "../../../src/components/TextDisplay";

const noop = () => {};

describe("TextDisplay", () => {
  it("returns null when no text provided", () => {
    const { container } = render(
      <TextDisplay
        originalText=""
        processedText=""
        isProcessing={false}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows original text", () => {
    render(
      <TextDisplay
        originalText="hello world"
        processedText=""
        isProcessing={false}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("shows processed text when available", () => {
    render(
      <TextDisplay
        originalText="raw"
        processedText="polished"
        isProcessing={false}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(screen.getByText("polished")).toBeTruthy();
  });

  it("shows loading state when processing", () => {
    render(
      <TextDisplay
        originalText="raw"
        processedText=""
        isProcessing={true}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(screen.getByText("AI正在优化文本...")).toBeTruthy();
  });

  it("calls onCopy with original text", () => {
    const onCopy = vi.fn();
    render(
      <TextDisplay
        originalText="copy me"
        processedText=""
        isProcessing={false}
        onCopy={onCopy}
        onExport={noop}
        onPaste={noop}
      />,
    );
    fireEvent.click(screen.getByTitle("复制识别文本"));
    expect(onCopy).toHaveBeenCalledWith("copy me");
  });

  it("calls onPaste with processed text", () => {
    const onPaste = vi.fn();
    render(
      <TextDisplay
        originalText="raw"
        processedText="polished"
        isProcessing={false}
        onCopy={noop}
        onExport={noop}
        onPaste={onPaste}
      />,
    );
    fireEvent.click(screen.getByTitle("粘贴优化文本"));
    expect(onPaste).toHaveBeenCalledWith("polished");
  });

  it("calls onExport with processed text", () => {
    const onExport = vi.fn();
    render(
      <TextDisplay
        originalText="raw"
        processedText="polished"
        isProcessing={false}
        onCopy={noop}
        onExport={onExport}
        onPaste={noop}
      />,
    );
    fireEvent.click(screen.getByTitle("导出文本"));
    expect(onExport).toHaveBeenCalledWith("polished");
  });

  it("calls onCopy with processed text from AI section", () => {
    const onCopy = vi.fn();
    render(
      <TextDisplay
        originalText="raw"
        processedText="polished"
        isProcessing={false}
        onCopy={onCopy}
        onExport={noop}
        onPaste={noop}
      />,
    );
    fireEvent.click(screen.getByTitle("复制优化文本"));
    expect(onCopy).toHaveBeenCalledWith("polished");
  });

  it("hides action buttons while processing", () => {
    render(
      <TextDisplay
        originalText="raw"
        processedText=""
        isProcessing={true}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(screen.queryByTitle("粘贴优化文本")).toBeNull();
    expect(screen.queryByTitle("导出文本")).toBeNull();
  });
});

// [20260913_Fix_197_AiLabelBaseline] Spec #197 known-behavior-change #1:
// the "AI优化后" block must render only when the polish actually CHANGED
// the text relative to the transcription (processedText !== originalText),
// or when an explicit aiOptimized flag says so. A record whose text was
// rewritten only by the main-process cleaner (no AI involved) must not
// show the AI-optimized block. While processing, the processing state
// renders regardless of the text baseline.
describe("[20260913_Fix_197_AiLabelBaseline] TextDisplay AI-label baseline", () => {
  it("hides the AI block when processedText equals originalText", () => {
    render(
      <TextDisplay
        originalText="same text"
        processedText="same text"
        isProcessing={false}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(screen.queryByText("AI优化后")).toBeNull();
    // Single transcription block keeps its copy button — no capability lost.
    expect(screen.getByTitle("复制识别文本")).toBeTruthy();
  });

  it("shows the AI block when processedText differs from originalText", () => {
    render(
      <TextDisplay
        originalText="raw"
        processedText="polished"
        isProcessing={false}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(screen.getByText("AI优化后")).toBeTruthy();
    expect(screen.getByText("polished")).toBeTruthy();
  });

  it("shows the AI block when the explicit aiOptimized flag is true even if texts are equal", () => {
    render(
      <TextDisplay
        originalText="same text"
        processedText="same text"
        isProcessing={false}
        aiOptimized={true}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(screen.getByText("AI优化后")).toBeTruthy();
  });

  it("hides the AI block when the explicit aiOptimized flag is false even if texts differ", () => {
    render(
      <TextDisplay
        originalText="raw"
        processedText="polished"
        isProcessing={false}
        aiOptimized={false}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(screen.queryByText("AI优化后")).toBeNull();
  });

  it("renders the processing state regardless of the text baseline", () => {
    render(
      <TextDisplay
        originalText="same text"
        processedText="same text"
        isProcessing={true}
        onCopy={noop}
        onExport={noop}
        onPaste={noop}
      />,
    );
    expect(screen.getByText("AI优化后")).toBeTruthy();
    expect(screen.getByText("AI正在优化文本...")).toBeTruthy();
  });
});
