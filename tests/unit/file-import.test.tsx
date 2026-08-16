// [20260729_Test_FileImport]
// Integration test for FileImport.tsx. FileImport composes FileDropZone,
// TranscriptionProgress, and TranscriptionResult and drives them through the
// useFileTranscription state machine (idle -> selected -> transcribing ->
// done/error). We mock window.electronAPI to control the state transitions and
// assert on user-visible behavior only (Testing Trophy: test behavior, not
// implementation).
// @vitest-environment jsdom
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FileImport from "../../src/components/FileImport";

// react-i18next / sonner are not used by FileImport's direct tree, but several
// child components (e.g. TranscriptionResult) may import them. Stub them so the
// rendered subtree never depends on i18n resource files or real toasts.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: "zh-CN", changeLanguage: () => undefined },
  }),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

// A controllable Electron bridge. Each test overrides the relevant resolvers
// to drive FileImport into the state under test. Fields not exercised by a
// given test are no-op mocks so the component never hits an unhandled promise.
interface MockApi {
  importAudioFile: ReturnType<typeof vi.fn>;
  validateAudioFile: ReturnType<typeof vi.fn>;
  transcribeFile: ReturnType<typeof vi.fn>;
  cancelFileTranscription: ReturnType<typeof vi.fn>;
  onFileTranscriptionProgress: ReturnType<typeof vi.fn>;
  getAIModes: ReturnType<typeof vi.fn>;
  diarizeAudio: ReturnType<typeof vi.fn>;
  copyText: ReturnType<typeof vi.fn>;
  aiReviewTranscription: ReturnType<typeof vi.fn>;
}

function makeElectronAPI(overrides: Partial<MockApi> = {}): MockApi {
  return {
    importAudioFile: vi.fn(),
    validateAudioFile: vi.fn(),
    transcribeFile: vi.fn(),
    cancelFileTranscription: vi.fn(),
    // onFileTranscriptionProgress must return an unsubscribe function.
    onFileTranscriptionProgress: vi.fn(() => () => undefined),
    getAIModes: vi.fn().mockResolvedValue([]),
    diarizeAudio: vi.fn(),
    copyText: vi.fn(),
    aiReviewTranscription: vi.fn(),
    ...overrides,
  };
}

function setElectronAPI(api: MockApi): void {
  (window as unknown as { electronAPI: MockApi }).electronAPI = api;
}

// Build a File backed by a real path, simulating Electron's augmented File
// (which exposes `.path`). jsdom's File lacks it, so define it explicitly.
function makeFileWithPath(name: string, path: string): File {
  const file = new File(["audio"], name, { type: "audio/wav" });
  Object.defineProperty(file, "path", {
    value: path,
    configurable: true,
    writable: false,
  });
  return file;
}

const VALID_SELECTION = {
  success: true,
  filePath: "/fake/audio.wav",
  fileName: "audio.wav",
  fileSize: 1024,
  extension: "wav",
};

describe("[20260729_Test_FileImport] FileImport", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { electronAPI?: MockApi }).electronAPI;
  });

  it("renders the drop zone and supported formats in the idle state", () => {
    setElectronAPI(makeElectronAPI());
    render(<FileImport />);

    // Drop zone present with its prompt and supported-formats blurb.
    expect(screen.getByTestId("file-drop-zone")).toBeInTheDocument();
    expect(
      screen.getByText("点击选择音频文件或拖拽到此处"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/支持 WAV、MP3、M4A、FLAC、OGG、WMA、AAC 格式/),
    ).toBeInTheDocument();

    // No transcribe action is available before a file is selected.
    expect(
      screen.queryByRole("button", { name: "开始转录" }),
    ).not.toBeInTheDocument();
  });

  it("clicking the drop zone selects a file and reveals the transcribe button", async () => {
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue(VALID_SELECTION),
    });
    setElectronAPI(api);
    const user = userEvent.setup();

    render(<FileImport />);
    await user.click(screen.getByTestId("file-drop-zone"));

    expect(api.importAudioFile).toHaveBeenCalledTimes(1);
    // Selected state shows the chosen file name and the start button.
    expect(await screen.findByText("audio.wav")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "开始转录" }),
    ).toBeInTheDocument();
  });

  it("drag-and-drop with a file path calls validateAudioFile and enters the selected state", async () => {
    const api = makeElectronAPI({
      validateAudioFile: vi.fn().mockResolvedValue({
        success: true,
        filePath: "/fake/drop.mp3",
        fileName: "drop.mp3",
        fileSize: 2048,
        extension: "mp3",
      }),
    });
    setElectronAPI(api);

    render(<FileImport />);
    const file = makeFileWithPath("drop.mp3", "/fake/drop.mp3");
    fireEvent.drop(screen.getByTestId("file-drop-zone"), {
      dataTransfer: { files: [file] },
    });

    expect(api.validateAudioFile).toHaveBeenCalledWith("/fake/drop.mp3");
    expect(api.importAudioFile).not.toHaveBeenCalled();
    expect(await screen.findByText("drop.mp3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "开始转录" }),
    ).toBeInTheDocument();
  });

  it("drag-and-drop without a file path falls back to importAudioFile", async () => {
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue({
        success: true,
        filePath: "/fake/browser.m4a",
        fileName: "browser.m4a",
        fileSize: 512,
        extension: "m4a",
      }),
    });
    setElectronAPI(api);

    render(<FileImport />);
    // A plain browser File has no .path property -> fallback path.
    const file = new File(["audio"], "browser.m4a", { type: "audio/m4a" });
    fireEvent.drop(screen.getByTestId("file-drop-zone"), {
      dataTransfer: { files: [file] },
    });

    expect(api.importAudioFile).toHaveBeenCalledTimes(1);
    expect(api.validateAudioFile).not.toHaveBeenCalled();
    expect(await screen.findByText("browser.m4a")).toBeInTheDocument();
  });

  it("shows an error when file selection fails (e.g. unsupported format)", async () => {
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue({
        success: false,
        error: "不支持的音频格式",
      }),
    });
    setElectronAPI(api);

    render(<FileImport />);
    fireEvent.click(screen.getByTestId("file-drop-zone"));

    expect(await screen.findByText("不支持的音频格式")).toBeInTheDocument();
    expect(screen.getByText("转录失败")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新选择文件" }),
    ).toBeInTheDocument();
  });

  it("the re-select button clears the error and returns to idle", async () => {
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue({
        success: false,
        error: "不支持的音频格式",
      }),
    });
    setElectronAPI(api);

    render(<FileImport />);
    fireEvent.click(screen.getByTestId("file-drop-zone"));
    await screen.findByText("不支持的音频格式");

    fireEvent.click(screen.getByRole("button", { name: "重新选择文件" }));

    await waitFor(() => {
      expect(screen.getByTestId("file-drop-zone")).toBeInTheDocument();
    });
    expect(screen.queryByText("不支持的音频格式")).not.toBeInTheDocument();
  });

  it("completes transcription, shows the result, and clears via the import-new-file button", async () => {
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue(VALID_SELECTION),
      transcribeFile: vi.fn().mockResolvedValue({
        success: true,
        text: "你好世界",
        id: 42,
        duration: 10,
      }),
    });
    setElectronAPI(api);

    render(<FileImport />);
    // Select a file.
    fireEvent.click(screen.getByTestId("file-drop-zone"));
    await screen.findByText("audio.wav");

    // Start transcription.
    fireEvent.click(screen.getByRole("button", { name: "开始转录" }));
    expect(api.transcribeFile).toHaveBeenCalledWith("/fake/audio.wav", {});

    // Done state: the transcribed text and the clear button appear.
    expect(await screen.findByText("你好世界")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "导入新文件" }),
    ).toBeInTheDocument();

    // Clear -> back to idle drop zone.
    fireEvent.click(screen.getByRole("button", { name: "导入新文件" }));
    await waitFor(() => {
      expect(screen.getByTestId("file-drop-zone")).toBeInTheDocument();
    });
    expect(screen.queryByText("你好世界")).not.toBeInTheDocument();
  });

  it("shows the error UI when transcription itself fails", async () => {
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue(VALID_SELECTION),
      transcribeFile: vi.fn().mockResolvedValue({
        success: false,
        error: "模型加载失败",
      }),
    });
    setElectronAPI(api);

    render(<FileImport />);
    fireEvent.click(screen.getByTestId("file-drop-zone"));
    await screen.findByText("audio.wav");

    fireEvent.click(screen.getByRole("button", { name: "开始转录" }));

    expect(await screen.findByText("模型加载失败")).toBeInTheDocument();
    expect(screen.getByText("转录失败")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新选择文件" }),
    ).toBeInTheDocument();
  });
});

// [20260816_Test_FileImportExpanded] Previously uncovered branches: the
// cancelled and transcribing views, the done-state copy path, and the
// aiReviewTranscription-driven AI optimize flow.
describe("[20260816_Test_FileImportExpanded] FileImport — remaining branches", () => {
  it("renders the cancelled banner after cancelFileTranscription succeeds", async () => {
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue(VALID_SELECTION),
      // Never resolves so the state holds at transcribing until cancel.
      transcribeFile: vi
        .fn()
        .mockImplementation(() => new Promise(() => undefined)),
      cancelFileTranscription: vi.fn().mockResolvedValue({ success: true }),
    });
    setElectronAPI(api);

    render(<FileImport />);
    fireEvent.click(screen.getByTestId("file-drop-zone"));
    await screen.findByText("audio.wav");
    fireEvent.click(screen.getByRole("button", { name: "开始转录" }));

    // Cancel from the progress view.
    const cancelBtn = await screen.findByRole("button", { name: /取消/ });
    fireEvent.click(cancelBtn);
    expect(await screen.findByText(/已取消/)).toBeInTheDocument();
  });

  it("renders the progress view with phase fields while transcribing", async () => {
    let progressCb: ((...args: unknown[]) => void) | undefined;
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue(VALID_SELECTION),
      transcribeFile: vi
        .fn()
        .mockImplementation(() => new Promise(() => undefined)),
      onFileTranscriptionProgress: vi.fn((cb) => {
        progressCb = cb as (...args: unknown[]) => void;
        return () => undefined;
      }),
    });
    setElectronAPI(api);

    render(<FileImport />);
    fireEvent.click(screen.getByTestId("file-drop-zone"));
    await screen.findByText("audio.wav");
    fireEvent.click(screen.getByRole("button", { name: "开始转录" }));

    // The hook registers a single-argument callback (data only).
    await screen.findByText(/正在处理|识别中/);
    act(() => {
      progressCb?.({ phase: "asr", message: "语音识别中" });
    });
    expect(await screen.findByText("语音识别中")).toBeInTheDocument();
  });

  it("routes the done-state copy through electronAPI.copyText", async () => {
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue(VALID_SELECTION),
      transcribeFile: vi.fn().mockResolvedValue({
        success: true,
        text: "复制内容",
        id: 9,
        duration: 2,
      }),
      copyText: vi.fn().mockResolvedValue(undefined),
    });
    setElectronAPI(api);

    render(<FileImport />);
    fireEvent.click(screen.getByTestId("file-drop-zone"));
    await screen.findByText("audio.wav");
    fireEvent.click(screen.getByRole("button", { name: "开始转录" }));
    expect(await screen.findByText("复制内容")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("复制文本"));
    await waitFor(() => {
      expect(api.copyText).toHaveBeenCalledWith("复制内容");
    });
  });

  it("runs AI review through aiReviewTranscription on optimize", async () => {
    const api = makeElectronAPI({
      importAudioFile: vi.fn().mockResolvedValue(VALID_SELECTION),
      transcribeFile: vi.fn().mockResolvedValue({
        success: true,
        text: "待审校",
        id: 42,
        duration: 3,
      }),
      getAIModes: vi
        .fn()
        .mockResolvedValue([
          { name: "optimize", label: "智能润色", description: "" },
        ]),
      aiReviewTranscription: vi.fn().mockResolvedValue({
        success: true,
        reviewText: "审校后的文本",
      }),
    });
    setElectronAPI(api);

    render(<FileImport />);
    fireEvent.click(screen.getByTestId("file-drop-zone"));
    await screen.findByText("audio.wav");
    fireEvent.click(screen.getByRole("button", { name: "开始转录" }));
    expect(await screen.findByText("待审校")).toBeInTheDocument();

    const apply = await screen.findByRole("button", { name: "应用 AI 处理" });
    await act(async () => {
      fireEvent.click(apply);
    });
    expect(api.aiReviewTranscription).toHaveBeenCalledWith(42);
    await waitFor(() => {
      expect(screen.getByText("审校后的文本")).toBeInTheDocument();
    });
  });
});
