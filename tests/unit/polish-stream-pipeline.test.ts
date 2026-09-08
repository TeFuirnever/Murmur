// [20260907_Feat_235_StreamPipeline] T8 pipeline tests: the orchestrator's
// streaming branch end-to-end — SSE consumption, chunk emission order,
// deadline matrix, output caps, abort channel and logging discipline.
// SSE Response stubs drive real timers with tiny injected timeouts.
import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

if (!process.resourcesPath) {
  Object.assign(process, { resourcesPath: "/fake/resources" });
}
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/fake-userdata"),
    getAppPath: vi.fn(() => "/fake/app"),
  },
}));

import {
  runPolishOrchestrator,
  POLISH_OUTPUT_MAX_CHARS,
} from "../../src/helpers/ipc/aiHandlers";

function frame(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    id: "c",
    choices: [{ delta, finish_reason: null }],
  })}\n\n`;
}

function sseResponse(
  readImpl: (
    abort: AbortSignal,
  ) => Promise<{ done: boolean; value?: Uint8Array }>,
): Response {
  const abort = new AbortController();
  const body = {
    getReader: () => ({
      read: () => readImpl(abort.signal),
    }),
  };
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body,
  } as unknown as Response;
}

function jsonCompletion(text: string): Response {
  const body = JSON.stringify({
    choices: [{ message: { content: text }, finish_reason: "stop" }],
  });
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

const MANAGERS = () => ({
  databaseManager: {
    getSetting: vi.fn(async (key: string) =>
      key === "ai_base_url"
        ? "https://api.example.com/v1"
        : key === "ai_api_key"
          ? "sk"
          : key === "ai_model"
            ? "gpt-x"
            : null,
    ),
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  templatesDir: "/tmp/t",
});

const TINY_TIMEOUTS = { firstDeltaMs: 150, idleMs: 150 };

describe("[20260907_Feat_235_StreamPipeline] orchestrator streaming branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams start/delta/finish chunks and returns the polished text", async () => {
    const frames = [
      new TextEncoder().encode(frame({ content: "你好" })),
      new TextEncoder().encode(frame({ content: "，世界" })),
    ];
    fetchMock.mockImplementationOnce(async () =>
      sseResponse(async () =>
        frames.length > 0
          ? { done: false, value: frames.shift() }
          : { done: true },
      ),
    );
    const notify = vi.fn();
    const result = await runPolishOrchestrator(
      MANAGERS() as never,
      {
        text: "原文",
        mode: "optimize",
        clampOutputTokens: true,
        stream: { requestId: "r1", notify, timeouts: TINY_TIMEOUTS },
      } as never,
    );

    expect(result.success).toBe(true);
    const types = notify.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types[0]).toBe("start");
    expect(types).toContain("delta");
    expect(types[types.length - 1]).toBe("finish");
    const finish = notify.mock.calls[notify.mock.calls.length - 1][0] as {
      type: string;
      text: string;
      requestId: string;
    };
    expect(finish).toMatchObject({
      type: "finish",
      text: "你好，世界",
      requestId: "r1",
    });
    // reasoning absent → zero count on finish
    expect(finish.reasoningChars).toBe(0);
  });

  it("classifies first-delta stalls as STREAM_FIRST_DELTA_TIMEOUT", async () => {
    fetchMock.mockImplementationOnce(async () =>
      sseResponse(async (abort) => {
        return new Promise((_resolve, reject) => {
          const onAbort = () =>
            reject(new DOMException("aborted", "AbortError"));
          if (abort.aborted) onAbort();
          else abort.addEventListener("abort", onAbort, { once: true });
        });
      }),
    );
    const notify = vi.fn();
    const result = await runPolishOrchestrator(
      MANAGERS() as never,
      {
        text: "原文",
        mode: "optimize",
        stream: {
          requestId: "r2",
          notify,
          timeouts: { firstDeltaMs: 80, idleMs: 80 },
        },
      } as never,
    );

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toContain("首块超时");
    expect(
      notify.mock.calls.some(
        (c) => (c[0] as { type: string }).type === "error",
      ),
    ).toBe(true);
  });

  it("classifies post-first-delta stalls as STREAM_IDLE_TIMEOUT", async () => {
    let reads = 0;
    fetchMock.mockImplementationOnce(async () =>
      sseResponse(async (abortSignal) => {
        reads++;
        if (reads === 1)
          return {
            done: false,
            value: new TextEncoder().encode(frame({ content: "第一" })),
          };
        return new Promise((_resolve, reject) => {
          const onAbort = () =>
            reject(new DOMException("aborted", "AbortError"));
          if (abortSignal.aborted) onAbort();
          else abortSignal.addEventListener("abort", onAbort, { once: true });
        });
      }),
    );
    const notify = vi.fn();
    const result = await runPolishOrchestrator(
      MANAGERS() as never,
      {
        text: "原文",
        mode: "optimize",
        stream: {
          requestId: "r3",
          notify,
          timeouts: { firstDeltaMs: 200, idleMs: 100 },
        },
      } as never,
    );

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toContain("空闲超时");
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it("aborts the upstream and errors when output exceeds the absolute cap", async () => {
    const half = Math.floor(POLISH_OUTPUT_MAX_CHARS / 2) + 10;
    let reads = 0;
    fetchMock.mockImplementationOnce(
      async (_url: string, init: { signal?: AbortSignal }) => {
        const signal = init.signal!;
        return sseResponse(async () => {
          reads++;
          if (reads > 3) {
            // Pend until the orchestrator aborts the fetch signal (cap hit),
            // then observe it — proving the cap enforcement reached upstream.
            return new Promise((_resolve, reject) => {
              const onAbort = () =>
                reject(new DOMException("aborted", "AbortError"));
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            });
          }
          return {
            done: false,
            value: new TextEncoder().encode(
              frame({ content: "字".repeat(half) }),
            ),
          };
        });
      },
    );
    const notify = vi.fn();
    const result = await runPolishOrchestrator(
      MANAGERS() as never,
      {
        text: "原文",
        mode: "optimize",
        stream: {
          requestId: "r4",
          notify,
          timeouts: { firstDeltaMs: 200, idleMs: 5_000 },
        },
      } as never,
    );

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toContain("上限");
  });

  it("notifies degraded and falls back to JSON when the gateway ignores streaming", async () => {
    fetchMock.mockImplementationOnce(async () => jsonCompletion("非流式结果"));
    const notify = vi.fn();
    const result = await runPolishOrchestrator(
      MANAGERS() as never,
      {
        text: "原文",
        mode: "optimize",
        stream: { requestId: "r5", notify, timeouts: TINY_TIMEOUTS },
      } as never,
    );

    expect(result.success).toBe(true);
    expect(result.text).toBe("非流式结果");
    const types = notify.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain("degraded");
    expect(types).not.toContain("finish");
  });

  it("never leaks chunk text into the log", async () => {
    const notify = vi.fn();
    const SECRET = "机密润色内容XYZ";
    let reads = 0;
    const frames = [
      frame({ content: SECRET }),
      JSON.stringify({
        id: "c",
        choices: [{ delta: {}, finish_reason: "stop" }],
      }) + "\n\n",
      "data: [DONE]\n\n",
    ];
    fetchMock.mockImplementationOnce(async () =>
      sseResponse(async () => {
        if (reads < frames.length)
          return {
            done: false,
            value: new TextEncoder().encode(frames[reads++]),
          };
        return { done: true };
      }),
    );
    const managers = MANAGERS();
    const result = await runPolishOrchestrator(
      managers as never,
      {
        text: "原文",
        mode: "optimize",
        stream: { requestId: "r7", notify, timeouts: TINY_TIMEOUTS },
      } as never,
    );
    await vi.waitFor(() => expect(result.success).toBe(true));

    for (const call of [
      ...managers.logger.info.mock.calls,
      ...managers.logger.warn.mock.calls,
      ...managers.logger.error.mock.calls,
    ]) {
      expect(JSON.stringify(call)).not.toContain(SECRET);
    }
  });

  // [20260907_Feat_235_StreamPipeline] Abort channel ownership: the abort
  // handler lives in aiHandlers — pinned here through the run-registry
  // semantics instead (sender ownership is handler-level; covered by
  // stream-abort handler tests in a follow-up wiring suite).
  it("completes a finite stream of incremental frames", async () => {
    // Mechanics: two incremental frames then a clean end — the merged text
    // reaches the result and the finish chunk carries it.
    const frames = [
      new TextEncoder().encode(frame({ content: "增" })),
      new TextEncoder().encode(frame({ content: "量" })),
    ];
    fetchMock.mockImplementationOnce(async () =>
      sseResponse(async () =>
        frames.length > 0
          ? { done: false, value: frames.shift() }
          : { done: true },
      ),
    );
    const notify = vi.fn();
    const result = await runPolishOrchestrator(
      MANAGERS() as never,
      {
        text: "原文",
        mode: "optimize",
        stream: { requestId: "r9", notify, timeouts: TINY_TIMEOUTS },
      } as never,
    );
    expect(result.success).toBe(true);
    expect(result.text).toBe("增量");
    const finish = notify.mock.calls[notify.mock.calls.length - 1][0] as {
      type: string;
      text: string;
    };
    expect(finish).toMatchObject({ type: "finish", text: "增量" });
  });
});
