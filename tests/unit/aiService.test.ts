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
import {
  createStreamAbortRegistry,
  listProviderModels,
  processPolishText,
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
