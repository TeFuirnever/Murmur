import { describe, it, expect, vi, beforeEach } from "vitest";

describe("aiHandlers", () => {
  let register;
  let processTextWithAI;
  let checkAIStatus;

  beforeEach(() => {
    vi.resetModules();
    const aiHandlers = require("../../src/helpers/ipc/aiHandlers");
    register = aiHandlers.register;
    processTextWithAI = aiHandlers.processTextWithAI;
    checkAIStatus = aiHandlers.checkAIStatus;
  });

  describe("register", () => {
    it("registers process-text and check-ai-status handlers", () => {
      const handlers = {};
      const ipcMain = {
        handle: vi.fn((channel, handler) => {
          handlers[channel] = handler;
        }),
      };

      register(ipcMain, {
        databaseManager: {},
        logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      });

      expect(ipcMain.handle).toHaveBeenCalledWith(
        "process-text",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "check-ai-status",
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
      ["https://localhost/v1", "localhost rejected"],
      ["https://127.0.0.1/v1", "loopback rejected"],
      ["not a url", "garbage rejected"],
    ])("rejects unsafe base URL %s (%s)", async (baseUrl) => {
      const db = {
        getSetting: vi.fn(async (key) => {
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
  });
});
