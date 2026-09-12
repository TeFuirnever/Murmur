// [20260912_Refactor_261_TranscriptionService] Seam tests for the
// transcription-domain services extracted in ticket #261 (spec #258
// Phase 0). Deps are plain vi.fn() bags — no Electron import anywhere:
// the point of the seam is that transcribeFileService /
// diarizeTranscriptionService / checkEngineStatusService run headless.
// Behavior parity with the IPC handlers is locked by the unmodified
// tests/unit/transcriptionHandlers.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";

// [20260912_Refactor_261_TranscriptionService] The pure helpers are mocked
// for determinism (same pattern as transcriptionHandlers.test.ts): path
// validation is controlled per-test, the cleaner is identity. The hotword
// sanitizer is used FOR REAL — its trim/control-char rules are part of the
// injection contract under test.
vi.mock("../../src/helpers/audioPathValidator", () => ({
  validateAudioPath: vi.fn(() => ({
    valid: true,
    ext: ".wav",
    resolved: "/fake/path.wav",
  })),
}));

vi.mock("../../src/helpers/transcriptCleaner", () => ({
  cleanTranscriptionText: (text: string) => text,
}));

import { validateAudioPath } from "../../src/helpers/audioPathValidator";
import {
  checkEngineStatusService,
  diarizeTranscriptionService,
  transcribeFileService,
  type TranscriptionServiceDeps,
} from "../../src/helpers/services/transcriptionService";

// [20260912_Refactor_261_TranscriptionService] Loosely-typed mocks
// (ReturnType<typeof vi.fn>, the established pattern in
// transcriptionHandlers.test.ts) so per-test overrides like
// mockResolvedValueOnce / mockRejectedValueOnce typecheck without `any`.
type MockFn = ReturnType<typeof vi.fn>;

interface MockDeps {
  funasrManager: {
    transcribeFile: MockFn;
    diarizeAudio: MockFn;
    checkModelFiles: MockFn;
  };
  databaseManager: {
    saveTranscription: MockFn;
    getSetting: MockFn;
    getTranscriptionById: MockFn;
  };
  logger: Record<string, MockFn>;
}

describe("transcriptionService (headless seam, ticket #261)", () => {
  let deps: TranscriptionServiceDeps;
  let mockDeps: MockDeps;

  beforeEach(() => {
    mockDeps = {
      funasrManager: {
        transcribeFile: vi.fn(async () => ({
          success: true,
          text: "文件转录",
          raw_text: "raw",
          segments: [],
        })),
        diarizeAudio: vi.fn(async () => ({ success: true })),
        checkModelFiles: vi.fn(async () => ({ models_downloaded: true })),
      },
      databaseManager: {
        saveTranscription: vi.fn(() => ({ lastInsertRowid: 42n, changes: 1 })),
        getSetting: vi.fn(() => null),
        getTranscriptionById: vi.fn(() => null),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    // [20260912_Refactor_261_TranscriptionService] `unknown` bridge (no
    // `any`), the established pattern from modelHandlers.test.ts: the
    // loosely-typed vi.fn mocks are structurally stubbed, not the full
    // production types.
    deps = mockDeps as unknown as TranscriptionServiceDeps;
  });

  describe("transcribeFileService", () => {
    it("rejects an invalid audio path without touching funasrManager", async () => {
      vi.mocked(validateAudioPath).mockReturnValueOnce({
        valid: false,
        error: "非法路径",
      });
      const result = (await transcribeFileService(
        deps,
        "/bad/path.xyz",
      )) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "非法路径" });
      expect(mockDeps.funasrManager.transcribeFile).not.toHaveBeenCalled();
      expect(mockDeps.databaseManager.saveTranscription).not.toHaveBeenCalled();
    });

    it("sanitizes and injects the stored hotword into transcribeFile options", async () => {
      mockDeps.databaseManager.getSetting.mockReturnValue("  张三  ");
      await transcribeFileService(deps, "/fake/audio.wav");
      const opts = mockDeps.funasrManager.transcribeFile.mock
        .calls[0]![1] as Record<string, unknown>;
      expect(opts.hotword).toBe("张三");
      expect(mockDeps.databaseManager.getSetting).toHaveBeenCalledWith(
        "hotwords",
      );
    });

    it("retries once without the hotword on failure and flags hotword_degraded", async () => {
      mockDeps.databaseManager.getSetting.mockReturnValue("张三");
      mockDeps.funasrManager.transcribeFile
        .mockRejectedValueOnce(new Error("hotword boom"))
        .mockResolvedValueOnce({
          success: true,
          text: "重试成功",
          raw_text: "r",
          segments: [],
        });
      const result = (await transcribeFileService(deps, "/fake/audio.wav")) as {
        success: boolean;
        text?: string;
        hotword_degraded?: boolean;
      };
      expect(mockDeps.funasrManager.transcribeFile).toHaveBeenCalledTimes(2);
      const firstOpts = mockDeps.funasrManager.transcribeFile.mock
        .calls[0]![1] as Record<string, unknown>;
      const secondOpts = mockDeps.funasrManager.transcribeFile.mock
        .calls[1]![1] as Record<string, unknown>;
      expect(firstOpts.hotword).toBe("张三");
      expect(secondOpts).not.toHaveProperty("hotword");
      expect(result.success).toBe(true);
      expect(result.text).toBe("重试成功");
      expect(result.hotword_degraded).toBe(true);
    });

    it("wires a provided onProgress callback into transcribeFile options", async () => {
      const onProgress = vi.fn();
      await transcribeFileService(deps, "/fake/audio.wav", {}, onProgress);
      const opts = mockDeps.funasrManager.transcribeFile.mock.calls[0]![1] as {
        onProgress?: unknown;
      };
      expect(opts.onProgress).toBe(onProgress);
    });

    it("completes without onProgress and persists the result with the DB rowid", async () => {
      const segments = [{ start_ms: 0, end_ms: 1, text: "段落" }];
      mockDeps.funasrManager.transcribeFile.mockResolvedValueOnce({
        success: true,
        text: "正文",
        raw_text: "原始",
        segments,
        duration: 3.2,
      });
      const result = (await transcribeFileService(deps, "/fake/audio.wav")) as {
        success: boolean;
        id?: number;
        text?: string;
        original_text?: string;
      };
      const opts = mockDeps.funasrManager.transcribeFile.mock
        .calls[0]![1] as Record<string, unknown>;
      // Sender-less scenario: no progress callback reaches the engine.
      expect(opts).not.toHaveProperty("onProgress");
      expect(mockDeps.databaseManager.saveTranscription).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "正文",
          raw_text: "正文",
          processed_text: "原始",
          source_type: "file",
          source_file_path: "/fake/audio.wav",
          segments: JSON.stringify(segments),
          duration: 3.2,
        }),
      );
      expect(result.success).toBe(true);
      expect(result.id).toBe(42); // Number(lastInsertRowid: 42n)
      expect(result.original_text).toBe("正文");
    });
  });

  describe("diarizeTranscriptionService", () => {
    it("returns an error when the transcription record does not exist", async () => {
      const result = (await diarizeTranscriptionService(deps, 999)) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ success: false, error: "转录记录不存在" });
      expect(mockDeps.funasrManager.diarizeAudio).not.toHaveBeenCalled();
    });

    it("returns an error when the record has no usable segments", async () => {
      mockDeps.databaseManager.getTranscriptionById.mockReturnValueOnce({
        id: 7,
        text: "x",
        segments: "[]",
      });
      const result = (await diarizeTranscriptionService(deps, 7)) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ success: false, error: "无分段数据" });
      expect(mockDeps.funasrManager.diarizeAudio).not.toHaveBeenCalled();
    });

    it("diarizes with the stored audio path and parsed segments", async () => {
      const segments = [{ start_ms: 0, end_ms: 1, text: "x" }];
      mockDeps.databaseManager.getTranscriptionById.mockReturnValueOnce({
        id: 7,
        segments: JSON.stringify(segments),
        source_file_path: "/a.wav",
      });
      const result = await diarizeTranscriptionService(deps, 7);
      expect(mockDeps.funasrManager.diarizeAudio).toHaveBeenCalledWith(
        "/a.wav",
        segments,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("checkEngineStatusService", () => {
    it("passes the engine status through from funasrManager.checkModelFiles", async () => {
      const status = {
        models_downloaded: true,
        models: [{ name: "paraformer" }],
      };
      mockDeps.funasrManager.checkModelFiles.mockResolvedValueOnce(status);
      const result = await checkEngineStatusService(deps);
      expect(result).toEqual(status);
      expect(mockDeps.funasrManager.checkModelFiles).toHaveBeenCalledTimes(1);
    });
  });
});
// [20260912_Refactor_261_TranscriptionService] END

// [20260912_Refactor_262_AiHistoryService] Ticket #262: edge tests the
// #261 review deferred to this ticket, now pinned at the SERVICE level.
// Appended as a standalone describe — the #261 cases above are untouched.
describe("transcribeFileService — deferred edge cases (#261 review → #262)", () => {
  // Local deps builder mirroring the #261 harness above (loosely-typed
  // vi.fn() mocks, `unknown` bridge, no `any`).
  type MockFn = ReturnType<typeof vi.fn>;
  let mockDeps: {
    funasrManager: { transcribeFile: MockFn };
    databaseManager: {
      saveTranscription: MockFn;
      getSetting: MockFn;
      getTranscriptionById: MockFn;
    };
    logger: Record<string, MockFn>;
  };

  beforeEach(() => {
    mockDeps = {
      funasrManager: {
        transcribeFile: vi.fn(async () => ({
          success: true,
          text: "文件转录",
          raw_text: "raw",
          segments: [],
        })),
      },
      databaseManager: {
        saveTranscription: vi.fn(() => ({ lastInsertRowid: 42n, changes: 1 })),
        getSetting: vi.fn(() => null),
        getTranscriptionById: vi.fn(() => null),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
  });

  const serviceDeps = () => mockDeps as unknown as TranscriptionServiceDeps;

  it("orchestrator timeout resolving {success:false} (not throwing) still fires the raw hotword-free fallback", async () => {
    // A downstream engine/orchestrator timeout surfaces as a RESOLVED
    // failure envelope, not a rejection. The hotword fallback contract
    // must treat it as a failure exactly like a throw: retry once with
    // the raw (hotword-free) options and flag hotword_degraded on success.
    mockDeps.databaseManager.getSetting.mockReturnValue("张三");
    mockDeps.funasrManager.transcribeFile
      .mockResolvedValueOnce({ success: false, error: "AI 请求超时" })
      .mockResolvedValueOnce({
        success: true,
        text: "重试成功",
        raw_text: "r",
        segments: [],
      });
    const result = (await transcribeFileService(
      serviceDeps(),
      "/fake/audio.wav",
    )) as { success: boolean; text?: string; hotword_degraded?: boolean };
    expect(mockDeps.funasrManager.transcribeFile).toHaveBeenCalledTimes(2);
    const firstOpts = mockDeps.funasrManager.transcribeFile.mock
      .calls[0]![1] as Record<string, unknown>;
    const secondOpts = mockDeps.funasrManager.transcribeFile.mock
      .calls[1]![1] as Record<string, unknown>;
    expect(firstOpts.hotword).toBe("张三");
    expect(secondOpts).not.toHaveProperty("hotword");
    expect(result.success).toBe(true);
    expect(result.text).toBe("重试成功");
    expect(result.hotword_degraded).toBe(true);
    // The retry success IS persisted like any successful transcription.
    expect(mockDeps.databaseManager.saveTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ text: "重试成功" }),
    );
  });

  it("saveTranscription throwing inside the persist returns the transcription result without id", async () => {
    // The DB write must never fail the transcription the user already
    // has in hand: the error is logged, the result keeps success+text,
    // and no id is attached.
    mockDeps.databaseManager.saveTranscription.mockImplementationOnce(() => {
      throw new Error("DB locked");
    });
    const result = (await transcribeFileService(
      serviceDeps(),
      "/fake/audio.wav",
    )) as { success: boolean; text?: string; id?: number };
    expect(result.success).toBe(true);
    expect(result.text).toBe("文件转录");
    expect(result).not.toHaveProperty("id");
    expect(mockDeps.logger.error).toHaveBeenCalledWith(
      "保存转录结果到数据库失败:",
      expect.any(Error),
    );
  });
});
// [20260912_Refactor_262_AiHistoryService] END

// [20260912_Feat_269_McpServer] Ticket #269: the persist opt-out for the
// MCP `transcribe_file` tool. Appended as a standalone describe — every
// case above is untouched (default behavior stays always-persist).
describe("transcribeFileService persist opt-out (ticket #269)", () => {
  // Local deps builder mirroring the harnesses above (loosely-typed
  // vi.fn() mocks, `unknown` bridge, no `any`).
  type MockFn = ReturnType<typeof vi.fn>;
  let mockDeps: {
    funasrManager: { transcribeFile: MockFn };
    databaseManager: {
      saveTranscription: MockFn;
      getSetting: MockFn;
      getTranscriptionById: MockFn;
    };
    logger: Record<string, MockFn>;
  };

  beforeEach(() => {
    mockDeps = {
      funasrManager: {
        transcribeFile: vi.fn(async () => ({
          success: true,
          text: "文件转录",
          raw_text: "raw",
          segments: [],
          duration: 1.5,
        })),
      },
      databaseManager: {
        saveTranscription: vi.fn(() => ({ lastInsertRowid: 42n, changes: 1 })),
        getSetting: vi.fn(() => null),
        getTranscriptionById: vi.fn(() => null),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
  });

  const serviceDeps = () => mockDeps as unknown as TranscriptionServiceDeps;

  it("persist=false: still transcribes, but saveTranscription is NEVER called and no id is attached", async () => {
    const result = (await transcribeFileService(
      serviceDeps(),
      "/fake/audio.wav",
      {},
      undefined,
      false,
    )) as { success: boolean; text?: string; id?: number };
    expect(mockDeps.funasrManager.transcribeFile).toHaveBeenCalledTimes(1);
    expect(mockDeps.databaseManager.saveTranscription).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.text).toBe("文件转录");
    // No DB row → no id on the result (the MCP tool surfaces this absence
    // by omitting `id` from its structuredContent).
    expect(result).not.toHaveProperty("id");
  });

  it("persist=true: persists exactly like the default", async () => {
    const result = (await transcribeFileService(
      serviceDeps(),
      "/fake/audio.wav",
      {},
      undefined,
      true,
    )) as { success: boolean; id?: number };
    expect(mockDeps.databaseManager.saveTranscription).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(42);
  });

  it("persist omitted (undefined): default-true — existing callers keep the always-persist behavior", async () => {
    await transcribeFileService(serviceDeps(), "/fake/audio.wav");
    expect(mockDeps.databaseManager.saveTranscription).toHaveBeenCalledTimes(1);
  });

  it("persist=false with a failing transcription: unchanged failure envelope, still no save", async () => {
    mockDeps.funasrManager.transcribeFile.mockResolvedValueOnce({
      success: false,
      error: "引擎未就绪",
    });
    const result = (await transcribeFileService(
      serviceDeps(),
      "/fake/audio.wav",
      {},
      undefined,
      false,
    )) as Record<string, unknown>;
    expect(result).toEqual({ success: false, error: "引擎未就绪" });
    expect(mockDeps.databaseManager.saveTranscription).not.toHaveBeenCalled();
  });
});
// [20260912_Feat_269_McpServer] END
