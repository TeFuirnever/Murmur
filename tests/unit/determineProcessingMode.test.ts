import { describe, it, expect } from "vitest";
import { determineProcessingMode } from "../../src/hooks/useRecording";

describe("determineProcessingMode", () => {
  it('returns "optimize" for short text', () => {
    expect(determineProcessingMode("你好世界")).toBe("optimize");
  });

  it('returns "optimize_long" for text over 150 chars', () => {
    const longText = "这是一段很长的文本".repeat(17);
    expect(longText.length).toBeGreaterThan(150);
    expect(determineProcessingMode(longText)).toBe("optimize_long");
  });

  it('returns "optimize_long" for text over 30 words', () => {
    const manyWords = Array(31).fill("word").join(" ");
    expect(determineProcessingMode(manyWords)).toBe("optimize_long");
  });

  it('returns "optimize" for exactly 30 words', () => {
    const words30 = Array(30).fill("word").join(" ");
    expect(determineProcessingMode(words30)).toBe("optimize");
  });

  it("handles whitespace-only text", () => {
    expect(determineProcessingMode("   \n\t  ")).toBe("optimize");
  });

  it("handles empty string", () => {
    expect(determineProcessingMode("")).toBe("optimize");
  });

  it('returns "optimize" for mixed content under threshold', () => {
    const text = "中文文本 mixed with English words here";
    expect(determineProcessingMode(text)).toBe("optimize");
  });
});
