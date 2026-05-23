import { describe, it, expect, vi, beforeEach } from "vitest";

describe("detectLocalModels", () => {
  let detectLocalModels;

  beforeEach(() => {
    vi.resetModules();
  });

  describe("with fetch mock", () => {
    beforeEach(() => {
      const detect = require("../../src/helpers/detectLocalModels");
      detectLocalModels = detect.detectLocalModels;
    });

    it("returns empty array when no local models running", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (_url) => {
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        expect(result).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("detects running Ollama instance", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes("11434")) {
          return {
            ok: true,
            json: async () => ({
              models: [{ name: "qwen2.5:7b" }, { name: "llama3.1:8b" }],
            }),
          };
        }
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        const ollama = result.find((r) => r.name === "ollama");
        expect(ollama).toBeDefined();
        expect(ollama.models).toContain("qwen2.5:7b");
        expect(ollama.models).toContain("llama3.1:8b");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("detects running LM Studio instance", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes("1234")) {
          return {
            ok: true,
            json: async () => ({ data: [{ id: "loaded-model" }] }),
          };
        }
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        const lmstudio = result.find((r) => r.name === "lmstudio");
        expect(lmstudio).toBeDefined();
        expect(lmstudio.models).toContain("loaded-model");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("detects both when both running", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes("11434")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "qwen2.5:7b" }] }),
          };
        }
        if (url.includes("1234")) {
          return {
            ok: true,
            json: async () => ({ data: [{ id: "model-a" }] }),
          };
        }
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        expect(result).toHaveLength(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles timeout gracefully", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (_url) => {
        throw new Error("fetch timeout");
      });
      try {
        const result = await detectLocalModels();
        expect(result).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("skips endpoints returning non-ok response", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes("11434")) {
          return { ok: false, status: 500 };
        }
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        expect(result).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles Ollama with empty models list", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes("11434")) {
          return { ok: true, json: async () => ({}) };
        }
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        const ollama = result.find((r) => r.name === "ollama");
        expect(ollama).toBeDefined();
        expect(ollama.models).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
