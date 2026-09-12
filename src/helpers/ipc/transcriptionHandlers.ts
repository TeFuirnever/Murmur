// [20260724_TS_BigBang_TranscriptionHandlers] Migrated from .js to .ts (ADR-010).
import path from "path";
import fs from "fs";
import { dialog } from "electron";
import * as C from "../ipc-contracts";
import * as exportFormatters from "../exportFormatters";
import type { TranscriptionForExport } from "../exportFormatters";
// [20260906_Refactor_PolishOrchestrator] The buildPrompt import was removed:
// the AI_REVIEW entry now passes its mode/template explicitly into the shared
// polish orchestrator (aiHandlers), which owns prompt building.
import { validateAudioPath } from "../audioPathValidator";
// [20260912_Refactor_261_TranscriptionService] Ticket #261 (spec #258
// Phase 0): the transcription-domain logic — the TRANSCRIBE_FILE body,
// the DIARIZE body, the hotword injection/fallback helpers, and the
// output cleaning — moved to src/helpers/services/transcriptionService.ts
// so it can run without a renderer/window/sender. This handler file keeps
// only channel registration, envelopes, and the event.sender progress
// wiring (passed to the service as the optional onProgress callback).
import {
  applyTranscriptionCleaning,
  diarizeTranscriptionService,
  injectStoredHotwords,
  transcribeFileService,
  withHotwordFallback,
  type Logger,
} from "../services/transcriptionService";

interface TranscriptionRow {
  text?: string;
  segments?: string;
  source_file_path?: string;
  audio_path?: string;
  // [20260906_Feat_TranscriptionUpdate] Polished-text fields echoed back by
  // the UPDATE handler (spec #193 T1).
  processed_text?: string;
  raw_text?: string;
  [key: string]: unknown;
}

interface DatabaseManager {
  saveTranscription(data: Record<string, unknown>): {
    lastInsertRowid?: number | bigint;
    changes?: number;
  };
  // [20260820_T14_Hotwords] Synchronous settings read (hotword injection).
  getSetting(key: string, defaultValue?: unknown): unknown;
  getTranscriptionById(id: number): TranscriptionRow | null;
  getTranscriptions(limit: number, offset: number): TranscriptionRow[];
  deleteTranscription(id: number): unknown;
  clearAllTranscriptions(): unknown;
  // [20260906_Feat_TranscriptionUpdate] Manual polish write-back
  // (spec #193 T1, ticket #228). Column whitelisting lives in the DB layer.
  // [20260912_Fix_322_AutoUpdateGuard] Ticket #322: the T2 manual-edit
  // guard option passes through, and a guarded skip comes back as a
  // success no-op carrying `skipped`.
  updateTranscription(
    id: number,
    patch: Record<string, unknown>,
    options?: { skipWhenManuallyEdited?: boolean },
  ): {
    changes?: number;
    skipped?: boolean;
  };
}

interface FunasrManager {
  transcribeAudio(
    audioData: unknown,
    options: unknown,
  ): Promise<{ success: boolean; text?: string }>;
  transcribeFile(
    audioPath: string,
    options: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    text?: string;
    raw_text?: string;
    segments?: unknown[];
    duration?: number;
    id?: number | bigint;
  }>;
  cancelTranscription(): Promise<unknown>;
  diarizeAudio(audioPath: string, segments: unknown[]): Promise<unknown>;
  // [20260912_Refactor_261_TranscriptionService] Echoed from the real
  // manager surface (it already has this method — modelHandlers calls it):
  // the extracted service's deps bag is typed with the full manager shape,
  // so this interface must carry checkModelFiles for the deps object to be
  // assignable. This handler itself never calls it.
  checkModelFiles(): Promise<
    { models_downloaded: boolean } & Record<string, unknown>
  >;
}

type ProcessTextWithAI = (
  text: string,
  mode: string,
  databaseManager: DatabaseManager,
  logger: Logger,
  options: Record<string, unknown>,
) => Promise<{ success: boolean; text?: string; error?: string }>;

interface Managers {
  funasrManager: FunasrManager;
  databaseManager: DatabaseManager;
  logger: Logger;
  processTextWithAI?: ProcessTextWithAI;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { funasrManager, databaseManager, logger, processTextWithAI } =
    managers;

  // [20260912_Refactor_261_TranscriptionService] Deps bag forwarded to the
  // extracted service functions (they take collaborators as a parameter
  // instead of closing over the managers — no renderer/window/sender
  // dependency). The two hotword helper closures (injectStoredHotwords /
  // withHotwordFallback) moved verbatim into
  // src/helpers/services/transcriptionService.ts, now taking this bag as
  // their first argument.
  const transcriptionDeps = { funasrManager, databaseManager, logger };

  ipcMain.handle(
    C.TRANSCRIPTION.AUDIO,
    async (_event, audioData: unknown, options: unknown) => {
      // [20260820_T14_Hotwords] Mic seam: inject then run with fallback.
      // [20260912_Refactor_261_TranscriptionService] The helpers are now
      // imported from the service module; call shapes are unchanged.
      const baseOptions = (options ?? {}) as Record<string, unknown>;
      const withHotword = await injectStoredHotwords(
        transcriptionDeps,
        baseOptions,
      );
      const result = (await withHotwordFallback(
        transcriptionDeps,
        baseOptions,
        withHotword,
        (opts) =>
          funasrManager.transcribeAudio(
            audioData,
            opts as Record<string, unknown>,
          ),
      )) as unknown;
      // [20260819_T10_CleanerWiring] Mic seam (see applyTranscriptionCleaning).
      applyTranscriptionCleaning(result, logger);
      return result;
    },
  );

  ipcMain.handle(C.TRANSCRIPTION.IMPORT_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "选择音频文件",
        filters: [
          {
            name: "音频文件",
            extensions: ["wav", "mp3", "m4a", "flac", "ogg", "wma", "aac"],
          },
          { name: "所有文件", extensions: ["*"] },
        ],
        properties: ["openFile"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const filePath = result.filePaths[0];
      if (!filePath) {
        return { success: false, error: "未选择文件" };
      }
      const stat = fs.statSync(filePath);
      return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        fileSize: stat.size,
        extension: path.extname(filePath).toLowerCase(),
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(
    C.TRANSCRIPTION.VALIDATE_FILE,
    async (_event, filePath: string) => {
      const validation = validateAudioPath(filePath);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      try {
        const stat = fs.statSync(filePath);
        const MAX_FILE_SIZE = 500 * 1024 * 1024;
        if (stat.size > MAX_FILE_SIZE) {
          return { success: false, error: "文件超过500MB限制" };
        }
        return {
          success: true,
          filePath,
          fileName: path.basename(filePath),
          fileSize: stat.size,
          extension: validation.ext,
        };
      } catch {
        return { success: false, error: "文件不存在或无法访问" };
      }
    },
  );

  ipcMain.handle(
    C.TRANSCRIPTION.TRANSCRIBE_FILE,
    async (event, audioPath: string, options: Record<string, unknown> = {}) => {
      // [20260912_Refactor_261_TranscriptionService] Thin shell: validation,
      // hotword injection/fallback, transcription, cleaning, and the DB
      // persist moved into transcribeFileService unchanged. The only
      // renderer coupling left here is the progress wiring — the
      // event.sender.send closure is handed to the service as its optional
      // onProgress callback (a headless caller would omit it; the returned
      // result is unaffected).
      return await transcribeFileService(
        transcriptionDeps,
        audioPath,
        options,
        (progress: unknown) => {
          event.sender.send(C.EVENTS.FILE_TRANSCRIPTION_PROGRESS, progress);
        },
      );
    },
  );

  ipcMain.handle(C.TRANSCRIPTION.CANCEL, async () => {
    return await funasrManager.cancelTranscription();
  });

  ipcMain.handle(C.TRANSCRIPTION.DIARIZE, async (_event, id: number) => {
    // [20260912_Refactor_261_TranscriptionService] Thin shell: the record
    // lookup, segments JSON parsing, audio-path resolution, and the
    // diarizeAudio delegation moved into diarizeTranscriptionService
    // unchanged (same {success:false, error} envelopes).
    return await diarizeTranscriptionService(transcriptionDeps, id);
  });

  ipcMain.handle(
    C.TRANSCRIPTION.EXPORT,
    async (
      _event,
      id: number,
      format: string,
      _options: Record<string, unknown> = {},
    ) => {
      try {
        const row = databaseManager.getTranscriptionById(id);
        if (!row) {
          return { success: false, error: "转录记录不存在" };
        }

        let segments: unknown[] = [];
        if (row.segments) {
          try {
            segments = JSON.parse(row.segments);
          } catch (e) {
            logger.warn?.(
              "Segments JSON parse failed for id",
              id,
              (e as Error).message,
            );
          }
        }
        const transcription = {
          ...row,
          parsedSegments: segments,
        } as unknown as TranscriptionForExport;

        const fmt = exportFormatters.getFormatInfo(format);
        if (!fmt) {
          return { success: false, error: `不支持的格式: ${format}` };
        }

        const content = await fmt.formatter(transcription);
        const isBuffer = Buffer.isBuffer(content);

        const defaultName = `转录_${new Date().toISOString().slice(0, 10)}${fmt.ext}`;
        const saveResult = await dialog.showSaveDialog({
          title: "导出转录文件",
          defaultPath: defaultName,
          filters: [
            {
              name: fmt.ext.replace(".", "").toUpperCase(),
              extensions: [fmt.ext.replace(".", "")],
            },
          ],
        });

        if (saveResult.canceled) {
          return { success: false, canceled: true };
        }

        if (isBuffer) {
          await fs.promises.writeFile(saveResult.filePath!, content as Buffer);
        } else {
          await fs.promises.writeFile(
            saveResult.filePath!,
            content as string,
            "utf-8",
          );
        }

        return { success: true, path: saveResult.filePath };
      } catch (error) {
        logger.error?.("导出转录失败:", error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  ipcMain.handle(
    C.TRANSCRIPTION.AI_REVIEW,
    async (_event, id: number, template: string) => {
      try {
        const row = databaseManager.getTranscriptionById(id);
        if (!row) {
          return { success: false, error: "转录记录不存在" };
        }

        // [20260725_Fix_NonNullAssertion] Guard against missing processTextWithAI
        // instead of using non-null assertion (!). Returns a clear error message
        // rather than letting TypeError propagate as a generic caught error.
        if (!processTextWithAI) {
          return { success: false, error: "AI 处理功能不可用" };
        }
        // [20260906_Refactor_PolishOrchestrator] Spec #193 T3 (ticket #230):
        // pass the review mode/template explicitly into the shared polish
        // orchestrator (runPolishOrchestrator, via the processTextWithAI
        // adapter) instead of pre-building the prompt here — the old code
        // built system/user prompts locally and injected them as
        // systemPrompt/userPrompt options, bypassing the orchestrator's
        // normal prompt branch. Semantics preserved: an empty template falls
        // back to "professional" and the orchestrator resolves the built-in
        // prompt (identical bytes to the previously hand-built one), and the
        // result stays RETURN-ONLY (mapped to reviewText, never persisted).
        const result = await processTextWithAI(
          row.text || "",
          template || "professional",
          databaseManager,
          logger,
          {},
        );

        if (!result.success) {
          return result;
        }

        return { success: true, reviewText: result.text };
      } catch (error) {
        logger.error?.("AI创作稿生成失败:", error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  ipcMain.handle(
    C.TRANSCRIPTION.SAVE,
    (_event, data: Record<string, unknown>) => {
      try {
        const result = databaseManager.saveTranscription(data);
        return {
          success: true,
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes,
        };
      } catch (error) {
        logger.error?.("保存转录失败:", error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  // [20260906_Feat_TranscriptionUpdate] Spec #193 T1 (ticket #228): manual
  // polish write-back. The renderer only polishes SAVED records, so the
  // polished text lands in the SAME row (processed_text + text); raw_text is
  // not in the DB layer's whitelist and always keeps the original ASR
  // output. Whitelist rejections from database.updateTranscription surface
  // through the normal {success:false, error} envelope; a missing record is
  // rejected before any write, matching the sibling DIARIZE/AI_REVIEW guards.
  // [20260906_Feat_ManualEditProtection] Spec #193 T2 (ticket #229): the
  // success echo carries the refreshed manually_edited flag so the edit-save
  // caller can observe the persisted mark.
  ipcMain.handle(
    C.TRANSCRIPTION.UPDATE,
    (
      _event,
      id: number,
      patch: Record<string, unknown>,
      options?: { skipWhenManuallyEdited?: boolean },
    ) => {
      try {
        const row = databaseManager.getTranscriptionById(id);
        if (!row) {
          return { success: false, error: "转录记录不存在" };
        }
        // [20260912_Fix_322_AutoUpdateGuard] Ticket #322: the end-of-recording
        // auto-polish write-back now rides this channel, so caller options
        // (the T2 skipWhenManuallyEdited seam) must reach the DB-layer guard.
        const result = databaseManager.updateTranscription(id, patch, options);
        // [20260912_Fix_322_AutoUpdateGuard] A skipped guard outcome is a
        // success no-op (the user's manual edit won), NOT a missing row —
        // report skipped + the refreshed flag so the renderer can fall back
        // to the raw text instead of treating it as an error.
        if (result?.skipped) {
          const current = databaseManager.getTranscriptionById(id);
          return {
            success: true,
            skipped: true,
            manually_edited: current?.manually_edited,
          };
        }
        // [20260906_Feat_TranscriptionUpdate_Review] A row deleted between
        // update and re-read must not report success with undefined fields.
        if (!result || result.changes === 0) {
          return { success: false, error: "转录记录不存在" };
        }
        const updated = databaseManager.getTranscriptionById(id);
        return {
          success: true,
          text: updated?.text,
          processed_text: updated?.processed_text,
          raw_text: updated?.raw_text,
          manually_edited: updated?.manually_edited,
        };
      } catch (error) {
        logger.error?.("更新转录记录失败:", error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  ipcMain.handle(
    C.TRANSCRIPTION.GET_ALL,
    (_event, limit: number, offset: number) => {
      return databaseManager.getTranscriptions(limit, offset);
    },
  );

  // [20260816_Refactor_DeadChannels] The GET (single-record) and STATS
  // handlers were removed — zero renderer callers; getTranscriptionById
  // stays (the AI_REVIEW/DIARIZE handlers use it).

  // [20260905_Fix_249_ReviewNit] Wrap the raw RunResult into OperationResult
  // like CLEAR does — DELETE is the last transcription handler still leaking
  // node:sqlite's {changes, lastInsertRowid} past the declared contract.
  ipcMain.handle(C.TRANSCRIPTION.DELETE, (_event, id: number) => {
    try {
      const result = databaseManager.deleteTranscription(id) as {
        changes?: number;
      };
      return { success: true, changes: result.changes ?? 0 };
    } catch (error) {
      logger.error?.("删除转录记录失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // [20260905_Fix_248_ReviewClearContract] Wrap the raw node:sqlite RunResult
  // ({changes, lastInsertRowid}) into the declared OperationResult contract —
  // the renderer checks `success`, and the unwrapped shape made every
  // successful clear report failure (review BLOCKER, issue #248).
  ipcMain.handle(C.TRANSCRIPTION.CLEAR, () => {
    try {
      const result = databaseManager.clearAllTranscriptions() as {
        changes?: number;
      };
      return { success: true, changes: result.changes ?? 0 };
    } catch (error) {
      logger.error?.("清空转录记录失败:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(C.TRANSCRIPTION.EXPORT_ALL, async (_event, format: string) => {
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

      const result = await dialog.showSaveDialog({
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
  });
}
// [20260724_TS_BigBang_TranscriptionHandlers] END
