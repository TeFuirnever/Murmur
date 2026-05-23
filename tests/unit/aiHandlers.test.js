import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-user-data"),
  },
}));

describe("aiHandlers", () => {
  let register;
  let processTextWithAI;
  let checkAIStatus;
  let getAIModes;

  beforeEach(() => {
    vi.resetModules();
    const aiHandlers = require("../../src/helpers/ipc/aiHandlers");
    register = aiHandlers.register;
    processTextWithAI = aiHandlers.processTextWithAI;
    checkAIStatus = aiHandlers.checkAIStatus;
    getAIModes = aiHandlers.getAIModes;
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
        templatesDir: "/tmp/test-templates",
      });

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
        expect(meeting.label).toBe("会议纪要");
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
