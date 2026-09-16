// [20260912_Refactor_262_AiHistoryService] Headless seam tests for the
// AI-domain services extracted in ticket #262 (spec #258 Phase 0).
// processPolishText / createStreamAbortRegistry / listProviderModels run
// with plain vi.fn() deps — no Electron import anywhere: the point of the
// seam is that the abort/requestId registry and the PROCESS entry wiring
// are callable without a renderer window. Behavior parity with the IPC
// handlers is locked by the unmodified tests/unit/aiHandlers.test.ts and
// tests/unit/list-models.test.ts.
import { describe, it, expect, vi, afterEach } from "vitest";
import { MINIMAL_EDIT_MODES } from "../../src/helpers/polish-diff";
// [20260912_Sec_319_SsrfHardening] Ticket #319: guarded redirect following +
// streaming LIST_MODELS response cap under test.
import {
  AiRedirectBlockedError,
  fetchWithGuardedRedirects,
  AiResponseTooLargeError,
  LIST_MODELS_MAX_RESPONSE_BYTES,
  MAX_REDIRECT_HOPS,
  createStreamAbortRegistry,
  listProviderModels,
  processPolishText,
  readBodyWithByteCap,
  validateAIBaseUrl,
  type PolishRunResult,
  type ProcessPolishTextDeps,
  type StreamAbortRegistry,
} from "../../src/helpers/services/aiService";

type MockFn = ReturnType<typeof vi.fn>;

// Minimal PolishChunk collector type (structural echo — no Electron).
type Chunk = Record<string, unknown>;

function makeDeps(): {
  deps: ProcessPolishTextDeps;
  runPolish: MockFn;
  logger: { info: MockFn; warn: MockFn; error: MockFn };
  databaseManager: { getSetting: MockFn };
} {
  const databaseManager = { getSetting: vi.fn(async () => null) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const runPolish = vi.fn(async () => ({ success: true, text: "ok" }));
  return {
    deps: {
      databaseManager:
        databaseManager as unknown as ProcessPolishTextDeps["databaseManager"],
      logger,
      templatesDir: "/tmp/test-templates",
      runPolish: runPolish as unknown as ProcessPolishTextDeps["runPolish"],
    },
    runPolish,
    logger,
    databaseManager,
  };
}

const noopNotify = (): void => undefined;

describe("aiService — processPolishText (headless seam, ticket #262)", () => {
  it("applies the entry-level optimize default when mode is omitted", async () => {
    const { deps, runPolish } = makeDeps();
    const registry = createStreamAbortRegistry();
    await processPolishText(deps, registry, {
      text: "raw",
      senderId: 1,
      notify: noopNotify,
    });
    expect(runPolish).toHaveBeenCalledTimes(1);
    const request = runPolish.mock.calls[0]![1] as Record<string, unknown>;
    expect(request.mode).toBe("optimize");
    expect(request.text).toBe("raw");
  });

  it("passes an explicit mode through untouched", async () => {
    const { deps, runPolish } = makeDeps();
    await processPolishText(deps, createStreamAbortRegistry(), {
      text: "t",
      mode: "summarize",
      senderId: 1,
      notify: noopNotify,
    });
    expect((runPolish.mock.calls[0]![1] as Record<string, unknown>).mode).toBe(
      "summarize",
    );
  });

  it("gates clampOutputTokens by the minimal-edit mode set", async () => {
    const { deps, runPolish } = makeDeps();
    const minimalMode = MINIMAL_EDIT_MODES.has("optimize")
      ? "optimize"
      : [...MINIMAL_EDIT_MODES][0]!;
    const rewriteMode = MINIMAL_EDIT_MODES.has("summarize")
      ? "format"
      : "summarize";
    await processPolishText(deps, createStreamAbortRegistry(), {
      text: "t",
      mode: minimalMode,
      senderId: 1,
      notify: noopNotify,
    });
    await processPolishText(deps, createStreamAbortRegistry(), {
      text: "t",
      mode: rewriteMode,
      senderId: 1,
      notify: noopNotify,
    });
    const minimalRequest = runPolish.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    const rewriteRequest = runPolish.mock.calls[1]![1] as Record<
      string,
      unknown
    >;
    expect(minimalRequest.clampOutputTokens).toBe(true);
    expect(rewriteRequest.clampOutputTokens).toBe(false);
  });

  it("registers a stream run for a requestId and wires scope + signal + notify", async () => {
    const { deps, runPolish } = makeDeps();
    // Hold the run in-flight so the registration is observable mid-flight.
    let settleRun: (() => void) | undefined;
    runPolish.mockImplementationOnce(
      () =>
        new Promise<PolishRunResult>((resolve) => {
          settleRun = () => resolve({ success: true, text: "ok" });
        }),
    );
    const registry = createStreamAbortRegistry();
    const chunks: Chunk[] = [];
    const pending = processPolishText(deps, registry, {
      text: "t",
      mode: "optimize",
      requestId: "req-1",
      senderId: 7,
      notify: (chunk) => chunks.push(chunk as Chunk),
    });
    const request = runPolish.mock.calls[0]![1] as Record<string, unknown>;
    expect(request.generationScope).toBe("req-1");
    const signal = request.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(registry.get("req-1")?.senderId).toBe(7);
    // The notify transport is reachable through the stream object: a chunk
    // the orchestrator emits lands in the collector.
    const stream = request.stream as {
      requestId: string;
      notify: (chunk: unknown) => void;
    };
    expect(stream.requestId).toBe("req-1");
    stream.notify({ type: "start", requestId: "req-1" });
    expect(chunks).toEqual([{ type: "start", requestId: "req-1" }]);
    // Own-entry release: settling drops the registry slot.
    settleRun!();
    const result = await pending;
    expect(result).toEqual({ success: true, text: "ok" });
    expect(registry.get("req-1")).toBeUndefined();
    expect(signal.aborted).toBe(false);
  });

  it("omits stream/generationScope/signal without a requestId and never reads senderId", async () => {
    const { deps, runPolish } = makeDeps();
    const registry: StreamAbortRegistry = createStreamAbortRegistry();
    await processPolishText(deps, registry, {
      text: "t",
      senderId: -1,
      notify: noopNotify,
    });
    const request = runPolish.mock.calls[0]![1] as Record<string, unknown>;
    expect(request.stream).toBeUndefined();
    expect(request.generationScope).toBeUndefined();
    expect(request.signal).toBeUndefined();
    expect(request.timeout).toBeUndefined();
    expect(registry.get("")).toBeUndefined();
  });

  it("release after completion never evicts a superseding run's registration", async () => {
    const { deps, runPolish } = makeDeps();
    // Hold BOTH runs in-flight so the ownership handoff is observable.
    const release: Array<() => void> = [];
    runPolish
      .mockImplementationOnce(
        () =>
          new Promise<PolishRunResult>((resolve) => {
            release.push(() => resolve({ success: true, text: "first" }));
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<PolishRunResult>((resolve) => {
            release.push(() => resolve({ success: true, text: "second" }));
          }),
      );
    const registry = createStreamAbortRegistry();
    const first = processPolishText(deps, registry, {
      text: "t",
      requestId: "dup",
      senderId: 1,
      notify: noopNotify,
    });
    const second = processPolishText(deps, registry, {
      text: "t2",
      requestId: "dup",
      senderId: 2,
      notify: noopNotify,
    });
    // The superseding run owns the map slot now (last-write-wins).
    expect(registry.get("dup")?.senderId).toBe(2);
    // First run settles: its finally-block release must be a NO-OP because
    // it no longer owns the slot.
    release[0]!();
    await first;
    expect(registry.get("dup")?.senderId).toBe(2);
    // Second run settles: its own release drops the entry.
    release[1]!();
    await second;
    expect(registry.get("dup")).toBeUndefined();
  });
});

describe("aiService — StreamAbortRegistry (POLISH_ABORT seam)", () => {
  it("returns unknown_request without throwing on a lookup miss", () => {
    const registry = createStreamAbortRegistry();
    const logger = { warn: vi.fn() };
    expect(registry.abort("missing-id", 1, logger)).toEqual({
      success: false,
      reason: "unknown_request",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("aborts the run controller when the owning sender calls", () => {
    const registry = createStreamAbortRegistry();
    registry.register("req-1", 42);
    const outcome = registry.abort("req-1", 42);
    expect(outcome).toEqual({ success: true });
    expect(registry.get("req-1")!.controller.signal.aborted).toBe(true);
  });

  it("rejects a cross-sender abort with forbidden and a warn log", () => {
    const registry = createStreamAbortRegistry();
    registry.register("req-1", 42);
    const logger = { warn: vi.fn() };
    const outcome = registry.abort("req-1", 99, logger);
    expect(outcome).toEqual({ success: false, reason: "forbidden" });
    expect(logger.warn).toHaveBeenCalledWith(
      "POLISH_ABORT 拒绝：请求 id 不属于该发送者",
    );
    expect(registry.get("req-1")!.controller.signal.aborted).toBe(false);
  });

  it("release drops only the current owner's controller", () => {
    const registry = createStreamAbortRegistry();
    const first = registry.register("req-1", 1);
    const second = registry.register("req-1", 2); // superseding run
    registry.release("req-1", first); // stale release is a no-op
    expect(registry.get("req-1")?.controller).toBe(second);
    registry.release("req-1", second);
    expect(registry.get("req-1")).toBeUndefined();
  });
});

describe("aiService — listProviderModels (LIST_MODELS seam)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a private https URL through the SSRF gate before any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { deps } = makeDeps();
    const result = await listProviderModels(deps, "https://10.0.0.1/v1");
    expect(result).toEqual({
      success: false,
      reason: "invalid_url",
      models: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a masked key against the stored credential and lists models", async () => {
    // Typed params so mock.calls infers [url, init] tuples (no cast dance).
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: "m-1" }, { id: "m-2" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { deps, databaseManager } = makeDeps();
    databaseManager.getSetting.mockResolvedValue("stored-secret");
    const result = await listProviderModels(
      deps,
      "https://api.example.com/v1",
      "****abcd",
    );
    expect(result).toEqual({ success: true, models: ["m-1", "m-2"] });
    expect(databaseManager.getSetting).toHaveBeenCalledWith("ai_api_key");
    const init = fetchMock.mock.calls[0]![1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer stored-secret");
  });

  it("falls back through the /v1 candidate and reports fetch_failed on the last", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("conn refused");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { deps, logger } = makeDeps();
    const result = await listProviderModels(deps, "https://api.example.com");
    expect(result).toEqual({
      success: false,
      reason: "fetch_failed",
      models: [],
    });
    // Two-candidate derivation for a base without a version segment.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("preserves the SSRF gate contract (validateAIBaseUrl moved verbatim)", () => {
    expect(validateAIBaseUrl("javascript:alert(1)")).toBe(false);
    expect(validateAIBaseUrl("http://api.example.com/v1")).toBe(false);
    expect(validateAIBaseUrl("https://api.example.com/v1")).toBe(true);
    expect(
      validateAIBaseUrl("http://127.0.0.1:11434/v1", { allowLocalhost: true }),
    ).toBe(true);
  });
});

// [20260912_Sec_319_SsrfHardening] Ticket #319: guarded redirect following
// (manual follow with per-hop re-validation) and the streaming LIST_MODELS
// response cap. Redirects are scripted with REAL Response objects (Node's
// Response constructor accepts 3xx statuses and a Location header); the cap
// arms use a stub for the content-length pre-read rejection and real
// ReadableStream bodies for the streaming arms.

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

function modelsJsonResponse(ids: string[]): Response {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), {
    status: 200,
  });
}

describe("aiService — #319 fetchWithGuardedRedirects via listProviderModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks a redirect to a private URL and never issues the follow-up request", async () => {
    const fetchMock = vi.fn(async () =>
      redirectResponse("https://10.0.0.1/v1/models?key=secret"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { deps } = makeDeps();
    const error = await listProviderModels(
      deps,
      "https://api.example.com/v1",
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiRedirectBlockedError);
    expect((error as Error).message).toContain("重定向目标被安全策略拒绝");
    // The blocked HOST is surfaced, never the full URL (query may carry
    // provider parameters).
    expect((error as Error).message).toContain("10.0.0.1");
    expect((error as Error).message).not.toContain("https://");
    expect((error as Error).message).not.toContain("key=secret");
    // The provider/gatekeeper saw exactly one request — the follow-up was
    // never dispatched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a 2-hop public chain and preserves Authorization on same-origin hops", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "https://api.example.com/v1/models") {
        return redirectResponse("https://api.example.com/v1/models-hop1");
      }
      if (url === "https://api.example.com/v1/models-hop1") {
        return redirectResponse("https://api.example.com/v1/models-final");
      }
      return modelsJsonResponse(["m-1"]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { deps } = makeDeps();
    const result = await listProviderModels(
      deps,
      "https://api.example.com/v1",
      "k",
    );
    expect(result).toEqual({ success: true, models: ["m-1"] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Same-origin hop: the Authorization header survives.
    const hopInit = fetchMock.mock.calls[1]![1] as { headers: Headers };
    expect(new Headers(hopInit.headers).get("authorization")).toBe("Bearer k");
    const finalInit = fetchMock.mock.calls[2]![1] as { headers: Headers };
    expect(new Headers(finalInit.headers).get("authorization")).toBe(
      "Bearer k",
    );
  });

  it("drops Authorization on a cross-origin hop but keeps it on same-origin hops", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "https://api.example.com/v1/models") {
        return redirectResponse("https://api.example.com/v1/models-step");
      }
      if (url === "https://api.example.com/v1/models-step") {
        return redirectResponse("https://mirror.example.com/v1/models-final");
      }
      return modelsJsonResponse(["m-2"]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { deps } = makeDeps();
    const result = await listProviderModels(
      deps,
      "https://api.example.com/v1",
      "k",
    );
    expect(result).toEqual({ success: true, models: ["m-2"] });
    // Hop 2 was same-origin: Authorization still present.
    const sameOriginInit = fetchMock.mock.calls[1]![1] as { headers: Headers };
    expect(new Headers(sameOriginInit.headers).get("authorization")).toBe(
      "Bearer k",
    );
    // Hop 3 crossed origins: Authorization dropped before following.
    const crossOriginInit = fetchMock.mock.calls[2]![1] as { headers: Headers };
    expect(
      new Headers(crossOriginInit.headers).get("authorization"),
    ).toBeNull();
  });

  it("blocks the 4th redirect hop with 重定向次数超限", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const hop = Number(new URL(url).searchParams.get("hop") ?? "0");
      return redirectResponse(
        `https://api.example.com/v1/models?hop=${hop + 1}`,
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { deps } = makeDeps();
    const error = await listProviderModels(
      deps,
      "https://api.example.com/v1",
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiRedirectBlockedError);
    expect((error as Error).message).toContain("重定向次数超限");
    // Initial request + exactly MAX_REDIRECT_HOPS followed hops.
    expect(fetchMock).toHaveBeenCalledTimes(1 + MAX_REDIRECT_HOPS);
  });

  it("hands back a 3xx without Location unchanged (mapped to http_302)", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);
    const { deps } = makeDeps();
    const result = await listProviderModels(deps, "https://api.example.com/v1");
    expect(result).toEqual({
      success: false,
      reason: "http_302",
      models: [],
    });
  });

  it("exports the #319 constants with the ticket-mandated values", () => {
    expect(MAX_REDIRECT_HOPS).toBe(3);
    expect(LIST_MODELS_MAX_RESPONSE_BYTES).toBe(512 * 1024);
    expect(new AiRedirectBlockedError("x").name).toBe("AiRedirectBlockedError");
    expect(new AiResponseTooLargeError("x").name).toBe(
      "AiResponseTooLargeError",
    );
  });
});

describe("aiService — #319 LIST_MODELS response-body cap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects on a content-length above the cap BEFORE any body read", async () => {
    // The stub Response is cast: only the fields readBodyWithByteCap reads
    // are present, and `text` is a spy proving no body byte was pulled.
    const textSpy = vi.fn(async () => "");
    const oversized = {
      ok: true,
      status: 200,
      headers: new Headers({
        "content-length": String(LIST_MODELS_MAX_RESPONSE_BYTES + 1),
      }),
      body: null,
      text: textSpy,
    };
    const error = await readBodyWithByteCap(
      oversized as unknown as Response,
      LIST_MODELS_MAX_RESPONSE_BYTES,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiResponseTooLargeError);
    expect((error as Error).message).toContain("模型列表响应超过大小上限");
    // No body byte was ever pulled.
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("aborts the reader and throws when the streaming body exceeds the cap", async () => {
    let cancelled = false;
    const oversizedChunk = new Uint8Array(LIST_MODELS_MAX_RESPONSE_BYTES + 1);
    oversizedChunk.fill(0x78); // "x"
    const stream = new ReadableStream<Uint8Array>({
      // Deliberately left OPEN (a hostile unbounded gateway never closes
      // the stream) — reader.cancel() only reaches the underlying source's
      // cancel algorithm for an open stream.
      start(controller) {
        controller.enqueue(oversizedChunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const error = await readBodyWithByteCap(
      new Response(stream, { status: 200 }),
      LIST_MODELS_MAX_RESPONSE_BYTES,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiResponseTooLargeError);
    expect((error as Error).message).toContain("模型列表响应超过大小上限");
    // The upstream read was aborted, not drained.
    expect(cancelled).toBe(true);
  });

  it("reads a streaming body under the cap to completion", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify({ data: [{ id: "m-1" }] })),
        );
        controller.close();
      },
    });
    const raw = await readBodyWithByteCap(
      new Response(stream, { status: 200 }),
      LIST_MODELS_MAX_RESPONSE_BYTES,
    );
    expect(JSON.parse(raw)).toEqual({ data: [{ id: "m-1" }] });
  });

  it("still degrades silently (body_too_large) when the cap is exceeded", async () => {
    // Legacy stub shape without a body stream: the cap maps to the
    // ticket #233 silent-degradation result instead of a thrown error.
    const oversized = {
      ok: true,
      status: 200,
      text: async () => "x".repeat(LIST_MODELS_MAX_RESPONSE_BYTES + 1),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => oversized),
    );
    const { deps } = makeDeps();
    const result = await listProviderModels(deps, "https://api.example.com/v1");
    expect(result).toEqual({
      success: false,
      reason: "body_too_large",
      models: [],
    });
  });
});

// [20260912_Sec_319_SsrfHardening_Review] Review NITs promoted to locks:
// (a) a malformed Location header shares the blocked-error umbrella instead
// of leaking a raw TypeError; (b) the credential, once dropped on a
// cross-origin hop, STAYS dropped on subsequent same-origin hops back to
// the original origin (A→B→A).
describe("guarded redirect — review invariants", () => {
  it("keeps the credential dropped across a cross-origin then same-origin hop pair", async () => {
    const seenAuths: Array<string | undefined> = [];
    const fetchSpy = vi.fn(async (_input: unknown, init?: RequestInit) => {
      seenAuths.push((init?.headers as Record<string, string>)?.Authorization);
      const hop = seenAuths.length;
      if (hop === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.example.net/v1" },
        });
      }
      if (hop === 2) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://api.example.com/v1/final" },
        });
      }
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof global.fetch;
    global.fetch = fetchSpy;

    const result = await fetchWithGuardedRedirects(
      "https://api.example.com/v1",
      { headers: { Authorization: "Bearer sk-secret" } },
      { validate: () => true, maxRedirects: 5 },
    );
    expect(result.status).toBe(200);
    // Hop 1 legitimately carries the credential (it targets the original
    // origin); every LATER hop must NOT re-introduce it after the
    // cross-origin drop.
    expect(seenAuths).toEqual(["Bearer sk-secret", undefined, undefined]);
  });
});
