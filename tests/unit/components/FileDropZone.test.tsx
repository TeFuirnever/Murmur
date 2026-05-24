// @vitest-environment happy-dom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import FileDropZone from "../../../src/components/FileDropZone";

describe("FileDropZone", () => {
  it("calls onSelectFileFromPath when dropped file has a path", () => {
    const onSelectFile = vi.fn();
    const onSelectFileFromPath = vi.fn();
    render(
      <FileDropZone
        fileInfo={null}
        onSelectFile={onSelectFile}
        onSelectFileFromPath={onSelectFileFromPath}
      />,
    );

    const dropZone = screen.getByText("点击选择音频文件或拖拽到此处").closest("div")!;
    const file = new File(["audio"], "test.wav", { type: "audio/wav" });
    Object.defineProperty(file, "path", { value: "/fake/test.wav", writable: false });

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file] },
    });

    expect(onSelectFileFromPath).toHaveBeenCalledWith("/fake/test.wav");
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it("calls onSelectFile fallback when dropped file has no path", () => {
    const onSelectFile = vi.fn();
    const onSelectFileFromPath = vi.fn();
    render(
      <FileDropZone
        fileInfo={null}
        onSelectFile={onSelectFile}
        onSelectFileFromPath={onSelectFileFromPath}
      />,
    );

    const dropZone = screen.getByText("点击选择音频文件或拖拽到此处").closest("div")!;
    const file = new File(["audio"], "test.wav", { type: "audio/wav" });
    // File in browser has no .path property — simulates non-Electron env

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file] },
    });

    expect(onSelectFile).toHaveBeenCalled();
    expect(onSelectFileFromPath).not.toHaveBeenCalled();
  });
});
