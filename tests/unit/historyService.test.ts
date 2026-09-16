// [20260912_Refactor_262_AiHistoryService] Headless seam tests for the
// history write/query/delete services extracted in ticket #262 (spec #258
// Phase 0). saveTranscriptionService / getTranscriptionsService /
// deleteTranscriptionService / clearTranscriptionsService /
// exportAllTranscriptionsService run with plain vi.fn() deps — no Electron
// import anywhere: the native save dialog is injected as the
// showSaveDialog callback, and the file write uses plain fs. Behavior
// parity with the IPC handlers is locked by the unmodified
// tests/unit/transcriptionHandlers.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// [20260912_Refactor_262_AiHistoryService] Controllable formatter module
// (same pattern as transcriptionHandlers.test.ts): getFormatInfo returns a
// stub formatter, formatDOCX yields deterministic bytes for the docx arm.
vi.mock("../../src/helpers/exportFormatters", () => ({
  formatDOCX: vi.fn(async () => Buffer.from("docx-bytes")),
  getFormatInfo: vi.fn(() => ({
    ext: ".txt",
    label: "Text",
    formatter: () => "formatted",
  })),
}));

import {
  clearTranscriptionsService,
  deleteTranscriptionService,
  exportAllTranscriptionsService,
  getTranscriptionsService,
  saveTranscriptionService,
  type HistoryRow,
  type Logger,
  type SaveFileDialogOptions,
} from "../../src/helpers/services/historyService";

type MockFn = ReturnType<typeof vi.fn>;

interface MockDeps {
  databaseManager: {
    saveTranscription: MockFn;
    getTranscriptions: MockFn;
    deleteTranscription: MockFn;
    clearAllTranscriptions: MockFn;
  };
  logger: Record<string, MockFn>;
}

// [20260912_Refactor_262_AiHistoryService] `unknown` bridge (no `any`, the
// established pattern from transcriptionService.test.ts): the loosely-typed
// vi.fn() mocks are bridged to the union of the service deps shapes. The
// bridge is a structural superset, so it satisfies every service's narrow
// deps slice.
interface ServiceDepsBridge {
  databaseManager: {
    saveTranscription(data: Record<string, unknown>): {
      lastInsertRowid?: number | bigint;
      changes?: number;
    };
    getTranscriptions(limit: number, offset: number): HistoryRow[];
    deleteTranscription(id: number): unknown;
    clearAllTranscriptions(): unknown;
  };
  logger: Logger;
}

describe("historyService (headless seam, ticket #262)", () => {
  let mockDeps: MockDeps;

  beforeEach(() => {
    mockDeps = {
      databaseManager: {
        saveTranscription: vi.fn(() => ({ lastInsertRowid: 42n, changes: 1 })),
        getTranscriptions: vi.fn(() => []),
        deleteTranscription: vi.fn(() => ({ changes: 1 })),
        clearAllTranscriptions: vi.fn(() => ({ changes: 5 })),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
  });

  const serviceDeps = (): ServiceDepsBridge =>
    mockDeps as unknown as ServiceDepsBridge;

  const dialogOk = (filePath: string) =>
    vi.fn(async (_options: SaveFileDialogOptions) => ({
      canceled: false,
      filePath,
    }));

  describe("saveTranscriptionService", () => {
    it("persists the record and normalizes a bigint rowid to Number", () => {
      const result = saveTranscriptionService(serviceDeps(), { text: "hello" });
      expect(mockDeps.databaseManager.saveTranscription).toHaveBeenCalledWith({
        text: "hello",
      });
      expect(result).toEqual({
        success: true,
        lastInsertRowid: 42,
        changes: 1,
      });
      expect(result.lastInsertRowid).toBe(42); // Number(42n)
    });

    it("passes a missing rowid through as undefined (no fabricated value)", () => {
      mockDeps.databaseManager.saveTranscription.mockReturnValueOnce({
        changes: 1,
      });
      const result = saveTranscriptionService(serviceDeps(), { text: "hello" });
      expect(result.success).toBe(true);
      expect(result.lastInsertRowid).toBeUndefined();
      expect(result.changes).toBe(1);
    });

    it("surfaces a DB failure through the error envelope and logs it", () => {
      mockDeps.databaseManager.saveTranscription.mockImplementationOnce(() => {
        throw new Error("DB locked");
      });
      const result = saveTranscriptionService(serviceDeps(), { text: "hello" });
      expect(result).toEqual({ success: false, error: "DB locked" });
      expect(mockDeps.logger.error).toHaveBeenCalledWith(
        "保存转录失败:",
        expect.any(Error),
      );
    });
  });

  describe("getTranscriptionsService", () => {
    it("passes limit/offset through and returns the rows raw (no envelope)", () => {
      const rows = [{ id: 1, text: "a", segments: "[]" }];
      mockDeps.databaseManager.getTranscriptions.mockReturnValueOnce(rows);
      const result = getTranscriptionsService(serviceDeps(), 100, 20);
      expect(mockDeps.databaseManager.getTranscriptions).toHaveBeenCalledWith(
        100,
        20,
      );
      expect(result).toBe(rows);
    });
  });

  describe("deleteTranscriptionService", () => {
    it("wraps the RunResult into {success, changes}", () => {
      const result = deleteTranscriptionService(serviceDeps(), 42);
      expect(mockDeps.databaseManager.deleteTranscription).toHaveBeenCalledWith(
        42,
      );
      expect(result).toEqual({ success: true, changes: 1 });
    });

    it("normalizes a missing changes count to 0", () => {
      mockDeps.databaseManager.deleteTranscription.mockReturnValueOnce({});
      expect(deleteTranscriptionService(serviceDeps(), 42)).toEqual({
        success: true,
        changes: 0,
      });
    });

    it("surfaces a DB failure through the error envelope and logs it", () => {
      mockDeps.databaseManager.deleteTranscription.mockImplementationOnce(
        () => {
          throw new Error("foreign key");
        },
      );
      const result = deleteTranscriptionService(serviceDeps(), 42);
      expect(result).toEqual({ success: false, error: "foreign key" });
      expect(mockDeps.logger.error).toHaveBeenCalledWith(
        "删除转录记录失败:",
        expect.any(Error),
      );
    });
  });

  describe("clearTranscriptionsService", () => {
    it("wraps the RunResult into {success, changes}", () => {
      expect(clearTranscriptionsService(serviceDeps())).toEqual({
        success: true,
        changes: 5,
      });
      expect(
        mockDeps.databaseManager.clearAllTranscriptions,
      ).toHaveBeenCalledTimes(1);
    });

    it("normalizes a missing changes count to 0", () => {
      mockDeps.databaseManager.clearAllTranscriptions.mockReturnValueOnce({});
      expect(clearTranscriptionsService(serviceDeps())).toEqual({
        success: true,
        changes: 0,
      });
    });

    it("surfaces a DB failure through the error envelope and logs it", () => {
      mockDeps.databaseManager.clearAllTranscriptions.mockImplementationOnce(
        () => {
          throw new Error("clear failed");
        },
      );
      const result = clearTranscriptionsService(serviceDeps());
      expect(result).toEqual({ success: false, error: "clear failed" });
      expect(mockDeps.logger.error).toHaveBeenCalledWith(
        "清空转录记录失败:",
        expect.any(Error),
      );
    });
  });

  describe("exportAllTranscriptionsService", () => {
    it("rejects when there are no rows to export", async () => {
      const showSaveDialog = dialogOk("/tmp/unused.txt");
      const result = await exportAllTranscriptionsService(
        serviceDeps(),
        "txt",
        showSaveDialog,
      );
      expect(result).toEqual({ success: false, error: "没有转录记录可导出" });
      expect(showSaveDialog).not.toHaveBeenCalled();
    });

    it("treats a null row list as empty", async () => {
      mockDeps.databaseManager.getTranscriptions.mockReturnValueOnce(
        null as unknown as never[],
      );
      const result = await exportAllTranscriptionsService(
        serviceDeps(),
        "txt",
        dialogOk("/tmp/unused.txt"),
      );
      expect(result).toEqual({ success: false, error: "没有转录记录可导出" });
    });

    it("rejects an unsupported format before showing the dialog", async () => {
      mockDeps.databaseManager.getTranscriptions.mockReturnValueOnce([
        { id: 1, text: "a" },
      ]);
      const { getFormatInfo } =
        await import("../../src/helpers/exportFormatters");
      vi.mocked(getFormatInfo).mockReturnValueOnce(null);
      const showSaveDialog = dialogOk("/tmp/unused.txt");
      const result = await exportAllTranscriptionsService(
        serviceDeps(),
        "bogus",
        showSaveDialog,
      );
      expect(result).toEqual({ success: false, error: "不支持的格式: bogus" });
      expect(showSaveDialog).not.toHaveBeenCalled();
    });

    it("defaults the empty format to txt and reports a canceled dialog", async () => {
      mockDeps.databaseManager.getTranscriptions.mockReturnValueOnce([
        { id: 1, text: "a" },
      ]);
      const showSaveDialog = vi.fn(async () => ({
        canceled: true,
        filePath: "",
      }));
      const result = await exportAllTranscriptionsService(
        serviceDeps(),
        "",
        showSaveDialog,
      );
      expect(result).toEqual({ success: false, canceled: true });
      const { getFormatInfo } =
        await import("../../src/helpers/exportFormatters");
      expect(getFormatInfo).toHaveBeenCalledWith("txt");
    });

    it("treats a falsy file path as a canceled dialog", async () => {
      mockDeps.databaseManager.getTranscriptions.mockReturnValueOnce([
        { id: 1, text: "a" },
      ]);
      const result = await exportAllTranscriptionsService(
        serviceDeps(),
        "txt",
        vi.fn(async () => ({ canceled: false, filePath: "" })),
      );
      expect(result).toEqual({ success: false, canceled: true });
    });

    it("writes the joined txt output to the chosen path", async () => {
      mockDeps.databaseManager.getTranscriptions.mockReturnValueOnce([
        {
          id: 1,
          text: "a",
          segments: '[{"start_ms":0,"end_ms":1,"text":"x"}]',
        },
        { id: 2, text: "b", segments: "{bad" }, // invalid JSON → []
        { id: 3, text: "c", segments: null }, // non-string → []
      ]);
      const outfile = path.join(os.tmpdir(), `h262-export-${Date.now()}.txt`);
      try {
        const result = await exportAllTranscriptionsService(
          serviceDeps(),
          "txt",
          dialogOk(outfile),
        );
        expect(result).toEqual({ success: true, path: outfile });
        expect(fs.existsSync(outfile)).toBe(true);
      } finally {
        if (fs.existsSync(outfile)) fs.unlinkSync(outfile);
      }
    });

    it("routes docx through formatDOCX and writes the Buffer", async () => {
      mockDeps.databaseManager.getTranscriptions.mockReturnValueOnce([
        { id: 1, text: "a" },
      ]);
      const outfile = path.join(os.tmpdir(), `h262-export-${Date.now()}.docx`);
      try {
        const result = await exportAllTranscriptionsService(
          serviceDeps(),
          "docx",
          dialogOk(outfile),
        );
        expect(result).toEqual({ success: true, path: outfile });
        expect(fs.readFileSync(outfile).toString()).toBe("docx-bytes");
      } finally {
        if (fs.existsSync(outfile)) fs.unlinkSync(outfile);
      }
    });

    it("surfaces a DB read failure through the error envelope and logs it", async () => {
      mockDeps.databaseManager.getTranscriptions.mockImplementationOnce(() => {
        throw new Error("read failed");
      });
      const result = await exportAllTranscriptionsService(
        serviceDeps(),
        "txt",
        dialogOk("/tmp/unused.txt"),
      );
      expect(result).toEqual({ success: false, error: "read failed" });
      expect(mockDeps.logger.error).toHaveBeenCalledWith(
        "导出转录失败:",
        expect.any(Error),
      );
    });
  });
});
