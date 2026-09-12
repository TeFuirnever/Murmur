// [20260912_Refactor_261_TranscriptionService] Ticket #261 (spec #258
// Phase 0 — 转写域服务化): transcription-domain service extraction. The
// TRANSCRIBE_FILE and DIARIZE handler bodies (transcriptionHandlers.ts)
// and the MODELS.CHECK engine-status probe (modelHandlers.ts) move here
// as plain main-process functions that receive every collaborator through
// a `TranscriptionServiceDeps` bag and depend on NO renderer, window, or
// event sender. The IPC handlers stay thin shells: same channels, same
// envelopes, with the `event.sender.send` progress wiring translated into
// this module's optional `onProgress` callback (a sender-less caller
// simply omits it; the returned result is unaffected). Behavior is
// byte-identical to the pre-extraction handlers — locked by the
// unmodified tests/unit/transcriptionHandlers.test.ts; new headless seam
// coverage lives in tests/unit/transcriptionService.test.ts. Comments and
// log strings copied from the handlers are kept verbatim (Chinese log
// strings are pre-existing diagnostics).

import { validateAudioPath } from "../audioPathValidator";
import { cleanTranscriptionText } from "../transcriptCleaner";
import { sanitizeHotwordInput } from "../hotwords";

// [20260912_Refactor_261_TranscriptionService] Structural types echoed
// from the handler files — the minimal surface the services touch. No
// Electron types here: the seam exists so these functions run headless
// (background jobs, tests) with plain mock deps.

/** Logger surface used for diagnostics; every method is optional. */
export interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

/** DB row subset read by the diarize service (diagnostics fields omitted). */
interface TranscriptionRow {
  segments?: string;
  source_file_path?: string;
  audio_path?: string;
  [key: string]: unknown;
}

/** Collaborator bag injected into every service function below. */
export interface TranscriptionServiceDeps {
  funasrManager: {
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
    diarizeAudio(audioPath: string, segments: unknown[]): Promise<unknown>;
    checkModelFiles(): Promise<
      { models_downloaded: boolean } & Record<string, unknown>
    >;
  };
  databaseManager: {
    saveTranscription(data: Record<string, unknown>): {
      lastInsertRowid?: number | bigint;
      changes?: number;
    };
    // Synchronous settings read (hotword injection).
    getSetting(key: string, defaultValue?: unknown): unknown;
    getTranscriptionById(id: number): TranscriptionRow | null;
  };
  logger: Logger;
}
// [20260912_Refactor_261_TranscriptionService] END

// [20260912_Refactor_261_TranscriptionService] Moved verbatim from
// transcriptionHandlers.ts (was the [20260819_T10_CleanerWiring] block).
// Ticket #188 (spec #177 T10): clean ASR output at the two transcription
// seams (mic AUDIO + file TRANSCRIBE_FILE). The response carries CLEANED
// text/raw_text/segments (AI polish and the UI consume cleaned content)
// PLUS original_text = the PRE-CLEAN text, which the file path persists
// into the DB raw_text column and the mic path forwards via the renderer
// — wrongly-folded text stays recoverable. The generic SAVE channel and
// the AI review channel are deliberately NOT cleaned (user edits / AI
// output must never be re-cleaned — locked by tests). v1 cleaner rules
// are fold-only, so a non-empty input can never clean to empty; the
// || original fail-safe below makes that invariant hold even if future
// rules regress it.
interface CleanableTranscriptionResult {
  success?: boolean;
  text?: string;
  raw_text?: string;
  original_text?: string;
  segments?: Array<{ start_ms: number; end_ms: number; text: string }>;
}

export function applyTranscriptionCleaning(
  result: unknown,
  logger: Logger,
): void {
  const cleanable = result as CleanableTranscriptionResult | null;
  if (!cleanable || !cleanable.success || !cleanable.text) return;

  const originalText = cleanable.text;
  const rawCleaned = cleanTranscriptionText(originalText);
  // Fail-safe: a non-empty input must never clean to empty. v1 rules are
  // fold-only (property-tested), so this is unreachable defensive depth —
  // but if a future rule regresses the invariant, WARN loudly instead of
  // silently no-op'ing. [T10 review fixup]
  let cleanedText = rawCleaned;
  if (!cleanedText) {
    logger.warn?.("清洗产生空文本，回退原文（清洗器规则回归信号）", {
      original: originalText,
    });
    cleanedText = originalText;
  }
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
// [20260912_Refactor_261_TranscriptionService] END

// [20260912_Refactor_261_TranscriptionService] The two hotword helpers
// moved verbatim from inside transcriptionHandlers.register() (the
// [20260820_T14_Hotwords] closures) — they are domain logic, so they
// live in the service module now and take `deps` instead of closing
// over the managers bag. END

/**
 * Main-process hotword injection (preload/IPC signatures untouched):
 * read the stored list, sanitize at this boundary, and inject into the
 * request options. Empty/invalid → options returned as-is (no hotword
 * field — byte-identical to pre-T14 traffic). An explicit caller-provided
 * hotword wins over the stored list. A settings read failure must never
 * block transcription.
 */
export async function injectStoredHotwords(
  // [20260912_Fix_261_Review_DepsSlices] Review MINOR: each service takes
  // only the deps slice it uses (indexed-access Picks), so a headless
  // hotword-only caller can supply just the settings reader + logger.
  deps: {
    databaseManager: Pick<
      TranscriptionServiceDeps["databaseManager"],
      "getSetting"
    >;
    logger: Logger;
  },
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { databaseManager, logger } = deps;
  // [T14 review MINOR] Caller wins over the stored list, but does NOT
  // bypass hygiene: an explicit hotword is sanitized too (a broken
  // renderer must not feed garbage straight to the protocol). Identity
  // is preserved when sanitizing is a no-op, so caller-hotword requests
  // stay non-injected (no retry) as designed.
  if (typeof options.hotword === "string" && options.hotword.trim()) {
    const sanitized = sanitizeHotwordInput(options.hotword);
    if (sanitized === options.hotword) return options;
    if (!sanitized) {
      const { hotword: _dropped, ...rest } = options;
      return rest;
    }
    return { ...options, hotword: sanitized };
  }
  try {
    const stored = await databaseManager.getSetting("hotwords");
    const hotword = sanitizeHotwordInput(stored);
    if (!hotword) return options;
    return { ...options, hotword };
  } catch (error) {
    logger.warn?.("读取热词设置失败，跳过注入", error);
    return options;
  }
}

/**
 * Empty-hotword retry: if a hotword-injected request fails, retry ONCE
 * with the original (hotword-free) options — a bad hotword list must not
 * brick transcription. Success on the retry surfaces hotword_degraded=true
 * so the UI can point at the settings.
 *
 * [T14 review BLOCKER] The real transcribeAudio THROWS on failure (only
 * success resolves) — rejections are normalized here so the retry fires
 * under the real contract, not just under {success:false} mocks.
 *
 * [T14 review MAJOR-1] A user CANCEL is never retryable: the Python
 * entry clears cancel_event, so a retry would restart the transcription
 * the user just aborted.
 */
export async function withHotwordFallback(
  // [20260912_Fix_261_Review_DepsSlices] Retry orchestration needs the
  // logger only.
  deps: { logger: Logger },
  baseOptions: Record<string, unknown>,
  hotwordOptions: Record<string, unknown>,
  run: (options: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  const { logger } = deps;
  const normalize = async (p: Promise<unknown>): Promise<unknown> => {
    try {
      return await p;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const injected = hotwordOptions !== baseOptions;
  const first = await normalize(run(hotwordOptions));
  if (!injected) return first;
  if ((first as { canceled?: boolean }).canceled === true) return first;
  const failed = !first || (first as { success?: boolean }).success === false;
  if (!failed) return first;
  logger.warn?.("热词转写失败，以空热词重试一次");
  const retry = await normalize(run(baseOptions));
  if (retry && (retry as { success?: boolean }).success) {
    return { ...(retry as object), hotword_degraded: true };
  }
  return retry;
}
// [20260912_Refactor_261_TranscriptionService] END

/**
 * File transcription pipeline (the TRANSCRIBE_FILE handler body):
 * validate → hotword injection + fallback → transcription → cleaning →
 * DB persist. `onProgress` is OPTIONAL — the IPC handler passes the
 * `event.sender.send` wiring; headless callers omit it entirely (the
 * progress callback never affects the returned result).
 */
export async function transcribeFileService(
  // [20260912_Fix_261_Review_DepsSlices] Review MINOR: the file seam uses
  // transcribeFile + settings/save reads only — no diarize/checkModelFiles
  // surface required from callers.
  deps: {
    funasrManager: Pick<
      TranscriptionServiceDeps["funasrManager"],
      "transcribeFile"
    >;
    databaseManager: Pick<
      TranscriptionServiceDeps["databaseManager"],
      "getSetting" | "saveTranscription"
    >;
    logger: Logger;
  },
  audioPath: string,
  options: Record<string, unknown> = {},
  onProgress?: (progress: unknown) => void,
  // [20260912_Feat_269_McpServer] Opt-out persistence switch (ticket #269):
  // the MCP `transcribe_file` tool must NOT write history unless the caller
  // explicitly asks for it (save=true), so the tool can honestly advertise
  // itself as non-persisting by default. Default is UNDEFINED → persist,
  // which keeps every existing caller (IPC handlers, CLI channel traffic)
  // byte-identical to the previous always-persist behavior.
  persist?: boolean,
): Promise<unknown> {
  const { funasrManager, databaseManager, logger } = deps;
  const validation = validateAudioPath(audioPath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  // [20260912_Refactor_261_TranscriptionService] The handler built
  // `baseOptions` with an inline `event.sender.send` progress callback.
  // The sender coupling now stays in the handler: onProgress is merged
  // into baseOptions here ONLY when provided, so sender-less callers
  // get byte-identical options to a handler call minus the callback.
  // [20260820_T14_Hotwords] File seam: same injection + fallback as the
  // mic seam (hotwords apply to imports too — long files are where
  // proper nouns live).
  const baseOptions: Record<string, unknown> = { ...options };
  if (onProgress) {
    baseOptions.onProgress = onProgress;
  }
  const withHotword = await injectStoredHotwords(deps, baseOptions);
  // [20260820_T14_Hotwords] withHotwordFallback returns unknown; the
  // file path below reads the transcription shape through this view.
  const result = (await withHotwordFallback(
    deps,
    baseOptions,
    withHotword,
    (opts) => funasrManager.transcribeFile(audioPath, opts) as Promise<unknown>,
  )) as CleanableTranscriptionResult & { id?: number; duration?: number };
  // [20260819_T10_CleanerWiring] File seam: clean response (text /
  // raw_text / segments), keep the pre-clean original for the DB.
  applyTranscriptionCleaning(result, logger);

  // [20260912_Feat_269_McpServer] The persist block is now conditional
  // (ticket #269): `persist !== false` keeps the default-true behavior for
  // every pre-existing caller; only an explicit persist=false (the MCP
  // tool's save=false default) skips the DB write entirely — the
  // transcription result itself is unaffected either way.
  if (result.success && result.text && persist !== false) {
    try {
      // [20260819_T10_CleanerWiring] original_text is added by
      // applyTranscriptionCleaning; read it through the typed view.
      const dbResult = databaseManager.saveTranscription({
        text: result.text,
        // [20260819_T10_CleanerWiring] raw_text column keeps the
        // PRE-CLEAN text (recovery); processed_text keeps the cleaned
        // raw output (previously this column stored the uncleaned raw).
        raw_text: result.original_text || null,
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
}
// [20260912_Refactor_261_TranscriptionService] END

/**
 * Speaker diarization (the DIARIZE handler body): load the record, parse
 * its stored segments JSON, resolve the audio path, delegate to the ASR
 * engine. Errors surface through the same {success:false, error} envelope.
 */
export async function diarizeTranscriptionService(
  // [20260912_Fix_261_Review_DepsSlices] Review MINOR: diarization needs
  // only the record reader and the ASR diarize entry.
  deps: {
    funasrManager: Pick<
      TranscriptionServiceDeps["funasrManager"],
      "diarizeAudio"
    >;
    databaseManager: Pick<
      TranscriptionServiceDeps["databaseManager"],
      "getTranscriptionById"
    >;
    logger: Logger;
  },
  id: number,
): Promise<unknown> {
  const { funasrManager, databaseManager, logger } = deps;
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
}
// [20260912_Refactor_261_TranscriptionService] END

/**
 * Engine status probe (the MODELS.CHECK handler body): a pure pass-through
 * to funasrManager.checkModelFiles(), callable without a renderer/sender.
 * Takes only the checkModelFiles slice of the manager — callers carry the
 * rest of the surface (e.g. downloadModels in modelHandlers) untouched.
 */
export async function checkEngineStatusService(deps: {
  funasrManager: Pick<
    TranscriptionServiceDeps["funasrManager"],
    "checkModelFiles"
  >;
}): Promise<{ models_downloaded: boolean } & Record<string, unknown>> {
  return await deps.funasrManager.checkModelFiles();
}
// [20260912_Refactor_261_TranscriptionService] END
