// [20260726_Tier3_AiHandlersMigrate] Migrated from .js to .ts as part of
// Tier 3 batch 5 (final electron-mock batch). Pattern: type the 4
// `let` bindings assigned from require() with `typeof import(...)` (TS7034),
// type the createIpcMain-equivalent `handlers` map (TS7053), type the
// mockFetch/mockFetchError helpers' params + the global.fetch assignment
// (TS7006 + TS2322 — the fetch mock returns a Response-shaped stub, cast
// through unknown to the DOM lib's Response type). The global.fetch mock's
// `.mock.calls` is read via a vi.Mock cast. Template reference:
// phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-user-data"),
  },
}));

// [20260726_Tier3_AiHandlersMigrate] Source module shape — typeof import lets
// the four bindings (register, processTextWithAI, checkAIStatus, getAIModes)
// infer their source signatures without restating them.
type AiHandlersModule = typeof import("../../src/helpers/ipc/aiHandlers");

// [20260726_Tier32_AiHandlers] Convert require() + vi.resetModules() to a
// top-level ESM namespace import. The vi.mock("electron", ...) above is
// hoisted by vitest and applies to every import of the source module across
// all tests, so per-test isolation via resetModules was never needed here.
// The require shim (_tsresolve.setup) was only needed to load .ts source.
import * as aiHandlersNS from "../../src/helpers/ipc/aiHandlers";

// [20260906_Refactor_PolishOrchestrator] Spec #193 T3 (ticket #230): the
// SECOND polish entry is the file-import review handler registered by
// transcriptionHandlers on C.TRANSCRIPTION.AI_REVIEW. It is characterized
// end-to-end below with the REAL processTextWithAI wired in (only fetch is
// mocked), so its prompt chain and provider payload are pinned exactly as
// production sends them — independent of the injected-mock harness used in
// transcriptionHandlers.test.ts.
import * as transcriptionHandlersNS from "../../src/helpers/ipc/transcriptionHandlers";
import * as C from "../../src/helpers/ipc-contracts";

// [20260726_Tier3_AiHandlersMigrate] Fetch mock return: the source only reads
// ok/status/statusText/json()/text(), so this is the narrowest shape that
// satisfies the call sites. Cast through unknown to Response at the assignment
// to global.fetch because the DOM lib Response requires ~14 more fields.
interface FetchResponseStub {
  ok: boolean;
  status: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

// [20260726_Tier3_AiHandlersMigrate] vi.fn typing on global.fetch: vitest's
// Mock carries the `.mock.calls` array. Used to read fetch.mock.calls[0][1].body
// — the second positional arg is the RequestInit carrying the JSON body.
type FetchMock = ReturnType<
  typeof vi.fn<(input: unknown, init?: unknown) => Promise<FetchResponseStub>>
>;

// [20260726_Tier3_AiHandlersMigrate] ipcMain.handle registers
// (event, ...args) => result callbacks; tests only assert on registration, so
// unknown[] args + void return suffices for the `registers` describe block.
type MockHandler = (...args: unknown[]) => void;

function mockFetch(response: unknown): void {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  })) as FetchMock;
  global.fetch = fn as unknown as typeof global.fetch;
}

function mockFetchError(status: number, body: unknown): void {
  const fn = vi.fn(async () => ({
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    text: async () => JSON.stringify(body),
  })) as FetchMock;
  global.fetch = fn as unknown as typeof global.fetch;
}

function setupDb(overrides: Record<string, unknown> = {}): {
  getSetting: (key: string) => Promise<unknown>;
} {
  const defaults = {
    ai_api_key: "test-key",
    ai_base_url: "https://api.openai.com/v1",
    ai_model: "gpt-3.5-turbo",
    ai_temperature: 0.3,
    ai_max_tokens: 2000,
  };
  // [20260726_Tier3_AiHandlersMigrate] Index signature so the string `key`
  // from getSetting can index settings (TS7053). Values are unioned to the
  // possible setting types the suite overrides (string | number).
  const settings: Record<string, string | number> = {
    ...defaults,
    ...overrides,
  };
  return {
    getSetting: vi.fn(async (key: string) => settings[key] ?? null),
  };
}

describe("aiHandlers", () => {
  // [20260726_Tier32_AiHandlers] Bind source functions at top level. The
  // module is loaded once with vi.mock("electron") applied; per-test state
  // lives in the managers/fetch stubs each test sets up, not in the module
  // instance. The `let` is kept only so the inner describe bodies read names
  // without the namespace prefix; assignment happens once, not per-test.
  const aiHandlers: AiHandlersModule = aiHandlersNS;
  const register = aiHandlers.register;
  const processTextWithAI = aiHandlers.processTextWithAI;
  const checkAIStatus = aiHandlers.checkAIStatus;
  const getAIModes = aiHandlers.getAIModes;
  // [20260906_Spec259_T3] Exported URL validator exercised directly below.
  const validateAIBaseUrl = aiHandlers.validateAIBaseUrl;

  describe("register", () => {
    it("registers process-text and check-ai-status handlers", () => {
      // [20260726_Tier3_AiHandlersMigrate] handlers map: channel -> handler.
      // Typed as Record<string, MockHandler | undefined> so the index access
      // in the handle() callback body type-checks (TS7053).
      const handlers: Record<string, MockHandler | undefined> = {};
      const ipcMain = {
        handle: vi.fn((channel: string, handler: MockHandler) => {
          handlers[channel] = handler;
        }),
      };

      // [20260726_Tier3_AiHandlersMigrate] Cast the mock ipcMain/managers to
      // register()'s source signature: structurally compatible with the
      // subset of Electron.IpcMain / Managers the handler uses. `unknown` bridge.
      register(
        ipcMain as unknown as Parameters<typeof register>[0],
        {
          databaseManager: {},
          logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
          templatesDir: "/tmp/test-templates",
        } as unknown as Parameters<typeof register>[1],
      );

      expect(ipcMain.handle).toHaveBeenCalledWith(
        "process-text",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "check-ai-status",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "get-ai-modes",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "get-ai-provider-presets",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "detect-local-models",
        expect.any(Function),
      );
    });
  });

  describe("processTextWithAI", () => {
    it("returns error when API key not configured", async () => {
      const db = { getSetting: vi.fn(async () => null) };
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      const result = await processTextWithAI(
        "test text",
        "optimize",
        db,
        logger,
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("API密钥");
    });

    it("uses configurable temperature and max_tokens from settings", async () => {
      const db = {
        getSetting: vi.fn(async (key: string) => {
          if (key === "ai_api_key") return "test-key";
          if (key === "ai_base_url") return "https://api.openai.com/v1";
          if (key === "ai_model") return "gpt-4";
          if (key === "ai_temperature") return 0.7;
          if (key === "ai_max_tokens") return 4000;
          return null;
        }),
      };
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetch({
        choices: [{ message: { content: "优化后文本" } }],
        usage: { total_tokens: 100 },
      });

      const result = await processTextWithAI(
        "原始文本",
        "optimize",
        db,
        logger,
      );

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
        }),
      );

      // [20260726_Tier3_AiHandlersMigrate] global.fetch is typed as the DOM
      // Response overload set, which lacks `.mock`. Cast to FetchMock to read
      // the captured calls; the second positional arg carries the RequestInit.
      const fetchMock = global.fetch as unknown as FetchMock;
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as { body: string }).body,
      );
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(4000);
    });

    // [20260815_Fix_AiMaxTokensDefault] Default raised 2000 → 8192: reasoning
    // models (deepseek-v4-flash etc.) count thinking tokens against
    // max_tokens; 2000 let reasoning alone exhaust the budget and return
    // empty content (see 20260815_Fix_AiEmptyContent).
    it("uses default temperature and max_tokens when not configured", async () => {
      const db = {
        getSetting: vi.fn(async (key: string) => {
          if (key === "ai_api_key") return "test-key";
          if (key === "ai_base_url") return "https://api.openai.com/v1";
          if (key === "ai_model") return "gpt-3.5-turbo";
          return null;
        }),
      };
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetch({
        choices: [{ message: { content: "优化后" } }],
        usage: { total_tokens: 50 },
      });

      await processTextWithAI("test", "optimize", db, logger);

      const fetchMock = global.fetch as unknown as FetchMock;
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as { body: string }).body,
      );
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(8192);
    });

    it("returns error on HTTP 401 response", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetchError(401, {
        error: { message: "Invalid API key" },
      });

      const result = await processTextWithAI("test", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("returns error on HTTP 500 response", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetchError(500, { error: "Internal Server Error" });

      const result = await processTextWithAI("test", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("returns error when choices array is empty", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetch({ choices: [] });

      const result = await processTextWithAI("test", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(result.error).toContain("格式错误");
    });

    // [20260815_Fix_AiEmptyContent] Regression: reasoning models (e.g.
    // deepseek-v4-flash) can spend the entire max_tokens budget on reasoning
    // (finish_reason "length"), returning HTTP 200 with an EMPTY message.content.
    // Production logs 2026-08-15: outputLength 0, reasoning_tokens 2000 ==
    // completion_tokens 2000 == max_tokens. This must NOT be reported as
    // success — the UI would then show a generic failure with no cause.
    it("returns actionable error when reasoning exhausts max_tokens and content is empty", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetch({
        choices: [
          {
            message: { content: "" },
            finish_reason: "length",
          },
        ],
        usage: {
          completion_tokens: 2000,
          completion_tokens_details: { reasoning_tokens: 2000 },
        },
      });

      const result = await processTextWithAI("test", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(result.error).toContain("max_tokens");
    });

    // [20260815_Fix_AiEmptyContent] Same guard applies when content is
    // undefined or whitespace, or finish_reason is absent but output is empty.
    it("returns error when content is whitespace only", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetch({
        choices: [{ message: { content: "   \n  " } }],
        usage: { completion_tokens: 10 },
      });

      const result = await processTextWithAI("test", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("checkAIStatus", () => {
    it("returns error when API key not configured", async () => {
      const db = { getSetting: vi.fn(async () => null) };
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(result.error).toContain("API密钥");
    });

    it.each([
      ["http://api.openai.com/v1", "http rejected"],
      ["https://192.168.1.1/v1", "RFC1918 rejected"],
      ["not a url", "garbage rejected"],
    ])("rejects unsafe base URL %s (%s)", async (baseUrl) => {
      const db = {
        getSetting: vi.fn(async (key: string) => {
          if (key === "ai_api_key") return "test-key";
          if (key === "ai_base_url") return baseUrl;
          if (key === "ai_model") return "gpt-3.5-turbo";
          return null;
        }),
      };
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(result.error).toContain("https");
    });

    it("returns mapped error on HTTP 401", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetchError(401, {
        error: { message: "Unauthorized" },
      });

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(result.error).toContain("无效");
    });

    it("returns mapped error on HTTP 429", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetchError(429, {
        error: { message: "Rate limited" },
      });

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(result.error).toContain("频率");
    });

    it("returns mapped error on HTTP 500", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetchError(500, { error: "Internal Server Error" });

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(result.error).toContain("内部错误");
    });

    it("returns error when response has empty choices", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      mockFetch({ choices: [] });

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("getAIModes", () => {
    it("returns built-in modes when no custom templates", () => {
      const modes = getAIModes("/non/existent/path");
      expect(modes.length).toBeGreaterThanOrEqual(6);
      const names = modes.map((m) => m.name);
      expect(names).toContain("optimize");
      expect(names).toContain("optimize_long");
      expect(names).toContain("format");
      expect(names).toContain("correct");
      expect(names).toContain("summarize");
      expect(names).toContain("enhance");
    });

    it("includes custom templates alongside built-in modes", () => {
      const dir = path.join(process.cwd(), "test-modes-temp");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "meeting.md"),
        "---\nname: meeting\nlabel: 会议纪要\n---\n会议助手。",
      );
      try {
        const modes = getAIModes(dir);
        const names = modes.map((m) => m.name);
        expect(names).toContain("optimize");
        expect(names).toContain("meeting");
        const meeting = modes.find((m) => m.name === "meeting");
        expect(meeting!.label).toBe("会议纪要");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("each mode has name and label", () => {
      const modes = getAIModes("/non/existent/path");
      for (const mode of modes) {
        expect(mode).toHaveProperty("name");
        expect(mode).toHaveProperty("label");
        expect(mode.name).toBeTruthy();
        expect(mode.label).toBeTruthy();
      }
    });
  });

  // ======================================================================
  // [20260906_Spec259_T3] URL-validation, fetch edge and error-mapping
  // arms (Spec #259 T3, #275).
  // ======================================================================
  describe("validateAIBaseUrl", () => {
    it("accepts a public https endpoint", () => {
      expect(validateAIBaseUrl("https://api.openai.com/v1")).toBe(true);
    });

    it("rejects http when localhost is not allowed", () => {
      expect(validateAIBaseUrl("http://api.openai.com/v1")).toBe(false);
    });

    it("accepts http for an allowed localhost endpoint", () => {
      expect(
        validateAIBaseUrl("http://localhost:1234/v1", {
          allowLocalhost: true,
        }),
      ).toBe(true);
    });

    it("accepts https for an allowed localhost endpoint", () => {
      expect(
        validateAIBaseUrl("https://localhost:1234/v1", {
          allowLocalhost: true,
        }),
      ).toBe(true);
    });

    it.each([
      "https://localhost/v1",
      "https://sub.localhost/v1",
      "https://0.0.0.0/v1",
      "https://[::1]/v1",
      "https://127.0.0.1/v1",
    ])("rejects loopback host %s", (baseUrl) => {
      expect(validateAIBaseUrl(baseUrl)).toBe(false);
    });

    it.each([
      "https://10.1.2.3/v1",
      "https://192.168.0.5/v1",
      "https://172.16.0.1/v1",
      "https://172.31.255.255/v1",
      "https://169.254.9.9/v1",
    ])("rejects private-network host %s", (baseUrl) => {
      expect(validateAIBaseUrl(baseUrl)).toBe(false);
    });

    it("accepts a host that only looks like the 172 range", () => {
      expect(validateAIBaseUrl("https://172.15.0.1/v1")).toBe(true);
      expect(validateAIBaseUrl("https://172.32.0.1/v1")).toBe(true);
    });

    it("rejects a URL with an empty hostname", () => {
      expect(validateAIBaseUrl("https://#")).toBe(false);
    });

    it("rejects unparseable input", () => {
      expect(validateAIBaseUrl("not a url")).toBe(false);
    });
  });

  describe("processTextWithAI — request and error-mapping arms", () => {
    it("falls back to the default base URL when the setting is empty", async () => {
      const db = setupDb({ ai_base_url: "" });
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetch({ choices: [{ message: { content: "ok" } }] });

      const result = await processTextWithAI("t", "optimize", db, logger);
      expect(result.success).toBe(true);
      const fetchMock = global.fetch as unknown as FetchMock;
      expect(fetchMock.mock.calls[0]![0]).toBe(
        "https://api.openai.com/v1/chat/completions",
      );
    });

    it("uses caller-supplied system/user prompts verbatim", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetch({ choices: [{ message: { content: "ok" } }] });

      await processTextWithAI("t", "optimize", db, logger, {
        systemPrompt: "SYS",
        userPrompt: "USR",
      });
      const fetchMock = global.fetch as unknown as FetchMock;
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as { body: string }).body,
      );
      expect(body.messages[0].content).toBe("SYS");
      expect(body.messages[1].content).toBe("USR");
    });

    it("maps a timed-out request to the TIMEOUT message", async () => {
      vi.useFakeTimers();
      try {
        const db = setupDb();
        const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
        // A fetch that never resolves but rejects when its abort signal
        // fires — lets the real AbortController timer run out.
        global.fetch = vi.fn(
          (_input: unknown, init?: { signal?: AbortSignal }) =>
            new Promise<FetchResponseStub>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                reject(err);
              });
            }),
        ) as unknown as typeof global.fetch;

        const pending = processTextWithAI("t", "optimize", db, logger);
        await vi.advanceTimersByTimeAsync(150_000);
        const result = await pending;
        expect(result.success).toBe(false);
        expect(result.error).toContain("超时");
      } finally {
        vi.useRealTimers();
      }
    });

    it("surfaces a generic fetch failure message", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      global.fetch = vi.fn(async () => {
        throw new Error("socket boom");
      }) as unknown as typeof global.fetch;

      const result = await processTextWithAI("t", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(result.error).toBe("socket boom");
    });

    it("maps an ENOTFOUND failure to the network hint", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      global.fetch = vi.fn(async () => {
        throw Object.assign(new Error("getaddrinfo failed"), {
          code: "ENOTFOUND",
        });
      }) as unknown as typeof global.fetch;

      const result = await processTextWithAI("t", "optimize", db, logger);
      expect(result.error).toBe("无法连接到AI服务器，请检查网络");
    });

    it("logs and forwards a non-JSON error body", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      global.fetch = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "<html>oops</html>",
      })) as unknown as typeof global.fetch;

      const result = await processTextWithAI("t", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        "AI错误响应非JSON格式:",
        expect.any(String),
      );
      expect(String(result.error)).toContain("<html>oops</html>");
    });

    it("falls back to the status code when the error body has no message", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetchError(500, { error: null });

      const result = await processTextWithAI("t", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain("AI服务请求失败 (500)");
    });

    it("tolerates an empty non-JSON error body (falls back to statusText)", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      global.fetch = vi.fn(async () => ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "",
      })) as unknown as typeof global.fetch;

      const result = await processTextWithAI("t", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain("Service Unavailable");
    });

    it("reports empty content without a token cap as retryable", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetch({ choices: [{ message: {} }] });

      const result = await processTextWithAI("t", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(result.error).toBe("AI返回了空内容，请重试或更换模型");
    });

    it("reports the token cap when usage alone proves it", async () => {
      const db = setupDb({ ai_max_tokens: 2000 });
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetch({
        choices: [{ message: { content: "  " }, finish_reason: "stop" }],
        usage: { completion_tokens: 2000 },
      });

      const result = await processTextWithAI("t", "optimize", db, logger);
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain("max_tokens");
    });
  });

  describe("checkAIStatus — config and error-mapping arms", () => {
    it("uses a temporary test config when provided", async () => {
      const db = { getSetting: vi.fn(async () => null) };
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetch({
        choices: [{ message: { content: "测试成功" } }],
        usage: { total_tokens: 5 },
      });

      const result = await checkAIStatus(
        {
          ai_api_key: "temp-key",
          ai_base_url: "https://temp.example.com/v1",
          ai_model: "temp-model",
        },
        db,
        logger,
      );
      expect(result.available).toBe(true);
      expect(result.model).toBe("temp-model");
      expect(result.status).toBe("connected");
      // The saved config must not have been read.
      expect(db.getSetting).not.toHaveBeenCalled();
    });

    it("defaults missing temp-config fields to the OpenAI presets", async () => {
      const db = { getSetting: vi.fn(async () => null) };
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetch({ choices: [{ message: { content: "测试成功" } }] });

      const result = await checkAIStatus(
        { ai_api_key: "temp-key" },
        db,
        logger,
      );
      expect(result.available).toBe(true);
      expect(result.model).toBe("gpt-3.5-turbo");
      const fetchMock = global.fetch as unknown as FetchMock;
      expect(fetchMock.mock.calls[0]![0]).toBe(
        "https://api.openai.com/v1/chat/completions",
      );
    });

    it("maps an HTTP 403 to the permission message", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetchError(403, { error: { message: "Forbidden" } });

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(result.error).toBe("API密钥权限不足");
    });

    it("falls back to the HTTP status when the body has no message", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetchError(502, { error: null });

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(String(result.error)).toContain("HTTP 502");
      expect(result.details).toContain("HTTP 502");
    });

    it("maps an AbortError to the timeout message", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      global.fetch = vi.fn(async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }) as unknown as typeof global.fetch;

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(result.error).toBe("请求超时，请检查网络连接");
    });

    it.each([
      [
        "getaddrinfo ENOTFOUND api.example.com",
        "无法连接到AI服务器，请检查网络和Base URL",
      ],
      [
        "connect ECONNREFUSED 1.2.3.4:443",
        "连接被拒绝，请检查Base URL是否正确",
      ],
      ["socket timeout waiting for response", "请求超时，请检查网络连接"],
      ["upstream replied 401 to probe", "API密钥无效"],
      ["upstream replied 403 to probe", "API密钥权限不足"],
      ["upstream replied 429 to probe", "API调用频率超限"],
    ])("maps %s to %s", async (message, expected) => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      global.fetch = vi.fn(async () => {
        throw new Error(message);
      }) as unknown as typeof global.fetch;

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(false);
      expect(result.error).toBe(expected);
    });

    it("reports connected with an empty reply when content is absent", async () => {
      const db = setupDb();
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      mockFetch({ choices: [{ message: {} }], usage: { total_tokens: 1 } });

      const result = await checkAIStatus(null, db, logger);
      expect(result.available).toBe(true);
      expect(result.response).toBe("");
    });
  });

  describe("register — handler invocation (Spec #259 T3)", () => {
    // Handler shape for invocation asserts: unknown args, unknown result.
    type AsyncMockHandler = (...args: unknown[]) => unknown;

    // UNREACHABLE ARM (documented per Spec #259 T3): the
    // managers.templatesDir fallback at aiHandlers.ts L578-585 (lazy
    // require("electron") → app.getPath) cannot resolve in the test
    // environment — vi.mock does not intercept CJS require, the real
    // electron package exports a binary path string outside Electron, so
    // register() without templatesDir always throws there. The handlers
    // below therefore pass templatesDir explicitly.
    function createCapturingIpcMain() {
      const handlers: Record<string, AsyncMockHandler | undefined> = {};
      const ipcMain = {
        handle: vi.fn((channel: string, fn: AsyncMockHandler) => {
          handlers[channel] = fn;
        }),
      };
      return { handlers, ipcMain };
    }

    function createManagers() {
      return {
        databaseManager: setupDb(),
        logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
        templatesDir: "/tmp/test-templates",
      } as unknown as Parameters<typeof register>[1];
    }

    it("serves the info handlers through the registered channels", async () => {
      const { handlers, ipcMain } = createCapturingIpcMain();
      register(
        ipcMain as unknown as Parameters<typeof register>[0],
        createManagers(),
      );

      // GET_MODES through the explicit templatesDir.
      const modes = (await handlers["get-ai-modes"]!()) as Array<{
        name: string;
      }>;
      expect(modes.length).toBeGreaterThanOrEqual(6);

      // GET_PROVIDER_PRESETS passthrough.
      const presets = (await handlers[
        "get-ai-provider-presets"
      ]!()) as unknown[];
      expect(Array.isArray(presets)).toBe(true);

      // DETECT_LOCAL_MODELS — probes localhost; offline yields an array.
      const detected = (await handlers["detect-local-models"]!()) as unknown[];
      expect(Array.isArray(detected)).toBe(true);
    });

    it("PROCESS applies the default mode and the template cache", async () => {
      const { handlers, ipcMain } = createCapturingIpcMain();
      register(
        ipcMain as unknown as Parameters<typeof register>[0],
        createManagers(),
      );
      mockFetch({ choices: [{ message: { content: "ok" } }] });

      const first = (await handlers["process-text"]!({}, "raw")) as {
        success: boolean;
      };
      // Second call inside the template-cache TTL exercises the hit path.
      const second = (await handlers["process-text"]!({}, "raw")) as {
        success: boolean;
      };
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);

      const fetchMock = global.fetch as unknown as FetchMock;
      expect(fetchMock.mock.calls.length).toBe(2);
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as { body: string }).body,
      );
      expect(body.model).toBe("gpt-3.5-turbo");
    });

    it("CHECK_STATUS handler defaults to the saved config", async () => {
      const { handlers, ipcMain } = createCapturingIpcMain();
      register(
        ipcMain as unknown as Parameters<typeof register>[0],
        createManagers(),
      );
      mockFetch({
        choices: [{ message: { content: "测试成功" } }],
        usage: { total_tokens: 5 },
      });

      const result = (await handlers["check-ai-status"]!()) as {
        available: boolean;
        model?: string;
      };
      expect(result.available).toBe(true);
      expect(result.model).toBe("gpt-3.5-turbo");
    });
  });

  // ======================================================================
  // [20260906_Refactor_PolishOrchestrator] Characterization tests (Spec #193
  // T3, ticket #230): lock the CURRENT behavior of BOTH polish entries before
  // extracting runPolishOrchestrator. These are characterization, not TDD-red:
  // they must pass against the pre-refactor code and stay untouched after.
  // ======================================================================
  describe("polish entries — characterization (Spec #193 T3)", () => {
    // Handle-capturing ipcMain mock (same pattern as the Spec #259 T3 block).
    type AsyncMockHandler = (...args: unknown[]) => unknown;

    // [20260906_Refactor_PolishOrchestrator] The never-parameter signature is
    // the assignability trick that lets BOTH handler modules' register
    // functions (aiHandlers and transcriptionHandlers) be passed without
    // restating their manager shapes; the invocation itself casts through
    // unknown, mirroring the register call sites elsewhere in this file.
    function captureHandlers(
      registerFn: (ipcMain: never, managers: never) => void,
      managers: unknown,
    ): Record<string, AsyncMockHandler | undefined> {
      const handlers: Record<string, AsyncMockHandler | undefined> = {};
      const ipcMain = {
        handle: vi.fn((channel: string, fn: AsyncMockHandler) => {
          handlers[channel] = fn;
        }),
      };
      (registerFn as unknown as (ipc: unknown, managers: unknown) => void)(
        ipcMain,
        managers,
      );
      return handlers;
    }

    // DB with the standard AI settings plus the transcription-row readers
    // the AI_REVIEW handler needs (getTranscriptionById is synchronous in
    // the transcriptionHandlers DatabaseManager contract).
    function createPolishDb(row: unknown): {
      getSetting: (key: string) => Promise<unknown>;
      getTranscriptionById: (id: number) => unknown;
      saveTranscription: (...args: unknown[]) => unknown;
    } {
      const settings: Record<string, string | number> = {
        ai_api_key: "test-key",
        ai_base_url: "https://api.openai.com/v1",
        ai_model: "gpt-3.5-turbo",
        ai_temperature: 0.3,
        ai_max_tokens: 2000,
      };
      return {
        getSetting: vi.fn(async (key: string) => settings[key] ?? null),
        getTranscriptionById: vi.fn(() => row),
        saveTranscription: vi.fn(),
      };
    }

    function readRequestBody(): Record<string, unknown> {
      const fetchMock = global.fetch as unknown as FetchMock;
      return JSON.parse(
        (fetchMock.mock.calls[0]![1] as { body: string }).body,
      ) as Record<string, unknown>;
    }

    it("PROCESS happy path: builds the mode prompt, calls the provider, maps success", async () => {
      const handlers = captureHandlers(register, {
        databaseManager: createPolishDb(null),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        templatesDir: "/tmp/test-templates",
      });
      mockFetch({
        choices: [{ message: { content: "  润色结果  " } }],
        usage: { total_tokens: 7 },
      });

      const result = (await handlers[C.AI.PROCESS]!(
        {},
        "原始文本",
        "optimize",
      )) as {
        success: boolean;
        text?: string;
        usage?: unknown;
        model?: string;
      };

      // Success mapping: trimmed text + usage + resolved model, no error key.
      expect(result).toEqual({
        success: true,
        text: "润色结果",
        usage: { total_tokens: 7 },
        model: "gpt-3.5-turbo",
      });

      // Provider payload: URL, auth, method and the full chat-completion body.
      const fetchMock = global.fetch as unknown as FetchMock;
      expect(fetchMock.mock.calls[0]![0]).toBe(
        "https://api.openai.com/v1/chat/completions",
      );
      const init = fetchMock.mock.calls[0]![1] as {
        method: string;
        headers: Record<string, string>;
      };
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer test-key");
      expect(readRequestBody()).toEqual({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: expect.stringContaining("语音转录文本润色助手"),
          },
          { role: "user", content: "<transcript>\n原始文本\n</transcript>" },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        stream: false,
      });
    });

    it("PROCESS prefers a custom template from templatesDir over built-in modes", async () => {
      const dir = path.join(process.cwd(), "test-polish-templates-temp");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "meeting.md"),
        '---\nname: meeting\nlabel: 会议纪要\nuser_template: "整理：{text}"\n---\n你是会议纪要助手。',
      );
      try {
        const handlers = captureHandlers(register, {
          databaseManager: createPolishDb(null),
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
          templatesDir: dir,
        });
        mockFetch({ choices: [{ message: { content: "纪要" } }] });

        const result = (await handlers[C.AI.PROCESS]!(
          {},
          "正文",
          "meeting",
        )) as { success: boolean };

        expect(result.success).toBe(true);
        const body = readRequestBody();
        expect(body.messages).toEqual([
          { role: "system", content: "你是会议纪要助手。" },
          { role: "user", content: "整理：正文" },
        ]);
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("PROCESS maps a provider HTTP error body to the normalized failure", async () => {
      const handlers = captureHandlers(register, {
        databaseManager: createPolishDb(null),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        templatesDir: "/tmp/test-templates",
      });
      mockFetchError(401, { error: { message: "Invalid API key" } });

      const result = (await handlers[C.AI.PROCESS]!({}, "t", "optimize")) as {
        success: boolean;
        error?: string;
      };
      expect(result).toEqual({ success: false, error: "Invalid API key" });
    });

    it("PROCESS blocks an unconfigured non-local call before reaching the provider", async () => {
      const db = {
        getSetting: vi.fn(async () => null),
      };
      const handlers = captureHandlers(register, {
        databaseManager: db,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        templatesDir: "/tmp/test-templates",
      });
      mockFetch({ choices: [{ message: { content: "x" } }] });

      const result = (await handlers[C.AI.PROCESS]!({}, "t", "optimize")) as {
        success: boolean;
        error?: string;
      };
      expect(result).toEqual({
        success: false,
        error: "请先在设置页面配置AI API密钥",
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("AI_REVIEW professional fallback: built-in professional prompt, reviewText mapping, never persisted", async () => {
      const db = createPolishDb({ id: 42, text: "评审原文" });
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      mockFetch({
        choices: [{ message: { content: "评审结果" } }],
        usage: { total_tokens: 3 },
      });

      // Wire the transcription AI_REVIEW handler to the REAL processTextWithAI
      // — the exact production wiring from src/helpers/ipc/index.ts.
      const handlers = captureHandlers(transcriptionHandlersNS.register, {
        funasrManager: {},
        databaseManager: db,
        logger,
        processTextWithAI: aiHandlers.processTextWithAI,
      });

      // Empty template → the handler must fall back to "professional".
      const result = (await handlers[C.TRANSCRIPTION.AI_REVIEW]!(
        {},
        42,
        "",
      )) as Record<string, unknown>;

      // Return-only: mapped to reviewText, exactly these keys.
      expect(result).toEqual({ success: true, reviewText: "评审结果" });
      // Never persisted to the DB.
      expect(db.saveTranscription).not.toHaveBeenCalled();

      // The prompt chain must produce the BUILT-IN professional template for
      // the row text (built outside the entry, sent as system+user messages).
      const body = readRequestBody();
      expect(body.model).toBe("gpt-3.5-turbo");
      expect(body.stream).toBe(false);
      expect(body.messages).toEqual([
        {
          role: "system",
          content: expect.stringContaining("专业评价文稿撰写专家"),
        },
        { role: "user", content: "<transcript>\n评审原文\n</transcript>" },
      ]);
    });

    it("AI_REVIEW passes an explicit template through to prompt resolution", async () => {
      const db = createPolishDb({ id: 42, text: "评审原文" });
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      mockFetch({ choices: [{ message: { content: "摘要结果" } }] });

      const handlers = captureHandlers(transcriptionHandlersNS.register, {
        funasrManager: {},
        databaseManager: db,
        logger,
        processTextWithAI: aiHandlers.processTextWithAI,
      });

      const result = (await handlers[C.TRANSCRIPTION.AI_REVIEW]!(
        {},
        42,
        "summarize",
      )) as Record<string, unknown>;

      expect(result).toEqual({ success: true, reviewText: "摘要结果" });
      const body = readRequestBody();
      expect(body.messages).toEqual([
        { role: "system", content: expect.stringContaining("文本摘要助手") },
        { role: "user", content: "<transcript>\n评审原文\n</transcript>" },
      ]);
    });

    it("AI_REVIEW passes provider failures through unchanged", async () => {
      const db = createPolishDb({ id: 42, text: "评审原文" });
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      mockFetchError(401, { error: { message: "Invalid API key" } });

      const handlers = captureHandlers(transcriptionHandlersNS.register, {
        funasrManager: {},
        databaseManager: db,
        logger,
        processTextWithAI: aiHandlers.processTextWithAI,
      });

      const result = (await handlers[C.TRANSCRIPTION.AI_REVIEW]!(
        {},
        42,
        "professional",
      )) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "Invalid API key" });
      expect(db.saveTranscription).not.toHaveBeenCalled();
    });

    it("AI_REVIEW returns the not-found failure before touching the provider", async () => {
      const db = createPolishDb(null);
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      mockFetch({ choices: [{ message: { content: "x" } }] });

      const handlers = captureHandlers(transcriptionHandlersNS.register, {
        funasrManager: {},
        databaseManager: db,
        logger,
        processTextWithAI: aiHandlers.processTextWithAI,
      });

      const result = (await handlers[C.TRANSCRIPTION.AI_REVIEW]!(
        {},
        999,
        "",
      )) as Record<string, unknown>;
      expect(result).toEqual({ success: false, error: "转录记录不存在" });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // [20260906_Feat_OrchestratorGenCancel] Spec #193 T7 (ticket #234): the
  // orchestrator gains generation invalidation (double-fire: only the newest
  // request lands), cancel semantics (AbortController through the provider
  // fetch, silent cancel outcome) and output clamping (minimal-edit budget
  // clamp with the 4096 floor + absolute response char guard). All three
  // activate through PolishRequest options; omitted options keep the legacy
  // behavior pinned by the suites above — those must stay green unedited.
  describe("polish orchestrator — generation, cancel, clamping (Spec #193 T7)", () => {
    const runPolishOrchestrator = aiHandlersNS.runPolishOrchestrator;

    function loggerOf(): { info: Mock; warn: Mock; error: Mock } {
      return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    }

    // Fetch stub whose responses are settled by hand: each provider call
    // registers a resolver in call order. With honorAbort the stub rejects
    // like real fetch when the run's signal is (or becomes) aborted — the
    // same never-resolving pattern the timeout test above uses.
    function mockDeferredFetch(options: { honorAbort: boolean }): {
      resolvers: Array<(response: FetchResponseStub) => void>;
      inits: Array<{ signal?: AbortSignal }>;
    } {
      const resolvers: Array<(response: FetchResponseStub) => void> = [];
      const inits: Array<{ signal?: AbortSignal }> = [];
      global.fetch = vi.fn(
        (_input: unknown, init?: { signal?: AbortSignal }) =>
          new Promise<FetchResponseStub>((resolve, reject) => {
            inits.push({ signal: init?.signal });
            const abortError = () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            };
            if (options.honorAbort) {
              if (init?.signal?.aborted) {
                abortError();
                return;
              }
              init?.signal?.addEventListener("abort", abortError, {
                once: true,
              });
            }
            resolvers.push(resolve);
          }),
      ) as unknown as typeof global.fetch;
      return { resolvers, inits };
    }

    function okResponse(content: string): FetchResponseStub {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content } }],
          usage: { total_tokens: 1 },
        }),
      };
    }

    // ---- 代际失效 (generation invalidation) --------------------------------

    it("generation: a newer run in the same scope supersedes the older one, which never reaches the provider", async () => {
      const db = setupDb();
      const logger = loggerOf();
      const { resolvers } = mockDeferredFetch({ honorAbort: true });

      const older = runPolishOrchestrator(
        { databaseManager: db, logger },
        { text: "旧文本", mode: "optimize", generationScope: "transcript-1" },
      );
      const newer = runPolishOrchestrator(
        { databaseManager: db, logger },
        { text: "新文本", mode: "optimize", generationScope: "transcript-1" },
      );

      const olderResult = await older;
      // Generation-lost outcome: observable via the result shape, no text.
      expect(olderResult.success).toBe(false);
      expect(olderResult.code).toBe("SUPERSEDED");
      expect(olderResult.text).toBeUndefined();

      // The stale run was short-circuited before the provider call; only the
      // newer run may talk to the provider.
      expect(global.fetch).toHaveBeenCalledTimes(1);

      resolvers[0]!(okResponse("最新结果"));
      const newerResult = await newer;
      expect(newerResult.success).toBe(true);
      expect(newerResult.text).toBe("最新结果");
    });

    it("generation: a stale run's late provider response is discarded, never mapped or allowed to overwrite the newer result", async () => {
      const db = setupDb();
      const logger = loggerOf();
      // Abort-ignoring provider: the stale response still "arrives" after the
      // newer request started — the orchestrator must discard it on its own.
      const { resolvers } = mockDeferredFetch({ honorAbort: false });

      const older = runPolishOrchestrator(
        { databaseManager: db, logger },
        { text: "旧文本", mode: "optimize", generationScope: "transcript-2" },
      );
      // Let the older run reach the provider first.
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

      const newer = runPolishOrchestrator(
        { databaseManager: db, logger },
        { text: "新文本", mode: "optimize", generationScope: "transcript-2" },
      );
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

      let staleJsonRead = false;
      resolvers[0]!({
        ok: true,
        status: 200,
        json: async () => {
          staleJsonRead = true;
          return { choices: [{ message: { content: "过期结果" } }] };
        },
      });
      const olderResult = await older;
      expect(olderResult.success).toBe(false);
      expect(olderResult.code).toBe("SUPERSEDED");
      expect(olderResult.text).toBeUndefined();
      // The stale provider response body was never even read/mapped.
      expect(staleJsonRead).toBe(false);

      resolvers[1]!(okResponse("最新结果"));
      const newerResult = await newer;
      expect(newerResult.success).toBe(true);
      expect(newerResult.text).toBe("最新结果");
    });

    it("generation: different scopes do not invalidate each other", async () => {
      const db = setupDb();
      const logger = loggerOf();
      mockFetch({ choices: [{ message: { content: "各自生效" } }] });

      const [first, second] = await Promise.all([
        runPolishOrchestrator(
          { databaseManager: db, logger },
          { text: "甲", mode: "optimize", generationScope: "scope-a" },
        ),
        runPolishOrchestrator(
          { databaseManager: db, logger },
          { text: "乙", mode: "optimize", generationScope: "scope-b" },
        ),
      ]);
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
    });

    // ---- 取消语义 (cancel semantics) ---------------------------------------

    it("cancel: aborting the caller signal terminates the in-flight fetch and settles silently with the cancel outcome", async () => {
      const db = setupDb();
      const logger = loggerOf();
      const controller = new AbortController();
      const { resolvers, inits } = mockDeferredFetch({ honorAbort: true });

      const pending = runPolishOrchestrator(
        { databaseManager: db, logger },
        { text: "长文本", mode: "optimize", signal: controller.signal },
      );
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

      controller.abort();
      const result = await pending;

      // Cancel-shaped outcome, not the TIMEOUT mapping and no mapped text.
      expect(result.success).toBe(false);
      expect(result.code).toBe("CANCELLED");
      expect(result.text).toBeUndefined();
      expect(String(result.error)).not.toContain("超时");
      // The upstream fetch observed the abort (request terminated).
      expect(inits[0]!.signal!.aborted).toBe(true);
      // Even if a response body "arrives" after the abort, the run stays
      // settled with the cancel outcome — it is never mapped.
      resolvers[0]?.(okResponse("迟到内容"));
      const settled = await pending;
      expect(settled.code).toBe("CANCELLED");
      expect(settled.text).toBeUndefined();
      // Silent cancel: no error log, so no error toast can be driven from it.
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("cancel: an already-aborted signal settles before touching the provider", async () => {
      const db = setupDb();
      const logger = loggerOf();
      const controller = new AbortController();
      controller.abort();
      mockDeferredFetch({ honorAbort: true });

      const result = await runPolishOrchestrator(
        { databaseManager: db, logger },
        { text: "长文本", mode: "optimize", signal: controller.signal },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe("CANCELLED");
      expect(global.fetch).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("cancel via the processTextWithAI adapter: T7 options flow through the positional-args contract", async () => {
      const controller = new AbortController();
      controller.abort();
      mockDeferredFetch({ honorAbort: true });

      const result = await processTextWithAI(
        "t",
        "optimize",
        setupDb(),
        loggerOf(),
        { signal: controller.signal },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe("CANCELLED");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    // ---- 输出钳制 (output clamping) -----------------------------------------

    it("clamp budget: floor 4096 wins when input×factor is small (reasoning-budget guard)", async () => {
      const db = setupDb({ ai_max_tokens: 2000 });
      mockFetch({ choices: [{ message: { content: "润色完成" } }] });

      const result = await runPolishOrchestrator(
        { databaseManager: db, logger: loggerOf() },
        {
          text: "字".repeat(2000), // 2000 × 2 = 4000, below the floor
          mode: "optimize",
          clampOutputTokens: true,
        },
      );

      expect(result.success).toBe(true);
      const body = JSON.parse(
        (
          (global.fetch as unknown as FetchMock).mock.calls[0]![1] as {
            body: string;
          }
        ).body,
      ) as { max_tokens: number };
      expect(body.max_tokens).toBe(aiHandlersNS.POLISH_CLAMP_MIN_TOKENS);
    });

    it("clamp budget: input×factor binds above the floor", async () => {
      const db = setupDb({ ai_max_tokens: 8192 });
      mockFetch({ choices: [{ message: { content: "润色完成" } }] });

      await runPolishOrchestrator(
        { databaseManager: db, logger: loggerOf() },
        {
          text: "字".repeat(2049), // 2049 × 2 = 4098, just above the floor
          mode: "optimize",
          clampOutputTokens: true,
        },
      );

      const body = JSON.parse(
        (
          (global.fetch as unknown as FetchMock).mock.calls[0]![1] as {
            body: string;
          }
        ).body,
      ) as { max_tokens: number };
      expect(body.max_tokens).toBe(4098);
    });

    it("clamp budget: the user-configured cap still binds when input×factor exceeds it", async () => {
      const db = setupDb({ ai_max_tokens: 6000 });
      mockFetch({ choices: [{ message: { content: "润色完成" } }] });

      await runPolishOrchestrator(
        { databaseManager: db, logger: loggerOf() },
        {
          text: "字".repeat(5000), // 5000 × 2 = 10000 > 6000
          mode: "optimize_long",
          clampOutputTokens: true,
        },
      );

      const body = JSON.parse(
        (
          (global.fetch as unknown as FetchMock).mock.calls[0]![1] as {
            body: string;
          }
        ).body,
      ) as { max_tokens: number };
      expect(body.max_tokens).toBe(6000);
    });

    it("clamp budget: rewrite-class modes are never clamped", async () => {
      const db = setupDb({ ai_max_tokens: 2000 });
      mockFetch({ choices: [{ message: { content: "摘要" } }] });

      await runPolishOrchestrator(
        { databaseManager: db, logger: loggerOf() },
        {
          text: "字".repeat(5000),
          mode: "summarize",
          clampOutputTokens: true,
        },
      );

      const body = JSON.parse(
        (
          (global.fetch as unknown as FetchMock).mock.calls[0]![1] as {
            body: string;
          }
        ).body,
      ) as { max_tokens: number };
      expect(body.max_tokens).toBe(2000);
    });

    it("clamp budget: omitted option keeps the user max_tokens verbatim (legacy behavior)", async () => {
      const db = setupDb({ ai_max_tokens: 2000 });
      mockFetch({ choices: [{ message: { content: "润色完成" } }] });

      await runPolishOrchestrator(
        { databaseManager: db, logger: loggerOf() },
        { text: "字".repeat(5000), mode: "optimize" },
      );

      const body = JSON.parse(
        (
          (global.fetch as unknown as FetchMock).mock.calls[0]![1] as {
            body: string;
          }
        ).body,
      ) as { max_tokens: number };
      expect(body.max_tokens).toBe(2000);
    });

    it("output guard: provider text beyond the absolute char cap is truncated before mapping", async () => {
      const cap = aiHandlersNS.POLISH_OUTPUT_MAX_CHARS;
      mockFetch({ choices: [{ message: { content: "x".repeat(cap + 1) } }] });

      const result = await runPolishOrchestrator(
        { databaseManager: setupDb(), logger: loggerOf() },
        { text: "t", mode: "optimize" },
      );

      expect(result.success).toBe(true);
      expect(result.text).toHaveLength(cap);
    });

    it("output guard: provider text exactly at the cap passes through untouched", async () => {
      const cap = aiHandlersNS.POLISH_OUTPUT_MAX_CHARS;
      mockFetch({ choices: [{ message: { content: "y".repeat(cap) } }] });

      const result = await runPolishOrchestrator(
        { databaseManager: setupDb(), logger: loggerOf() },
        { text: "t", mode: "optimize" },
      );

      expect(result.success).toBe(true);
      expect(result.text).toHaveLength(cap);
    });
  });
});
