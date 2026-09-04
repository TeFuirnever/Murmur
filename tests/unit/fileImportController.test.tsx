// [20260905_Feat_BloubFileLift] Contract test: FileImport must accept an
// externally-owned transcription controller (the lift to App, spec #224
// ticket 4) so the title-bar mascot can see file-transcription state, and
// must report copy success through onCopied.

// @vitest-environment jsdom
import "../setup/react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import FileImport from "../../src/components/FileImport";
import type { FileTranscriptionController } from "../../src/hooks/useFileTranscription";

function stubController(
  overrides: Partial<FileTranscriptionController> = {},
): FileTranscriptionController {
  return {
    state: "idle",
    fileInfo: null,
    progress: null,
    result: null,
    error: null,
    isOptimizing: false,
    optimizedText: null,
    selectFile: vi.fn(),
    selectFileFromPath: vi.fn(),
    startTranscription: vi.fn(),
    cancelTranscription: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

describe("FileImport with an injected transcription controller", () => {
  it("renders the transcribing progress UI from the injected controller", () => {
    const ctrl = stubController({
      state: "transcribing",
      progress: { phase: "transcribing", message: "处理中", progress_pct: 42 },
      fileInfo: { filePath: "/a.mp3", fileName: "a.mp3", fileSize: 1 },
    });
    render(<FileImport transcription={ctrl} />);
    // the progress view is anchored by the file name + cancel control
    expect(screen.getByText("a.mp3")).toBeInTheDocument();
    expect(screen.getByText("取消转录")).toBeInTheDocument();
  });

  it("renders the result UI from the injected controller", () => {
    const ctrl = stubController({
      state: "done",
      result: { success: true, text: "hello", id: 7 },
    });
    render(<FileImport transcription={ctrl} />);
    expect(screen.getByText(/导入新文件/)).toBeInTheDocument();
  });

  it("reports copy success through onCopied", async () => {
    const onCopied = vi.fn();
    const ctrl = stubController({
      state: "done",
      result: { success: true, text: "hello", id: 7 },
    });
    // jsdom has no clipboard; stub it so the copy path succeeds
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    render(<FileImport transcription={ctrl} onCopied={onCopied} />);
    // TranscriptionResult's copy control carries title="复制文本"
    const copyButton = screen.getByTitle("复制文本").closest("button");
    expect(copyButton).not.toBeNull();
    (copyButton as HTMLButtonElement).click();
    await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
  });

  it("still drives its own hook when no controller is injected", () => {
    render(<FileImport />);
    expect(screen.getByText(/拖拽|选择/)).toBeInTheDocument();
  });
});
