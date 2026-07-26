// [20260726_Tier3_AiPromptsFewShotMigrate] Migrated from .js to .ts as part
// of Tier 3 batch 2. Pattern: type the destructured require() binding via
// `typeof import("<module>").<export>` so buildPrompt reuses the source
// signature from src/helpers/aiPrompts.ts, and annotate the describe.each
// callback param as `string` (TS7008 — describe.each infers the table as
// `ReadonlyArray<unknown>` so the callback parameter is implicitly `any`).
// No `let`-bare bindings in this file. Template reference: phase4-i18n.test.ts
// (commit d52f2e0).
//
// [20260724_Feat_PromptFewShot] Regression tests for AI prompt few-shot examples.
// Ensures each platform-style prompt includes concrete examples per ADR-012 Issue #4c.
import { describe, it, expect } from "vitest";

const {
  buildPrompt,
}: typeof import("../../src/helpers/aiPrompts") = require("../../src/helpers/aiPrompts");

describe("AI Prompt few-shot examples (ADR-012 Issue #4c)", () => {
  // Platform prompts that need few-shot examples
  const PLATFORM_MODES = ["xiaohongshu", "dianping", "douyin", "zhihu"];

  describe.each(PLATFORM_MODES)("mode: %s", (mode: string) => {
    it("system prompt contains at least one example section", () => {
      const result = buildPrompt(mode, "这是一段测试文本");
      // Look for example markers: ## 示例, ## 范例, 示例：, 例子：
      const hasExampleSection =
        /##\s*(示例|范例)|示例：|例子：|---\s*示例/.test(result.system);
      expect(hasExampleSection).toBe(true);
    });

    it("system prompt example contains realistic content (not placeholder)", () => {
      const result = buildPrompt(mode, "这是一段测试文本");
      // The example should have substantive content — not just "示例：..."
      // Check for Chinese characters indicating real example text
      const exampleMatch = result.system.match(
        /(?:##\s*(?:示例|范例)|示例：|例子：)[\s\S]*?(?=##|$)/,
      );
      if (exampleMatch) {
        // Example section should be at least 50 chars (real content, not placeholder)
        expect(exampleMatch[0].length).toBeGreaterThan(50);
      }
    });
  });

  describe("optimize mode (should NOT have few-shot — it's a cleanup mode)", () => {
    it("optimize prompt does not contain example section", () => {
      const result = buildPrompt("optimize", "测试文本");
      // Optimize mode is a cleanup mode, not a creative rewrite mode
      expect(result.system).not.toMatch(/##\s*示例/);
    });
  });

  describe("prompt structure integrity", () => {
    it("all platform prompts still have system + user with transcript tag", () => {
      for (const mode of PLATFORM_MODES) {
        const result = buildPrompt(mode, "测试内容");
        expect(result.system).toBeTruthy();
        expect(result.user).toContain("<transcript>");
        expect(result.user).toContain("测试内容");
      }
    });

    it("adding examples does not break buildPrompt for unknown mode", () => {
      const result = buildPrompt("nonexistent_mode", "测试");
      expect(result.system).toBeTruthy();
      expect(result.user).toContain("<transcript>");
    });
  });
});
