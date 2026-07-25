import { describe, it, expect, beforeEach } from "vitest";

describe("providerPresets", () => {
  let getProviderPresets;
  let getProviderByName;

  beforeEach(() => {
    vi.resetModules();
    const presets = require("../../src/helpers/providerPresets");
    getProviderPresets = presets.getProviderPresets;
    getProviderByName = presets.getProviderByName;
  });

  describe("getProviderPresets", () => {
    it("returns non-empty array of providers", () => {
      const presets = getProviderPresets();
      expect(presets.length).toBeGreaterThan(0);
    });

    it("each preset has required fields", () => {
      const presets = getProviderPresets();
      for (const p of presets) {
        expect(p).toHaveProperty("name");
        expect(p).toHaveProperty("label");
        expect(p).toHaveProperty("base_url");
        expect(p).toHaveProperty("models");
        expect(p.models.length).toBeGreaterThan(0);
        expect(p).toHaveProperty("requires_api_key");
        expect(typeof p.requires_api_key).toBe("boolean");
      }
    });

    it("includes DeepSeek preset", () => {
      const presets = getProviderPresets();
      const deepseek = presets.find((p) => p.name === "deepseek");
      expect(deepseek).toBeDefined();
      expect(deepseek.base_url).toContain("deepseek");
    });

    it("includes Qwen preset", () => {
      const presets = getProviderPresets();
      const qwen = presets.find((p) => p.name === "qwen");
      expect(qwen).toBeDefined();
    });

    it("includes GLM preset", () => {
      const presets = getProviderPresets();
      const glm = presets.find((p) => p.name === "glm");
      expect(glm).toBeDefined();
    });

    it("includes SiliconFlow preset", () => {
      const presets = getProviderPresets();
      const sf = presets.find((p) => p.name === "siliconflow");
      expect(sf).toBeDefined();
    });

    it("includes Ollama preset (local, no API key)", () => {
      const presets = getProviderPresets();
      const ollama = presets.find((p) => p.name === "ollama");
      expect(ollama).toBeDefined();
      expect(ollama.requires_api_key).toBe(false);
      expect(ollama.base_url).toContain("localhost");
    });

    it("includes OpenAI preset", () => {
      const presets = getProviderPresets();
      const openai = presets.find((p) => p.name === "openai");
      expect(openai).toBeDefined();
      expect(openai.base_url).toContain("openai.com");
    });

    it("includes Groq preset", () => {
      const presets = getProviderPresets();
      const groq = presets.find((p) => p.name === "groq");
      expect(groq).toBeDefined();
      expect(groq.base_url).toContain("groq.com");
    });

    it("includes Moonshot preset", () => {
      const presets = getProviderPresets();
      const moonshot = presets.find((p) => p.name === "moonshot");
      expect(moonshot).toBeDefined();
      expect(moonshot.base_url).toContain("moonshot.cn");
    });

    it("includes MiniMax preset", () => {
      const presets = getProviderPresets();
      const minimax = presets.find((p) => p.name === "minimax");
      expect(minimax).toBeDefined();
      expect(minimax.base_url).toContain("minimaxi.com");
    });

    it("all base URLs are valid https (except local models)", () => {
      const presets = getProviderPresets();
      for (const p of presets) {
        if (!p.requires_api_key) {
          expect(p.base_url).toMatch(/^https?:\/\/localhost/);
        } else {
          expect(p.base_url).toMatch(/^https:\/\//);
        }
      }
    });
  });

  describe("registration fields", () => {
    it("presets with registration have valid URLs", () => {
      const presets = getProviderPresets();
      for (const p of presets) {
        if (p.registration) {
          expect(typeof p.registration.url).toBe("string");
          expect(p.registration.url).toMatch(/^https:\/\//);
          // [20260712_Fix_RegistrationGuideI18n] guide field removed from
          // presets — text now lives in i18n locale files.
          expect(p.registration).not.toHaveProperty("guide");
        }
      }
    });

    it("at most 2 presets are recommended", () => {
      const presets = getProviderPresets();
      const recommended = presets.filter(
        (p) => p.registration?.recommended === true,
      );
      expect(recommended.length).toBeLessThanOrEqual(2);
    });

    it("recommended presets have registration info", () => {
      const presets = getProviderPresets();
      const recommended = presets.filter(
        (p) => p.registration?.recommended === true,
      );
      for (const p of recommended) {
        expect(p.registration.url).toBeTruthy();
      }
    });

    it("deepseek is recommended with registration", () => {
      const deepseek = getProviderByName("deepseek");
      expect(deepseek.registration).toBeDefined();
      expect(deepseek.registration.recommended).toBe(true);
      expect(deepseek.registration.url).toContain("deepseek.com");
      expect(deepseek.registration).not.toHaveProperty("guide");
    });

    it("siliconflow is recommended with registration", () => {
      const siliconflow = getProviderByName("siliconflow");
      expect(siliconflow.registration).toBeDefined();
      expect(siliconflow.registration.recommended).toBe(true);
      expect(siliconflow.registration.url).toContain("siliconflow.cn");
      expect(siliconflow.registration).not.toHaveProperty("guide");
    });

    it("groq has registration without recommended flag", () => {
      const groq = getProviderByName("groq");
      expect(groq.registration).toBeDefined();
      expect(groq.registration.recommended).toBeUndefined();
    });

    it("openrouter has registration with free models", () => {
      const openrouter = getProviderByName("openrouter");
      expect(openrouter).toBeDefined();
      expect(openrouter.registration).toBeDefined();
      expect(openrouter.registration.url).toContain("openrouter.ai");
      expect(openrouter.models.length).toBeGreaterThan(0);
      expect(openrouter.models.some((m) => m.includes("free"))).toBe(true);
    });

    it("local providers do not have registration", () => {
      const presets = getProviderPresets();
      const local = presets.filter((p) => !p.requires_api_key);
      for (const p of local) {
        expect(p.registration).toBeUndefined();
      }
    });
  });

  describe("getProviderByName", () => {
    it("returns matching provider", () => {
      const deepseek = getProviderByName("deepseek");
      expect(deepseek).toBeDefined();
      expect(deepseek.name).toBe("deepseek");
    });

    // [20260725_TDD_ProviderPresets] openai lookup — verifies the find()
    // happy path returns a fully-defined preset for a known provider name.
    it("returns defined preset with name 'openai' for getProviderByName('openai')", () => {
      const openai = getProviderByName("openai");
      expect(openai).toBeDefined();
      expect(openai.name).toBe("openai");
      expect(openai.label).toBe("OpenAI");
      expect(openai.base_url).toContain("openai.com");
    });

    it("returns undefined for unknown provider", () => {
      expect(getProviderByName("nonexistent")).toBeUndefined();
    });
  });
});
