import { describe, it, expect } from "vitest";
import en from "../../src/i18n/en.json";
import zh from "../../src/i18n/zh.json";

const enKeys = Object.keys(en).sort();
const zhKeys = Object.keys(zh).sort();

describe("i18n completeness", () => {
  it("en.json and zh.json have identical key sets", () => {
    expect(enKeys).toEqual(zhKeys);
  });

  it("all translation values are non-empty", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(String(value).trim().length, `en.${key} is empty`).toBeGreaterThan(
        0,
      );
    }
    for (const [key, value] of Object.entries(zh)) {
      expect(String(value).trim().length, `zh.${key} is empty`).toBeGreaterThan(
        0,
      );
    }
  });

  it("no HTML injection in translations", () => {
    const dangerous = /<script|<iframe|onerror\s*=/i;
    for (const [key, value] of Object.entries(en)) {
      expect(
        dangerous.test(String(value)),
        `en.${key} contains HTML injection`,
      ).toBe(false);
    }
    for (const [key, value] of Object.entries(zh)) {
      expect(
        dangerous.test(String(value)),
        `zh.${key} contains HTML injection`,
      ).toBe(false);
    }
  });

  it("install commands contain expected package managers", () => {
    expect(en.hero_brew).toContain("brew");
    expect(en.hero_winget).toContain("winget");
    expect(zh.hero_brew).toContain("brew");
    expect(zh.hero_winget).toContain("winget");
  });

  it('site titles contain "Murmur"', () => {
    expect(en.site_title).toContain("Murmur");
    expect(zh.site_title).toContain("Murmur");
  });

  it("language switch labels are correct", () => {
    expect(en.lang_switch).toBe("中文");
    expect(zh.lang_switch).toBe("English");
  });

  it("comparison headers are distinct from each other", () => {
    const enHeaders = [
      en.comparison_macos,
      en.comparison_iflytek,
      en.comparison_whisper,
    ];
    const zhHeaders = [
      zh.comparison_macos,
      zh.comparison_iflytek,
      zh.comparison_whisper,
    ];
    expect(new Set(enHeaders).size).toBe(3);
    expect(new Set(zhHeaders).size).toBe(3);
  });

  it("section overline keys exist in both languages", () => {
    const sectionKeys = [
      "section_why",
      "section_features",
      "section_getting_started",
      "section_comparison",
      "section_providers",
      "section_faq",
    ];
    for (const key of sectionKeys) {
      expect(en[key as keyof typeof en]).toBeDefined();
      expect(zh[key as keyof typeof zh]).toBeDefined();
      expect(String(en[key as keyof typeof en]).length).toBeGreaterThan(0);
      expect(String(zh[key as keyof typeof zh]).length).toBeGreaterThan(0);
    }
  });

  // C2: hero_overline key exists (not hardcoded)
  it("hero_overline key exists in both languages", () => {
    expect(en.hero_overline).toBeDefined();
    expect(zh.hero_overline).toBeDefined();
    expect(en.hero_overline.length).toBeGreaterThan(0);
    expect(zh.hero_overline.length).toBeGreaterThan(0);
  });

  // C2: ZH hero_overline should not contain English
  it("ZH hero_overline has no English leak", () => {
    expect(zh.hero_overline).not.toContain("Open Source");
    expect(zh.hero_overline).not.toContain("Privacy First");
  });

  // H3: hero tagline split into separate keys
  it("hero_tagline_primary and hero_tagline_secondary exist in both languages", () => {
    expect(en.hero_tagline_primary).toBeDefined();
    expect(en.hero_tagline_secondary).toBeDefined();
    expect(zh.hero_tagline_primary).toBeDefined();
    expect(zh.hero_tagline_secondary).toBeDefined();
    expect(en.hero_tagline_primary.length).toBeGreaterThan(0);
    expect(en.hero_tagline_secondary.length).toBeGreaterThan(0);
    expect(zh.hero_tagline_primary.length).toBeGreaterThan(0);
    expect(zh.hero_tagline_secondary.length).toBeGreaterThan(0);
  });

  // H1: AI provider name keys are localized
  it("AI provider name keys exist in both languages", () => {
    const providerKeys = [
      "provider_openai",
      "provider_deepseek",
      "provider_qwen",
      "provider_glm",
      "provider_groq",
      "provider_moonshot",
      "provider_siliconflow",
      "provider_minimax",
      "provider_ollama",
      "provider_lmstudio",
    ];
    for (const key of providerKeys) {
      expect(en[key as keyof typeof en], `en.${key} missing`).toBeDefined();
      expect(zh[key as keyof typeof zh], `zh.${key} missing`).toBeDefined();
      expect(
        String(en[key as keyof typeof en]).length,
        `en.${key} empty`,
      ).toBeGreaterThan(0);
      expect(
        String(zh[key as keyof typeof zh]).length,
        `zh.${key} empty`,
      ).toBeGreaterThan(0);
    }
  });

  // H1: ZH-specific providers should have Chinese names
  it("ZH provider names use Chinese where appropriate", () => {
    expect(zh.provider_qwen).toBe("通义千问");
    expect(zh.provider_glm).toBe("智谱 GLM");
    expect(zh.provider_siliconflow).toBe("硅基流动");
  });

  // H1: EN provider names should use English names
  it("EN provider names use English names", () => {
    expect(en.provider_qwen).toBe("Qwen");
    expect(en.provider_glm).toBe("GLM");
    expect(en.provider_siliconflow).toBe("SiliconFlow");
  });
});
