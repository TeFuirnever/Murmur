// [20260724_TS_BigBang_TranscriptionHandlers] Migrated from .js to .ts (ADR-010).
import path from "path";
import fs from "fs";
import { dialog } from "electron";
import * as C from "../ipc-contracts";
import * as exportFormatters from "../exportFormatters";
import type { TranscriptionForExport } from "../exportFormatters";
import { buildPrompt } from "../aiPrompts";
import { validateAudioPath } from "../audioPathValidator";
import { cleanTranscriptionText } from "../transcriptCleaner";

// [20260819_T10_CleanerWiring] Ticket #188 (spec #177 T10): clean ASR
// output at the two transcription seams (mic AUDIO + file TRANSCRIBE_FILE).
// The response carries CLEANED text/raw_text/segments (AI polish and the UI
// consume cleaned content) PLUS original_text = the PRE-CLEAN text, which
// the file path persists into the DB raw_text column and the mic path
// forwards via the renderer — wrongly-folded text stays recoverable.
// The generic SAVE channel and the AI review channel are deliberately NOT
// cleaned (user edits / AI output must never be re-cleaned — locked by
// tests). v1 cleaner rules are fold-only, so a non-empty input can never
// clean to empty; the || original fail-safe below makes that invariant
// hold even if future rules regress it.
interface CleanableTranscriptionResult {
  success?: boolean;
  text?: string;
  raw_text?: string;
  original_text?: string;
  segments?: Array<{ start_ms: number; end_ms: number; text: string }>;
}

function applyTranscriptionCleaning(result: unknown, logger: Logger): void {
  const cleanable = result as CleanableTranscriptionResult | null;
  if (!cleanable || !cleanable.success || !cleanable.text) return;

  const originalText = cleanable.text;
  const cleanedText = cleanTranscriptionText(originalText) || originalText;
  const cleanedRaw = cleanable.raw_text
    ? cleanTranscriptionText(cleanable.raw_text) || cleanable.raw_text
    : undefined;

  if (
    cleanedText !== originalText ||
    (cleanedRaw !== undefined && cleanedRaw !== cleanable.raw_text)
  ) {
    logger.debug?.("转录文本清洗", {
      before: originalText,
      after: cleanedText,
    });
  }

  cleanable.original_text = originalText;
  cleanable.text = cleanedText;
  if (cleanedRaw !== undefined) cleanable.raw_text = cleanedRaw;
  if (Array.isArray(cleanable.segments)) {
    cleanable.segments = cleanable.segments.map((seg) => ({
      ...seg,
      text: cleanTranscriptionText(seg.text) || seg.text,
    }));
  }
}

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

interface TranscriptionRow {
  text?: string;
  segments?: string;
  source_file_path?: string;
  audio_path?: string;
  [key: string]: unknown;
}

interface DatabaseManager {
  saveTranscription(data: Record<string, unknown>): {
    lastInsertRowid?: number | bigint;
    changes?: number;
  };
  getTranscriptionById(id: number): TranscriptionRow | null;
  getTranscriptions(limit: number, offset: number): TranscriptionRow[];
  deleteTranscription(id: number): unknown;
  clearAllTranscriptions(): unknown;
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

  ipcMain.handle(
    C.TRANSCRIPTION.AUDIO,
    async (_event, audioData: unknown, options: unknown) => {
      const result = await funasrManager.transcribeAudio(audioData, options);
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
      const validation = validateAudioPath(audioPath);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      const result = await funasrManager.transcribeFile(audioPath, {
        ...options,
        onProgress: (progress: unknown) => {
          event.sender.send(C.EVENTS.FILE_TRANSCRIPTION_PROGRESS, progress);
        },
      });
      // [20260819_T10_CleanerWiring] File seam: clean response (text /
      // raw_text / segments), keep the pre-clean original for the DB.
      applyTranscriptionCleaning(result, logger);

      if (result.success && result.text) {
        try {
          // [20260819_T10_CleanerWiring] original_text is added by
          // applyTranscriptionCleaning; read it through the typed view.
          const cleaned = result as CleanableTranscriptionResult;
          const dbResult = databaseManager.saveTranscription({
            text: result.text,
            // [20260819_T10_CleanerWiring] raw_text column keeps the
            // PRE-CLEAN text (recovery); processed_text keeps the cleaned
            // raw output (previously this column stored the uncleaned raw).
            raw_text: cleaned.original_text || null,
            processed_text: result.raw_text || result.text,
            source_type: "file",
            source_file_path: audioPath,
            segments: result.segments ? JSON.stringify(result.segments) : null,
            duration: result.duration || null,
          });
          if (dbResult && dbResult.lastInsertRowid) {
            result.id = Number(dbResult.lastInsertRowid);
          }
        } catch (dbErr) {
          logger.error?.("保存转录结果到数据库失败:", dbErr);
        }
      }

      return result;
    },
  );

  ipcMain.handle(C.TRANSCRIPTION.CANCEL, async () => {
    return await funasrManager.cancelTranscription();
  });

  ipcMain.handle(C.TRANSCRIPTION.DIARIZE, async (_event, id: number) => {
    try {
      const row = databaseManager.getTranscriptionById(id);
      if (!row) return { success: false, error: "转录记录不存在" };

      let segments: unknown[] = [];
      if (row.segments) {
        try {
          segments = JSON.parse(row.segments);
        } catch {}
      }
      if (!segments.length) return { success: false, error: "无分段数据" };

      const audioPath = row.source_file_path || row.audio_path;
      if (!audioPath) return { success: false, error: "音频文件不存在" };

      const result = await funasrManager.diarizeAudio(
        audioPath,
        segments as unknown[],
      );
      return result;
    } catch (err) {
      logger.error?.("说话人分离失败:", err);
      return { success: false, error: (err as Error).message };
    }
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

        const { system, user } = buildPrompt(
          template || "professional",
          row.text || "",
        );
        // [20260725_Fix_NonNullAssertion] Guard against missing processTextWithAI
        // instead of using non-null assertion (!). Returns a clear error message
        // rather than letting TypeError propagate as a generic caught error.
        if (!processTextWithAI) {
          return { success: false, error: "AI 处理功能不可用" };
        }
        const result = await processTextWithAI(
          row.text || "",
          template || "professional",
          databaseManager,
          logger,
          { systemPrompt: system, userPrompt: user },
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

  ipcMain.handle(
    C.TRANSCRIPTION.GET_ALL,
    (_event, limit: number, offset: number) => {
      return databaseManager.getTranscriptions(limit, offset);
    },
  );

  // [20260816_Refactor_DeadChannels] The GET (single-record) and STATS
  // handlers were removed — zero renderer callers; getTranscriptionById
  // stays (the AI_REVIEW/DIARIZE handlers use it).

  ipcMain.handle(C.TRANSCRIPTION.DELETE, (_event, id: number) => {
    return databaseManager.deleteTranscription(id);
  });

  ipcMain.handle(C.TRANSCRIPTION.CLEAR, () => {
    return databaseManager.clearAllTranscriptions();
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

      let content: Buffer | string;
      if (format === "docx") {
        // [20260724_TS_BigBang_TranscriptionHandlers] Pre-existing behavior:
        // the .js passed the whole transcriptions array to formatDOCX
        // (which expects a single record). Preserve runtime behavior via
        // a cast; the doc comes out with empty text/segments as before.
        content = await exportFormatters.formatDOCX(
          transcriptions as unknown as TranscriptionForExport,
        );
        fs.writeFileSync(result.filePath, content as Buffer);
      } else {
        // [20260815_Refactor_FormatterLookup] getFormatInfo above already
        // resolved the right formatter; the nested ternary re-derived it.
        const formatter = formatInfo.formatter;
        content = (transcriptions as unknown[])
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
