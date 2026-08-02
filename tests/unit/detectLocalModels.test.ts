// [20260726_Tier3_DetectLocalModelsMigrate] Migrated from .js to .ts as part
// of Tier 3 batch 4. Pattern: typed `let detectLocalModels` via
// `typeof import("...").detectLocalModels` (TS7034), and the inline fetch
// mocks' (url) and (_url) params get explicit `string` / `Response`-like
// structural typing — vi.fn(async (url) => ...) would otherwise be implicit
// any under TS7008. The mock Response objects are partial; cast to
// `unknown as Response` so the structural Response shape stays intact.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
//
// [20260726_Tier32_DetectLocalModels] Tier 3.2: converted cargo-cult
// require() + vi.resetModules() to top-level ESM import. The shim only
// existed to load the .ts source (no vi.mock was ever used). The nested
// describe's beforeEach that did the require is removed; the outer
// beforeEach (vi.resetModules only) is also removed as it no-ops.
// [20260726_Tier32_DetectLocalModels] END
import { describe, it, expect, vi } from "vitest";
import { detectLocalModels } from "../../src/helpers/detectLocalModels";

describe("detectLocalModels", () => {
  describe("with fetch mock", () => {
    it("returns empty array when no local models running", async () => {
      const originalFetch = globalThis.fetch;
      // [20260726_Tier3_DetectLocalModelsMigrate] globalThis.fetch is
      // overloaded (URL|RequestInfo, RequestInit?) — match that signature so
      // the vi.fn assignment type-checks. Cast url to string at use site.
      globalThis.fetch = vi.fn(async (_url: URL | RequestInfo) => {
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
      globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("11434")) {
          return {
            ok: true,
            json: async () => ({
              models: [{ name: "qwen2.5:7b" }, { name: "llama3.1:8b" }],
            }),
          } as unknown as Response;
        }
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        const ollama = result.find((r) => r.name === "ollama");
        expect(ollama).toBeDefined();
        expect(ollama!.models).toContain("qwen2.5:7b");
        expect(ollama!.models).toContain("llama3.1:8b");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("detects running LM Studio instance", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("1234")) {
          return {
            ok: true,
            json: async () => ({ data: [{ id: "loaded-model" }] }),
          } as unknown as Response;
        }
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        const lmstudio = result.find((r) => r.name === "lmstudio");
        expect(lmstudio).toBeDefined();
        expect(lmstudio!.models).toContain("loaded-model");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("detects both when both running", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("11434")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "qwen2.5:7b" }] }),
          } as unknown as Response;
        }
        if (String(url).includes("1234")) {
          return {
            ok: true,
            json: async () => ({ data: [{ id: "model-a" }] }),
          } as unknown as Response;
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
      globalThis.fetch = vi.fn(async (_url: URL | RequestInfo) => {
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
      globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("11434")) {
          return { ok: false, status: 500 } as unknown as Response;
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
      globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("11434")) {
          return { ok: true, json: async () => ({}) } as unknown as Response;
        }
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        const ollama = result.find((r) => r.name === "ollama");
        expect(ollama).toBeDefined();
        expect(ollama!.models).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles LM Studio with empty models list", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("1234")) {
          return { ok: true, json: async () => ({}) } as unknown as Response;
        }
        throw new Error("ECONNREFUSED");
      });
      try {
        const result = await detectLocalModels();
        const lmstudio = result.find((r) => r.name === "lmstudio");
        expect(lmstudio).toBeDefined();
        expect(lmstudio!.models).toEqual([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
