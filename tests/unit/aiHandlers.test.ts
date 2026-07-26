// [20260726_Tier3_AiHandlersMigrate] Migrated from .js to .ts as part of
// Tier 3 batch 5 (final electron-mock batch). Pattern: type the 4
// `let` bindings assigned from require() with `typeof import(...)` (TS7034),
// type the createIpcMain-equivalent `handlers` map (TS7053), type the
// mockFetch/mockFetchError helpers' params + the global.fetch assignment
// (TS7006 + TS2322 — the fetch mock returns a Response-shaped stub, cast
// through unknown to the DOM lib's Response type). The global.fetch mock's
// `.mock.calls` is read via a vi.Mock cast. Template reference:
// phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  let register: AiHandlersModule["register"];
  let processTextWithAI: AiHandlersModule["processTextWithAI"];
  let checkAIStatus: AiHandlersModule["checkAIStatus"];
  let getAIModes: AiHandlersModule["getAIModes"];

  beforeEach(() => {
    vi.resetModules();
    const aiHandlers: AiHandlersModule = require("../../src/helpers/ipc/aiHandlers");
    register = aiHandlers.register;
    processTextWithAI = aiHandlers.processTextWithAI;
    checkAIStatus = aiHandlers.checkAIStatus;
    getAIModes = aiHandlers.getAIModes;
  });

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
      expect(body.max_tokens).toBe(2000);
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
});
