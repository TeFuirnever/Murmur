// [20260911_Feat_241_LongTextChunking] Spec #193 T14 (ticket #241): the
// long-text chunker + chunk-strategy classification for polish.
//
// The budget is a plain CHARACTER count — deliberately no tokenizer
// dependency (ticket constraint); for mixed zh/en transcripts chars are a
// good enough proxy for the provider's context window. Splitting priority
// is paragraph (double newline) → line (single newline) → hard cut at the
// budget, and the split is LOSSLESS: chunks.join("") === input.
//
// Strategies: 整理/改写类 modes walk an incremental accumulation chain
// (each chunk carries the key points so far with an append-only
// constraint); summarize maps to per-chunk summaries → merge.

/** Activation threshold AND per-chunk budget, in characters. */
export const POLISH_CHUNK_MAX_CHARS = 4000;

export type ChunkStrategy = "accumulate" | "map-reduce";

/** summarize 类 → 分块摘要再合并；其余（含自定义模板）→ 增量累积链。 */
export function chunkStrategyForMode(mode: string): ChunkStrategy {
  return mode === "summarize" ? "map-reduce" : "accumulate";
}

/**
 * Lossless chunker. Breaks at the LAST paragraph boundary inside the
 * budget window, else the last line boundary, else a hard cut. Delimiters
 * stay at the end of the preceding chunk so no content is lost.
 */
export function splitIntoChunks(
  text: string,
  maxChars: number = POLISH_CHUNK_MAX_CHARS,
): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const paragraphBreak = window.lastIndexOf("\n\n");
    const lineBreak = window.lastIndexOf("\n");
    let cut: number;
    if (paragraphBreak > 0) {
      cut = paragraphBreak + 2; // keep the delimiter on the left chunk
    } else if (lineBreak > 0) {
      cut = lineBreak + 1;
    } else {
      cut = maxChars;
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/**
 * Concatenate per-chunk outputs into the final text. Paragraph-joined;
 * single-chunk output passes through byte-identical (现状行为).
 */
export function joinChunkOutputs(outputs: string[]): string {
  if (outputs.length === 1) return outputs[0]!;
  return outputs.join("\n\n");
}
// [20260911_Feat_241_LongTextChunking] END
