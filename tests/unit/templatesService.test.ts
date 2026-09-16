// [20260912_Feat_242_TemplateSystem] TDD for ticket #242 (spec #193 T15):
// the custom-template file IO service. Group ① covers the pure filename
// sanitizer in the three AC groups (path traversal / Windows reserved names
// / illegal characters) plus the length, emptiness and fixed-.md-suffix
// rules. Group ② covers the IO surface (list/read/save/delete) with the
// 512KB write cap and the 1MB single-file read cap enforced at the service
// boundary. All tests run against a throwaway tmpdir.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  TEMPLATE_MAX_CONTENT_BYTES,
  TEMPLATE_MAX_READ_BYTES,
  TEMPLATE_NAME_MAX_CHARS,
  sanitizeTemplateFileName,
  listTemplates,
  readTemplate,
  saveTemplate,
  deleteTemplate,
} from "../../src/helpers/services/templatesService";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "templates-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("[20260912_Feat_242_TemplateSystem] sanitizeTemplateFileName", () => {
  // ── AC group 1: path traversal ──
  describe("path traversal", () => {
    it("rejects forward slashes", () => {
      const result = sanitizeTemplateFileName("a/b");
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("name_path_separator");
    });

    it("rejects backslashes", () => {
      const result = sanitizeTemplateFileName("a\\b");
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("name_path_separator");
    });

    it("rejects the bare parent reference", () => {
      const result = sanitizeTemplateFileName("..");
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("name_parent_reference");
    });

    it("rejects embedded parent references", () => {
      const result = sanitizeTemplateFileName("foo/../bar");
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("name_parent_reference");
    });

    it("rejects hidden traversal via a ..-containing name", () => {
      const result = sanitizeTemplateFileName("a..b");
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("name_parent_reference");
    });
  });

  // ── AC group 2: Windows reserved names (case-insensitive) ──
  describe("Windows reserved names", () => {
    const RESERVED = [
      "CON",
      "PRN",
      "AUX",
      "NUL",
      "COM1",
      "COM2",
      "COM3",
      "COM4",
      "COM5",
      "COM6",
      "COM7",
      "COM8",
      "COM9",
      "LPT1",
      "LPT2",
      "LPT3",
      "LPT4",
      "LPT5",
      "LPT6",
      "LPT7",
      "LPT8",
      "LPT9",
    ];

    it("rejects every reserved name case-insensitively, with or without .md", () => {
      for (const reserved of RESERVED) {
        const bare = sanitizeTemplateFileName(reserved);
        expect(bare.valid, `bare ${reserved}`).toBe(false);
        if (!bare.valid) expect(bare.error).toBe("name_reserved");
        const lower = sanitizeTemplateFileName(reserved.toLowerCase());
        expect(lower.valid, `lower ${reserved}`).toBe(false);
        const withExt = sanitizeTemplateFileName(`${reserved}.md`);
        expect(withExt.valid, `ext ${reserved}`).toBe(false);
        if (!withExt.valid) expect(withExt.error).toBe("name_reserved");
      }
    });

    it("accepts names that merely contain a reserved word", () => {
      expect(sanitizeTemplateFileName("console").valid).toBe(true);
      expect(sanitizeTemplateFileName("com10").valid).toBe(true);
      expect(sanitizeTemplateFileName("printer").valid).toBe(true);
    });

    // [20260912_Fix_242_ReviewRound2] Bypass hardening: stripping only a
    // trailing ".md" let "CON.txt"→CON.txt.md, "CON."→CON..md and
    // "NUL.md.md" through; those names still resolve to DOS devices on
    // win32. The check therefore also fires on the FIRST dot-delimited
    // token of the stem, and stems ending in "." are rejected outright.
    it("rejects reserved words as the first dot-token of a compound stem", () => {
      for (const bypass of ["CON.txt", "NUL.md.md", "com1.notes"]) {
        const result = sanitizeTemplateFileName(bypass);
        expect(result.valid, JSON.stringify(bypass)).toBe(false);
        if (!result.valid) expect(result.error).toBe("name_reserved");
      }
      // A non-reserved first token stays acceptable.
      expect(sanitizeTemplateFileName("my.template").valid).toBe(true);
    });

    it("rejects stems ending in a dot before the suffix is appended", () => {
      for (const trailing of ["CON.", "template."]) {
        const result = sanitizeTemplateFileName(trailing);
        expect(result.valid, JSON.stringify(trailing)).toBe(false);
        if (!result.valid) expect(result.error).toBe("name_trailing_dot");
      }
    });
  });

  // ── AC group 3: illegal characters, length, emptiness, suffix ──
  describe("illegal characters and length", () => {
    it("rejects colons", () => {
      const result = sanitizeTemplateFileName("a:b");
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("name_colon");
    });

    it("rejects control characters", () => {
      for (const bad of ["a\u0000b", "a\nb", "a\tb", "a\u007fb"]) {
        const result = sanitizeTemplateFileName(bad);
        expect(result.valid, JSON.stringify(bad)).toBe(false);
        if (!result.valid) expect(result.error).toBe("name_control_char");
      }
    });

    it("rejects empty and whitespace-only names", () => {
      expect(sanitizeTemplateFileName("").valid).toBe(false);
      const ws = sanitizeTemplateFileName("   ");
      expect(ws.valid).toBe(false);
      if (!ws.valid) expect(ws.error).toBe("empty_name");
    });

    it("rejects names longer than 64 chars after trim", () => {
      const over = sanitizeTemplateFileName(
        `a${"b".repeat(TEMPLATE_NAME_MAX_CHARS)}`,
      );
      expect(over.valid).toBe(false);
      if (!over.valid) expect(over.error).toBe("name_too_long");
      expect(
        sanitizeTemplateFileName("a".repeat(TEMPLATE_NAME_MAX_CHARS)).valid,
      ).toBe(true);
    });

    it("trims surrounding whitespace before validating", () => {
      const result = sanitizeTemplateFileName("  my template  ");
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.fileName).toBe("my template.md");
    });

    it("normalizes to a fixed lowercase .md suffix", () => {
      const appended = sanitizeTemplateFileName("meeting");
      expect(appended.valid).toBe(true);
      if (appended.valid) expect(appended.fileName).toBe("meeting.md");

      const kept = sanitizeTemplateFileName("meeting.md");
      expect(kept.valid).toBe(true);
      if (kept.valid) expect(kept.fileName).toBe("meeting.md");

      const upper = sanitizeTemplateFileName("Report.MD");
      expect(upper.valid).toBe(true);
      if (upper.valid) expect(upper.fileName).toBe("Report.md");
    });

    it("rejects a bare .md extension (empty stem)", () => {
      const result = sanitizeTemplateFileName(".md");
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("empty_name");
    });
  });
});

describe("[20260912_Feat_242_TemplateSystem] template IO service", () => {
  const deps = () => ({ templatesDir: tmpDir });

  it("save creates the templates dir and writes the file verbatim", () => {
    const content = "---\nname: meeting\nlabel: 会议纪要\n---\n会议助手。";
    const result = saveTemplate(deps(), "meeting", content);
    expect(result.success).toBe(true);
    if (result.success) expect(result.fileName).toBe("meeting.md");
    expect(fs.readFileSync(path.join(tmpDir, "meeting.md"), "utf-8")).toBe(
      content,
    );
  });

  it("save rejects oversized content at the service boundary", () => {
    const big = "x".repeat(TEMPLATE_MAX_CONTENT_BYTES + 1);
    const result = saveTemplate(deps(), "big", big);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("content_too_large");
    expect(fs.existsSync(path.join(tmpDir, "big.md"))).toBe(false);
  });

  it("save accepts content at exactly the write cap", () => {
    const exact = "x".repeat(TEMPLATE_MAX_CONTENT_BYTES);
    const result = saveTemplate(deps(), "exact", exact);
    expect(result.success).toBe(true);
  });

  it("save never writes outside the templates dir even with a traversal name", () => {
    const result = saveTemplate(deps(), "../evil", "boom");
    expect(result.success).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "..", "evil.md"))).toBe(false);
  });

  it("save overwrites an existing template in place", () => {
    saveTemplate(deps(), "twice", "first");
    const second = saveTemplate(deps(), "twice", "second");
    expect(second.success).toBe(true);
    expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".md"))).toEqual([
      "twice.md",
    ]);
    expect(fs.readFileSync(path.join(tmpDir, "twice.md"), "utf-8")).toBe(
      "second",
    );
  });

  it("read returns the verbatim file content", () => {
    saveTemplate(deps(), "readme", "---\nname: readme\n---\n正文 {text}");
    const result = readTemplate(deps(), "readme");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toBe("---\nname: readme\n---\n正文 {text}");
    }
  });

  it("read reports not_found for a missing template", () => {
    const result = readTemplate(deps(), "ghost");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("not_found");
  });

  it("read refuses files over the read cap without reading them", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "huge.md"),
      "x".repeat(TEMPLATE_MAX_READ_BYTES + 1),
    );
    const result = readTemplate(deps(), "huge");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("read_too_large");
  });

  it("list parses frontmatter name/label and skips unparsable files", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "meeting.md"),
      "---\nname: meeting\nlabel: 会议纪要\n---\n会议助手。",
    );
    // No frontmatter → loadCustomTemplates would skip it; so does list.
    fs.writeFileSync(path.join(tmpDir, "broken.md"), "no frontmatter here");
    // Non-.md files are ignored entirely.
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "ignore me");

    const listed = listTemplates(deps());
    expect(listed).toEqual([
      { name: "meeting", label: "会议纪要", fileName: "meeting.md" },
    ]);
  });

  // [20260912_Fix_242_ReviewRound2] Identity divergence regression: a
  // hand-edited file whose frontmatter name differs from the file stem
  // used to make LIST show a name that READ 404'd, SAVE duplicate and
  // DELETE no-op. LIST now carries the on-disk fileName, and READ/SAVE/
  // DELETE key off that fileName instead of the display name.
  describe("fileName identity (stem ≠ frontmatter name)", () => {
    const fixture = () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "custom.md"),
        "---\nname: meeting-notes\nlabel: 会议纪要\n---\n正文",
      );
    };

    it("list exposes the on-disk fileName next to the parsed name", () => {
      fixture();
      expect(listTemplates(deps())).toEqual([
        {
          name: "meeting-notes",
          label: "会议纪要",
          fileName: "custom.md",
        },
      ]);
    });

    it("read keys off the on-disk fileName, not the display name", () => {
      fixture();
      const result = readTemplate(deps(), "custom.md");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.content).toBe(
          "---\nname: meeting-notes\nlabel: 会议纪要\n---\n正文",
        );
      }
    });

    it("save through the on-disk fileName overwrites that file (no duplicate)", () => {
      fixture();
      const result = saveTemplate(deps(), "custom.md", "updated");
      expect(result.success).toBe(true);
      if (result.success) expect(result.fileName).toBe("custom.md");
      expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".md"))).toEqual([
        "custom.md",
      ]);
      expect(fs.readFileSync(path.join(tmpDir, "custom.md"), "utf-8")).toBe(
        "updated",
      );
    });

    it("delete through the on-disk fileName removes the actual file", () => {
      fixture();
      const result = deleteTemplate(deps(), "custom.md");
      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "custom.md"))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, "meeting-notes.md"))).toBe(false);
    });
  });

  // [20260912_Fix_242_ReviewRound2] Post-save validation: a file saved
  // without frontmatter never loads as a mode (parseTemplateFile returns
  // null), so the save result carries a machine-readable warning the UI
  // surfaces — the write itself still succeeds.
  describe("post-save frontmatter validation", () => {
    it("warns when the saved content has no parseable frontmatter", () => {
      const result = saveTemplate(deps(), "plain", "no frontmatter here");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.warning).toBe("missing_frontmatter");
      }
    });

    it("does not warn for frontmattered content", () => {
      const result = saveTemplate(
        deps(),
        "proper",
        "---\nname: proper\n---\n正文",
      );
      expect(result.success).toBe(true);
      if (result.success) expect(result.warning).toBeUndefined();
    });
  });

  it("list skips files over the read cap", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "huge.md"),
      "---\nname: huge\n---\n" + "x".repeat(TEMPLATE_MAX_READ_BYTES),
    );
    const listed = listTemplates(deps());
    expect(listed).toEqual([]);
  });

  it("list returns an empty array when the dir does not exist", () => {
    expect(
      listTemplates({ templatesDir: path.join(tmpDir, "missing") }),
    ).toEqual([]);
  });

  it("delete removes the custom file and is idempotent", () => {
    saveTemplate(deps(), "gone", "bye");
    expect(deleteTemplate(deps(), "gone").success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "gone.md"))).toBe(false);
    // Deleting again is still a success (restore-default idempotence).
    expect(deleteTemplate(deps(), "gone").success).toBe(true);
  });

  it("delete rejects traversal names", () => {
    const result = deleteTemplate(deps(), "../evil");
    expect(result.success).toBe(false);
  });
});
