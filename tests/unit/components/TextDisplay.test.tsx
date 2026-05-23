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
