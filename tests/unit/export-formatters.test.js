import { describe, it, expect } from "vitest";

const {
  formatTXT,
  formatSRT,
  formatVTT,
  formatMD,
  getFormatInfo,
} = require("../../src/helpers/exportFormatters");

const sampleTranscription = {
  text: "你好世界",
  created_at: "2025-01-01T00:00:00",
  duration: 65,
  source_file_path: "test.wav",
  parsedSegments: [
    { start_ms: 0, end_ms: 2000, text: "你好" },
    { start_ms: 2000, end_ms: 4000, text: "世界" },
  ],
};

describe("exportFormatters", () => {
  describe("formatTXT", () => {
    it("includes header and text", () => {
      const output = formatTXT(sampleTranscription);
      expect(output).toContain("转录文本");
      expect(output).toContain("你好世界");
      expect(output).toContain("test.wav");
    });

    it("handles transcription without optional fields", () => {
      const output = formatTXT({ text: "simple" });
      expect(output).toContain("simple");
    });
  });

  describe("formatSRT", () => {
    it("produces numbered SRT blocks with timestamps", () => {
      const output = formatSRT(sampleTranscription);
      expect(output).toContain("1\n");
      expect(output).toContain("00:00:00,000 -->");
      expect(output).toContain("你好");
    });

    it("falls back to single block without segments", () => {
      const output = formatSRT({ text: "no segments", parsedSegments: [] });
      expect(output).toMatch(/^1\n/);
      expect(output).toContain("no segments");
    });
  });

  describe("formatVTT", () => {
    it("starts with WEBVTT header", () => {
      const output = formatVTT(sampleTranscription);
      expect(output).toMatch(/^WEBVTT/);
    });

    it("uses dot separator for milliseconds", () => {
      const output = formatVTT(sampleTranscription);
      expect(output).toContain("00:00:00.000");
    });
  });

  describe("formatMD", () => {
    it("includes YAML frontmatter and heading", () => {
      const output = formatMD(sampleTranscription);
      expect(output).toMatch(/^---/);
      expect(output).toContain("# 转录文本");
      expect(output).toContain("你好世界");
    });

    it("includes segment timeline table when segments exist", () => {
      const output = formatMD(sampleTranscription);
      expect(output).toContain("## 分段时间线");
      expect(output).toContain("| 开始 | 结束 | 文本 |");
    });
  });

  describe("getFormatInfo", () => {
    it("returns info for supported formats", () => {
      for (const fmt of ["txt", "srt", "vtt", "md", "docx"]) {
        const info = getFormatInfo(fmt);
        expect(info).toBeDefined();
        expect(info.ext).toBeTruthy();
        expect(info.formatter).toBeInstanceOf(Function);
      }
    });

    it("returns null for unsupported format", () => {
      expect(getFormatInfo("pdf")).toBeNull();
      expect(getFormatInfo("json")).toBeNull();
    });
  });
});
