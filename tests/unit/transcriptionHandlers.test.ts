// [20260724_TDD_TranscriptionHandlers] TDD tests for transcriptionHandlers.ts
// Tests verify channel registration completeness + key handler behaviors.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron — dialog.showSaveDialog for EXPORT, dialog.showMessageBox
vi.mock("electron", () => ({
  dialog: {
    showMessageBox: vi.fn(),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
}));

// Mock exportFormatters — must export getFormatInfo + formatters
vi.mock("../../src/helpers/exportFormatters", () => ({
  formatTranscription: vi.fn(),
  formatTranscriptions: vi.fn(),
  getFormatInfo: vi.fn(() => ({
    ext: ".txt",
    label: "Text",
    formatter: vi.fn(async () => "formatted"),
  })),
}));

vi.mock("../../src/helpers/aiPrompts", () => ({
  buildPrompt: vi.fn(() => ({ system: "sys", user: "user" })),
  DEFAULT_PIPELINE: ["optimize"],
}));

vi.mock("../../src/helpers/audioPathValidator", () => ({
  validateAudioPath: vi.fn(() => ({
    valid: true,
    ext: ".wav",
    resolved: "/fake/path.wav",
  })),
}));

describe("transcriptionHandlers", () => {
  let registeredHandlers: Map<string, (...args: unknown[]) => unknown>;
  let mockIpcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => void;
  };
  let mockManagers: Record<string, unknown>;
  let mockDb: Record<string, ReturnType<typeof vi.fn>>;
  let mockFunasr: Record<string, ReturnType<typeof vi.fn>>;
  let mockProcessTextWithAI: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers = new Map();
    mockIpcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    };

    mockDb = {
      saveTranscription: vi.fn((_data) => ({
        lastInsertRowid: 42,
        changes: 1,
      })),
      getTranscriptionById: vi.fn(() => ({
        id: 42,
        text: "test text",
        segments: "[]",
      })),
      getTranscriptions: vi.fn(() => []),
      deleteTranscription: vi.fn(() => ({ changes: 1 })),
      searchTranscriptions: vi.fn(() => []),
      getTranscriptionStats: vi.fn(() => ({ total: 5 })),
      clearAllTranscriptions: vi.fn(),
    };

    mockFunasr = {
      transcribeAudio: vi.fn(async () => ({ success: true, text: "转录结果" })),
      transcribeFile: vi.fn(async () => ({
        success: true,
        text: "文件转录",
        raw_text: "raw",
        segments: [],
      })),
      diarizeAudio: vi.fn(async () => ({ success: true, segments: [] })),
    };

    mockProcessTextWithAI = vi.fn(async () => ({
      success: true,
      text: "优化后",
    }));

    mockManagers = {
      databaseManager: mockDb,
      funasrManager: mockFunasr,
      processTextWithAI: mockProcessTextWithAI,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
  });

  async function setup() {
    const { register } =
      await import("../../src/helpers/ipc/transcriptionHandlers");
    register(mockIpcMain as never, mockManagers as never);
    return await import("../../src/helpers/ipc-contracts");
  }

  describe("register() — channel registration completeness", () => {
    it("registers all 16 transcription channels", async () => {
      const C = await setup();

      const expectedChannels = [
        C.TRANSCRIPTION.AUDIO,
        C.TRANSCRIPTION.IMPORT_FILE,
        C.TRANSCRIPTION.VALIDATE_FILE,
        C.TRANSCRIPTION.TRANSCRIBE_FILE,
        C.TRANSCRIPTION.CANCEL,
        C.TRANSCRIPTION.SAVE,
        C.TRANSCRIPTION.GET,
        C.TRANSCRIPTION.GET_ALL,
        C.TRANSCRIPTION.DELETE,
        C.TRANSCRIPTION.SEARCH,
        C.TRANSCRIPTION.STATS,
        C.TRANSCRIPTION.CLEAR,
        C.TRANSCRIPTION.EXPORT,
        C.TRANSCRIPTION.EXPORT_ALL,
        C.TRANSCRIPTION.AI_REVIEW,
        C.TRANSCRIPTION.DIARIZE,
      ];

      for (const channel of expectedChannels) {
        expect(registeredHandlers.has(channel)).toBe(true);
      }
      expect(registeredHandlers.size).toBeGreaterThanOrEqual(16);
    });

    it("does not register duplicate channels", async () => {
      await setup();
      const channels = Array.from(registeredHandlers.keys());
      const unique = new Set(channels);
      expect(channels.length).toBe(unique.size);
    });
  });

  describe("TRANSCRIPTION.SAVE handler", () => {
    it("saves transcription and returns lastInsertRowid", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.SAVE)!;

      const result = await handler({}, { text: "hello" });
      expect(result.success).toBe(true);
      expect(result.lastInsertRowid).toBe(42);
      expect(mockDb.saveTranscription).toHaveBeenCalledWith({ text: "hello" });
    });

    it("returns error on exception", async () => {
      mockDb.saveTranscription.mockImplementationOnce(() => {
        throw new Error("DB locked");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.SAVE)!;

      const result = await handler({}, { text: "hello" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("DB locked");
    });
  });

  describe("TRANSCRIPTION.VALIDATE_FILE handler", () => {
    it("rejects unsupported file extensions", async () => {
      const { validateAudioPath } =
        await import("../../src/helpers/audioPathValidator");
      vi.mocked(validateAudioPath).mockReturnValueOnce({
        valid: false,
        error: "不支持的音频格式",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.VALIDATE_FILE)!;

      const result = await handler({}, "/fake/file.xyz");
      expect(result.success).toBe(false);
    });

    it("rejects non-existent file", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.VALIDATE_FILE)!;

      // validateAudioPath mock returns valid:true, but fs.statSync will fail
      // on /fake/path.wav since the file doesn't exist
      const result = await handler({}, "/fake/path.wav");
      expect(result.success).toBe(false);
      expect(result.error).toContain("不存在");
    });
  });

  describe("TRANSCRIPTION.EXPORT handler", () => {
    it("returns success false when save dialog is canceled", async () => {
      const { dialog } = await import("electron");
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: true,
        filePath: "",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT)!;

      const result = await handler({}, 42, "txt");
      expect(result.success).toBe(false);
      expect(result.canceled).toBe(true);
    });

    it("returns error when transcription not found", async () => {
      mockDb.getTranscriptionById.mockReturnValueOnce(null);
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT)!;

      const result = await handler({}, 999, "txt");
      expect(result.success).toBe(false);
    });
  });

  describe("TRANSCRIPTION.AI_REVIEW handler", () => {
    it("calls processTextWithAI for optimization", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW)!;

      const result = await handler({}, 42, "optimize");
      expect(mockProcessTextWithAI).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("returns error when transcription not found", async () => {
      mockDb.getTranscriptionById.mockReturnValueOnce(null);
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW)!;

      const result = await handler({}, 999, "optimize");
      expect(result.success).toBe(false);
    });

    it("returns clear error when processTextWithAI is not available", async () => {
      // [20260725_Fix_NonNullAssertion] RED: when processTextWithAI is missing,
      // should return clear error, not TypeError caught as generic message
      mockManagers.processTextWithAI = undefined;
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW)!;

      const result = await handler({}, 42, "optimize");
      expect(result.success).toBe(false);
      expect(result.error).toContain("不可用");
    });
  });

  describe("TRANSCRIPTION.GET handler", () => {
    it("returns transcription by id", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.GET)!;

      const result = await handler({}, 42);
      expect(result).toEqual({ id: 42, text: "test text", segments: "[]" });
    });
  });

  describe("TRANSCRIPTION.DELETE handler", () => {
    it("deletes transcription via databaseManager", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DELETE)!;

      await handler({}, 42);
      expect(mockDb.deleteTranscription).toHaveBeenCalledWith(42);
    });
  });

  describe("TRANSCRIPTION.GET_ALL handler", () => {
    it("returns transcriptions array", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.GET_ALL)!;

      const result = await handler({}, 10, 0);
      expect(Array.isArray(result)).toBe(true);
      expect(mockDb.getTranscriptions).toHaveBeenCalledWith(10, 0);
    });
  });

  describe("TRANSCRIPTION.STATS handler", () => {
    it("returns stats from databaseManager", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.STATS)!;

      const result = await handler({});
      expect(result).toEqual({ total: 5 });
    });
  });
});
