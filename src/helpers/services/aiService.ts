// [20260912_Refactor_262_AiHistoryService] Ticket #262 (spec #258 Phase 0 —
// AI 域服务化): AI-text-domain service extraction. The pieces of the
// C.AI.PROCESS / C.AI.POLISH_ABORT / C.AI.LIST_MODELS handler bodies that
// carried inline domain logic move here as plain main-process functions:
//
//   - createStreamAbortRegistry(): the requestId → AbortController registry
//     (the critical headless seam — abort/supersession bookkeeping becomes
//     callable without a renderer window).
//   - processPolishText(): the PROCESS entry wiring (stream registration,
//     mode-default + minimal-edit clamp gating, generation-scope/signal
//     hookup, own-entry release). The polish orchestrator itself is INJECTED
//     via deps (`runPolish`) so this module stays dependency-clean and the
//     HIGH-RISK streaming/deadline-matrix pipeline stays untouched in
//     aiHandlers.ts (wrap, not relocate).
//   - listProviderModels(): the provider /models listing (SSRF gate,
//     masked-key resolution, endpoint derivation, response validation).
//     Verbatim move; the SSRF predicates it shares with the orchestrator
//     (isLocalhost/isPrivateNetwork/validateAIBaseUrl) moved with it and
//     aiHandlers re-exports validateAIBaseUrl to keep its public contract.
//
// No Electron types appear here: the sender coupling stays in the handler,
// translated into the plain `notify(chunk)` callback and the numeric
// `senderId`. Dependency direction is one-way: aiHandlers imports THIS
// module (except erased type-only imports) — no import cycle.
//
// 密钥读取路径不变: API keys are still decrypted inside the main process
// via the injected databaseManager (getSetting("ai_api_key")) exactly as
// before; this refactor adds no key-reading parameter or renderer-facing
// export surface.
//
// Behavior is byte-identical to the pre-extraction handlers — locked by the
// unmodified tests/unit/aiHandlers.test.ts and tests/unit/list-models.test.ts;
// new headless seam coverage lives in tests/unit/aiService.test.ts. Comments
// and log strings copied from the handler are kept verbatim.

import { MINIMAL_EDIT_MODES } from "../polish-diff";
import type { PolishChunk } from "../../types/ipc";
// [20260912_Refactor_262_AiHistoryService] Type-only imports from aiHandlers
// (erased at runtime — they cannot create an import cycle). They pin the
// injected orchestrator to the exact production contract.
import type {
  PolishDeps,
  PolishRequest,
  PolishOutcomeCode,
} from "../ipc/aiHandlers";

/** Logger surface used for diagnostics; every method is optional. */
export interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

/** Structural echo of the orchestrator's (non-exported) AIResult shape. */
export interface PolishRunResult {
  success: boolean;
  text?: string;
  error?: string;
  usage?: unknown;
  model?: string;
  code?: PolishOutcomeCode;
}

// [20260912_Refactor_262_AiHistoryService] SSRF gate moved verbatim from
// aiHandlers.ts (isLocalhost + isPrivateNetwork + validateAIBaseUrl) — the
// shared security predicate for every AI channel. Pure functions, no state.
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

// [20260912_Refactor_262_AiHistoryService] Exported for the orchestrator's
// and checkAIStatus's local-gateway exception back in aiHandlers (they now
// import it from here — one-way dependency).
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    return isLocalhost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}
// [20260912_Refactor_262_AiHistoryService] END

// [20260912_Refactor_262_AiHistoryService] requestId → AbortController
// registry, moved from the `streamAbortTargets` map inside
// aiHandlers.register(). This is THE headless seam of ticket #262: abort/
// supersession bookkeeping no longer requires a renderer window. The
// `abort` method carries the full POLISH_ABORT handler semantics —
// unknown id → no-throw {success:false, reason:"unknown_request"};
// sender mismatch → warn + {success:false, reason:"forbidden"};
// match → controller.abort() + {success:true}.
export interface StreamAbortEntry {
  controller: AbortController;
  senderId: number;
}

export interface PolishAbortOutcome {
  success: boolean;
  reason?: "unknown_request" | "forbidden";
}

export interface StreamAbortRegistry {
  /** Register a run and return its abort controller (the old map.set). */
  register(requestId: string, senderId: number): AbortController;
  /** Raw entry lookup (the old map.get). */
  get(requestId: string): StreamAbortEntry | undefined;
  /** Signal of the currently registered run for a requestId. */
  signalOf(requestId: string): AbortSignal | undefined;
  /** Drop a finished run — but only if it still owns its map slot. */
  release(requestId: string, controller: AbortController): void;
  /** The POLISH_ABORT semantics (sender-checked, never throws). */
  abort(
    requestId: string,
    senderId: number,
    logger?: Logger,
  ): PolishAbortOutcome;
}

export function createStreamAbortRegistry(): StreamAbortRegistry {
  const targets = new Map<string, StreamAbortEntry>();
  return {
    register(requestId, senderId) {
      const controller = new AbortController();
      targets.set(requestId, { controller, senderId });
      return controller;
    },
    get(requestId) {
      return targets.get(requestId);
    },
    signalOf(requestId) {
      return targets.get(requestId)?.controller.signal;
    },
    release(requestId, controller) {
      // [20260907_Fix_235_ReviewMinor1] Delete ONLY our own entry: a
      // superseding run reusing the requestId owns the map slot now.
      const entry = targets.get(requestId);
      if (entry && entry.controller === controller) {
        targets.delete(requestId);
      }
    },
    abort(requestId, senderId, logger) {
      // [20260907_Feat_235_StreamPipeline] T8 abort channel — rate-limit
      // exempt (an abort must never be throttled) and sender-checked so one
      // window cannot cancel another window's run.
      const target = targets.get(requestId);
      if (!target) {
        return { success: false, reason: "unknown_request" };
      }
      if (target.senderId !== senderId) {
        logger?.warn?.("POLISH_ABORT 拒绝：请求 id 不属于该发送者");
        return { success: false, reason: "forbidden" };
      }
      target.controller.abort();
      return { success: true };
    },
  };
}
// [20260912_Refactor_262_AiHistoryService] END

// [20260912_Refactor_262_AiHistoryService] The C.AI.PROCESS entry wiring,
// moved from the handler body into a service function. The only renderer
// coupling left in the handler is the `event.sender.send` chunk transport,
// translated into the injected `notify` callback (a headless caller passes
// a no-op or collects chunks in tests). The polish orchestrator itself is
// injected as `runPolish` so the HIGH-RISK streaming/deadline-matrix
// pipeline stays byte-identical in aiHandlers.ts and this module gains no
// runtime dependency on it.
export interface ProcessPolishTextDeps {
  databaseManager: PolishDeps["databaseManager"];
  logger: Logger;
  templatesDir: string;
  runPolish: (
    deps: PolishDeps,
    request: PolishRequest,
  ) => Promise<PolishRunResult>;
}

export interface ProcessPolishTextParams {
  text: string;
  /** Entry-level default ("optimize") is applied by the service. */
  mode?: string;
  timeout?: number;
  requestId?: string;
  senderId: number;
  notify: (chunk: PolishChunk) => void;
}

export async function processPolishText(
  deps: ProcessPolishTextDeps,
  registry: StreamAbortRegistry,
  params: ProcessPolishTextParams,
): Promise<PolishRunResult> {
  const { databaseManager, logger, templatesDir, runPolish } = deps;
  const { text, requestId, senderId, notify } = params;
  const mode = params.mode === undefined ? "optimize" : params.mode;
  // [20260907_Feat_235_StreamPipeline] T8: a requestId opts the call into
  // streaming — chunk events are sent to THIS window only (via the injected
  // notify transport), and the requestId becomes the abort/generation scope
  // key.
  let stream: PolishRequest["stream"];
  let ownedController: AbortController | undefined;
  if (requestId) {
    ownedController = registry.register(requestId, senderId);
    stream = { requestId, notify };
  }
  try {
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
    return await runPolish(
      { databaseManager, logger },
      {
        text,
        mode,
        templatesDir,
        timeout: params.timeout,
        clampOutputTokens: MINIMAL_EDIT_MODES.has(mode),
        generationScope: requestId,
        signal: registry.signalOf(requestId ?? ""),
        stream,
      },
    );
  } finally {
    // [20260907_Fix_235_ReviewMinor1] Delete ONLY our own entry: a
    // superseding run reusing the requestId owns the map slot now.
    if (ownedController) {
      registry.release(requestId as string, ownedController);
    }
  }
}
// [20260912_Refactor_262_AiHistoryService] END

// [20260912_Refactor_262_AiHistoryService] Ticket #233 provider model-list
// derivation moved verbatim from the C.AI.LIST_MODELS handler body. Same
// SSRF gate as the chat request (private https rejected, local-gateway
// exception allowed), URL-constructor endpoint derivation, strict response
// shape with silent fallback to the manual-input path.
// [20260907_Feat_233_ListModels] Derive the /models endpoint from the base
// URL with the URL constructor only — never whole-URL string concatenation.
// Bases that already end in a version segment get exactly one candidate
// ({base}/models); other bases try {base}/models first and {base}/v1/models
// second (the common "no /v1 in base_url" gateway shape).
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

export interface ListProviderModelsDeps {
  databaseManager: {
    // Masked renderer keys resolve against the stored credential here —
    // the same main-process-only decryption path as before this refactor.
    getSetting(key: string): Promise<unknown>;
  };
  logger: Logger;
}

export interface ProviderModelListResult {
  success: boolean;
  reason?: string;
  models: string[];
}

export async function listProviderModels(
  deps: ListProviderModelsDeps,
  baseUrl: string,
  apiKey = "",
): Promise<ProviderModelListResult> {
  const { databaseManager, logger } = deps;
  const isLocal = isLocalBaseUrl(baseUrl);
  if (!validateAIBaseUrl(baseUrl, { allowLocalhost: isLocal })) {
    return { success: false, reason: "invalid_url", models: [] };
  }
  let key = typeof apiKey === "string" ? apiKey : "";
  // Masked renderer keys resolve against the stored credential, mirroring
  // the save/test paths (the mask is not a usable secret).
  if (!key || key.startsWith("****")) {
    key = ((await databaseManager.getSetting("ai_api_key")) as string) || "";
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
}
// [20260912_Refactor_262_AiHistoryService] END
