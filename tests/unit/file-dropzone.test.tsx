// @vitest-environment jsdom
// [20260816_Test_FileDropZone] Render + drag-callback coverage: drag-over
// highlight, drag-leave reset, and the drop path routing to
// onSelectFileFromPath / onSelectFile.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import FileDropZone from "../../src/components/FileDropZone";

function dropEvent(files: File[]): React.DragEvent {
  const evt = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: { files } });
  return evt as unknown as React.DragEvent;
}

// fireEvent's generic signature expects a plain Event for custom events.
function fireDrop(el: Element, files: File[]): void {
  fireEvent(el, dropEvent(files) as unknown as Event);
}

describe("[20260816_Test_FileDropZone] FileDropZone", () => {
  it("renders the idle drop zone with supported formats", () => {
    render(<FileDropZone fileInfo={null} onSelectFile={vi.fn()} />);
    expect(screen.getByTestId("file-drop-zone")).toBeInTheDocument();
    expect(screen.getByText(/wav|mp3/i)).toBeInTheDocument();
  });

  it("shows the selected file info when present", () => {
    render(
      <FileDropZone
        fileInfo={{ fileName: "demo.wav", fileSize: 2048 }}
        onSelectFile={vi.fn()}
      />,
    );
    expect(screen.getByText("demo.wav")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("highlights on drag over and resets on drag leave", () => {
    render(<FileDropZone fileInfo={null} onSelectFile={vi.fn()} />);
    const zone = screen.getByTestId("file-drop-zone");

    fireEvent.dragOver(zone, { bubbles: true, cancelable: true });
    // The dragging branch's full highlight string (the idle branch only has
    // hover: variants, whose substring would false-match).
    expect(zone.className).toContain("border-[#0071e3] bg-[#e8f4fd]/30");

    fireEvent.dragLeave(zone, { bubbles: true, cancelable: true });
    expect(zone.className).not.toContain("border-[#0071e3] bg-");
  });

  it("routes a dropped file with a path to onSelectFileFromPath", () => {
    const onSelectFileFromPath = vi.fn();
    render(
      <FileDropZone
        fileInfo={null}
        onSelectFile={vi.fn()}
        onSelectFileFromPath={onSelectFileFromPath}
      />,
    );
    const file = new File(["audio"], "dropped.wav", { type: "audio/wav" });
    Object.defineProperty(file, "path", {
      value: "/tmp/dropped.wav",
      configurable: true,
    });
    fireDrop(screen.getByTestId("file-drop-zone"), [file]);
    expect(onSelectFileFromPath).toHaveBeenCalledWith("/tmp/dropped.wav");
  });

  it("falls back to onSelectFile when the drop carries no path", () => {
    const onSelectFile = vi.fn();
    render(
      <FileDropZone
        fileInfo={null}
        onSelectFile={onSelectFile}
        onSelectFileFromPath={vi.fn()}
      />,
    );
    const file = new File(["audio"], "pathless.wav", { type: "audio/wav" });
    fireDrop(screen.getByTestId("file-drop-zone"), [file]);
    expect(onSelectFile).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty drop", () => {
    const onSelectFile = vi.fn();
    render(<FileDropZone fileInfo={null} onSelectFile={onSelectFile} />);
    fireDrop(screen.getByTestId("file-drop-zone"), []);
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it("invokes onSelectFile on plain click", () => {
    const onSelectFile = vi.fn();
    render(<FileDropZone fileInfo={null} onSelectFile={onSelectFile} />);
    fireEvent.click(screen.getByTestId("file-drop-zone"));
    expect(onSelectFile).toHaveBeenCalledTimes(1);
  });
});
