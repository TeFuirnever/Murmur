// [20260724_TS_BigBang_AIHandlers] Migrated from .js to .ts (ADR-010).
// `module.exports = { register, processTextWithAI, ... }` (named) became
// named exports. Lazy require("electron") for templatesDir kept as require
// (import is hoisted; the lazy require defers electron load to call time).
import path from "path";
import * as C from "../ipc-contracts";
import { buildPrompt, loadCustomTemplates } from "../aiPrompts";
import type { PromptTemplate } from "../aiPrompts";
import { getProviderPresets } from "../providerPresets";
import { detectLocalModels } from "../detectLocalModels";
// [20260907_Feat_235_StreamPipeline] T8 chunk protocol union.
import type { PolishChunk } from "../../types/ipc";
import {
  createSseMerger,
  STREAM_MAX_CHUNKS,
  streamDeadlineViolation,
} from "../polish-stream";
// [20260908_Feat_333_VocabInjection] Corrections-table injection (T13→#333).
import { filterVocabForInjection } from "../vocab";
// [20260910_Feat_237_StreamDegradation] T10: degradation memory read/write.
import {
  isStreamDegradationRemembered,
  rememberStreamDegradation,
} from "../streamDegradation";

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

interface DatabaseManager {
  getSetting(key: string): Promise<unknown>;
  // [20260908_Feat_333_VocabInjection] Corrections-table read for injection.
  listVocabCorrections?(): Array<{ wrong: string; right: string }>;
  // [20260910_Feat_237_StreamDegradation] T10 store surface (optional so
  // legacy test doubles that only stub getSetting keep compiling; the
  // degradation paths run only for streaming requests, and a store without
  // write/enumeration simply cannot remember).
  setSetting?(key: string, value: unknown): unknown;
  getAllSettings?(): Record<string, unknown>;
  deleteSetting?(key: string): unknown;
}

interface AIMode {
  name: string;
  label: string;
  description: string;
}

// [20260906_Feat_OrchestratorGenCancel] Machine-readable outcome codes for
// runs that end without a provider result. They let the renderer stay silent
// for user cancels and superseded races instead of surfacing an error UI.
export type PolishOutcomeCode = "CANCELLED" | "SUPERSEDED";

interface AIResult {
  success: boolean;
  text?: string;
  error?: string;
  usage?: unknown;
  model?: string;
  // Present only when the run was cancelled by the caller ("CANCELLED") or
  // invalidated by a newer run in the same generation scope ("SUPERSEDED").
  code?: PolishOutcomeCode;
}

const BUILT_IN_MODES: AIMode[] = [
  {
    name: "optimize",
    label: "智能润色",
    description: "优化文本流畅度和表达，适合日常录音",
  },
  {
    name: "optimize_long",
    label: "长文本整理",
    description: "结构化整理长文本，保留完整信息",
  },
  { name: "format", label: "格式化", description: "整理文本排版和段落结构" },
  { name: "correct", label: "校对纠错", description: "修正语法错误和拼写问题" },
  {
    name: "summarize",
    label: "摘要总结",
    description: "提取文本核心要点生成摘要",
  },
  {
    name: "enhance",
    label: "内容优化",
    description: "增强文本内容的深度和表现力",
  },
  {
    name: "xiaohongshu",
    label: "小红书风格",
    description: "转换为小红书笔记风格，emoji丰富、亲切分享、互动感强",
  },
  {
    name: "zhihu",
    label: "知乎风格",
    description: "转换为知乎深度回答风格，结构化论述、专业权威",
  },
  {
    name: "douyin",
    label: "抖音风格",
    description: "转换为抖音口播文案风格，短句节奏、勾子开头、口语化",
  },
  {
    name: "de-ai",
    label: "去AI化",
    description: "消除AI写作痕迹，让文本自然有人味，保留原意",
  },
];

const TEMPLATE_CACHE_TTL_MS = 30_000;
let templateCache: {
  dir: string | null;
  time: number;
  templates: PromptTemplate[];
} = {
  dir: null,
  time: 0,
  templates: [],
};

function getCachedTemplates(templatesDir: string): PromptTemplate[] {
  const now = Date.now();
  if (
    templateCache.dir === templatesDir &&
    now - templateCache.time < TEMPLATE_CACHE_TTL_MS
  ) {
    return templateCache.templates;
  }
  const templates = loadCustomTemplates(templatesDir);
  templateCache = { dir: templatesDir, time: now, templates };
  return templates;
}

export function getAIModes(templatesDir: string): AIMode[] {
  const custom = getCachedTemplates(templatesDir);
  const customNames = new Set(custom.map((t) => t.name));
  const builtIn = BUILT_IN_MODES.filter((m) => !customNames.has(m.name));
  return [
    ...builtIn,
    // [20260724_TS_BigBang_AIHandlers] PromptTemplate has no `description`
    // field in the type (only name/label/system/user). The .js referenced
    // t.description which was always undefined; map to "" to preserve shape.
    ...custom.map((t) => ({
      name: t.name,
      label: t.label,
      description: "",
    })),
  ];
}

function isLocalhost(host: string | null | undefined): boolean {
  if (!host) return false;
  host = host.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  if (/^127\./.test(host)) return true;
  return false;
}

// [20260907_Fix_233_SsrfHardening] Security-review MEDIUM: the IPv4-text
// checks missed IPv4-mapped IPv6 (::ffff:a00:1), IPv6 ULA fc00::/7,
// link-local fe80::/10, loopback ::/128, and CGNAT 100.64.0.0/10 — all
// resolve to private/internal addresses while canonicalizing to hostnames
// that matched no regex. Bracket stripping + mapped-address reduction close
// the gap for every AI channel that shares this gate.
function isPrivateNetwork(host: string): boolean {
  if (!host) return false;
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "::1" || bare === "::") return true;
  const mapped = bare.match(/^::ffff:(.+)$/);
  if (mapped) {
    // WHATWG canonicalizes mapped addresses to hex form ([::ffff:a00:1]);
    // convert the trailing 32 bits back to dotted-decimal for the IPv4
    // checks below.
    const hex = mapped[1]!.match(/^([0-9a-f]+):([0-9a-f]+)$/);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return isPrivateNetwork(
        `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`,
      );
    }
    return isPrivateNetwork(mapped[1]!);
  }
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true; // IPv6 ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(bare)) return true; // IPv6 link-local
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(bare)) return true; // CGNAT
  if (/^198\.(1[89]|0)\./.test(bare)) return true; // benchmark 198.18.0.0/15
  if (/^10\./.test(bare)) return true;
  if (/^192\.168\./.test(bare)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return true;
  if (/^169\.254\./.test(bare)) return true;
  if (/^127\./.test(bare)) return true;
  return false;
}

export function validateAIBaseUrl(
  baseUrl: string,
  { allowLocalhost = false }: { allowLocalhost?: boolean } = {},
): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    if (!host) return false;

    if (allowLocalhost && isLocalhost(host)) {
      return url.protocol === "http:" || url.protocol === "https:";
    }

    if (url.protocol !== "https:") return false;
    if (isLocalhost(host)) return false;
    if (isPrivateNetwork(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// [20260815_Refactor_AiFetchDedup] processTextWithAI and checkAIStatus used
// to hand-roll the same sequence: auth headers, AbortController + timeout,
// fetch, AbortError→TIMEOUT mapping, and non-OK error-body parsing. The three
// helpers below carry that shared plumbing so the callers only keep their
// genuinely different parts (request shape, response interpretation, and the
// user-facing error text).
// [20260815_Refactor_AiFetchDedup] END

// [20260907_Feat_233_ListModels] Ticket #233: derive the /models endpoint
// from the base URL with the URL constructor only — never whole-URL string
// concatenation. Bases that already end in a version segment get exactly
// one candidate ({base}/models); other bases try {base}/models first and
// {base}/v1/models second (the common "no /v1 in base_url" gateway shape).
function modelEndpointCandidates(baseUrl: string): string[] {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const withPath = (suffix: string) => {
    const derived = new URL(baseUrl);
    derived.pathname = basePath + suffix;
    return derived.toString();
  };
  if (/\/v\d+$/.test(basePath)) {
    return [withPath("/models")];
  }
  return [withPath("/models"), withPath("/v1/models")];
}

// [20260907_Feat_233_ListModels] Response contract for the provider /models
// listing. Anything outside the shape silently degrades the renderer to the
// manual-input path (ticket #233: 非法即静默回退手输).
const MODELS_MAX_ITEMS = 500;
const MODELS_MAX_ID_BYTES = 200;
const MODELS_MAX_BODY_BYTES = 512 * 1024;
// [20260908_Fix_BatchReview_M8] Named per the no-magic-numbers rule.
const LIST_MODELS_TIMEOUT_MS = 10_000;

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    return isLocalhost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

interface ChatCompletionMessage {
  role: string;
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

async function postChatCompletion(
  baseUrl: string,
  apiKey: string | undefined,
  body: ChatCompletionRequest,
  timeoutMs: number,
  timeoutMessage: string,
  // [20260906_Feat_OrchestratorGenCancel] T7 cancel semantics: run-level
  // signal (caller cancel / generation supersession) combined with the
  // timeout signal. When THIS signal fires, the raw AbortError is rethrown
  // so the orchestrator can classify it as a silent cancel/supersede — only
  // the timeout abort maps to the TIMEOUT error message.
  externalSignal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (externalSignal?.aborted) {
      throw fetchError;
    }
    if ((fetchError as Error).name === "AbortError") {
      throw Object.assign(new Error(timeoutMessage), { code: "TIMEOUT" });
    }
    throw fetchError;
  }
  clearTimeout(timeoutId);
  return response;
}

// [20260907_Feat_235_StreamPipeline] T8: consume the streaming response
// body — merge upstream SSE via createSseMerger, push PolishChunk events to
// the initiating window, enforce the deadline matrix (first-delta / idle /
// total) and the cumulative output caps. Chunk TEXT never reaches the
// logger: only counts, byte sizes and durations are logged.
async function consumePolishStream(
  response: Response,
  stream: {
    requestId: string;
    notify: (chunk: PolishChunk) => void;
    timeouts?: { firstDeltaMs: number; idleMs: number };
  },
  runHandle: PolishRunHandle | null,
  logger: Logger | undefined,
  timeoutMs: number,
): Promise<{
  success: boolean;
  text?: string;
  error?: string;
  code?: PolishOutcomeCode;
}> {
  const requestId = stream.requestId;
  const notify = (chunk: PolishChunk) => stream.notify(chunk);
  const startedAt = Date.now();
  let lastActivity = startedAt;
  let receivedFirst = false;
  let chunkCount = 0;
  let outputChars = 0;
  let reasoningChars = 0;
  let fullText = "";
  const timeouts = stream.timeouts ?? {
    firstDeltaMs: STREAM_FIRST_DELTA_MS,
    idleMs: STREAM_IDLE_MS,
  };

  notify({ type: "start", requestId });
  const merger = createSseMerger({
    now: Date.now,
    onDelta: (t) => {
      receivedFirst = true;
      fullText += t;
      outputChars += t.length;
      notify({ type: "delta", requestId, text: t });
    },
    onReasoning: (t) => {
      reasoningChars += t.length;
    },
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const failWith = (message: string, errorCode: string) => {
    runHandle?.controller.abort();
    notify({ type: "error", requestId, error: message });
    logger?.error?.(
      "流式润色失败:",
      JSON.stringify({ requestId, code: errorCode, outputChars, chunkCount }),
    );
    return { success: false as const, error: message };
  };

  try {
    // Deadline matrix: first-delta before any content, idle between deltas,
    // total across the whole body ([20260907_Fix_235_TotalDeadline] — the
    // response-headers timer cleared on arrival, so body consumption needs
    // this explicit total bound). The read is raced against the nearest
    // remaining deadline so a stalled upstream wakes the loop for
    // classification.
    let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null =
      null;
    while (true) {
      const stage = receivedFirst ? "streaming" : "awaiting_first";
      // [20260908_Fix_BatchReview_M3] Reasoning-aware first-delta: the
      // awaiting-first window measures from the LAST ACTIVITY, not from
      // stream start. Thinking models stream delta.reasoning for well past
      // 15s before any content (the T5 spike's ② warning; the exact
      // profile of the 2026-08-15 production incident) — reasoning bytes
      // refresh lastActivity, so a live-thinking model survives; a truly
      // silent upstream still trips first_delta after 15 quiet seconds.
      const stageDeadline =
        lastActivity +
        (receivedFirst ? timeouts.idleMs : timeouts.firstDeltaMs);
      const totalDeadline = startedAt + timeoutMs;
      const deadline = Math.min(stageDeadline, totalDeadline);
      const remainingMs = Math.max(deadline - Date.now(), 1);
      let timerId: ReturnType<typeof setTimeout> | undefined;
      if (!pendingRead) pendingRead = reader.read();
      const raced = await Promise.race([
        pendingRead.then((r) => ({ kind: "read" as const, r })),
        new Promise<{ kind: "deadline" }>((resolve) => {
          timerId = setTimeout(
            () => resolve({ kind: "deadline" }),
            remainingMs,
          );
        }),
      ]);
      // A read-win clears its deadline timer; a deadline-win keeps the
      // queued read alive for the next iteration (no orphaned reads).
      clearTimeout(timerId);
      if (raced.kind === "deadline") {
        if (Date.now() >= totalDeadline) {
          return failWith("AI 流式响应总时长超时", "STREAM_TOTAL_TIMEOUT");
        }
        const violation = streamDeadlineViolation(
          stage,
          // [20260908_Fix_BatchReview_M3] Same base as the armed deadline
          // above: activity-relative for awaiting_first.
          receivedFirst ? startedAt : lastActivity,
          lastActivity,
          Date.now(),
          timeouts,
        );
        if (violation === "first_delta") {
          return failWith("AI 流式响应首块超时", "STREAM_FIRST_DELTA_TIMEOUT");
        }
        if (violation === "idle") {
          return failWith("AI 流式响应空闲超时", "STREAM_IDLE_TIMEOUT");
        }
        // Early wake (wall-clock jitter before the strict threshold):
        // re-arm the deadline and keep waiting on the SAME queued read.
        continue;
      }
      pendingRead = null;
      const { done, value } = raced.r;
      if (done) break;
      chunkCount++;
      lastActivity = Date.now();
      if (chunkCount > STREAM_MAX_CHUNKS) {
        return failWith("AI 流式响应块数超过上限", "STREAM_CHUNK_CAP");
      }
      notify({ type: "progress", requestId, bytes: value.length });
      merger.push(decoder.decode(value, { stream: true }));
      if (merger.contentChars() > 0) receivedFirst = true;
      if (outputChars > POLISH_OUTPUT_MAX_CHARS) {
        return failWith("AI 输出超过上限", "OUTPUT_CAP");
      }
      // T7 gates stay live mid-stream: a cancelled/superseded run settles
      // immediately without touching the renderer state again. Flush the
      // window BEFORE the terminal abort chunk so no delta trails it.
      const settled = polishRunOutcomeIfSettledAside(runHandle);
      if (settled) {
        merger.flush();
        notify({ type: "abort", requestId });
        return settled;
      }
    }
    decoder.decode(); // flush a possibly-split multi-byte tail
    merger.flush();
    if (!fullText) {
      return failWith("AI返回了空内容，请重试或更换模型", "EMPTY_CONTENT");
    }
    notify({ type: "finish", requestId, text: fullText, reasoningChars });
    logger?.info?.(
      "流式润色完成:",
      JSON.stringify({
        requestId,
        outputChars,
        reasoningChars,
        chunkCount,
        totalMs: Date.now() - startedAt,
      }),
    );
    return { success: true, text: fullText };
  } catch (error) {
    if (runHandle?.controller.signal.aborted) {
      notify({ type: "abort", requestId });
      const outcome = polishRunOutcomeIfSettledAside(runHandle);
      if (outcome) return outcome;
      return { success: false, error: "已取消", code: "CANCELLED" };
    }
    return failWith((error as Error).message || "流式处理失败", "STREAM_ERROR");
  }
}

/**
 * Extract the human-readable message from an OpenAI-style error body.
 * Returns "" when the body has no usable message; the caller supplies its
 * own status-code fallback text.
 */
function extractAIErrorMessage(
  response: Response,
  errorText: string,
  logger?: Logger,
): string {
  let errorData: { error?: { message?: string } | string } = {
    error: response.statusText,
  };
  try {
    errorData = JSON.parse(errorText);
  } catch {
    logger?.warn?.(
      "AI错误响应非JSON格式:",
      (errorText || "").substring(0, 200),
    );
    errorData = { error: errorText || response.statusText };
  }
  return (
    (typeof errorData.error === "object"
      ? errorData.error?.message
      : errorData.error) || ""
  );
}

// [20260906_Refactor_PolishOrchestrator] Spec #193 T3 (ticket #230): single
// polish orchestrator. BOTH polish IPC entries route through
// runPolishOrchestrator — C.AI.PROCESS (this module's register) and
// C.TRANSCRIPTION.AI_REVIEW (transcriptionHandlers, wired via the injected
// processTextWithAI adapter in src/helpers/ipc/index.ts). It owns the full
// pipeline for both: mode/template resolution → prompt building → provider
// call → response normalization/error mapping.
//
// Extension points for the upcoming spec tickets — add them HERE, never by
// bypassing this function, so both entries keep one shared seam:
//   - T7 generation invalidation: LANDED (20260906_Feat_OrchestratorGenCancel,
//     ticket #234) — PolishRequest.generationScope / .signal / .clampOutputTokens
//     activate it; omitted options keep the legacy behavior byte-for-byte.
//   - T8 streaming: add stream fields to PolishRequest; the provider call and
//     response normalization live only here.
//   - T14 chunking: add chunk-strategy fields to PolishRequest; long-input
//     splitting/merging stays transparent to both entries.
export interface PolishRequest {
  text: string;
  // Explicit mode/template id. Callers resolve their own entry-level defaults
  // (PROCESS defaults to "optimize"; the AI_REVIEW entry falls back to
  // "professional" for an empty template) — the orchestrator never guesses.
  mode: string;
  // Directory of custom prompt templates; when set, a custom template whose
  // name matches `mode` wins over the built-in mode prompts.
  templatesDir?: string;
  timeout?: number;
  // Escape hatch that skips prompt building entirely. Kept for the existing
  // processTextWithAI option contract; after T3 no production caller uses it.
  systemPrompt?: string;
  userPrompt?: string;
  // [20260907_Feat_235_StreamPipeline] T8: when present the run streams —
  // the provider is called with stream:true, upstream SSE deltas are merged
  // (16ms window / 2048-char cap) and pushed via notify as PolishChunk
  // events; the deadline matrix (first-delta / idle / total) and the
  // cumulative output cap abort the upstream on violation. Timeouts are
  // injectable for tests.
  stream?: {
    requestId: string;
    notify: (chunk: PolishChunk) => void;
    timeouts?: { firstDeltaMs: number; idleMs: number };
  };
  // [20260906_Feat_OrchestratorGenCancel] Spec #193 T7 (ticket #234):
  // generation-scope key for last-write-wins race protection. When two runs
  // share a scope, starting a newer run invalidates the older one: the stale
  // run's provider fetch is aborted and it settles with the SUPERSEDED
  // outcome instead of overwriting the newer result. Omitted = no tracking.
  generationScope?: string;
  // Caller-side cancellation. Aborting it terminates the in-flight provider
  // fetch and settles the run with the silent CANCELLED outcome (no error
  // log — a user cancel is a normal operation, not a failure). Omitted = the
  // run can only end via timeout/completion, as before.
  signal?: AbortSignal;
  // Opt-in output budget clamp for minimal-edit modes (optimize /
  // optimize_long / format / correct): request max_tokens becomes
  // max(4096 floor, min(inputLength × factor, user max_tokens)). Rewrite-class
  // modes and custom templates are never clamped. Omitted/false = the user
  // max_tokens is sent verbatim (legacy behavior).
  clampOutputTokens?: boolean;
}
// [20260906_Refactor_PolishOrchestrator] END

export interface PolishDeps {
  databaseManager: DatabaseManager;
  logger: Logger;
}

// [20260906_Feat_OrchestratorGenCancel] Spec #193 T7 (ticket #234) constants
// and per-scope run registry. Rationale: the polish pipeline must be
// race-safe (double-fire: only the newest request lands), cancellable (the
// upstream fetch must actually terminate, and a cancel is silent — no error
// log, no error UI) and cost-bounded (minimal-edit modes clamp the request
// budget, and an absurd provider response must never reach the renderer).
const POLISH_RESULT_CANCELLED: PolishOutcomeCode = "CANCELLED";
const POLISH_RESULT_SUPERSEDED: PolishOutcomeCode = "SUPERSEDED";
const POLISH_CANCELLED_MESSAGE = "已取消本次AI处理";
const POLISH_SUPERSEDED_MESSAGE = "已发起新的AI处理，本次结果已丢弃";
// Output budget clamp for minimal-edit modes: max(4096, min(input×2, userMax)).
// The 4096 floor exists so a short input × small coefficient can never starve
// a reasoning model's thinking budget (the 2026-08-15 empty-content
// regression); the user-configured cap still binds above the floor.
const POLISH_CLAMP_MIN_TOKENS = 4096;
const POLISH_CLAMP_INPUT_LENGTH_FACTOR = 2;
export { POLISH_CLAMP_MIN_TOKENS, POLISH_CLAMP_INPUT_LENGTH_FACTOR };
// [20260909_Fix_333_Review] Single shared source in polish-diff.ts.
export { MINIMAL_EDIT_MODES } from "../polish-diff";
import { MINIMAL_EDIT_MODES as MINIMAL_MODES_FOR_CLAMP } from "../polish-diff";
// Absolute response guard (Spec #193 超时与总量上限矩阵: 绝对上限 200 万字符):
// a provider (or malicious gateway) response longer than this is truncated
// before mapping, so oversized/absurd output never flows to the renderer.
export const POLISH_OUTPUT_MAX_CHARS = 2_000_000;
// [20260907_Feat_235_StreamPipeline] T8 streaming consumption guards: chunk
// count cap (per-read events) and the deadline matrix values. The total
// duration reuses the existing 150s/180s timeout passed by the entry.
const STREAM_FIRST_DELTA_MS = 15_000;
const STREAM_IDLE_MS = 30_000;

// One in-flight run per generation scope: the epoch orders runs within the
// scope, the controller aborts the run's provider fetch when it is
// superseded (or the caller cancels).
interface PolishRunHandle {
  scope: string | null;
  epoch: number | null;
  controller: AbortController;
  // [20260906_Feat_OrchestratorGenCancel_Review] Removed in endPolishRun so
  // a long-lived external signal does not accumulate one listener per run.
  removeExternalAbortListener: (() => void) | null;
}

const activePolishRuns = new Map<
  string,
  { epoch: number; controller: AbortController }
>();

/**
 * Register a run for generation/cancel tracking. Returns null when the
 * request opts out of both features, so legacy callers keep the exact
 * previous behavior (no registry writes, no AbortController).
 */
function beginPolishRun(request: PolishRequest): PolishRunHandle | null {
  let removeExternalAbortListener: (() => void) | null = null;
  const { generationScope, signal } = request;
  if (generationScope === undefined && signal === undefined) {
    return null;
  }
  const controller = new AbortController();
  if (signal !== undefined) {
    if (signal.aborted) {
      controller.abort();
    } else {
      const forwardAbort = () => controller.abort();
      signal.addEventListener("abort", forwardAbort, { once: true });
      removeExternalAbortListener = () =>
        signal.removeEventListener("abort", forwardAbort);
    }
  }
  let epoch: number | null = null;
  if (generationScope !== undefined) {
    const previous = activePolishRuns.get(generationScope);
    epoch = (previous?.epoch ?? 0) + 1;
    activePolishRuns.set(generationScope, { epoch, controller });
    // Invalidate the previously in-flight run of this scope: its fetch is
    // aborted and it will settle with the SUPERSEDED outcome.
    previous?.controller.abort();
  }
  return {
    scope: generationScope ?? null,
    epoch,
    controller,
    removeExternalAbortListener,
  };
}

/**
 * Drop a finished run from the registry — but only if it is still the
 * current run of its scope (a superseded run must never evict its successor).
 */
function endPolishRun(handle: PolishRunHandle | null): void {
  // [20260906_Feat_OrchestratorGenCancel_Review] Always drop the forwarded
  // abort listener first — a long-lived external signal must not accumulate
  // one listener per run.
  handle?.removeExternalAbortListener?.();
  if (handle === null || handle.scope === null) {
    return;
  }
  const current = activePolishRuns.get(handle.scope);
  if (current?.controller === handle.controller) {
    activePolishRuns.delete(handle.scope);
  }
}

function isRunSuperseded(handle: PolishRunHandle): boolean {
  return (
    handle.scope !== null &&
    activePolishRuns.get(handle.scope)?.epoch !== handle.epoch
  );
}

/**
 * Outcome for a run whose abort signal fired. Supersession wins over plain
 * cancellation so the caller can distinguish the two races.
 */
function polishAbortOutcome(handle: PolishRunHandle): AIResult {
  if (isRunSuperseded(handle)) {
    return {
      success: false,
      code: POLISH_RESULT_SUPERSEDED,
      error: POLISH_SUPERSEDED_MESSAGE,
    };
  }
  return {
    success: false,
    code: POLISH_RESULT_CANCELLED,
    error: POLISH_CANCELLED_MESSAGE,
  };
}

/**
 * The settle-aside outcome for a cancelled/superseded run, or null while the
 * run is still current and its signal has not fired.
 */
function polishRunOutcomeIfSettledAside(
  handle: PolishRunHandle | null,
): AIResult | null {
  if (handle === null) {
    return null;
  }
  if (!handle.controller.signal.aborted && !isRunSuperseded(handle)) {
    return null;
  }
  return polishAbortOutcome(handle);
}

/**
 * Effective request budget for this run. Only minimal-edit modes with the
 * opt-in flag are clamped; rewrite-class modes and legacy calls get the user
 * max_tokens verbatim.
 */
function resolvePolishMaxTokens(
  mode: string,
  inputLength: number,
  userMaxTokens: number,
  clampEnabled: boolean,
): number {
  if (!clampEnabled || !MINIMAL_MODES_FOR_CLAMP.has(mode)) {
    return userMaxTokens;
  }
  return Math.max(
    POLISH_CLAMP_MIN_TOKENS,
    Math.min(inputLength * POLISH_CLAMP_INPUT_LENGTH_FACTOR, userMaxTokens),
  );
}
// [20260906_Feat_OrchestratorGenCancel] END

export async function runPolishOrchestrator(
  deps: PolishDeps,
  request: PolishRequest,
): Promise<AIResult> {
  const { databaseManager, logger } = deps;
  const { text, mode } = request;
  // [20260906_Feat_OrchestratorGenCancel] Register the run for generation/
  // cancel tracking first (synchronously, so a newer run fired right after
  // invalidates this one before it even reaches the provider). Null when the
  // request opts out — the legacy path below is untouched.
  const runHandle = beginPolishRun(request);
  // [20260910_Feat_237_StreamDegradation] T10: settle-aside exits that
  // bypass consumePolishStream (pre-fetch gate, post-response gates, the
  // degraded retry, the outer catch) never emitted the abort chunk — a
  // cancel landing there surfaced "已取消" as an ERROR in the UI, breaking
  // the silent-cancel contract. Emit it centrally for streaming runs.
  // Declared before try{} so the catch can reach it.
  const settleAside = (outcome: AIResult): AIResult => {
    if (request.stream) {
      request.stream.notify({
        type: "abort",
        requestId: request.stream.requestId,
      });
    }
    return outcome;
  };
  // [20260910_Feat_237_StreamDegradation] END
  try {
    const apiKey = (await databaseManager.getSetting("ai_api_key")) as
      | string
      | undefined;
    const baseUrl =
      ((await databaseManager.getSetting("ai_base_url")) as string) ||
      "https://api.openai.com/v1";
    const isLocal = isLocalBaseUrl(baseUrl);

    if (!apiKey && !isLocal) {
      return {
        success: false,
        error: "请先在设置页面配置AI API密钥",
      };
    }

    const model =
      ((await databaseManager.getSetting("ai_model")) as string) ||
      "gpt-3.5-turbo";
    const temperature =
      parseFloat(
        (await databaseManager.getSetting("ai_temperature")) as string,
      ) || 0.3;
    // [20260815_Fix_AiMaxTokensDefault] 8192 fallback matches the renderer
    // DEFAULT_SETTINGS — reasoning models count thinking tokens against
    // max_tokens; the old 2000 could be exhausted by reasoning alone.
    const maxTokens =
      parseInt(
        (await databaseManager.getSetting("ai_max_tokens")) as string,
        10,
      ) || 8192;
    // [20260906_Feat_OrchestratorGenCancel] T7 output clamp: minimal-edit
    // modes with the opt-in flag get the floored budget; every other
    // combination sends the user max_tokens verbatim. The effective budget
    // (not the raw setting) also drives the empty-content token-cap check so
    // its message names the budget the provider actually received.
    const effectiveMaxTokens = resolvePolishMaxTokens(
      mode,
      text.length,
      maxTokens,
      request.clampOutputTokens === true,
    );

    if (!validateAIBaseUrl(baseUrl, { allowLocalhost: isLocal })) {
      return {
        success: false,
        error: "请填写有效的 https API 地址（不支持 http 或内网地址）",
      };
    }

    let system: string, user: string;
    if (request.systemPrompt && request.userPrompt) {
      system = request.systemPrompt;
      user = request.userPrompt;
    } else {
      const customTemplates = request.templatesDir
        ? getCachedTemplates(request.templatesDir)
        : [];
      // [20260908_Feat_333_VocabInjection] Resolve the corrections table
      // and keep ONLY entries whose wrong word appears in this text (T13
      // discipline: ≤20 by recency; the directive rides inside the XML
      // envelope via buildPrompt). A table read failure degrades to no
      // injection — polish must never fail on the optional corrections.
      let vocabCorrections: Array<{ wrong: string; right: string }> = [];
      try {
        vocabCorrections = filterVocabForInjection(
          text,
          databaseManager.listVocabCorrections?.() ?? [],
        );
      } catch (vocabError) {
        logger?.warn?.("修正表读取失败,跳过注入:", vocabError);
      }
      ({ system, user } = buildPrompt(mode, text, {
        customTemplates,
        vocabCorrections,
      }));
    }

    // [20260910_Feat_237_StreamDegradation] T10: a gateway REMEMBERED as
    // stream-incapable skips the doomed streaming attempt entirely — one
    // plain request, and the UI learns why via a degraded chunk. The memory
    // read stays behind request.stream so legacy non-streaming callers
    // never touch the settings store here.
    const wantsStream = request.stream !== undefined;
    const rememberedGateway = wantsStream
      ? await isStreamDegradationRemembered(databaseManager, baseUrl)
      : false;
    if (rememberedGateway && request.stream) {
      request.stream.notify({
        type: "degraded",
        requestId: request.stream.requestId,
        reason: "remembered",
      });
    }
    const useStream = wantsStream && !rememberedGateway;
    // True once this run proved the gateway cannot stream (any signature);
    // a successful fallback then persists the memory.
    let degradedFallback = rememberedGateway;
    // [20260910_Feat_237_StreamDegradation] END

    const requestData = {
      model: model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: temperature,
      max_tokens: effectiveMaxTokens,
      // [20260907_Feat_235_StreamPipeline] T8: stream the response body when
      // the caller requested it; chunk events flow through request.stream.
      // [20260910_Feat_237_StreamDegradation] T10: ...unless the gateway is
      // remembered as stream-incapable.
      stream: useStream,
    };

    logger.info?.("AI文本处理请求:", {
      baseUrl,
      model,
      mode,
      inputLength: text.length,
    });

    // [20260906_Feat_OrchestratorGenCancel] T7 generation gate: short-circuit
    // BEFORE the provider call when the run was cancelled or superseded
    // while settings/prompt were being resolved.
    const pendingOutcome = polishRunOutcomeIfSettledAside(runHandle);
    if (pendingOutcome) {
      return settleAside(pendingOutcome);
    }

    const timeoutMs = request.timeout || (isLocal ? 180_000 : 150_000);
    // [20260910_Feat_237_StreamDegradation] T10: one deadline shared by the
    // streaming attempt AND its degradation retry — a slow-then-4xx gateway
    // must not double the user's wait. (Also serves the tagged retry below:
    // `response` is reassigned there.)
    const deadlineMs = Date.now() + timeoutMs;
    const timeoutMessage = `AI请求超时（${Math.round(timeoutMs / 1000)}秒），请尝试缩短文本或检查网络`;
    // [20260910_Feat_237_StreamDegradation] END
    let response = await postChatCompletion(
      baseUrl,
      apiKey,
      requestData,
      timeoutMs,
      timeoutMessage,
      runHandle?.controller.signal,
    );

    // [20260906_Feat_OrchestratorGenCancel] T7 generation gate: the provider
    // response of a cancelled/superseded run is discarded unread — it must
    // never overwrite the newer run's result.
    const staleOutcome = polishRunOutcomeIfSettledAside(runHandle);
    if (staleOutcome) {
      return settleAside(staleOutcome);
    }

    // [20260910_Feat_237_StreamDegradation] T10 second signature: an
    // IMMEDIATE 4xx to the streaming attempt means the gateway rejected the
    // stream itself — retry ONCE without stream:true. The retry rides the
    // same run signal, so a user cancel aborts it identically; generation
    // gates bracket it like the first attempt. Auth/quota statuses
    // (401/403/429) are EXCLUDED: they fail identically non-streaming, and
    // retrying them would double pressure on an already-limiting gateway.
    const retryBudgetMs = deadlineMs - Date.now();
    if (
      useStream &&
      request.stream &&
      !response.ok &&
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 401 &&
      response.status !== 403 &&
      response.status !== 429 &&
      retryBudgetMs > 0
    ) {
      request.stream.notify({
        type: "degraded",
        requestId: request.stream.requestId,
        reason: "http_4xx",
      });
      degradedFallback = true;
      response = await postChatCompletion(
        baseUrl,
        apiKey,
        { ...requestData, stream: false },
        retryBudgetMs,
        timeoutMessage,
        runHandle?.controller.signal,
      );
      const retryOutcome = polishRunOutcomeIfSettledAside(runHandle);
      if (retryOutcome) {
        return settleAside(retryOutcome);
      }
    }
    // [20260910_Feat_237_StreamDegradation] END

    // [20260907_Feat_235_StreamPipeline] T8: consume the SSE body via the
    // merger + deadline matrix. A gateway that ignored stream:true (200 with
    // a non-SSE content-type) degrades to the non-stream JSON path below.
    // [20260910_Feat_237_StreamDegradation] T10: skipped when the run already
    // degraded (remembered gateway or a completed 4xx retry).
    if (useStream && !degradedFallback && request.stream) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        return await consumePolishStream(
          response,
          request.stream,
          runHandle,
          logger,
          timeoutMs,
        );
      }
      request.stream.notify({
        type: "degraded",
        requestId: request.stream.requestId,
        reason: "non_sse_response",
      });
      // [20260910_Feat_237_StreamDegradation] T10: non-SSE 200 is the third
      // degradation signature — the JSON path below IS the fallback.
      degradedFallback = true;
    }

    // [20260908_Fix_BatchReview_M1] The response-headers timer cleared on
    // arrival, so the non-streaming body read (JSON path — also where the
    // degraded fallback routes streaming users, and the only bound for the
    // AI_REVIEW entry) had NO deadline: a body-stalling gateway hung the
    // invoke forever. Race the body reads against the same total budget
    // the streaming path enforces.
    const readBodyWithDeadline = <T>(read: () => Promise<T>): Promise<T> =>
      Promise.race([
        read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                Object.assign(
                  new Error(
                    `AI请求超时（${Math.round(timeoutMs / 1000)}秒），请尝试缩短文本或检查网络`,
                  ),
                  { code: "TIMEOUT" },
                ),
              ),
            timeoutMs,
          ),
        ),
      ]);

    if (!response.ok) {
      const errorText = await readBodyWithDeadline(() => response.text());
      throw new Error(
        extractAIErrorMessage(response, errorText, logger) ||
          `AI服务请求失败 (${response.status})`,
      );
    }

    const data = (await readBodyWithDeadline(() => response.json())) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: unknown;
    };

    logger.info?.("AI文本处理响应:", {
      status: response.status,
      outputLength: data.choices?.[0]?.message?.content?.length || 0,
      usage: data.usage,
    });

    if (data.choices && data.choices.length > 0) {
      // [20260815_Fix_AiEmptyContent] Reasoning models (e.g. deepseek-v4-flash)
      // can spend the entire max_tokens budget on reasoning before emitting
      // any content: HTTP 200, choices present, message.content empty,
      // finish_reason "length" (production logs 2026-08-15: reasoning_tokens
      // 2000 == completion_tokens == max_tokens). Returning success with empty
      // text made the UI show a generic "AI处理失败，请重试" with no cause.
      const content = data.choices[0]?.message?.content?.trim() || "";
      if (!content) {
        const usage = data.usage as { completion_tokens?: number } | undefined;
        const tokenCapHit =
          data.choices[0]?.finish_reason === "length" ||
          (usage?.completion_tokens !== undefined &&
            usage.completion_tokens >= effectiveMaxTokens);
        const error = tokenCapHit
          ? `AI输出为空：模型推理占满了 max_tokens（${effectiveMaxTokens}）预算，请在设置中调大「AI 配置 → 最大输出长度」或换用非推理模型`
          : "AI返回了空内容，请重试或更换模型";
        logger.error?.("AI返回空内容:", {
          finish_reason: data.choices[0]?.finish_reason,
          usage: data.usage,
          maxTokens: effectiveMaxTokens,
        });
        return { success: false, error };
      }
      // [20260906_Feat_OrchestratorGenCancel] T7 output guard: clamp an
      // oversized provider response to the absolute char cap before it can
      // flow to the renderer (logged as info — a robustness action, not an
      // error).
      let resultText = content;
      if (resultText.length > POLISH_OUTPUT_MAX_CHARS) {
        const originalLength = resultText.length;
        resultText = resultText.slice(0, POLISH_OUTPUT_MAX_CHARS);
        logger.info?.("AI输出超出字符上限，已截断:", {
          originalLength,
          cap: POLISH_OUTPUT_MAX_CHARS,
        });
      }
      const result: AIResult = {
        success: true,
        text: resultText,
        usage: data.usage,
        model: model,
      };

      logger.info?.("AI文本处理结果:", {
        inputLength: text.length,
        outputLength: result.text?.length || 0,
        usage: result.usage,
      });

      // [20260910_Feat_237_StreamDegradation] T10: the fallback SUCCEEDED —
      // persist "this gateway cannot stream" so later runs skip straight
      // to the JSON path. Local gateways are excluded inside remember
      // (their streaming quirks get fixed, not memorized); a memory write
      // failure must never fail the polish the user already has in hand.
      if (degradedFallback && !rememberedGateway) {
        try {
          await rememberStreamDegradation(databaseManager, baseUrl);
        } catch (memoryError) {
          logger?.warn?.("流式降级记忆写入失败:", memoryError);
        }
      }
      // [20260910_Feat_237_StreamDegradation] END
      return result;
    } else {
      logger.error?.("AI API返回数据格式错误:", undefined);
      return { success: false, error: "AI API返回数据格式错误" };
    }
  } catch (error) {
    // [20260906_Feat_OrchestratorGenCancel] T7 cancel semantics: classify
    // abort-driven failures BEFORE the generic error mapping. A user cancel
    // or generation supersession settles silently — no error log, cancel-
    // shaped outcome — so it never drives an error UI.
    const abortOutcome = polishRunOutcomeIfSettledAside(runHandle);
    if (abortOutcome) {
      return settleAside(abortOutcome);
    }

    logger.error?.("AI文本处理失败:", error);

    const err = error as Error & { code?: string };
    let errorMessage = "文本处理失败";
    if (err.code === "TIMEOUT" || err.name === "AbortError") {
      errorMessage = err.message || "请求超时，请检查网络连接";
    } else if (err.code === "ENOTFOUND") {
      errorMessage = "无法连接到AI服务器，请检查网络";
    } else {
      errorMessage = err.message || "未知错误";
    }
    // [20260815_Refactor_AiFetchDedup] The ECONNABORTED branch was an axios
    // error code this fetch-based code path can never produce.

    return { success: false, error: errorMessage };
  } finally {
    // [20260906_Feat_OrchestratorGenCancel] T7: release the registry slot —
    // a superseded run must never evict its successor's registration.
    endPolishRun(runHandle);
  }
}

// [20260906_Refactor_PolishOrchestrator] Positional-args adapter kept for the
// injected provider seam (src/helpers/ipc/index.ts wires this into
// transcriptionHandlers' AI_REVIEW entry) and the existing unit-test
// contract. Pure delegation — all logic lives in runPolishOrchestrator.
export async function processTextWithAI(
  text: string,
  mode: string,
  databaseManager: DatabaseManager,
  logger: Logger,
  options: Record<string, unknown> = {},
): Promise<AIResult> {
  return runPolishOrchestrator(
    { databaseManager, logger },
    {
      text,
      mode,
      templatesDir: options.templatesDir as string | undefined,
      timeout: options.timeout as number | undefined,
      systemPrompt: options.systemPrompt as string | undefined,
      userPrompt: options.userPrompt as string | undefined,
      // [20260906_Feat_OrchestratorGenCancel] T7 options flow through the
      // positional-args contract; omitted options keep legacy behavior.
      generationScope: options.generationScope as string | undefined,
      signal: options.signal as AbortSignal | undefined,
      clampOutputTokens: options.clampOutputTokens as boolean | undefined,
    },
  );
}
// [20260906_Refactor_PolishOrchestrator] END

export async function checkAIStatus(
  testConfig: {
    ai_api_key?: string;
    ai_base_url?: string;
    ai_model?: string;
  } | null,
  databaseManager: DatabaseManager,
  logger: Logger,
): Promise<{
  available: boolean;
  error?: string;
  details?: string;
  model?: string;
  status?: string;
  response?: string;
  usage?: unknown;
}> {
  try {
    logger.info?.(
      "开始测试AI配置...",
      testConfig ? "使用临时配置" : "使用已保存配置",
    );

    let apiKey: string | undefined, baseUrl: string, model: string;

    if (testConfig) {
      apiKey = testConfig.ai_api_key;
      baseUrl = testConfig.ai_base_url || "https://api.openai.com/v1";
      model = testConfig.ai_model || "gpt-3.5-turbo";
      logger.info?.("使用临时测试配置:", { baseUrl, model });
    } else {
      apiKey = (await databaseManager.getSetting("ai_api_key")) as
        | string
        | undefined;
      baseUrl =
        ((await databaseManager.getSetting("ai_base_url")) as string) ||
        "https://api.openai.com/v1";
      model =
        ((await databaseManager.getSetting("ai_model")) as string) ||
        "gpt-3.5-turbo";
      logger.info?.("使用已保存配置:", { baseUrl, model });
    }

    const isLocal = isLocalBaseUrl(baseUrl);

    if (!apiKey && !isLocal) {
      logger.warn?.("AI测试失败: 未配置API密钥");
      return {
        available: false,
        error: "未配置API密钥",
        details: "请输入AI API密钥",
      };
    }

    if (!validateAIBaseUrl(baseUrl, { allowLocalhost: isLocal })) {
      return {
        available: false,
        error: "请填写有效的 https API 地址（不支持 http 或内网地址）",
        details: "请确认 API 地址为有效的 https 端点",
      };
    }

    logger.info?.("AI配置信息:", { baseUrl, model });

    const requestData = {
      model: model,
      messages: [
        { role: "user", content: '请回复"测试成功"来确认AI服务正常工作' },
      ],
      max_tokens: 50,
      temperature: 0.1,
    };

    logger.info?.("发送AI测试请求:", requestData);

    const response = await postChatCompletion(
      baseUrl,
      apiKey,
      requestData,
      15_000,
      "请求超时，请检查网络连接",
    );

    logger.info?.("AI API响应状态:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error?.("AI API错误响应:", errorText);

      let errorMessage =
        extractAIErrorMessage(response, errorText) || `HTTP ${response.status}`;
      if (response.status === 401) errorMessage = "API密钥无效或已过期";
      else if (response.status === 403) errorMessage = "API密钥权限不足";
      else if (response.status === 429) errorMessage = "API调用频率超限";
      else if (response.status === 500) errorMessage = "AI服务器内部错误";

      throw new Error(errorMessage);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
    };
    logger.info?.("AI API成功响应:", data);

    if (!data.choices || data.choices.length === 0) {
      throw new Error("AI API返回格式异常：缺少choices字段");
    }

    const aiResponse = data.choices[0]?.message?.content || "";
    logger.info?.("AI回复内容:", aiResponse);

    return {
      available: true,
      model: model,
      status: "connected",
      response: aiResponse,
      usage: data.usage,
      details: `成功连接到 ${model}，响应时间正常`,
    };
  } catch (error) {
    logger.error?.("AI配置测试失败:", error);

    const err = error as Error & { code?: string };
    let errorMessage = "连接失败";
    if (err.code === "TIMEOUT") errorMessage = err.message;
    else if (err.message.includes("401")) errorMessage = "API密钥无效";
    else if (err.message.includes("403")) errorMessage = "API密钥权限不足";
    else if (err.message.includes("429")) errorMessage = "API调用频率超限";
    else if (err.message.includes("ENOTFOUND"))
      errorMessage = "无法连接到AI服务器，请检查网络和Base URL";
    else if (err.message.includes("ECONNREFUSED"))
      errorMessage = "连接被拒绝，请检查Base URL是否正确";
    else if (err.message.includes("timeout"))
      errorMessage = "请求超时，请检查网络连接";
    else errorMessage = err.message || "未知错误";

    return {
      available: false,
      error: errorMessage,
      details: `测试失败原因: ${err.message}`,
    };
  }
}

interface Managers {
  databaseManager: DatabaseManager;
  logger: Logger;
  templatesDir?: string;
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { databaseManager, logger } = managers;
  // [20260907_Feat_235_StreamPipeline] T8: requestId → abort controller for
  // the initiating sender. POLISH_ABORT resolves through this map with a
  // sender-ownership check.
  const streamAbortTargets = new Map<
    string,
    { controller: AbortController; senderId: number }
  >();
  const templatesDir =
    managers.templatesDir ||
    (() => {
      // [20260724_TS_BigBang_LazyRequire] Lazy require("electron") — import is
      // hoisted and would load electron at module init, but this is only needed
      // when register() is called in the Electron main process.
      const { app } = require("electron");
      return path.join(app.getPath("userData"), "templates");
    })();
  // [20260724_TS_BigBang_LazyRequire] END

  ipcMain.handle(
    C.AI.PROCESS,
    async (
      event,
      text: string,
      mode = "optimize",
      timeout?: number,
      requestId?: string,
    ) => {
      // [20260906_Refactor_PolishOrchestrator] Spec #193 T3 (ticket #230):
      // route the PROCESS entry straight through the shared orchestrator
      // (entry resolves its own default mode; the orchestrator owns prompt
      // building, the provider call and response/error mapping).
      //
      // [20260907_Fix_312_WireClampEntry] Activate the minimal-edit output
      // budget clamp for this entry (issue #312, first T7 wiring step): the
      // orchestrator only clamps when the caller opts in, and without this
      // the 2026-08-15 empty-content fix never bound on a live path. Rewrite
      // modes and custom templates stay unclamped by design.
      //
      // [20260907_Feat_235_StreamPipeline] T8: a requestId opts the call
      // into streaming — chunk events are sent to THIS window only, and the
      // requestId becomes the abort/generation scope key.
      let stream: PolishRequest["stream"];
      let ownedController: AbortController | undefined;
      if (requestId) {
        const senderId = event.sender.id;
        const controller = new AbortController();
        ownedController = controller;
        streamAbortTargets.set(requestId, { controller, senderId });
        stream = {
          requestId,
          notify: (chunk: PolishChunk) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(C.EVENTS.AI_POLISH_CHUNK, chunk);
            }
          },
        };
      }
      try {
        return await runPolishOrchestrator(
          { databaseManager, logger },
          {
            text,
            mode,
            templatesDir,
            timeout,
            clampOutputTokens: MINIMAL_MODES_FOR_CLAMP.has(mode),
            generationScope: requestId,
            signal: streamAbortTargets.get(requestId ?? "")?.controller.signal,
            stream,
          },
        );
      } finally {
        // [20260907_Fix_235_ReviewMinor1] Delete ONLY our own entry: a
        // superseding run reusing the requestId owns the map slot now.
        const entry = requestId ? streamAbortTargets.get(requestId) : undefined;
        if (entry && entry.controller === ownedController) {
          streamAbortTargets.delete(requestId as string);
        }
      }
    },
  );

  // [20260907_Feat_235_StreamPipeline] T8 abort channel — rate-limit exempt
  // (an abort must never be throttled) and sender-checked so one window
  // cannot cancel another window's run.
  ipcMain.handle(C.AI.POLISH_ABORT, (event, requestId: string) => {
    const target = streamAbortTargets.get(requestId);
    if (!target) {
      return { success: false, reason: "unknown_request" };
    }
    if (target.senderId !== event.sender.id) {
      logger.warn?.("POLISH_ABORT 拒绝：请求 id 不属于该发送者");
      return { success: false, reason: "forbidden" };
    }
    target.controller.abort();
    return { success: true };
  });

  // [20260907_Feat_233_ListModels] Ticket #233: provider model-list
  // derivation. Same SSRF gate as the chat request (private https rejected,
  // local-gateway exception allowed), URL-constructor endpoint derivation,
  // strict response shape with silent fallback to the manual-input path.
  ipcMain.handle(
    C.AI.LIST_MODELS,
    async (_event, baseUrl: string, apiKey = "") => {
      const isLocal = isLocalBaseUrl(baseUrl);
      if (!validateAIBaseUrl(baseUrl, { allowLocalhost: isLocal })) {
        return { success: false, reason: "invalid_url", models: [] };
      }
      let key = typeof apiKey === "string" ? apiKey : "";
      // Masked renderer keys resolve against the stored credential, mirroring
      // the save/test paths (the mask is not a usable secret).
      if (!key || key.startsWith("****")) {
        key =
          ((await databaseManager.getSetting("ai_api_key")) as string) || "";
      }
      const headers: Record<string, string> = key
        ? { Authorization: `Bearer ${key}` }
        : {};
      const candidates = modelEndpointCandidates(baseUrl);
      for (let i = 0; i < candidates.length; i++) {
        const candidateUrl = candidates[i]!;
        try {
          const response = await fetch(candidateUrl, {
            headers,
            signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
          });
          if (response.status === 404 && i < candidates.length - 1) {
            continue;
          }
          if (!response.ok) {
            return {
              success: false,
              reason: `http_${response.status}`,
              models: [],
            };
          }
          const raw = await response.text();
          if (Buffer.byteLength(raw) > MODELS_MAX_BODY_BYTES) {
            return { success: false, reason: "body_too_large", models: [] };
          }
          const parsed = JSON.parse(raw) as {
            data?: Array<{ id?: unknown }>;
          };
          const rows = parsed?.data;
          if (
            !Array.isArray(rows) ||
            rows.length === 0 ||
            rows.length > MODELS_MAX_ITEMS
          ) {
            return { success: false, reason: "invalid_shape", models: [] };
          }
          const models: string[] = [];
          for (const row of rows) {
            const id = row?.id;
            if (
              typeof id !== "string" ||
              !id.trim() ||
              Buffer.byteLength(id) > MODELS_MAX_ID_BYTES
            ) {
              return { success: false, reason: "invalid_shape", models: [] };
            }
            models.push(id);
          }
          return { success: true, models };
        } catch (error) {
          // A failed candidate on the two-candidate path falls through to
          // the /v1 retry; on the last candidate it degrades to the manual
          // input path (silent, per ticket #233).
          if (i >= candidates.length - 1) {
            logger.warn?.("模型列表获取失败:", error);
            return { success: false, reason: "fetch_failed", models: [] };
          }
        }
      }
      return { success: false, reason: "unreachable", models: [] };
    },
  );

  ipcMain.handle(
    C.AI.CHECK_STATUS,
    async (
      _event,
      testConfig: {
        ai_api_key?: string;
        ai_base_url?: string;
        ai_model?: string;
      } | null = null,
    ) => {
      return await checkAIStatus(testConfig, databaseManager, logger);
    },
  );

  ipcMain.handle(C.AI.GET_MODES, async () => {
    return getAIModes(templatesDir);
  });

  ipcMain.handle(C.AI.GET_PROVIDER_PRESETS, async () => {
    return getProviderPresets();
  });

  ipcMain.handle(C.AI.DETECT_LOCAL_MODELS, async () => {
    return await detectLocalModels();
  });
}
// [20260724_TS_BigBang_AIHandlers] END
