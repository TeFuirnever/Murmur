// [20260725_Tier3_EdgeCasesMigrate] Migrated from .js to .ts as part of
// Tier 3 batch 1. Pattern: declare explicit types for `let` bindings assigned
// from require() in beforeEach — strict tsc (TS7034/TS7005) cannot infer the
// type because the assignment happens in a callback whose type does not flow
// back to the declaration site. Each binding is typed via
// `typeof import("<module>").<export>` to reuse the source module's own types
// without introducing `any`. Template reference: phase4-i18n.test.ts
// (commit d52f2e0).
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

describe("edge cases: template + file config", () => {
  describe("parseTemplateFile edge cases", () => {
    // [20260725_Tier3_EdgeCasesMigrate] Named export; index the module
    // namespace type to reuse the source's (content, fileName) => PromptTemplate | null
    // signature.
    let parseTemplateFile: typeof import("../../src/helpers/aiPrompts").parseTemplateFile;

    beforeEach(() => {
      vi.resetModules();
      const aiPrompts = require("../../src/helpers/aiPrompts");
      parseTemplateFile = aiPrompts.parseTemplateFile;
    });

    it("handles Windows line endings (\\r\\n)", () => {
      const content =
        "---\r\nname: win\r\nlabel: Win\r\n---\r\nWindows content.";
      const result = parseTemplateFile(content, "win.md");
      expect(result).not.toBeNull();
      // [20260725_Tier3_EdgeCasesMigrate] Non-null assertion: the prior
      // expect().not.toBeNull() guards this at runtime; the narrowing just
      // isn't visible to tsc. Same convention as database-error-paths.test.ts.
      expect(result!.name).toBe("win");
    });

    it("handles template with only whitespace in body", () => {
      const content = "---\nname: space\n---\n   \n   \n";
      const result = parseTemplateFile(content, "space.md");
      expect(result).toBeNull();
    });

    it("handles frontmatter with empty values", () => {
      const content = "---\nname:\nlabel:\n---\nSome content here.";
      const result = parseTemplateFile(content, "fallback.md");
      expect(result).not.toBeNull();
      // [20260725_Tier3_EdgeCasesMigrate] Non-null after the assertion above.
      expect(result!.name).toBe("fallback");
    });

    it("handles multilingual content in system prompt", () => {
      const content =
        "---\nname: multilingual\n---\nTranslate to English. 翻译成中文。日本語に翻訳。";
      const result = parseTemplateFile(content, "multi.md");
      expect(result).not.toBeNull();
      // [20260725_Tier3_EdgeCasesMigrate] Non-null after the assertion above.
      expect(result!.system).toContain("翻译");
      expect(result!.system).toContain("日本語");
    });
  });

  describe("fileConfig edge cases", () => {
    // [20260725_Tier3_EdgeCasesMigrate] Named exports; the module namespace
    // type provides the (configPath, settings) => void / => SettingsRecord
    // signatures directly.
    let loadFileConfig: typeof import("../../src/helpers/fileConfig").loadFileConfig;
    let saveFileConfig: typeof import("../../src/helpers/fileConfig").saveFileConfig;

    beforeEach(() => {
      vi.resetModules();
      const fileConfig = require("../../src/helpers/fileConfig");
      loadFileConfig = fileConfig.loadFileConfig;
      saveFileConfig = fileConfig.saveFileConfig;
    });

    it("handles file with array root", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-edge-"));
      const configPath = path.join(dir, "murmur.json");
      fs.writeFileSync(configPath, "[1,2,3]");
      try {
        expect(loadFileConfig(configPath)).toEqual({});
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("handles file with null root", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-edge-"));
      const configPath = path.join(dir, "murmur.json");
      fs.writeFileSync(configPath, "null");
      try {
        expect(loadFileConfig(configPath)).toEqual({});
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("handles file with numeric value", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-edge-"));
      const configPath = path.join(dir, "murmur.json");
      fs.writeFileSync(configPath, '{"auto_paste": "paste", "port": 8080}');
      try {
        const result = loadFileConfig(configPath);
        // port is not in FILE_CONFIGURABLE_KEYS, should be filtered
        expect(result).not.toHaveProperty("port");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("overwrites existing config file on save", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-edge-"));
      const configPath = path.join(dir, "murmur.json");
      fs.writeFileSync(configPath, '{"old_key": "old_value"}');
      try {
        saveFileConfig(configPath, { ai_model: "new-model" });
        const result = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(result).not.toHaveProperty("old_key");
        expect(result).toHaveProperty("ai_model", "new-model");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("validateAIBaseUrl edge cases", () => {
    // [20260725_Tier3_EdgeCasesMigrate] Named export; same shape as in
    // phase7-tier0-fixes.test.ts.
    let validateAIBaseUrl: typeof import("../../src/helpers/ipc/aiHandlers").validateAIBaseUrl;

    beforeEach(() => {
      vi.resetModules();
      const aiHandlers = require("../../src/helpers/ipc/aiHandlers");
      validateAIBaseUrl = aiHandlers.validateAIBaseUrl;
    });

    it("rejects javascript: protocol", () => {
      expect(validateAIBaseUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects data: protocol", () => {
      expect(validateAIBaseUrl("data:text/html,<h1>hi</h1>")).toBe(false);
    });

    it("rejects ftp: protocol", () => {
      expect(validateAIBaseUrl("ftp://example.com")).toBe(false);
    });

    it("accepts https:// with valid hostname", () => {
      expect(validateAIBaseUrl("https://api.deepseek.com/v1")).toBe(true);
    });

    it("allows 127.0.0.1 when allowLocalhost is true", () => {
      expect(
        validateAIBaseUrl("http://127.0.0.1:11434/v1", {
          allowLocalhost: true,
        }),
      ).toBe(true);
    });

    it("rejects 127.0.0.1 when allowLocalhost is false", () => {
      expect(
        validateAIBaseUrl("https://127.0.0.1/v1", { allowLocalhost: false }),
      ).toBe(false);
    });

    it("rejects 0.0.0.0 when allowLocalhost is false", () => {
      expect(validateAIBaseUrl("https://0.0.0.0/v1")).toBe(false);
    });

    it("rejects link-local address 169.254.x.x", () => {
      expect(validateAIBaseUrl("https://169.254.1.1/v1")).toBe(false);
    });
  });
});
