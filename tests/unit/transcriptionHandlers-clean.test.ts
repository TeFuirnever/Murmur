// [20260819_T10_CleanerWiring] Ticket #188 (spec #177 T10): wire the T9
// cleaner into the two transcription seams. Contracts under test:
//  - AUDIO + TRANSCRIBE_FILE return CLEANED text/raw_text/segments AND an
//    original_text field carrying the PRE-CLEAN text (DB recovery column)
//  - TRANSCRIBE_FILE persists text=cleaned, raw_text=PRE-CLEAN (the column
//    is null today — this fills it), processed_text=cleaned raw
//  - the generic SAVE channel passes user data through VERBATIM (a user
//    edit or AI output must never be re-cleaned)
//  - debug audit log emitted when cleaning changed anything
// RED first.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  dialog: {
    showMessageBox: vi.fn(),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
}));

vi.mock("../../src/helpers/exportFormatters", () => ({
  formatTranscription: vi.fn(),
  formatTranscriptions: vi.fn(),
  getFormatInfo: vi.fn(() => ({
    ext: ".txt",
    label: "TXT",
    mime: "text/plain",
  })),
}));

const DEGENERATE = "好的好的好的好的好的好的好的好的我们开始吧";
const CLEANED = "好的我们开始吧";

describe("transcriptionHandlers cleaner wiring", () => {
  let registeredHandlers: Map<string, (...args: unknown[]) => unknown>;
  let mockIpcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => void;
  };
  let mockDb: Record<string, ReturnType<typeof vi.fn>>;
  let mockFunasr: Record<string, ReturnType<typeof vi.fn>>;
  let logger: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers = new Map();
    mockIpcMain = {
      handle: (channel, handler) => {
        registeredHandlers.set(channel, handler);
      },
    };
    mockDb = {
      saveTranscription: vi.fn(() => ({
        lastInsertRowid: 42,
        changes: 1,
      })),
      getTranscriptionById: vi.fn(() => ({
        id: 42,
        text: "x",
        segments: "[]",
      })),
      getTranscriptions: vi.fn(() => []),
      deleteTranscription: vi.fn(() => ({ changes: 1 })),
      clearAllTranscriptions: vi.fn(),
    };
    mockFunasr = {
      transcribeAudio: vi.fn(async () => ({
        success: true,
        text: DEGENERATE,
        raw_text: DEGENERATE,
        confidence: 0.9,
      })),
      transcribeFile: vi.fn(async () => ({
        success: true,
        text: DEGENERATE,
        raw_text: DEGENERATE,
        segments: [
          {
            start_ms: 0,
            end_ms: 1000,
            text: "我我我我我我我我我我我我觉得可以",
          },
          { start_ms: 1000, end_ms: 2000, text: "正常内容不受影响" },
        ],
        duration: 2,
      })),
      diarizeAudio: vi.fn(async () => ({ success: true, segments: [] })),
    };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  });

  async function setup() {
    const { register } =
      await import("../../src/helpers/ipc/transcriptionHandlers");
    register(
      mockIpcMain as never,
      {
        databaseManager: mockDb,
        funasrManager: mockFunasr,
        logger,
      } as never,
    );
    const C = await import("../../src/helpers/ipc-contracts");
    return C;
  }

  it("AUDIO seam: returns cleaned text/raw_text plus original_text pre-clean", async () => {
    const C = await setup();
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    const result = (await handler(null, new ArrayBuffer(0))) as {
      text: string;
      raw_text: string;
      original_text: string;
    };
    expect(result.text).toBe(CLEANED);
    expect(result.raw_text).toBe(CLEANED);
    expect(result.original_text).toBe(DEGENERATE);
  });

  it("AUDIO seam: normal text passes through unchanged with original_text equal", async () => {
    const C = await setup();
    mockFunasr.transcribeAudio!.mockResolvedValueOnce({
      success: true,
      text: "对对对,是这个意思",
      raw_text: "对对对",
    });
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    const result = (await handler(null, new ArrayBuffer(0))) as {
      text: string;
      raw_text: string;
      original_text: string;
    };
    expect(result.text).toBe("对对对,是这个意思");
    expect(result.raw_text).toBe("对对对");
    expect(result.original_text).toBe("对对对,是这个意思");
  });

  it("cleaning action is debug-logged for auditability", async () => {
    const C = await setup();
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    await handler(null, new ArrayBuffer(0));
    expect(logger.debug).toHaveBeenCalledWith(
      "转录文本清洗",
      expect.objectContaining({ before: DEGENERATE, after: CLEANED }),
    );
  });

  it("TRANSCRIBE_FILE seam: cleans text+segments in response, DB gets pre-clean raw_text", async () => {
    const C = await setup();
    // tmpdir is an allowed root for audioPathValidator — a real (tiny)
    // file passes validation; content is irrelevant (funasr is mocked).
    const os = await import("os");
    const fs = await import("fs");
    const path = await import("path");
    const audioPath = path.join(os.tmpdir(), `t10-clean-${Date.now()}.wav`);
    fs.writeFileSync(audioPath, "x");
    try {
      const handler = registeredHandlers.get(C.TRANSCRIPTION.TRANSCRIBE_FILE)!;
      const result = (await handler(null, audioPath)) as {
        text: string;
        raw_text: string;
        original_text: string;
        segments: { text: string }[];
      };
      expect(result.text).toBe(CLEANED);
      expect(result.original_text).toBe(DEGENERATE);
      expect(result.segments[0]!.text).toBe("我我我觉得可以");
      expect(result.segments[1]!.text).toBe("正常内容不受影响");
      expect(mockDb.saveTranscription).toHaveBeenCalledWith(
        expect.objectContaining({
          text: CLEANED,
          raw_text: DEGENERATE,
          processed_text: CLEANED,
        }),
      );
    } finally {
      fs.unlinkSync(audioPath);
    }
  });

  it("SAVE channel passes data through VERBATIM (no second cleaning pass)", async () => {
    const C = await setup();
    const handler = registeredHandlers.get(C.TRANSCRIPTION.SAVE)!;
    const userEdited = {
      text: "用户手工编辑过的对对对对对对对对",
      raw_text: "原文",
    };
    const result = (await handler(null, userEdited)) as { success: boolean };
    expect(result.success).toBe(true);
    expect(mockDb.saveTranscription).toHaveBeenCalledWith(userEdited);
  });

  // [T10 review fixup] Low-risk branch coverage.
  it("failed transcription passes through untouched (no original_text)", async () => {
    const C = await setup();
    mockFunasr.transcribeAudio!.mockResolvedValueOnce({
      success: false,
      error: "识别失败",
    });
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    const result = (await handler(null, new ArrayBuffer(0))) as {
      success: boolean;
      error?: string;
      original_text?: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe("识别失败");
    expect(result.original_text).toBeUndefined();
  });

  it("AUDIO result without raw_text cleans text only", async () => {
    const C = await setup();
    mockFunasr.transcribeAudio!.mockResolvedValueOnce({
      success: true,
      text: DEGENERATE,
    });
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    const result = (await handler(null, new ArrayBuffer(0))) as {
      text: string;
      raw_text?: string;
      original_text: string;
    };
    expect(result.text).toBe(CLEANED);
    expect(result.raw_text).toBeUndefined();
    expect(result.original_text).toBe(DEGENERATE);
  });
});

// [20260819_T10_CleanerWiring] END
