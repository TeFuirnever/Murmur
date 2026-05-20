import { describe, it, expect } from "vitest";

const {
  formatTXT,
  formatSRT,
  formatVTT,
  formatMD,
  formatDOCX,
  getFormatInfo,
  getAIReviewPrompt,
  smartMergeSrt,
} = require("../../src/helpers/exportFormatters");

describe("exportFormatters - extended coverage", () => {
  const segs = [
    { start_ms: 0, end_ms: 2000, text: "你好" },
    { start_ms: 2000, end_ms: 4000, text: "世界" },
  ];

  describe("formatMD", () => {
    it("produces markdown with metadata", () => {
      const out = formatMD({
        text: "测试",
        created_at: "2025-01-01T00:00:00",
        duration: 30,
        source_file_path: "test.wav",
      });
      expect(out).toContain("# 转录文本");
      expect(out).toContain("测试");
      expect(out).toContain("0:30");
      expect(out).toContain("test.wav");
    });

    it("handles missing optional fields", () => {
      const out = formatMD({ text: "simple" });
      expect(out).toContain("simple");
      expect(out).toContain("# 转录文本");
    });

    it("includes segments as table", () => {
      const out = formatMD({
        text: "seg test",
        parsedSegments: segs,
      });
      expect(out).toContain("你好");
      expect(out).toContain("世界");
      expect(out).toContain("分段时间线");
    });

    it("formats long duration as minutes", () => {
      const out = formatMD({ text: "long", duration: 125 });
      expect(out).toContain("2:05");
    });

    it("formats duration with zero minutes", () => {
      const out = formatMD({ text: "short", duration: 45 });
      expect(out).toContain("0:45");
    });
  });

  describe("formatSRT edge cases", () => {
    it("handles segments that end with punctuation", () => {
      const punctSegs = [
        { start_ms: 0, end_ms: 2000, text: "你好。" },
        { start_ms: 2000, end_ms: 4000, text: "世界" },
      ];
      const out = formatSRT({ text: "test", parsedSegments: punctSegs });
      expect(out).toContain("你好。");
      expect(out).toContain("世界");
    });

    it("handles null segments", () => {
      const out = formatSRT({ text: "no segs" });
      expect(out).toContain("no segs");
    });
  });

  describe("formatVTT edge cases", () => {
    it("formats segments with dot separator", () => {
      const out = formatVTT({ text: "test", parsedSegments: segs });
      expect(out).toContain("00:00:00.000 -->");
      expect(out).toContain("你好世界");
    });

    it("handles null parsedSegments", () => {
      const out = formatVTT({ text: "hello" });
      expect(out).toContain("WEBVTT");
      expect(out).toContain("hello");
    });
  });

  describe("formatTXT edge cases", () => {
    it("formats duration", () => {
      const out = formatTXT({ text: "test", duration: 90 });
      expect(out).toContain("1:30");
    });

    it("handles zero duration", () => {
      const out = formatTXT({ text: "test", duration: 0 });
      expect(out).toContain("test");
    });
  });

  describe("getFormatInfo", () => {
    it("returns info for txt", () => {
      const info = getFormatInfo("txt");
      expect(info.formatter).toBeTruthy();
      expect(info.ext).toBe(".txt");
      expect(info.mime).toBe("text/plain");
    });

    it("returns info for srt", () => {
      const info = getFormatInfo("srt");
      expect(info.ext).toBe(".srt");
    });

    it("returns info for vtt", () => {
      const info = getFormatInfo("vtt");
      expect(info.ext).toBe(".vtt");
    });

    it("returns info for md", () => {
      const info = getFormatInfo("md");
      expect(info.ext).toBe(".md");
    });

    it("returns info for docx", () => {
      const info = getFormatInfo("docx");
      expect(info.ext).toBe(".docx");
    });

    it("returns null for unknown format", () => {
      expect(getFormatInfo("xyz")).toBeNull();
    });
  });

  describe("smartMergeSrt", () => {
    it("splits long text at punctuation boundaries", () => {
      const longText = "这是一段非常长的文本".repeat(10);
      const segs = [
        { start_ms: 0, end_ms: 4000, text: longText },
      ];
      const merged = smartMergeSrt(segs);
      expect(merged.length).toBe(1);
      expect(merged[0].text).toContain("\n");
    });

    it("returns empty array for null segments", () => {
      expect(smartMergeSrt(null)).toEqual([]);
      expect(smartMergeSrt([])).toEqual([]);
    });

    it("merges short consecutive segments", () => {
      const segs = [
        { start_ms: 0, end_ms: 1000, text: "你" },
        { start_ms: 1000, end_ms: 2000, text: "好" },
      ];
      const merged = smartMergeSrt(segs);
      expect(merged.length).toBe(1);
      expect(merged[0].text).toBe("你好");
    });

    it("splits at punctuation when text over 42 chars", () => {
      const segs = [
        { start_ms: 0, end_ms: 4000, text: "a，b，c，d，e，f，g，h，i，j，k，l，m，n，o，p，q，r，s，t，u，v" },
      ];
      const merged = smartMergeSrt(segs);
      expect(merged[0].text).toContain("\n");
    });
  });

  describe("formatDOCX", () => {
    it("generates a docx buffer", async () => {
      const buf = await formatDOCX({ text: "docx test" });
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });

    it("includes metadata and segments", async () => {
      const buf = await formatDOCX({
        text: "hello",
        source_file_path: "test.wav",
        duration: 30,
        created_at: "2025-01-01",
        parsedSegments: [
          { start_ms: 0, end_ms: 1000, text: "he" },
          { start_ms: 1000, end_ms: 2000, text: "llo" },
        ],
      });
      expect(buf).toBeInstanceOf(Buffer);
    });
  });

  describe("getAIReviewPrompt", () => {
    it("returns dianping template", () => {
      const t = getAIReviewPrompt("dianping");
      expect(t.systemPrompt).toContain("大众点评");
    });

    it("returns xiaohongshu template", () => {
      const t = getAIReviewPrompt("xiaohongshu");
      expect(t.systemPrompt).toContain("小红书");
    });

    it("returns professional template", () => {
      const t = getAIReviewPrompt("professional");
      expect(t.systemPrompt).toContain("专业");
    });

    it("returns raw_with_notes template", () => {
      const t = getAIReviewPrompt("raw_with_notes");
      expect(t.systemPrompt).toContain("关键要点");
    });

    it("defaults to professional for unknown template", () => {
      const t = getAIReviewPrompt("unknown");
      expect(t.systemPrompt).toContain("专业");
    });
  });
});
