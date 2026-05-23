import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

describe("aiPrompts", () => {
  let buildPrompt;
  let parseTemplateFile;
  let loadCustomTemplates;

  beforeEach(() => {
    vi.resetModules();
    const aiPrompts = require("../../src/helpers/aiPrompts");
    buildPrompt = aiPrompts.buildPrompt;
    parseTemplateFile = aiPrompts.parseTemplateFile;
    loadCustomTemplates = aiPrompts.loadCustomTemplates;
  });

  describe("parseTemplateFile", () => {
    it("parses valid template with frontmatter and body", () => {
      const content = `---
name: meeting-notes
label: 会议纪要
---
你是一位会议纪要助手。

## 任务
总结会议内容。`;
      const result = parseTemplateFile(content, "meeting-notes.md");
      expect(result).toEqual({
        name: "meeting-notes",
        label: "会议纪要",
        system: "你是一位会议纪要助手。\n\n## 任务\n总结会议内容。",
        user: "<transcript>\n{text}\n</transcript>",
      });
    });

    it("uses filename (without ext) as name when frontmatter has no name", () => {
      const content = `---
label: 简洁
---
简洁模式。`;
      const result = parseTemplateFile(content, "concise.md");
      expect(result.name).toBe("concise");
      expect(result.label).toBe("简洁");
    });

    it("returns null for file without frontmatter", () => {
      const result = parseTemplateFile("just some text", "invalid.md");
      expect(result).toBeNull();
    });

    it("returns null for file with empty body", () => {
      const content = `---
name: empty
---
`;
      const result = parseTemplateFile(content, "empty.md");
      expect(result).toBeNull();
    });

    it("supports custom user_template in frontmatter", () => {
      const content = `---
name: custom-user
user_template: "请处理: {text}"
---
处理文本。`;
      const result = parseTemplateFile(content, "custom.md");
      expect(result.user).toBe("请处理: {text}");
    });
  });

  describe("loadCustomTemplates", () => {
    it("returns empty array for non-existent directory", () => {
      const result = loadCustomTemplates("/non/existent/path");
      expect(result).toEqual([]);
    });

    it("loads all .md template files from directory", () => {
      const dir = path.join(process.cwd(), "test-templates-temp");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "notes.md"),
        "---\nname: notes\nlabel: 笔记\n---\n整理笔记。",
      );
      fs.writeFileSync(
        path.join(dir, "translate.md"),
        "---\nname: translate\nlabel: 翻译\n---\n翻译文本。",
      );
      // Non-md file should be ignored
      fs.writeFileSync(path.join(dir, "readme.txt"), "ignore me");

      try {
        const result = loadCustomTemplates(dir);
        expect(result).toHaveLength(2);
        expect(result.map((t) => t.name)).toContain("notes");
        expect(result.map((t) => t.name)).toContain("translate");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });

    it("skips invalid template files gracefully", () => {
      const dir = path.join(process.cwd(), "test-templates-invalid");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "valid.md"), "---\nname: ok\n---\nOK.");
      fs.writeFileSync(path.join(dir, "bad.md"), "no frontmatter here");

      try {
        const result = loadCustomTemplates(dir);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("ok");
      } finally {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe("buildPrompt with custom templates", () => {
    it("returns built-in mode when no custom templates provided", () => {
      const result = buildPrompt("optimize", "test text");
      expect(result.system).toContain("润色助手");
      expect(result.user).toContain("test text");
    });

    it("returns built-in mode when custom templates do not match", () => {
      const customTemplates = [
        {
          name: "custom-mode",
          label: "自定义",
          system: "custom system",
          user: "{text}",
        },
      ];
      const result = buildPrompt("optimize", "hello", { customTemplates });
      expect(result.system).toContain("润色助手");
    });

    it("uses custom template when mode matches", () => {
      const customTemplates = [
        {
          name: "meeting",
          label: "会议纪要",
          system: "你是会议助手。",
          user: "<meeting>{text}</meeting>",
        },
      ];
      const result = buildPrompt("meeting", "讨论了项目进展", {
        customTemplates,
      });
      expect(result.system).toBe("你是会议助手。");
      expect(result.user).toBe("<meeting>讨论了项目进展</meeting>");
    });

    it("custom template overrides built-in mode", () => {
      const customTemplates = [
        {
          name: "optimize",
          label: "优化Pro",
          system: "Pro version.",
          user: "{text}",
        },
      ];
      const result = buildPrompt("optimize", "test", { customTemplates });
      expect(result.system).toBe("Pro version.");
    });

    it("replaces {text} placeholder in custom user template", () => {
      const customTemplates = [
        {
          name: "review",
          system: "Review this.",
          user: "Review: {text}\nPlease check.",
        },
      ];
      const result = buildPrompt("review", "the content", { customTemplates });
      expect(result.user).toBe("Review: the content\nPlease check.");
    });
  });

  describe("buildPrompt backward compatibility", () => {
    it.each([
      "optimize",
      "optimize_long",
      "format",
      "correct",
      "summarize",
      "enhance",
    ])("returns valid prompt for built-in mode '%s'", (mode) => {
      const result = buildPrompt(mode, "sample text");
      expect(result.system).toBeTruthy();
      expect(result.user).toContain("sample text");
    });

    it("defaults to optimize for unknown mode", () => {
      const result = buildPrompt("nonexistent", "text");
      expect(result.system).toContain("润色助手");
    });
  });
});
