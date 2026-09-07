// [20260724_TDD_TranscriptionHandlers] TDD tests for transcriptionHandlers.ts
// Tests verify channel registration completeness + key handler behaviors.
//
// [20260726_TypeGate_TranscriptionHandlers] Re-enabled in the tsconfig.test.json
// typecheck gate. Two strict-mode patterns surface here:
//  (A) TS18046 — handlers are typed (...args: unknown[]) => unknown, so each
//      `const result = await handler(...)` reads fields on `unknown`. Fix:
//      cast at the assignment site to the structural shape the assertions
//      read (HandlerResult below covers success/error/canceled/lastInsertRowid).
//  (B) TS18048 — mockDb is Record<string, ReturnType<typeof vi.fn>>, so indexed
//      access is possibly-undefined. The mock is fully populated in beforeEach,
//      so `.mockImplementationOnce`/`.mockReturnValueOnce` sites take a
//      non-null assertion. No `any`.
// Template reference: tests/unit/modelHandlers.test.ts (MockHandler + casts).
// [20260726_TypeGate_TranscriptionHandlers] END
import { describe, it, expect, vi, beforeEach } from "vitest";
// [20260906_Spec259_T3] fs import resolves to the partial mock declared
// below (real fs with statSync routed through a controllable spy).
import fs from "fs";

// [20260906_Spec259_T3] Hoisted controllable mocks referenced by the hoisted
// vi.mock factories below: statSyncSpy lets the size-limit arm be exercised
// without materializing a 500MB file; cleanTextMock lets the cleaner fail-
// safes (empty-clean fallback, changed-text debug log, segment fallback) be
// exercised deterministically. Both default to identity/real behavior so the
// pre-existing tests in this file are unaffected.
const { statSyncSpy, cleanTextMock } = vi.hoisted(() => ({
  statSyncSpy: vi.fn(),
  cleanTextMock: vi.fn((text: string) => text),
}));

// [20260906_Spec259_T3] Partial fs mock: everything real except statSync,
// which is routed through the hoisted spy. The spy's base implementation
// (installed in the factory) delegates to the real statSync.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  statSyncSpy.mockImplementation(
    (...args: Parameters<typeof actual.statSync>) => actual.statSync(...args),
  );
  return {
    ...actual,
    default: { ...actual, statSync: statSyncSpy },
    statSync: statSyncSpy,
  };
});

// [20260906_Spec259_T3] Controllable cleaner: identity by default (the
// cleaner wiring contracts are pinned in transcriptionHandlers-clean.test.ts
// against the real cleaner); per-test overrides exercise the fail-safe arms.
vi.mock("../../src/helpers/transcriptCleaner", () => ({
  cleanTranscriptionText: (text: string) => cleanTextMock(text),
}));

// Mock electron — dialog.showSaveDialog for EXPORT, dialog.showMessageBox
// [20260906_Spec259_T3] showOpenDialog added for the IMPORT_FILE handler.
vi.mock("electron", () => ({
  dialog: {
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
}));

// Mock exportFormatters — must export getFormatInfo + formatters
// [20260906_Spec259_T3] formatDOCX added for the EXPORT_ALL docx arm.
vi.mock("../../src/helpers/exportFormatters", () => ({
  formatTranscription: vi.fn(),
  formatTranscriptions: vi.fn(),
  formatDOCX: vi.fn(async () => Buffer.from("docx-bytes")),
  getFormatInfo: vi.fn(() => ({
    ext: ".txt",
    label: "Text",
    formatter: vi.fn(async () => "formatted"),
  })),
}));

vi.mock("../../src/helpers/aiPrompts", () => ({
  buildPrompt: vi.fn(() => ({ system: "sys", user: "user" })),
  loadCustomTemplates: vi.fn(() => []),
}));

vi.mock("../../src/helpers/audioPathValidator", () => ({
  validateAudioPath: vi.fn(() => ({
    valid: true,
    ext: ".wav",
    resolved: "/fake/path.wav",
  })),
}));

// [20260726_TypeGate_TranscriptionHandlers] Structural shape for handler
// return values read in assertions below. Handlers are typed as returning
// `unknown`; this cast bridges to the fields the tests inspect without `any`.
interface HandlerResult {
  success: boolean;
  error?: string;
  canceled?: boolean;
  lastInsertRowid?: number;
}

describe("transcriptionHandlers", () => {
  let registeredHandlers: Map<string, (...args: unknown[]) => unknown>;
  let mockIpcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => void;
  };
  let mockManagers: Record<string, unknown>;
  let mockDb: Record<string, ReturnType<typeof vi.fn>>;
  let mockFunasr: Record<string, ReturnType<typeof vi.fn>>;
  let mockProcessTextWithAI: ReturnType<typeof vi.fn>;
  // [20260906_Spec259_T3] Shared logger handle so behavioral tests can
  // assert logger.warn / logger.error / logger.debug calls.
  let logger: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers = new Map();
    // [20260906_Spec259_T3] Cleaner mock back to identity before each test;
    // per-test overrides (mockReturnValueOnce etc.) then layer on top.
    cleanTextMock.mockReset();
    cleanTextMock.mockImplementation((text: string) => text);
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
      // [20260906_Spec259_T3] getSetting(null) keeps hotword injection
      // deterministic (no hotword) for the behavioral tests below.
      getSetting: vi.fn(() => null),
      getTranscriptionById: vi.fn(() => ({
        id: 42,
        text: "test text",
        segments: "[]",
      })),
      getTranscriptions: vi.fn(() => []),
      deleteTranscription: vi.fn(() => ({ changes: 1 })),
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
      // [20260906_Spec259_T3] cancelTranscription added for CANCEL coverage.
      cancelTranscription: vi.fn(async () => ({ canceled: true })),
      diarizeAudio: vi.fn(async () => ({ success: true, segments: [] })),
    };

    mockProcessTextWithAI = vi.fn(async () => ({
      success: true,
      text: "优化后",
    }));

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockManagers = {
      databaseManager: mockDb,
      funasrManager: mockFunasr,
      processTextWithAI: mockProcessTextWithAI,
      logger,
    };
  });

  async function setup() {
    const { register } =
      await import("../../src/helpers/ipc/transcriptionHandlers");
    register(mockIpcMain as never, mockManagers as never);
    return await import("../../src/helpers/ipc-contracts");
  }

  describe("register() — channel registration completeness", () => {
    it("registers all 13 transcription channels", async () => {
      const C = await setup();

      const expectedChannels = [
        C.TRANSCRIPTION.AUDIO,
        C.TRANSCRIPTION.IMPORT_FILE,
        C.TRANSCRIPTION.VALIDATE_FILE,
        C.TRANSCRIPTION.TRANSCRIBE_FILE,
        C.TRANSCRIPTION.CANCEL,
        C.TRANSCRIPTION.SAVE,
        C.TRANSCRIPTION.GET_ALL,
        C.TRANSCRIPTION.DELETE,
        C.TRANSCRIPTION.CLEAR,
        C.TRANSCRIPTION.EXPORT,
        C.TRANSCRIPTION.EXPORT_ALL,
        C.TRANSCRIPTION.AI_REVIEW,
        C.TRANSCRIPTION.DIARIZE,
      ];

      for (const channel of expectedChannels) {
        expect(registeredHandlers.has(channel)).toBe(true);
      }
      expect(registeredHandlers.size).toBeGreaterThanOrEqual(13);
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

      // [20260726_TypeGate_TranscriptionHandlers] handler returns unknown;
      // cast to HandlerResult to read success/lastInsertRowid.
      const result = (await handler({}, { text: "hello" })) as HandlerResult;
      expect(result.success).toBe(true);
      expect(result.lastInsertRowid).toBe(42);
      expect(mockDb.saveTranscription).toHaveBeenCalledWith({ text: "hello" });
    });

    it("returns error on exception", async () => {
      // [20260726_TypeGate_TranscriptionHandlers] mockDb indexed access is
      // possibly-undefined; the method is populated in beforeEach so assert.
      mockDb.saveTranscription!.mockImplementationOnce(() => {
        throw new Error("DB locked");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.SAVE)!;

      const result = (await handler({}, { text: "hello" })) as HandlerResult;
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

      const result = (await handler({}, "/fake/file.xyz")) as HandlerResult;
      expect(result.success).toBe(false);
    });

    it("rejects non-existent file", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.VALIDATE_FILE)!;

      // validateAudioPath mock returns valid:true, but fs.statSync will fail
      // on /fake/path.wav since the file doesn't exist
      const result = (await handler({}, "/fake/path.wav")) as HandlerResult;
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

      const result = (await handler({}, 42, "txt")) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.canceled).toBe(true);
    });

    it("returns error when transcription not found", async () => {
      // [20260726_TypeGate_TranscriptionHandlers] mockDb indexed access —
      // non-null; method populated in beforeEach.
      mockDb.getTranscriptionById!.mockReturnValueOnce(null);
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT)!;

      const result = (await handler({}, 999, "txt")) as HandlerResult;
      expect(result.success).toBe(false);
    });
  });

  describe("TRANSCRIPTION.AI_REVIEW handler", () => {
    it("calls processTextWithAI for optimization", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW)!;

      const result = (await handler({}, 42, "optimize")) as HandlerResult;
      expect(mockProcessTextWithAI).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("returns error when transcription not found", async () => {
      // [20260726_TypeGate_TranscriptionHandlers] mockDb indexed access —
      // non-null; method populated in beforeEach.
      mockDb.getTranscriptionById!.mockReturnValueOnce(null);
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW)!;

      const result = (await handler({}, 999, "optimize")) as HandlerResult;
      expect(result.success).toBe(false);
    });

    it("returns clear error when processTextWithAI is not available", async () => {
      // [20260725_Fix_NonNullAssertion] RED: when processTextWithAI is missing,
      // should return clear error, not TypeError caught as generic message
      mockManagers.processTextWithAI = undefined;
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW)!;

      const result = (await handler({}, 42, "optimize")) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("不可用");
    });
  });

  describe("TRANSCRIPTION.DELETE handler", () => {
    it("deletes transcription via databaseManager", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DELETE)!;

      await handler({}, 42);
      expect(mockDb.deleteTranscription!).toHaveBeenCalledWith(42);
    });
  });

  describe("TRANSCRIPTION.CLEAR handler", () => {
    it("wraps the SQLite RunResult into the declared OperationResult shape", async () => {
      // [20260905_Fix_248_ReviewClearContract] databaseManager returns the
      // raw node:sqlite RunResult ({changes, lastInsertRowid}) — the renderer
      // and the declared contract (OperationResult in types/ipc.ts, preload
      // electronAPI.d.ts) expect { success }. Without the wrapper the UI
      // read success===undefined and showed "clear failed" after a
      // successful wipe (review BLOCKER, issue #248).
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.CLEAR)!;

      mockDb.clearAllTranscriptions!.mockReturnValue({
        changes: 5,
        lastInsertRowid: 1,
      });
      const result = (await handler({})) as Record<string, unknown>;

      expect(mockDb.clearAllTranscriptions!).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, changes: 5 });
    });

    it("returns success:false when the underlying clear throws", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.CLEAR)!;

      mockDb.clearAllTranscriptions!.mockImplementation(() => {
        throw new Error("db locked");
      });
      const result = (await handler({})) as Record<string, unknown>;

      expect(result).toMatchObject({ success: false });
      expect(String(result.error)).toContain("db locked");
    });
  });

  describe("TRANSCRIPTION.DELETE wraps RunResult (review NIT)", () => {
    it("returns the declared OperationResult shape", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DELETE)!;
      mockDb.deleteTranscription!.mockReturnValue({ changes: 3 });
      const result = (await handler({}, 42)) as Record<string, unknown>;
      expect(mockDb.deleteTranscription).toHaveBeenCalledWith(42);
      expect(result).toEqual({ success: true, changes: 3 });
    });

    it("returns success:false when the delete throws", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DELETE)!;
      mockDb.deleteTranscription!.mockImplementation(() => {
        throw new Error("locked");
      });
      const result = (await handler({}, 42)) as Record<string, unknown>;
      expect(result).toMatchObject({ success: false });
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

  // =====================================================================
  // [20260906_Spec259_T3] Behavioral coverage for the handler arms left
  // open by the registration-focused suites above (Spec #259 T3, #275).
  // External behavior only: invoke the captured handlers and assert the
  // returned shapes plus module-boundary calls (dialog / db / funasr).
  // =====================================================================

  describe("TRANSCRIPTION.CANCEL handler", () => {
    it("forwards to funasrManager.cancelTranscription", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.CANCEL)!;
      const result = (await handler({})) as Record<string, unknown>;
      expect(mockFunasr.cancelTranscription).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ canceled: true });
    });
  });

  describe("TRANSCRIPTION.IMPORT_FILE handler", () => {
    it("reports canceled when the dialog is canceled", async () => {
      const { dialog } = await import("electron");
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.IMPORT_FILE)!;
      const result = (await handler({})) as Record<string, unknown>;
      expect(result).toEqual({ success: false, canceled: true });
    });

    it("reports canceled when the dialog returns no paths", async () => {
      const { dialog } = await import("electron");
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: [],
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.IMPORT_FILE)!;
      const result = (await handler({})) as Record<string, unknown>;
      expect(result).toEqual({ success: false, canceled: true });
    });

    it("returns an error for an empty first path", async () => {
      const { dialog } = await import("electron");
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: [""],
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.IMPORT_FILE)!;
      const result = (await handler({})) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "未选择文件" });
    });

    it("stats the chosen file and returns its metadata", async () => {
      const { dialog } = await import("electron");
      const os = await import("os");
      const path = await import("path");
      const tmpPath = path.join(os.tmpdir(), `t3-import-${Date.now()}.wav`);
      fs.writeFileSync(tmpPath, "x");
      try {
        vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
          canceled: false,
          filePaths: [tmpPath],
        });
        const C = await setup();
        const handler = registeredHandlers.get(C.TRANSCRIPTION.IMPORT_FILE)!;
        const result = (await handler({})) as {
          success: boolean;
          filePath: string;
          fileName: string;
          fileSize: number;
          extension: string;
        };
        expect(result.success).toBe(true);
        expect(result.filePath).toBe(tmpPath);
        expect(result.fileName).toBe(path.basename(tmpPath));
        expect(result.fileSize).toBe(1);
        expect(result.extension).toBe(".wav");
      } finally {
        fs.unlinkSync(tmpPath);
      }
    });

    it("returns the error message when statSync throws", async () => {
      const { dialog } = await import("electron");
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ["/no/such/file.wav"],
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.IMPORT_FILE)!;
      const result = (await handler({})) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain("ENOENT");
    });
  });

  describe("TRANSCRIPTION.VALIDATE_FILE handler (size arm)", () => {
    it("rejects files above the 500MB limit", async () => {
      statSyncSpy.mockReturnValueOnce({ size: 501 * 1024 * 1024 });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.VALIDATE_FILE)!;
      const result = (await handler({}, "/fake/big.wav")) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ success: false, error: "文件超过500MB限制" });
    });

    it("returns metadata for a valid in-range file", async () => {
      const os = await import("os");
      const path = await import("path");
      const tmpPath = path.join(os.tmpdir(), `t3-valid-${Date.now()}.wav`);
      fs.writeFileSync(tmpPath, "x");
      try {
        const C = await setup();
        const handler = registeredHandlers.get(C.TRANSCRIPTION.VALIDATE_FILE)!;
        const result = (await handler({}, tmpPath)) as {
          success: boolean;
          fileName: string;
          fileSize: number;
          extension: string;
        };
        expect(result.success).toBe(true);
        expect(result.fileName).toBe(path.basename(tmpPath));
        expect(result.fileSize).toBe(1);
        expect(result.extension).toBe(".wav");
      } finally {
        fs.unlinkSync(tmpPath);
      }
    });
  });

  describe("TRANSCRIPTION.AUDIO — hotword boundary + failure normalization", () => {
    it("drops a caller hotword that sanitizes to empty", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      // Control chars are stripped by the sanitizer → "" → field dropped.
      await handler({}, new ArrayBuffer(0), { hotword: "\u0007" });
      const opts = mockFunasr.transcribeAudio!.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(opts).not.toHaveProperty("hotword");
      // The explicit-hotword branch short-circuits the stored-list read.
      expect(mockDb.getSetting).not.toHaveBeenCalled();
    });

    it("sanitizes a caller hotword before injecting it", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      await handler({}, new ArrayBuffer(0), { hotword: "  张三  " });
      const opts = mockFunasr.transcribeAudio!.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(opts.hotword).toBe("张三");
    });

    it("keeps the caller options identity when the hotword is already clean", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      const options = { hotword: "abc" };
      await handler({}, new ArrayBuffer(0), options);
      expect(mockFunasr.transcribeAudio!.mock.calls[0]![1]).toBe(options);
    });

    it("normalizes a non-Error rejection into {success:false, error}", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      mockFunasr.transcribeAudio!.mockRejectedValueOnce("boom-string");
      const result = (await handler({}, new ArrayBuffer(0))) as {
        success: boolean;
        error?: string;
      };
      expect(result.success).toBe(false);
      expect(result.error).toBe("boom-string");
    });

    it("does not inject a hotword when the stored list is empty", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      await handler({}, new ArrayBuffer(0));
      const opts = mockFunasr.transcribeAudio!.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(opts).not.toHaveProperty("hotword");
      expect(mockDb.getSetting).toHaveBeenCalledWith("hotwords");
    });
  });

  describe("applyTranscriptionCleaning fail-safes", () => {
    it("falls back to the original text when the cleaner returns empty", async () => {
      cleanTextMock.mockReturnValueOnce("");
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      mockFunasr.transcribeAudio!.mockResolvedValueOnce({
        success: true,
        text: "原文",
      });
      const result = (await handler({}, new ArrayBuffer(0))) as {
        text: string;
        original_text: string;
      };
      expect(result.text).toBe("原文");
      expect(result.original_text).toBe("原文");
      expect(logger.warn).toHaveBeenCalledWith(
        "清洗产生空文本，回退原文（清洗器规则回归信号）",
        expect.objectContaining({ original: "原文" }),
      );
    });

    it("debug-logs when cleaning changes the text", async () => {
      cleanTextMock.mockReturnValueOnce("清洗后");
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      mockFunasr.transcribeAudio!.mockResolvedValueOnce({
        success: true,
        text: "原文",
      });
      const result = (await handler({}, new ArrayBuffer(0))) as {
        text: string;
      };
      expect(result.text).toBe("清洗后");
      expect(logger.debug).toHaveBeenCalledWith(
        "转录文本清洗",
        expect.objectContaining({ before: "原文", after: "清洗后" }),
      );
    });

    it("falls back to the segment text when the cleaner empties it", async () => {
      cleanTextMock.mockReset();
      cleanTextMock.mockImplementation((text: string) =>
        text === "段落" ? "" : text,
      );
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      mockFunasr.transcribeAudio!.mockResolvedValueOnce({
        success: true,
        text: "正文",
        segments: [{ start_ms: 0, end_ms: 1, text: "段落" }],
      });
      const result = (await handler({}, new ArrayBuffer(0))) as {
        segments: Array<{ text: string }>;
      };
      expect(result.segments[0]!.text).toBe("段落");
      expect(cleanTextMock).toHaveBeenCalledWith("段落");
    });

    it("falls back to the raw_text when the cleaner empties it", async () => {
      // Call order: text first (identity), then raw_text (emptied).
      cleanTextMock.mockReturnValueOnce("正文").mockReturnValueOnce("");
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      mockFunasr.transcribeAudio!.mockResolvedValueOnce({
        success: true,
        text: "正文",
        raw_text: "原始",
      });
      const result = (await handler({}, new ArrayBuffer(0))) as {
        text: string;
        raw_text: string;
      };
      expect(result.text).toBe("正文");
      expect(result.raw_text).toBe("原始");
    });

    it("leaves raw_text undefined when the result has none", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
      mockFunasr.transcribeAudio!.mockResolvedValueOnce({
        success: true,
        text: "正文",
      });
      const result = (await handler({}, new ArrayBuffer(0))) as {
        raw_text?: string;
      };
      expect(result.raw_text).toBeUndefined();
    });
  });

  describe("TRANSCRIPTION.TRANSCRIBE_FILE handler", () => {
    it("rejects an invalid audio path before touching funasr", async () => {
      const { validateAudioPath } =
        await import("../../src/helpers/audioPathValidator");
      vi.mocked(validateAudioPath).mockReturnValueOnce({
        valid: false,
        error: "非法路径",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.TRANSCRIBE_FILE)!;
      const result = (await handler({}, "/bad/path.xyz")) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ success: false, error: "非法路径" });
      expect(mockFunasr.transcribeFile).not.toHaveBeenCalled();
    });

    it("forwards transcription progress through event.sender.send", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.TRANSCRIBE_FILE)!;
      const send = vi.fn();
      await handler({ sender: { send } }, "/fake/path.wav");
      const opts = mockFunasr.transcribeFile!.mock.calls[0]![1] as {
        onProgress: (progress: unknown) => void;
      };
      opts.onProgress({ percent: 50 });
      expect(send).toHaveBeenCalledWith(C.EVENTS.FILE_TRANSCRIPTION_PROGRESS, {
        percent: 50,
      });
    });

    it("stamps result.id from the DB insert rowid", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.TRANSCRIBE_FILE)!;
      const result = (await handler({}, "/fake/path.wav")) as {
        success: boolean;
        id?: number;
      };
      expect(result.success).toBe(true);
      expect(result.id).toBe(42);
      expect(mockDb.saveTranscription).toHaveBeenCalledWith(
        expect.objectContaining({ source_type: "file" }),
      );
    });
  });

  describe("TRANSCRIPTION.DIARIZE handler", () => {
    it("returns an error when the record has no segments field", async () => {
      mockDb.getTranscriptionById!.mockReturnValueOnce({ id: 1, text: "x" });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DIARIZE)!;
      const result = (await handler({}, 1)) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "无分段数据" });
    });

    it("treats unparseable segments JSON as no data", async () => {
      mockDb.getTranscriptionById!.mockReturnValueOnce({
        id: 1,
        segments: "{not json",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DIARIZE)!;
      const result = (await handler({}, 1)) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "无分段数据" });
    });

    it("returns an error for an empty segments array", async () => {
      mockDb.getTranscriptionById!.mockReturnValueOnce({
        id: 1,
        segments: "[]",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DIARIZE)!;
      const result = (await handler({}, 1)) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "无分段数据" });
    });

    it("returns an error when neither source_file_path nor audio_path exists", async () => {
      mockDb.getTranscriptionById!.mockReturnValueOnce({
        id: 1,
        segments: '[{"start_ms":0,"end_ms":1,"text":"x"}]',
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DIARIZE)!;
      const result = (await handler({}, 1)) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "音频文件不存在" });
    });

    it("prefers source_file_path for the diarize call", async () => {
      const segments = [{ start_ms: 0, end_ms: 1, text: "x" }];
      mockDb.getTranscriptionById!.mockReturnValueOnce({
        id: 1,
        segments: JSON.stringify(segments),
        source_file_path: "/a.wav",
        audio_path: "/b.wav",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DIARIZE)!;
      const result = (await handler({}, 1)) as Record<string, unknown>;
      expect(mockFunasr.diarizeAudio).toHaveBeenCalledWith("/a.wav", segments);
      expect(result).toEqual({ success: true, segments: [] });
    });

    it("falls back to audio_path when source_file_path is absent", async () => {
      const segments = [{ start_ms: 0, end_ms: 1, text: "x" }];
      mockDb.getTranscriptionById!.mockReturnValueOnce({
        id: 1,
        segments: JSON.stringify(segments),
        audio_path: "/b.wav",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DIARIZE)!;
      await handler({}, 1);
      expect(mockFunasr.diarizeAudio).toHaveBeenCalledWith("/b.wav", segments);
    });

    it("returns a failure shape when the DB lookup throws", async () => {
      mockDb.getTranscriptionById!.mockImplementationOnce(() => {
        throw new Error("db exploded");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DIARIZE)!;
      const result = (await handler({}, 1)) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "db exploded" });
      expect(logger.error).toHaveBeenCalledWith(
        "说话人分离失败:",
        expect.any(Error),
      );
    });
  });

  describe("TRANSCRIPTION.EXPORT handler", () => {
    it("rejects an unsupported format", async () => {
      const { getFormatInfo } =
        await import("../../src/helpers/exportFormatters");
      vi.mocked(getFormatInfo).mockReturnValueOnce(null);
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT)!;
      const result = (await handler({}, 42, "bogus")) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ success: false, error: "不支持的格式: bogus" });
    });

    it("writes string content with utf-8 and returns the path", async () => {
      const os = await import("os");
      const path = await import("path");
      const outfile = path.join(os.tmpdir(), `t3-export-${Date.now()}.txt`);
      const { dialog } = await import("electron");
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: false,
        filePath: outfile,
      });
      try {
        const C = await setup();
        const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT)!;
        const result = (await handler({}, 42, "txt")) as Record<
          string,
          unknown
        >;
        expect(result).toEqual({ success: true, path: outfile });
        expect(fs.readFileSync(outfile, "utf-8")).toBe("formatted");
      } finally {
        fs.unlinkSync(outfile);
      }
    });

    it("writes Buffer content without an encoding argument", async () => {
      const os = await import("os");
      const path = await import("path");
      const outfile = path.join(os.tmpdir(), `t3-export-${Date.now()}.docx`);
      const { dialog } = await import("electron");
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: false,
        filePath: outfile,
      });
      const { getFormatInfo } =
        await import("../../src/helpers/exportFormatters");
      vi.mocked(getFormatInfo).mockReturnValueOnce({
        ext: ".docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        formatter: async () => Buffer.from("docx-zip"),
      });
      try {
        const C = await setup();
        const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT)!;
        const result = (await handler({}, 42, "docx")) as Record<
          string,
          unknown
        >;
        expect(result).toEqual({ success: true, path: outfile });
        expect(fs.readFileSync(outfile).toString()).toBe("docx-zip");
      } finally {
        fs.unlinkSync(outfile);
      }
    });

    it("returns the formatter error when formatting throws", async () => {
      const { getFormatInfo } =
        await import("../../src/helpers/exportFormatters");
      vi.mocked(getFormatInfo).mockReturnValueOnce({
        ext: ".txt",
        mime: "text/plain",
        formatter: async () => {
          throw new Error("fmt blew up");
        },
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT)!;
      const result = (await handler({}, 42, "txt")) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "fmt blew up" });
      expect(logger.error).toHaveBeenCalledWith(
        "导出转录失败:",
        expect.any(Error),
      );
    });

    it("handles a record without segments before the dialog", async () => {
      mockDb.getTranscriptionById!.mockReturnValueOnce({ id: 7, text: "t" });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT)!;
      const result = (await handler({}, 7, "txt")) as Record<string, unknown>;
      // Default dialog mock resolves canceled — proves the no-segments row
      // path reached the dialog.
      expect(result).toEqual({ success: false, canceled: true });
    });
  });

  describe("TRANSCRIPTION.AI_REVIEW handler", () => {
    it("falls back to the professional template and empty text", async () => {
      mockDb.getTranscriptionById!.mockReturnValueOnce({ id: 2 });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW)!;
      const result = (await handler({}, 2, "")) as {
        success: boolean;
        reviewText?: string;
      };
      expect(mockProcessTextWithAI.mock.calls[0]![0]).toBe("");
      expect(mockProcessTextWithAI.mock.calls[0]![1]).toBe("professional");
      expect(result).toEqual({ success: true, reviewText: "优化后" });
    });

    it("passes a failed AI result through unchanged", async () => {
      mockProcessTextWithAI.mockResolvedValueOnce({
        success: false,
        error: "配额不足",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW)!;
      const result = (await handler({}, 42, "optimize")) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ success: false, error: "配额不足" });
    });

    it("returns a failure shape when the AI call throws", async () => {
      mockProcessTextWithAI.mockRejectedValueOnce(new Error("net down"));
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW)!;
      const result = (await handler({}, 42, "optimize")) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ success: false, error: "net down" });
      expect(logger.error).toHaveBeenCalledWith(
        "AI创作稿生成失败:",
        expect.any(Error),
      );
    });
  });

  describe("TRANSCRIPTION.DELETE/CLEAR — missing changes normalizes to 0", () => {
    it("DELETE reports changes:0 when the RunResult has none", async () => {
      mockDb.deleteTranscription!.mockReturnValueOnce({});
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.DELETE)!;
      const result = (await handler({}, 42)) as Record<string, unknown>;
      expect(result).toEqual({ success: true, changes: 0 });
    });

    it("CLEAR reports changes:0 when the RunResult has none", async () => {
      mockDb.clearAllTranscriptions!.mockReturnValueOnce({});
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.CLEAR)!;
      const result = (await handler({})) as Record<string, unknown>;
      expect(result).toEqual({ success: true, changes: 0 });
    });
  });

  describe("TRANSCRIPTION.EXPORT_ALL handler", () => {
    it("returns an error when there are no transcriptions", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
      const result = (await handler({}, "txt")) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "没有转录记录可导出" });
    });

    it("returns an error when the row list is null", async () => {
      mockDb.getTranscriptions!.mockReturnValueOnce(null);
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
      const result = (await handler({}, "txt")) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "没有转录记录可导出" });
    });

    it("rejects an unsupported format", async () => {
      mockDb.getTranscriptions!.mockReturnValueOnce([{ id: 1, text: "a" }]);
      const { getFormatInfo } =
        await import("../../src/helpers/exportFormatters");
      vi.mocked(getFormatInfo).mockReturnValueOnce(null);
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
      const result = (await handler({}, "bogus")) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "不支持的格式: bogus" });
    });

    it("reports canceled when the save dialog is canceled", async () => {
      mockDb.getTranscriptions!.mockReturnValueOnce([{ id: 1, text: "a" }]);
      const { dialog } = await import("electron");
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: true,
        filePath: "",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
      const result = (await handler({}, "txt")) as Record<string, unknown>;
      expect(result).toEqual({ success: false, canceled: true });
    });

    it("reports canceled when the dialog returns no file path", async () => {
      mockDb.getTranscriptions!.mockReturnValueOnce([{ id: 1, text: "a" }]);
      const { dialog } = await import("electron");
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: false,
        // Falsy path exercises the !result.filePath guard arm.
        filePath: "",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
      const result = (await handler({}, "txt")) as Record<string, unknown>;
      expect(result).toEqual({ success: false, canceled: true });
    });

    it("defaults the empty format to txt", async () => {
      mockDb.getTranscriptions!.mockReturnValueOnce([{ id: 1, text: "a" }]);
      const { dialog } = await import("electron");
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: true,
        filePath: "",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
      await handler({}, "");
      expect(
        (await import("../../src/helpers/exportFormatters")).getFormatInfo,
      ).toHaveBeenCalledWith("txt");
    });

    it("falls back to the format string when the info has no label", async () => {
      mockDb.getTranscriptions!.mockReturnValueOnce([{ id: 1, text: "a" }]);
      const { getFormatInfo } =
        await import("../../src/helpers/exportFormatters");
      vi.mocked(getFormatInfo).mockReturnValueOnce({
        ext: ".md",
        mime: "text/markdown",
        formatter: () => "md-content",
      });
      const { dialog } = await import("electron");
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: true,
        filePath: "",
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
      await handler({}, "txt");
      expect(dialog.showSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [{ name: "txt", extensions: [".md"] }],
        }),
      );
    });

    it("parses per-row segments (valid, invalid, empty, non-string) and writes the join", async () => {
      mockDb.getTranscriptions!.mockReturnValueOnce([
        {
          id: 1,
          text: "a",
          segments: '[{"start_ms":0,"end_ms":1,"text":"x"}]',
        },
        { id: 2, text: "b", segments: "{bad" },
        { id: 3, text: "c", segments: "" },
        { id: 4, text: "d", segments: null },
      ]);
      const os = await import("os");
      const path = await import("path");
      const outfile = path.join(os.tmpdir(), `t3-export-all-${Date.now()}.txt`);
      const { dialog } = await import("electron");
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: false,
        filePath: outfile,
      });
      try {
        const C = await setup();
        const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
        const result = (await handler({}, "txt")) as Record<string, unknown>;
        expect(result).toEqual({ success: true, path: outfile });
        expect(fs.existsSync(outfile)).toBe(true);
      } finally {
        fs.unlinkSync(outfile);
      }
    });

    it("routes docx through formatDOCX and writes the Buffer", async () => {
      mockDb.getTranscriptions!.mockReturnValueOnce([{ id: 1, text: "a" }]);
      const os = await import("os");
      const path = await import("path");
      const outfile = path.join(
        os.tmpdir(),
        `t3-export-all-${Date.now()}.docx`,
      );
      const { dialog } = await import("electron");
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
        canceled: false,
        filePath: outfile,
      });
      try {
        const C = await setup();
        const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
        const result = (await handler({}, "docx")) as Record<string, unknown>;
        expect(result).toEqual({ success: true, path: outfile });
        expect(fs.readFileSync(outfile).toString()).toBe("docx-bytes");
      } finally {
        fs.unlinkSync(outfile);
      }
    });

    it("returns the error message when the DB read throws", async () => {
      mockDb.getTranscriptions!.mockImplementationOnce(() => {
        throw new Error("read failed");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL)!;
      const result = (await handler({}, "txt")) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "read failed" });
      expect(logger.error).toHaveBeenCalledWith(
        "导出转录失败:",
        expect.any(Error),
      );
    });
  });

  // [20260816_Refactor_DeadChannels] GET(single)/STATS handler describes
  // removed with their zero-caller channels.
});
