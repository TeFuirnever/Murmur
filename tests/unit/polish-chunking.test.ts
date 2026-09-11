// [20260911_Feat_241_LongTextChunking] TDD for Spec #193 T14 (ticket #241):
// the long-text chunker. Pure function, no tokenizer dependency — splitting
// priority is paragraph (double newline) → line (single newline) → hard cut
// at the char budget. Goldens pin completeness: no content is ever lost or
// reordered, and a sub-threshold text passes through untouched (单块 = 现状).
import { describe, it, expect } from "vitest";
import {
  POLISH_CHUNK_MAX_CHARS,
  chunkStrategyForMode,
  joinChunkOutputs,
  splitIntoChunks,
} from "../../src/helpers/polish-chunking";

/** Build N paragraphs of roughly equal size. */
function paragraphs(count: number, sentencePrefix = "第"): string[] {
  return Array.from(
    { length: count },
    (_, i) => `${sentencePrefix}${i + 1}段内容。${"补充细节。".repeat(20)}`,
  );
}

describe("[20260911_Feat_241_LongTextChunking] splitIntoChunks", () => {
  it("passes sub-threshold text through as a single chunk (直通不回归)", () => {
    const text = "一段不长的转写文本。";
    expect(splitIntoChunks(text)).toEqual([text]);
    expect(splitIntoChunks("x".repeat(POLISH_CHUNK_MAX_CHARS))).toEqual([
      "x".repeat(POLISH_CHUNK_MAX_CHARS),
    ]);
  });

  it("prefers paragraph boundaries (double newline) over line breaks", () => {
    const paras = paragraphs(8);
    const text = paras.join("\n\n");
    const chunks = splitIntoChunks(text, paras[0]!.length * 3);
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk ends mid-paragraph: every chunk boundary sits on "\n\n".
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith("\n\n")).toBe(true);
    }
  });

  it("falls back to single newlines when no paragraph break fits", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `行${i}`.repeat(30));
    const text = lines.join("\n");
    const chunks = splitIntoChunks(text, 400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith("\n")).toBe(true);
      expect(chunk.endsWith("\n\n")).toBe(false);
    }
  });

  it("hard-cuts text with no break points at exactly the budget", () => {
    const text = "密".repeat(1000);
    const chunks = splitIntoChunks(text, 300);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toHaveLength(300);
    expect(chunks[3]).toHaveLength(100);
  });

  it("GOLDEN: N× threshold text loses nothing and reorders nothing", () => {
    const sentences = Array.from(
      { length: 500 },
      (_, i) => `句子编号${i}。${"展开论述。".repeat(6)}`,
    );
    // Mix paragraphs and lines so both break priorities engage.
    const text = sentences
      .map((s, i) => (i % 7 === 0 ? `${s}\n\n` : `${s}\n`))
      .join("");
    expect(text.length).toBeGreaterThan(POLISH_CHUNK_MAX_CHARS * 3);

    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(3);
    // No loss, no reorder: concatenation reproduces the input exactly.
    expect(chunks.join("")).toBe(text);
    // First and last sentences survive in their original positions.
    expect(chunks[0]!.startsWith("句子编号0。")).toBe(true);
    expect(chunks[chunks.length - 1]!).toContain("句子编号499。");
    // Every chunk respects the budget (hard-cut guarantee).
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(POLISH_CHUNK_MAX_CHARS);
    }
  });
});

describe("[20260911_Feat_241_LongTextChunking] joinChunkOutputs", () => {
  it("GOLDEN: first/last sentence present, sentence set = union of outputs", () => {
    const outputs = ["要点甲。要点乙。", "要点丙。要点丁。", "要点戊。"];
    const joined = joinChunkOutputs(outputs);
    expect(joined.startsWith("要点甲。")).toBe(true);
    expect(joined.endsWith("要点戊。")).toBe(true);
    const joinedSentences = new Set(
      joined
        .split(/(?<=。)/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    for (const output of outputs) {
      for (const sentence of output.split(/(?<=。)/)) {
        if (sentence) expect(joinedSentences.has(sentence.trim())).toBe(true);
      }
    }
  });

  it("single output passes through unchanged (单块 = 现状行为)", () => {
    expect(joinChunkOutputs(["唯一块输出。"])).toBe("唯一块输出。");
  });
});

describe("[20260911_Feat_241_LongTextChunking] chunkStrategyForMode", () => {
  it("summarize maps to map-reduce; everything else to the accumulation chain", () => {
    expect(chunkStrategyForMode("summarize")).toBe("map-reduce");
    for (const mode of [
      "optimize",
      "optimize_long",
      "format",
      "correct",
      "enhance",
      "de-ai",
    ]) {
      expect(chunkStrategyForMode(mode)).toBe("accumulate");
    }
    // Unknown/custom modes default to the accumulation chain.
    expect(chunkStrategyForMode("my-custom-template")).toBe("accumulate");
  });
});
