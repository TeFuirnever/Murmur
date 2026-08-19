// [20260820_T14_Hotwords] Ticket #183: main-process hotword injection at
// both transcription seams + empty-hotword retry. Contracts:
//  - hotwords are read from the settings store in the MAIN process and
//    injected into options (preload/IPC signature untouched)
//  - empty/invalid stored value → options passed through EXACTLY as
//    received (no hotword key — byte-identical to pre-T14 behavior)
//  - a transcription failure WITH an injected hotword retries ONCE with
//    no hotword; success on retry surfaces hotword_degraded=true
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

import os from "os";
import fs from "fs";
import path from "path";

describe("hotword injection", () => {
  let registeredHandlers: Map<string, (...args: unknown[]) => unknown>;
  let mockIpcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => void;
  };
  let mockDb: Record<string, ReturnType<typeof vi.fn>>;
  let mockFunasr: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers = new Map();
    mockIpcMain = {
      handle: (channel, handler) => {
        registeredHandlers.set(channel, handler);
      },
    };
    mockDb = {
      getSetting: vi.fn(async () => null),
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
        text: "结果",
        raw_text: "结果",
      })),
      transcribeFile: vi.fn(async () => ({
        success: true,
        text: "文件结果",
        raw_text: "文件结果",
        segments: [],
      })),
      diarizeAudio: vi.fn(async () => ({ success: true, segments: [] })),
    };
  });

  async function setup() {
    const { register } =
      await import("../../src/helpers/ipc/transcriptionHandlers");
    register(
      mockIpcMain as never,
      {
        databaseManager: mockDb,
        funasrManager: mockFunasr,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      } as never,
    );
    const C = await import("../../src/helpers/ipc-contracts");
    return C;
  }

  it("AUDIO: stored hotwords are sanitized and injected into options", async () => {
    const C = await setup();
    mockDb.getSetting!.mockResolvedValue("张晗玥\n\n刘翀\n\u0000垃圾\u007F");
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    await handler(null, new ArrayBuffer(0), { language: "zh" });
    expect(mockFunasr.transcribeAudio).toHaveBeenCalledWith(expect.anything(), {
      language: "zh",
      hotword: "张晗玥 刘翀 垃圾",
    });
  });

  it("AUDIO: no stored hotwords → options pass through untouched (no hotword key)", async () => {
    const C = await setup();
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    await handler(null, new ArrayBuffer(0), { language: "zh" });
    expect(mockFunasr.transcribeAudio).toHaveBeenCalledWith(expect.anything(), {
      language: "zh",
    });
  });

  it("AUDIO: caller-provided hotword is NOT clobbered by empty settings", async () => {
    const C = await setup();
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    await handler(null, new ArrayBuffer(0), { hotword: "显式传入" });
    expect(mockFunasr.transcribeAudio).toHaveBeenCalledWith(expect.anything(), {
      hotword: "显式传入",
    });
  });

  it("AUDIO: failure with injected hotword retries once without it; success surfaces hotword_degraded", async () => {
    const C = await setup();
    mockDb.getSetting!.mockResolvedValue("张晗玥");
    mockFunasr
      .transcribeAudio!.mockResolvedValueOnce({
        success: false,
        error: "识别失败",
      })
      .mockResolvedValueOnce({ success: true, text: "重试成功" });
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    const result = (await handler(null, new ArrayBuffer(0), {})) as {
      success: boolean;
      text: string;
      hotword_degraded?: boolean;
    };
    expect(mockFunasr.transcribeAudio).toHaveBeenCalledTimes(2);
    expect(mockFunasr.transcribeAudio).toHaveBeenLastCalledWith(
      expect.anything(),
      {},
    );
    expect(result.success).toBe(true);
    expect(result.text).toBe("重试成功");
    expect(result.hotword_degraded).toBe(true);
  });

  it("AUDIO: failure WITHOUT hotword does not retry", async () => {
    const C = await setup();
    mockFunasr.transcribeAudio!.mockResolvedValue({
      success: false,
      error: "识别失败",
    });
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    const result = (await handler(null, new ArrayBuffer(0), {})) as {
      success: boolean;
    };
    expect(mockFunasr.transcribeAudio).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
  });

  it("AUDIO: both attempts fail → original error, no hotword_degraded", async () => {
    const C = await setup();
    mockDb.getSetting!.mockResolvedValue("张晗玥");
    mockFunasr.transcribeAudio!.mockResolvedValue({
      success: false,
      error: "彻底失败",
    });
    const handler = registeredHandlers.get(C.TRANSCRIPTION.AUDIO)!;
    const result = (await handler(null, new ArrayBuffer(0), {})) as {
      success: boolean;
      error?: string;
      hotword_degraded?: boolean;
    };
    expect(mockFunasr.transcribeAudio).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.error).toBe("彻底失败");
    expect(result.hotword_degraded).toBeUndefined();
  });

  it("TRANSCRIBE_FILE: hotwords injected into file-path options too", async () => {
    const C = await setup();
    mockDb.getSetting!.mockResolvedValue("张晗玥 刘翀");
    const audioPath = path.join(os.tmpdir(), `t14-hw-${Date.now()}.wav`);
    fs.writeFileSync(audioPath, "x");
    try {
      const handler = registeredHandlers.get(C.TRANSCRIPTION.TRANSCRIBE_FILE)!;
      await handler(null, audioPath);
      expect(mockFunasr.transcribeFile).toHaveBeenCalledWith(
        audioPath,
        expect.objectContaining({ hotword: "张晗玥 刘翀" }),
      );
    } finally {
      fs.unlinkSync(audioPath);
    }
  });

  it("TRANSCRIBE_FILE: no stored hotwords → options shape unchanged", async () => {
    const C = await setup();
    const audioPath = path.join(os.tmpdir(), `t14-hw2-${Date.now()}.wav`);
    fs.writeFileSync(audioPath, "x");
    try {
      const handler = registeredHandlers.get(C.TRANSCRIPTION.TRANSCRIBE_FILE)!;
      await handler(null, audioPath);
      const call = mockFunasr.transcribeFile!.mock.calls[0]!;
      const options = call[1] as Record<string, unknown>;
      expect("hotword" in options).toBe(false);
      expect("onProgress" in options).toBe(true);
    } finally {
      fs.unlinkSync(audioPath);
    }
  });
});
