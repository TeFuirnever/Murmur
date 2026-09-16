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

// [20260912_Sec_319_SsrfHardening] DNS rebinding TOCTOU — explicitly NOT
// closed by this gate. Hostname TEXT validation (this function) and fetch's
// actual DNS resolution are two separate operations separated in time: a
// hostile resolver can answer the check with a public IP and the connect
// with an intranet IP (DNS rebinding TOCTOU), and every hop re-validation
// below inherits the same gap. Full closure requires pinning the resolved
// IP at connect time — an undici custom dispatcher/Agent configured with
// `connect: { lookup }` that re-checks the address the resolver returns
// before the socket opens. That work is deliberately deferred (ticket #319
// closes the redirect/follow + response-cap primitives only). This gate is
// therefore a hostname-text filter, not a rebinding fix; do not treat it
// as one.
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

// [20260912_Sec_319_SsrfHardening] Ticket #319: guarded redirect following
// for every AI-channel fetch. PRODUCT DECISION (maintainer delegate, verbatim):
// redirect policy = MANUAL FOLLOW WITH PER-HOP RE-VALIDATION. A blanket
// redirect-reject was rejected because legitimate providers/gateways
// sometimes 302 API endpoints (would break real users); manual per-hop
// re-validation preserves them while closing the intranet-probe hole.
// Cross-origin hops drop the Authorization header before following.
//
// Mechanism: fetch runs with `redirect: "manual"` — in Node/Electron-main
// (undici) this returns each 3xx response UNFILTERED (real status + Location
// header, verified empirically), so this loop consumes and re-dispatches
// every hop BEFORE returning the final Response. Callers' streaming logic
// is unchanged: they only ever see the terminal (non-redirect) response.

/** A redirect hop was blocked by the SSRF policy or the hop budget. */
export class AiRedirectBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRedirectBlockedError";
  }
}

/** A provider response exceeded the size cap enforced before parsing. */
export class AiResponseTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseTooLargeError";
  }
}

/** Maximum redirects followed per request; further hops are blocked. */
export const MAX_REDIRECT_HOPS = 3;

// Redirect statuses we follow. 301/302/308 preserve method+body; 303 is
// followed as-is too (both AI call sites keep their original method — the
// body re-send to a validated target is the accepted policy).
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

// User-facing block reasons. The blocked-target detail is the HOST only —
// never the full URL with its query string (it may carry provider params).
const REDIRECT_BLOCKED_MESSAGE = "重定向目标被安全策略拒绝";
const REDIRECT_HOPS_EXCEEDED_MESSAGE = "重定向次数超限";

/** Clone the request init minus the Authorization header (cross-origin hop). */
function dropAuthorizationHeader(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  return { ...init, headers };
}

export interface GuardedRedirectOptions {
  /**
   * SSRF predicate re-run on every resolved hop URL. Callers pin the
   * local-gateway exception to the ORIGINAL request's locality — never
   * recompute it from the hop target, or a public https endpoint could
   * redirect the request into a localhost service.
   */
  validate: (url: string) => boolean;
  maxRedirects?: number;
}

/**
 * fetch() that follows 301/302/303/307/308 manually, re-validating every
 * hop through `validate` and dropping Authorization across origins. The
 * returned Response is the terminal (non-redirect) response.
 */
export async function fetchWithGuardedRedirects(
  url: string,
  init: RequestInit,
  options: GuardedRedirectOptions,
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECT_HOPS;
  let currentUrl = url;
  let currentInit = init;
  let followed = 0;
  for (;;) {
    const response = await fetch(currentUrl, {
      ...currentInit,
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }
    if (followed >= maxRedirects) {
      throw new AiRedirectBlockedError(REDIRECT_HOPS_EXCEEDED_MESSAGE);
    }
    const location = response.headers?.get?.("location");
    if (!location) {
      // A 3xx without Location cannot be followed; hand it back unchanged
      // (callers map it through their normal non-OK handling).
      return response;
    }
    // [20260912_Sec_319_SsrfHardening_Review] Resolve defensively: a
    // malformed Location is a redirect-path failure and shares the blocked
    // error umbrella instead of leaking a raw TypeError into generic
    // network-failure mapping.
    let resolved: URL;
    try {
      resolved = new URL(location, currentUrl);
    } catch {
      throw new AiRedirectBlockedError(
        `${REDIRECT_BLOCKED_MESSAGE}：Location 无法解析`,
      );
    }
    if (!options.validate(resolved.toString())) {
      throw new AiRedirectBlockedError(
        `${REDIRECT_BLOCKED_MESSAGE}：${resolved.hostname}`,
      );
    }
    if (new URL(currentUrl).origin !== resolved.origin) {
      currentInit = dropAuthorizationHeader(currentInit);
    }
    // Stream hygiene: release the intermediate 3xx body before
    // re-dispatching (typically empty, but the contract is explicit).
    await response.body?.cancel().catch(() => {});
    followed += 1;
    currentUrl = resolved.toString();
  }
}
// [20260912_Sec_319_SsrfHardening] END

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
// [20260908_Fix_BatchReview_M8] Named per the no-magic-numbers rule.
const LIST_MODELS_TIMEOUT_MS = 10_000;

// [20260912_Sec_319_SsrfHardening] Ticket #319: the LIST_MODELS response cap
// moves from a post-read Buffer.byteLength check to a STREAMING accumulate-
// with-cap read. A hostile gateway can stream an unbounded body — buffering
// all of it just to measure it afterwards is the memory amplification this
// closes. Three arms, in order:
//   1. content-length declared above the cap → rejected BEFORE any body read;
//   2. a body stream is available → accumulate with the cap, abort the
//      reader on overflow (never drain the remainder just to discard it);
//   3. no body stream (legacy test-double Responses without .body) → full
//      text read, cap checked after (byte-identical to the pre-#319 arm).
// Overflow throws AiResponseTooLargeError; listProviderModels maps it to the
// silent body_too_large degradation (the ticket #233 renderer contract) —
// the throw stays the single enforcement point (exported for direct tests:
// listProviderModels cannot observe the throw, it only sees the mapped
// result).
export const LIST_MODELS_MAX_RESPONSE_BYTES = 512 * 1024;
const MODELS_BODY_TOO_LARGE_MESSAGE = "模型列表响应超过大小上限";

export async function readBodyWithByteCap(
  response: Response,
  maxBytes: number,
): Promise<string> {
  // Arm 1 — declared size known up front: reject without reading.
  const declaredLength = Number(
    response.headers?.get?.("content-length") ?? "",
  );
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AiResponseTooLargeError(MODELS_BODY_TOO_LARGE_MESSAGE);
  }
  // Arm 2 — stream the body with a running byte cap.
  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let receivedBytes = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        // Abort the upstream read — never drain an oversized remainder.
        // [20260912_Sec_319_SsrfHardening_Review] A cancel() rejection must
        // not mask the cap error (it would drift the locked reason code).
        await reader.cancel().catch(() => {});
        throw new AiResponseTooLargeError(MODELS_BODY_TOO_LARGE_MESSAGE);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }
  // Arm 3 — degraded shape without a readable stream.
  const raw = await response.text();
  if (Buffer.byteLength(raw) > maxBytes) {
    throw new AiResponseTooLargeError(MODELS_BODY_TOO_LARGE_MESSAGE);
  }
  return raw;
}
// [20260912_Sec_319_SsrfHardening] END

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
      // [20260912_Sec_319_SsrfHardening] Ticket #319: redirects are followed
      // manually through the shared per-hop gate. The local-gateway exception
      // is pinned to THIS request's base URL (never recomputed from the hop
      // target), so a public https endpoint cannot hop into a localhost or
      // intranet service. Blocked hops throw AiRedirectBlockedError, which
      // propagates (a security block is not a fetch failure to retry).
      const response = await fetchWithGuardedRedirects(
        candidateUrl,
        {
          headers,
          signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
        },
        {
          validate: (hopUrl) =>
            validateAIBaseUrl(hopUrl, { allowLocalhost: isLocal }),
        },
      );
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
      // [20260912_Sec_319_SsrfHardening] Streaming accumulate-with-cap read;
      // overflow throws AiResponseTooLargeError (mapped to the silent
      // body_too_large degradation in the catch below).
      const raw = await readBodyWithByteCap(
        response,
        LIST_MODELS_MAX_RESPONSE_BYTES,
      );
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
      // [20260912_Sec_319_SsrfHardening] Named #319 errors are NOT network
      // failures and must not degrade to fetch_failed: a redirect block is a
      // security event that propagates to the caller; the size cap degrades
      // silently (reason: body_too_large) per the ticket #233 contract.
      if (error instanceof AiRedirectBlockedError) {
        throw error;
      }
      if (error instanceof AiResponseTooLargeError) {
        return { success: false, reason: "body_too_large", models: [] };
      }
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
