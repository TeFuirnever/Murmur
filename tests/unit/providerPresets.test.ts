// [20260726_Tier3_ProviderPresetsMigrate] Migrated from .js to .ts as part of
// Tier 3 batch 3. Pattern: type the `let getProviderPresets` / `let
// getProviderByName` bindings via the source's named exports (TS7034). Once
// typed, the `(p) =>` / `(m) =>` callback params infer ProviderPresetData /
// string from the source signatures, and getProviderByName's
// `ProviderPresetData | undefined` return is narrowed with non-null assertions
// after the prior `toBeDefined()` (suite convention). Template reference:
// phase4-i18n.test.ts (commit d52f2e0).
//
// [20260726_Tier32_ProviderPresets] Tier 3.2: converted cargo-cult require()
// + vi.resetModules() to top-level ESM import. No vi.mock() was used; shim
// existed only to load the .ts source. `beforeEach` was ONLY the require, so
// it is deleted entirely (it would have been an empty block). The `beforeEach`
// import is dropped from the vitest import list since nothing else uses it.
// [20260726_Tier32_ProviderPresets] END
import { describe, it, expect } from "vitest";
import {
  getProviderPresets,
  getProviderByName,
} from "../../src/helpers/providerPresets";

describe("providerPresets", () => {
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
      // [20260726_Tier3_ProviderPresetsMigrate] find() returns T | undefined;
      // non-null after the defined assertion (suite convention).
      const deepseek = presets.find((p) => p.name === "deepseek")!;
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
      const ollama = presets.find((p) => p.name === "ollama")!;
      expect(ollama).toBeDefined();
      expect(ollama.requires_api_key).toBe(false);
      expect(ollama.base_url).toContain("localhost");
    });

    it("includes OpenAI preset", () => {
      const presets = getProviderPresets();
      const openai = presets.find((p) => p.name === "openai")!;
      expect(openai).toBeDefined();
      expect(openai.base_url).toContain("openai.com");
    });

    it("includes Groq preset", () => {
      const presets = getProviderPresets();
      const groq = presets.find((p) => p.name === "groq")!;
      expect(groq).toBeDefined();
      expect(groq.base_url).toContain("groq.com");
    });

    it("includes Moonshot preset", () => {
      const presets = getProviderPresets();
      const moonshot = presets.find((p) => p.name === "moonshot")!;
      expect(moonshot).toBeDefined();
      expect(moonshot.base_url).toContain("moonshot.cn");
    });

    it("includes MiniMax preset", () => {
      const presets = getProviderPresets();
      const minimax = presets.find((p) => p.name === "minimax")!;
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
        // [20260726_Tier3_ProviderPresetsMigrate] Non-null: the filter kept
        // only presets whose registration?.recommended === true, so
        // registration is present.
        expect(p.registration!.url).toBeTruthy();
      }
    });

    it("deepseek is recommended with registration", () => {
      // [20260726_Tier3_ProviderPresetsMigrate] getProviderByName returns
      // T | undefined; non-null after the subsequent assertions. The
      // registration sub-object is asserted defined before each access.
      const deepseek = getProviderByName("deepseek")!;
      expect(deepseek.registration).toBeDefined();
      expect(deepseek.registration!.recommended).toBe(true);
      expect(deepseek.registration!.url).toContain("deepseek.com");
      expect(deepseek.registration).not.toHaveProperty("guide");
    });

    it("siliconflow is recommended with registration", () => {
      const siliconflow = getProviderByName("siliconflow")!;
      expect(siliconflow.registration).toBeDefined();
      expect(siliconflow.registration!.recommended).toBe(true);
      expect(siliconflow.registration!.url).toContain("siliconflow.cn");
      expect(siliconflow.registration).not.toHaveProperty("guide");
    });

    it("groq has registration without recommended flag", () => {
      const groq = getProviderByName("groq")!;
      expect(groq.registration).toBeDefined();
      expect(groq.registration!.recommended).toBeUndefined();
    });

    it("openrouter has registration with free models", () => {
      const openrouter = getProviderByName("openrouter")!;
      expect(openrouter).toBeDefined();
      expect(openrouter.registration).toBeDefined();
      expect(openrouter.registration!.url).toContain("openrouter.ai");
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

    // [20260926_Fix_398_ProviderLabelI18n] The "(本地)" suffix was hardcoded
    // Chinese in the label strings — English UI rendered it verbatim (issue
    // #398). Same class of bug as registration.guide: locale-bound text must
    // not live in the locale-neutral preset data. The suffix now composes via
    // i18n (settings.providers.localSuffix) at the label resolution point, so
    // the data carries a locale-neutral is_local flag instead.
    it("local presets are flagged is_local and labels carry no locale suffix", () => {
      const presets = getProviderPresets();
      const local = presets.filter((p) => p.is_local === true);
      expect(local.map((p) => p.name).sort()).toEqual(["lmstudio", "ollama"]);
      for (const p of presets) {
        expect(p.label).not.toMatch(/\(本地\)|\(local\)/i);
      }
    });
  });

  describe("getProviderByName", () => {
    it("returns matching provider", () => {
      const deepseek = getProviderByName("deepseek")!;
      expect(deepseek).toBeDefined();
      expect(deepseek.name).toBe("deepseek");
    });

    // [20260725_TDD_ProviderPresets] openai models refresh — pins the
    // 2026-09 verified GPT-6 family as the advertised catalog.
    it("returns defined preset with name 'openai' for getProviderByName('openai')", () => {
      const openai = getProviderByName("openai")!;
      expect(openai).toBeDefined();
      expect(openai.name).toBe("openai");
      expect(openai.label).toBe("OpenAI");
      expect(openai.base_url).toContain("openai.com");
    });

    it("returns undefined for unknown provider", () => {
      expect(getProviderByName("nonexistent")).toBeUndefined();
    });
  });

  // [20260926_Fix_397_ProviderAudit] Issue #397 F3: every base_url and model
  // mapping below was verified against the provider's own API docs in
  // 2026-09. These pins exist so silent upstream catalog drift surfaces as a
  // red test instead of a broken preset button in the settings UI.
  describe("[20260926_Fix_397_ProviderAudit] 2026-09 factual audit", () => {
    it("openai preset advertises the GPT-6 family, not the retired gpt-4 generation", () => {
      const openai = getProviderByName("openai")!;
      expect(openai.base_url).toBe("https://api.openai.com/v1");
      expect(openai.models).toEqual(["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"]);
    });

    it("anthropic preset exposes the OpenAI-compatibility endpoint with current Claude models", () => {
      const anthropic = getProviderByName("anthropic")!;
      expect(anthropic.base_url).toBe("https://api.anthropic.com/v1");
      expect(anthropic.models).toEqual([
        "claude-sonnet-5",
        "claude-opus-5-5",
        "claude-haiku-4-5",
      ]);
      expect(anthropic.requires_api_key).toBe(true);
      expect(anthropic.registration?.url).toBe("https://console.anthropic.com");
    });

    it("deepseek preset uses the documented bare-domain base_url and the V4-generation models", () => {
      // api-docs.deepseek.com documents the OpenAI-format base as the bare
      // domain; the legacy /v1 suffix is no longer part of the docs.
      const deepseek = getProviderByName("deepseek")!;
      expect(deepseek.base_url).toBe("https://api.deepseek.com");
      expect(deepseek.models).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    });

    it("qwen preset lists the Qwen3.8 generation", () => {
      const qwen = getProviderByName("qwen")!;
      expect(qwen.base_url).toBe(
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      );
      expect(qwen.models).toEqual([
        "qwen3.8-max",
        "qwen3.5-plus",
        "qwen3.5-flash",
      ]);
    });

    it("glm preset lists the GLM-5 generation", () => {
      const glm = getProviderByName("glm")!;
      expect(glm.base_url).toBe("https://open.bigmodel.cn/api/paas/v4");
      expect(glm.models).toEqual(["glm-5.3", "glm-5.3-flash"]);
    });

    it("siliconflow preset lists the current DeepSeek-V4 catalog IDs", () => {
      const sf = getProviderByName("siliconflow")!;
      expect(sf.base_url).toBe("https://api.siliconflow.cn/v1");
      expect(sf.models).toEqual([
        "deepseek-ai/DeepSeek-V4-Flash",
        "Pro/deepseek-ai/DeepSeek-V4",
      ]);
    });

    it("groq preset drops the retired mixtral and lists production-tier models", () => {
      const groq = getProviderByName("groq")!;
      expect(groq.base_url).toBe("https://api.groq.com/openai/v1");
      expect(groq.models).toEqual([
        "openai/gpt-oss-120b",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
      ]);
    });

    it("moonshot preset lists the Kimi K generation on the documented /v1 host", () => {
      const moonshot = getProviderByName("moonshot")!;
      expect(moonshot.base_url).toBe("https://api.moonshot.cn/v1");
      expect(moonshot.models).toEqual(["kimi-k3", "kimi-k2.6"]);
    });

    it("minimax preset lists the current M-series", () => {
      const minimax = getProviderByName("minimax")!;
      expect(minimax.base_url).toBe("https://api.minimaxi.com/v1");
      expect(minimax.models).toEqual(["MiniMax-M3", "MiniMax-M2.5"]);
    });

    it("ollama preset suggests currently mainstream library tags", () => {
      const ollama = getProviderByName("ollama")!;
      expect(ollama.models).toEqual(["qwen3:8b", "gemma3:4b", "llama3.1:8b"]);
    });

    it("lmstudio preset keeps the loaded-model placeholder", () => {
      const lmstudio = getProviderByName("lmstudio")!;
      expect(lmstudio.base_url).toBe("http://localhost:1234/v1");
      expect(lmstudio.models).toEqual(["loaded-model"]);
    });
  });
});
