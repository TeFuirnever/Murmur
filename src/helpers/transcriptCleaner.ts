// [20260819_T9_TranscriptCleaner] Ticket #182 (spec #177 T9): engine-agnostic
// transcription text cleaner. Conservative v1 rules that fold degenerate
// model loops/hallucinations while protecting natural Chinese spoken
// repetition. The FIRST principle is "never alter correct text" — every
// threshold below was chosen against the golden corpus
// (tests/fixtures/transcript-cleaner-golden.json) whose normal half must
// pass through byte-identical.
//
// Deviation from the spec's "≥4 consecutive chars" (recorded on #182):
// the fold threshold here is 6 — runs of 4–5 identical chars are natural
// laughter ("哈哈哈哈" / "哈哈哈哈哈") and the golden corpus's zero-change
// requirement forces the more conservative line. Model degeneracy in the
// wild shows up as 6+ runs, so the discrimination is not lost.
//
// No whole-segment dropping in v1: degenerate content is FOLDED, never
// deleted, and the raw pre-clean text stays recoverable at the persistence
// layer (T10 wiring keeps the original in the DB's raw column).
//
// Linear time by construction: both passes are single forward scans with
// amortized skip-ahead (no backtracking regexes).

/** Fold runs of ≥6 identical consecutive characters down to 3. */
export const CHAR_REPEAT_FOLD_THRESHOLD = 6;
/** Floor length a degenerate character run folds down to. */
export const CHAR_REPEAT_FOLD_FLOOR = 3;
/** Phrase lengths eligible for consecutive-repeat folding (Chinese words). */
export const PHRASE_MIN_LEN = 2;
export const PHRASE_MAX_LEN = 5;
/** Consecutive repeats of the same phrase required before folding. */
export const PHRASE_MIN_REPEATS = 3;
/**
 * Inputs shorter than the smallest triggerable pattern (phrase 2 × 3
 * repeats = 6 chars; char-run threshold = 6) are exempt outright.
 */
export const SHORT_INPUT_EXEMPTION = 6;

function foldCharRuns(text: string): string {
  let out = "";
  let runStart = 0;
  for (let i = 1; i <= text.length; i += 1) {
    const runEnded = i === text.length || text[i] !== text[runStart];
    if (runEnded) {
      const runLen = i - runStart;
      if (runLen >= CHAR_REPEAT_FOLD_THRESHOLD) {
        out += text[runStart]!.repeat(CHAR_REPEAT_FOLD_FLOOR);
      } else {
        out += text.slice(runStart, i);
      }
      runStart = i;
    }
  }
  return out;
}

function foldConsecutivePhrases(text: string): string {
  let out = "";
  let i = 0;
  outer: while (i < text.length) {
    // Shortest-first: greedy longest-first matches composite phrases
    // ("好的好的" ×4 folds to "好的好的" instead of "好的"); the shortest
    // unit that repeats is the semantic one. Longer units still win when
    // shorter ones don't repeat ("我知道了"×k only matches at len 4).
    for (let len = PHRASE_MIN_LEN; len <= PHRASE_MAX_LEN; len += 1) {
      const phrase = text.substr(i, len);
      if (phrase.length < len) continue;
      let repeats = 1;
      while (text.substr(i + repeats * len, len) === phrase) {
        repeats += 1;
      }
      if (repeats >= PHRASE_MIN_REPEATS) {
        out += phrase;
        i += repeats * len;
        continue outer;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * Clean a raw transcription string. Pure: no I/O, no logging, no config.
 * Returns the cleaned text (folded degeneracies; correct text untouched).
 */
export function cleanTranscriptionText(text: string): string {
  if (text.length < SHORT_INPUT_EXEMPTION) {
    return text;
  }
  return foldConsecutivePhrases(foldCharRuns(text));
}
