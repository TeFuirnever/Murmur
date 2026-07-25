// [20260725_Tier3_Phase7Tier0FixesMigrate] Migrated from .js to .ts as part
// of Tier 3 batch 1. Pattern: declare explicit types for `let` bindings
// assigned from require() in beforeEach/beforeAll — strict tsc (TS7034/TS7005)
// cannot infer the type because the assignment happens in a callback whose
// type does not flow back to the declaration site. Each binding is typed via
// `typeof import("<module>").<export>` to reuse the source module's own
// types without introducing `any`. Template reference: phase4-i18n.test.ts
// (commit d52f2e0).
//
// [20260724_TS_BigBang_TestFix] Replace all createRequire usages with
// vite-intercepted require + vi.resetModules(). createRequire uses Node's
// native resolver which cannot load .ts files. The tests only needed module
// isolation (delete-cache), which vi.resetModules() provides equivalently.
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Tier 0 fixes", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  // [20260724_TS_BigBang_TestFix] END

  describe("T0-2: Python version detection requires 3.8+", () => {
    // [20260725_Tier3_Phase7Tier0FixesMigrate] require() returns the default
    // export directly under esbuild CJS interop, so the binding holds the
    // class constructor itself. `.default` indexes the module namespace type.
    let PythonEnvironment: typeof import("../../src/helpers/pythonEnvironment").default;

    beforeEach(() => {
      PythonEnvironment = require("../../src/helpers/pythonEnvironment");
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
      expect(env.isPythonVersionSupported({ major: 3, minor: 11 })).toBe(true);
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

  describe("T0-4: PYTHONUTF8=1 in buildPythonEnvironment", () => {
    // [20260725_Tier3_Phase7Tier0FixesMigrate] Same default-export shape as
    // the T0-2 block above.
    let PythonEnvironment: typeof import("../../src/helpers/pythonEnvironment").default;

    beforeEach(() => {
      PythonEnvironment = require("../../src/helpers/pythonEnvironment");
    });

    it("sets PYTHONUTF8=1 to prevent GBK/CP936 encoding corruption on Windows", () => {
      const env = new PythonEnvironment({
        info: () => {},
        warn: () => {},
        error: () => {},
      });
      // Stub embedded python check to avoid filesystem dependency
      env.getEmbeddedPythonPath = () => "/nonexistent";
      const result = env.buildPythonEnvironment();
      expect(result.PYTHONUTF8).toBe("1");
    });

    it("PYTHONUTF8 is set even when embedded Python is used", () => {
      const env = new PythonEnvironment({
        info: () => {},
        warn: () => {},
        error: () => {},
      });
      // Simulate embedded python present (won't actually exist, but force the branch)
      const origExistsSync = require("fs").existsSync;
      require("fs").existsSync = () => true;
      try {
        env.getEmbeddedPythonPath = () => "/fake/embedded/python/bin/python3";
        const result = env.buildPythonEnvironment();
        expect(result.PYTHONUTF8).toBe("1");
      } finally {
        require("fs").existsSync = origExistsSync;
      }
    });
  });

  describe("T0-3: SSRF validation allows localhost for local models", () => {
    // [20260725_Tier3_Phase7Tier0FixesMigrate] Named export; index the
    // module namespace type by member name to reuse the source signature.
    let validateAIBaseUrl: typeof import("../../src/helpers/ipc/aiHandlers").validateAIBaseUrl;

    beforeEach(() => {
      const aiHandlers = require("../../src/helpers/ipc/aiHandlers");
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
    // [20260725_Tier3_Phase7Tier0FixesMigrate] Named async export; the
    // mock db/logger passed at call sites satisfy the source's structural
    // DatabaseManager/Logger interfaces.
    let processTextWithAI: typeof import("../../src/helpers/ipc/aiHandlers").processTextWithAI;

    beforeEach(() => {
      const aiHandlers = require("../../src/helpers/ipc/aiHandlers");
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
    // [20260725_Tier3_Phase7Tier0FixesMigrate] Named async export; first
    // argument is the testConfig | null per source signature.
    let checkAIStatus: typeof import("../../src/helpers/ipc/aiHandlers").checkAIStatus;

    beforeEach(() => {
      const aiHandlers = require("../../src/helpers/ipc/aiHandlers");
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
