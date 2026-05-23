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

  describe("getProviderByName", () => {
    it("returns matching provider", () => {
      const deepseek = getProviderByName("deepseek");
      expect(deepseek).toBeDefined();
      expect(deepseek.name).toBe("deepseek");
    });

    it("returns undefined for unknown provider", () => {
      expect(getProviderByName("nonexistent")).toBeUndefined();
    });
  });
});
