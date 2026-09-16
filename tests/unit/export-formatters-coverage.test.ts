// [20260726_Tier3_ExportFormattersCoverageMigrate] Migrated from .js to .ts
// as part of Tier 3 batch 4. Pattern: destructure-require into typed consts
// via the source module namespace (TS7053/TS7005), then reuse
// `TranscriptionSegment`/`TranscriptionForExport` from the source types for
// the inline `segs` literal so property checks stay strict. The nested
// `buildPrompt` require inside the suite follows the same `typeof import`
// pattern. Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect } from "vitest";
// [20260726_Tier32_ExportFormattersCoverage] Convert CJS require() → ESM
// namespace import. The accessor consts below unchanged.
import * as exportFormatters from "../../src/helpers/exportFormatters";
// [20260726_Tier32_ExportFormattersCoverage] Hoist the buildPrompt require
// (previously inside the describe block) to a top-level import — same value,
// same name, ESM imports are file-scoped so hoisting is semantically safe.
import { buildPrompt } from "../../src/helpers/aiPrompts";

// [20260726_Tier3_ExportFormattersCoverageMigrate] Pull named exports out
// via the module namespace so each binding has its real (function) type.
const formatTXT = exportFormatters.formatTXT;
const formatSRT = exportFormatters.formatSRT;
const formatVTT = exportFormatters.formatVTT;
const formatMD = exportFormatters.formatMD;
const formatDOCX = exportFormatters.formatDOCX;
const getFormatInfo = exportFormatters.getFormatInfo;
const smartMergeSrt = exportFormatters.smartMergeSrt;

describe("exportFormatters - extended coverage", () => {
  // [20260726_Tier3_ExportFormattersCoverageMigrate] Annotated with the
  // source TranscriptionSegment so start_ms/end_ms/text are checked.
  const segs: import("../../src/helpers/exportFormatters").TranscriptionSegment[] =
    [
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
      const punctSegs: import("../../src/helpers/exportFormatters").TranscriptionSegment[] =
        [
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

    it("handles no duration fallback", () => {
      const out = formatSRT({ text: "hello" });
      expect(out).toContain("00:00:00,000 --> 00:00:00,000");
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

    it("handles no duration fallback", () => {
      const out = formatVTT({ text: "hello" });
      expect(out).toContain("00:00:00.000 --> 00:00:00.000");
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
      // [20260726_Tier3_ExportFormattersCoverageMigrate] getFormatInfo
      // returns FormatInfo | null; cast to the non-null branch after the
      // implicit truthy assertion below.
      const info = getFormatInfo("txt")!;
      expect(info.formatter).toBeTruthy();
      expect(info.ext).toBe(".txt");
      expect(info.mime).toBe("text/plain");
    });

    it("returns info for srt", () => {
      const info = getFormatInfo("srt")!;
      expect(info.ext).toBe(".srt");
    });

    it("returns info for vtt", () => {
      const info = getFormatInfo("vtt")!;
      expect(info.ext).toBe(".vtt");
    });

    it("returns info for md", () => {
      const info = getFormatInfo("md")!;
      expect(info.ext).toBe(".md");
    });

    it("returns info for docx", () => {
      const info = getFormatInfo("docx")!;
      expect(info.ext).toBe(".docx");
    });

    it("returns null for unknown format", () => {
      expect(getFormatInfo("xyz")).toBeNull();
    });
  });

  describe("smartMergeSrt", () => {
    it("splits long text at punctuation boundaries", () => {
      const longText = "这是一段非常长的文本".repeat(10);
      const segs = [{ start_ms: 0, end_ms: 4000, text: longText }];
      const merged = smartMergeSrt(segs);
      expect(merged.length).toBe(1);
      expect(merged[0]!.text).toContain("\n");
    });

    it("returns empty array for null segments", () => {
      // [20260726_Tier3_ExportFormattersCoverageMigrate] Source signature
      // is `TranscriptionSegment[]`; null is the runtime guard branch.
      expect(
        smartMergeSrt(
          null as unknown as import("../../src/helpers/exportFormatters").TranscriptionSegment[],
        ),
      ).toEqual([]);
      expect(smartMergeSrt([])).toEqual([]);
    });

    it("merges short consecutive segments", () => {
      const segs = [
        { start_ms: 0, end_ms: 1000, text: "你" },
        { start_ms: 1000, end_ms: 2000, text: "好" },
      ];
      const merged = smartMergeSrt(segs);
      expect(merged.length).toBe(1);
      expect(merged[0]!.text).toBe("你好");
    });

    it("splits at punctuation when text over 42 chars", () => {
      const segs = [
        {
          start_ms: 0,
          end_ms: 4000,
          text: "a，b，c，d，e，f，g，h，i，j，k，l，m，n，o，p，q，r，s，t，u，v",
        },
      ];
      const merged = smartMergeSrt(segs);
      expect(merged[0]!.text).toContain("\n");
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

  describe("buildPrompt review modes", () => {
    // [20260726_Tier32_ExportFormattersCoverage] buildPrompt is now imported
    // at the top of the file (hoisted from the original nested require()).

    it("returns dianping prompt", () => {
      const p = buildPrompt("dianping", "test");
      expect(p.system).toContain("大众点评");
      expect(p.user).toContain("test");
    });

    it("returns xiaohongshu prompt", () => {
      const p = buildPrompt("xiaohongshu", "test");
      expect(p.system).toContain("小红书");
    });

    it("returns professional prompt", () => {
      const p = buildPrompt("professional", "test");
      expect(p.system).toContain("专业");
    });

    it("returns raw_with_notes prompt", () => {
      const p = buildPrompt("raw_with_notes", "test");
      expect(p.system).toContain("关键要点");
    });

    it("defaults to optimize for unknown mode", () => {
      const p = buildPrompt("unknown", "test");
      expect(p.system).toContain("润色");
    });
  });

  // [20260816_Test_BranchPush] Remaining uncovered arcs: the duration-present
  // arms of the segment-less SRT/VTT fallbacks, missing-text formatting across
  // TXT/MD/DOCX, and smartMergeSrt's boundary splits plus the exact-fit
  // punctuation remainder.
  describe("[20260816_Test_BranchPush] branch coverage", () => {
    it("uses the duration for the end timestamp when no segments exist (SRT)", () => {
      const out = formatSRT({
        text: "timed",
        duration: 65,
        parsedSegments: [],
      });
      expect(out).toContain("00:00:00,000 --> 00:01:05,000");
      expect(out).toContain("timed");
    });

    it("uses the duration for the end timestamp when no segments exist (VTT)", () => {
      const out = formatVTT({
        text: "timed",
        duration: 65,
        parsedSegments: [],
      });
      expect(out).toContain("00:00:00.000 --> 00:01:05.000");
    });

    it("formats TXT without any text field", () => {
      const out = formatTXT({});
      expect(out).toContain("转录文本");
      expect(out).not.toContain("undefined");
    });

    it("formats MD without any text field, defaulting the date", () => {
      const out = formatMD({});
      // date: "<ISO now>" — the created_at || new Date() fallback.
      expect(out).toMatch(/date: "\d{4}-\d{2}-\d{2}T/);
    });

    it("formats DOCX without any text field", async () => {
      const buf = await formatDOCX({});
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });

    it("splits segments whose own duration reached 3000ms", () => {
      const merged = smartMergeSrt([
        { start_ms: 0, end_ms: 3500, text: "你" },
        { start_ms: 3500, end_ms: 5000, text: "好" },
      ]);
      // current duration 3500 >= 3000 -> no merge.
      expect(merged).toHaveLength(2);
    });

    it("splits when the combined span exceeds 7000ms", () => {
      const merged = smartMergeSrt([
        { start_ms: 0, end_ms: 1500, text: "你" },
        { start_ms: 7000, end_ms: 8000, text: "好" },
      ]);
      // seg.end - current.start = 8000 > 7000 -> no merge.
      expect(merged).toHaveLength(2);
    });

    it("splits when the combined text exceeds 42 chars", () => {
      const merged = smartMergeSrt([
        { start_ms: 0, end_ms: 500, text: "a".repeat(30) },
        { start_ms: 500, end_ms: 1000, text: "b".repeat(30) },
      ]);
      // combinedText 60 > 42 -> no merge.
      expect(merged).toHaveLength(2);
    });

    it("skips the trailing-remainder push when punctuation absorbs the tail", () => {
      // 42 plain chars + a comma at index 42: the break scan finds it,
      // breakAt becomes 43 (the whole text), and the remaining slice is ""
      // so the `if (remaining) parts.push(...)` guard takes its false arm.
      const text = "a".repeat(42) + "，";
      const merged = smartMergeSrt([{ start_ms: 0, end_ms: 4000, text }]);
      expect(merged).toHaveLength(1);
      expect(merged[0]!.text).toBe(text);
    });
  });
});
