// [20260912_Refactor_262_AiHistoryService] Ticket #262 (spec #258 Phase 0 —
// 历史写域服务化): history write/query/delete service extraction. The
// C.TRANSCRIPTION.SAVE / GET_ALL / DELETE / CLEAR / EXPORT_ALL handler
// bodies (transcriptionHandlers.ts) move here as plain main-process
// functions receiving `{ databaseManager, logger }` deps. The single-writer
// principle holds: every function writes through the SAME injected
// databaseManager the handler used — no new writers appear. The SAVE UPDATE
// sibling and everything #261 already serviced are untouched.
//
// No Electron types here: EXPORT_ALL's dialog coupling stays in the
// handler, translated into the injected `showSaveDialog` callback (same
// pattern as #261's optional onProgress). Behavior is identical to the
// pre-extraction handlers except ONE disclosed envelope refinement (see
// below) — locked by the unmodified
// tests/unit/transcriptionHandlers.test.ts; new headless seam coverage
// lives in tests/unit/historyService.test.ts. Comments and log strings
// copied from the handlers are kept verbatim (Chinese log strings are
// pre-existing diagnostics).
//
// The disclosed refinement (ticket #262 test contract b): SAVE now
// normalizes `lastInsertRowid` through Number() (node:sqlite can hand back
// a bigint; the #261 file-transcription persist already normalizes the
// same way). Existing handler tests pass plain-number rowids and are
// unaffected.

import fs from "fs";
import * as exportFormatters from "../exportFormatters";
import type { TranscriptionForExport } from "../exportFormatters";

/** Logger surface used for diagnostics; every method is optional. */
export interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

/** History row shape the query/export services read (permissive echo). */
export interface HistoryRow {
  id?: number;
  text?: string;
  segments?: string | null;
  [key: string]: unknown;
}

/** Result of the DB write returning the inserted row id. */
interface SaveTranscriptionResult {
  lastInsertRowid?: number | bigint;
  changes?: number;
}

// [20260912_Refactor_262_AiHistoryService] The C.TRANSCRIPTION.SAVE handler
// body: persist the record and surface {success, lastInsertRowid, changes};
// DB failures surface through the {success:false, error} envelope.
export function saveTranscriptionService(
  deps: {
    databaseManager: {
      saveTranscription(data: Record<string, unknown>): SaveTranscriptionResult;
    };
    logger: Logger;
  },
  data: Record<string, unknown>,
): {
  success: boolean;
  lastInsertRowid?: number;
  changes?: number;
  error?: string;
} {
  try {
    const result = deps.databaseManager.saveTranscription(data);
    return {
      success: true,
      // Ticket #262 (b): node:sqlite rowids are normalized to Number so
      // headless callers get a plain value regardless of the driver's
      // number|bigint return; undefined (no rowid) passes through.
      lastInsertRowid:
        result.lastInsertRowid !== undefined
          ? Number(result.lastInsertRowid)
          : undefined,
      changes: result.changes,
    };
  } catch (error) {
    deps.logger.error?.("保存转录失败:", error);
    return { success: false, error: (error as Error).message };
  }
}
// [20260912_Refactor_262_AiHistoryService] END

// [20260912_Refactor_262_AiHistoryService] The C.TRANSCRIPTION.GET_ALL
// handler body: raw paginated row passthrough (no envelope, as before).
export function getTranscriptionsService(
  deps: {
    databaseManager: {
      getTranscriptions(limit: number, offset: number): HistoryRow[];
    };
  },
  limit: number,
  offset: number,
): HistoryRow[] {
  return deps.databaseManager.getTranscriptions(limit, offset);
}
// [20260912_Refactor_262_AiHistoryService] END

// [20260912_Refactor_262_AiHistoryService] The C.TRANSCRIPTION.DELETE
// handler body ([20260905_Fix_249_ReviewNit]): wrap the raw node:sqlite
// RunResult into the OperationResult contract — missing `changes`
// normalizes to 0.
export function deleteTranscriptionService(
  deps: {
    databaseManager: { deleteTranscription(id: number): unknown };
    logger: Logger;
  },
  id: number,
): { success: boolean; changes?: number; error?: string } {
  try {
    const result = deps.databaseManager.deleteTranscription(id) as {
      changes?: number;
    };
    return { success: true, changes: result.changes ?? 0 };
  } catch (error) {
    deps.logger.error?.("删除转录记录失败:", error);
    return { success: false, error: (error as Error).message };
  }
}
// [20260912_Refactor_262_AiHistoryService] END

// [20260912_Refactor_262_AiHistoryService] The C.TRANSCRIPTION.CLEAR
// handler body ([20260905_Fix_248_ReviewClearContract]): same
// OperationResult wrapping as DELETE — the renderer checks `success`.
export function clearTranscriptionsService(deps: {
  databaseManager: { clearAllTranscriptions(): unknown };
  logger: Logger;
}): { success: boolean; changes?: number; error?: string } {
  try {
    const result = deps.databaseManager.clearAllTranscriptions() as {
      changes?: number;
    };
    return { success: true, changes: result.changes ?? 0 };
  } catch (error) {
    deps.logger.error?.("清空转录记录失败:", error);
    return { success: false, error: (error as Error).message };
  }
}
// [20260912_Refactor_262_AiHistoryService] END

// [20260912_Refactor_262_AiHistoryService] The C.TRANSCRIPTION.EXPORT_ALL
// handler body. The native save dialog is injected (`showSaveDialog`) —
// the handler passes `dialog.showSaveDialog`; headless callers inject a
// stub resolving a target path (or {canceled:true} to exercise the cancel
// arm). File writes stay here (plain fs, no Electron).
export interface SaveFileDialogOptions {
  title: string;
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
}

export type ShowSaveFileDialog = (
  options: SaveFileDialogOptions,
) => Promise<{ canceled: boolean; filePath?: string }>;

export async function exportAllTranscriptionsService(
  deps: {
    databaseManager: {
      getTranscriptions(limit: number, offset: number): HistoryRow[];
    };
    logger: Logger;
  },
  format: string,
  showSaveDialog: ShowSaveFileDialog,
): Promise<Record<string, unknown>> {
  const { databaseManager, logger } = deps;
  try {
    const transcriptions = databaseManager.getTranscriptions(10000, 0);
    if (!transcriptions || transcriptions.length === 0) {
      return { success: false, error: "没有转录记录可导出" };
    }

    const formatInfo = exportFormatters.getFormatInfo(format || "txt");
    if (!formatInfo) {
      return { success: false, error: `不支持的格式: ${format}` };
    }
    const filters = [
      { name: formatInfo.label || format, extensions: [formatInfo.ext] },
    ];

    const result = await showSaveDialog({
      title: "导出转录记录",
      defaultPath: `transcriptions.${formatInfo.ext}`,
      filters,
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    // [20260906_Fix_ExportAllSegments] Found by the T16 content-readback
    // e2e: rows carry the raw segments JSON string, but formatters read
    // parsedSegments — export-all therefore silently dropped segment
    // timelines. Parse per record (parity with the single-record export).
    const withParsedSegments = (
      transcriptions as unknown as Array<Record<string, unknown>>
    ).map((row) => {
      let parsedSegments: unknown[] = [];
      if (typeof row.segments === "string" && row.segments) {
        try {
          parsedSegments = JSON.parse(row.segments) as unknown[];
        } catch {
          parsedSegments = [];
        }
      }
      return { ...row, parsedSegments };
    });

    let content: Buffer | string;
    if (format === "docx") {
      // [20260724_TS_BigBang_TranscriptionHandlers] Pre-existing behavior:
      // the .js passed the whole transcriptions array to formatDOCX
      // (which expects a single record). Preserve runtime behavior via
      // a cast; the doc comes out with empty text/segments as before.
      content = await exportFormatters.formatDOCX(
        withParsedSegments as unknown as TranscriptionForExport,
      );
      fs.writeFileSync(result.filePath, content as Buffer);
    } else {
      // [20260815_Refactor_FormatterLookup] getFormatInfo above already
      // resolved the right formatter; the nested ternary re-derived it.
      const formatter = formatInfo.formatter;
      content = (withParsedSegments as unknown[])
        .map((t) => formatter(t as unknown as TranscriptionForExport))
        .join("\n\n");
      fs.writeFileSync(result.filePath, content as string, "utf-8");
    }

    return { success: true, path: result.filePath };
  } catch (error) {
    logger.error?.("导出转录失败:", error);
    return { success: false, error: (error as Error).message };
  }
}
// [20260912_Refactor_262_AiHistoryService] END
