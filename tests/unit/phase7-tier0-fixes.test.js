import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);

describe("Tier 0 fixes", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("T0-2: Python version detection requires 3.8+", () => {
    let PythonEnvironment;

    beforeEach(() => {
      const pyPath = requireCJS.resolve(
        "../../src/helpers/pythonEnvironment.js",
      );
      delete requireCJS.cache[pyPath];
      PythonEnvironment = requireCJS("../../src/helpers/pythonEnvironment.js");
    });

    it("rejects Python 3.6", () => {
      const env = new PythonEnvironment();
      expect(env.isPythonVersionSupported({ major: 3, minor: 6 })).toBe(false);
    });

    it("rejects Python 3.7", () => {
      const env = new PythonEnvironment();
      expect(env.isPythonVersionSupported({ major: 3, minor: 7 })).toBe(false);
    });

    it("accepts Python 3.8", () => {
      const env = new PythonEnvironment();
      expect(env.isPythonVersionSupported({ major: 3, minor: 8 })).toBe(true);
    });

    it("accepts Python 3.11", () => {
      const env = new PythonEnvironment();
      expect(
        env.isPythonVersionSupported({ major: 3, minor: 11 }),
      ).toBe(true);
    });

    it("rejects null/undefined version", () => {
      const env = new PythonEnvironment();
      expect(env.isPythonVersionSupported(null)).toBe(false);
      expect(env.isPythonVersionSupported(undefined)).toBe(false);
    });

    it("rejects Python 2.x", () => {
      const env = new PythonEnvironment();
      expect(env.isPythonVersionSupported({ major: 2, minor: 7 })).toBe(false);
    });
  });

  describe("T0-3: SSRF validation allows localhost for local models", () => {
    let validateAIBaseUrl;

    beforeEach(() => {
      const aiPath = requireCJS.resolve(
        "../../src/helpers/ipc/aiHandlers.js",
      );
      delete requireCJS.cache[aiPath];
      const aiHandlers = requireCJS("../../src/helpers/ipc/aiHandlers.js");
      validateAIBaseUrl = aiHandlers.validateAIBaseUrl;
    });

    it("rejects localhost by default (cloud mode)", () => {
      expect(validateAIBaseUrl("http://localhost:11434/v1")).toBe(false);
      expect(validateAIBaseUrl("https://localhost/v1")).toBe(false);
    });

    it("rejects 127.0.0.1 by default", () => {
      expect(validateAIBaseUrl("http://127.0.0.1:11434/v1")).toBe(false);
      expect(validateAIBaseUrl("https://127.0.0.1/v1")).toBe(false);
    });

    it("rejects http for cloud URLs", () => {
      expect(validateAIBaseUrl("http://api.openai.com/v1")).toBe(false);
    });

    it("accepts https cloud URLs", () => {
      expect(validateAIBaseUrl("https://api.openai.com/v1")).toBe(true);
    });

    it("allows http://localhost when allowLocalhost is true", () => {
      expect(
        validateAIBaseUrl("http://localhost:11434/v1", {
          allowLocalhost: true,
        }),
      ).toBe(true);
    });

    it("allows http://127.0.0.1 when allowLocalhost is true", () => {
      expect(
        validateAIBaseUrl("http://127.0.0.1:1234/v1", {
          allowLocalhost: true,
        }),
      ).toBe(true);
    });

    it("still rejects private network (10.x, 192.168.x) even with allowLocalhost", () => {
      expect(
        validateAIBaseUrl("http://192.168.1.100:11434/v1", {
          allowLocalhost: true,
        }),
      ).toBe(false);
      expect(
        validateAIBaseUrl("http://10.0.0.1:11434/v1", {
          allowLocalhost: true,
        }),
      ).toBe(false);
    });

    it("rejects garbage URLs", () => {
      expect(validateAIBaseUrl("not a url")).toBe(false);
      expect(validateAIBaseUrl("not a url", { allowLocalhost: true })).toBe(
        false,
      );
    });
  });

  describe("T1-1: processTextWithAI supports local models without API key", () => {
    let processTextWithAI;

    beforeEach(() => {
      const aiPath = requireCJS.resolve(
        "../../src/helpers/ipc/aiHandlers.js",
      );
      delete requireCJS.cache[aiPath];
      const aiHandlers = requireCJS("../../src/helpers/ipc/aiHandlers.js");
      processTextWithAI = aiHandlers.processTextWithAI;
    });

    it("proceeds without API key when base URL is localhost", async () => {
      const db = {
        getSetting: vi.fn(async (key) => {
          if (key === "ai_api_key") return null;
          if (key === "ai_base_url") return "http://localhost:11434/v1";
          if (key === "ai_model") return "qwen2.5";
          return null;
        }),
      };
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      const result = await processTextWithAI(
        "test text",
        "optimize",
        db,
        logger,
      );
      // Should NOT return the "API密钥" error — it should attempt the fetch
      expect(result.error).not.toContain("API密钥");
    });

    it("still requires API key for cloud URLs", async () => {
      const db = {
        getSetting: vi.fn(async (key) => {
          if (key === "ai_api_key") return null;
          if (key === "ai_base_url") return "https://api.openai.com/v1";
          return null;
        }),
      };
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

  describe("T1-1: checkAIStatus supports local models without API key", () => {
    let checkAIStatus;

    beforeEach(() => {
      const aiPath = requireCJS.resolve(
        "../../src/helpers/ipc/aiHandlers.js",
      );
      delete requireCJS.cache[aiPath];
      const aiHandlers = requireCJS("../../src/helpers/ipc/aiHandlers.js");
      checkAIStatus = aiHandlers.checkAIStatus;
    });

    it("does not reject localhost URL in checkAIStatus", async () => {
      const db = {
        getSetting: vi.fn(async (key) => {
          if (key === "ai_api_key") return null;
          if (key === "ai_base_url") return "http://localhost:11434/v1";
          if (key === "ai_model") return "qwen2.5";
          return null;
        }),
      };
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

      const result = await checkAIStatus(null, db, logger);
      // Should NOT fail with the "https" or "API密钥" error
      expect(result.error).not.toContain("https");
      expect(result.error).not.toContain("API密钥");
    });
  });
});
