// [20260908_Feat_239_DiffReview] Spec #193 T12 (ticket #239): minimal-edit
// diff review — line-level diff (diff-match-patch, selected by the T5 spike)
// aggregated into per-paragraph change hunks with accept/reject merge.
// Pure functions: no clocks, no IPC — fully unit-testable.
//
// [20260908_Fix_239_ReviewByteDrift] Hunk model v2 (review HIGH ×3): hunks
// are OFFSET SLICES into the original string — {start, end, revised} — not
// line-arrays joined back together. Consequences: reject-all is
// byte-identical to the original (blank lines, trailing newlines, CRLF all
// survive untouched); accept-all reproduces the revised byte-for-byte
// (replacement text is itself a slice of the revised string); a pure
// blank-line deletion is a real modified hunk, never a phantom no-change.
//
// Library note (T5 spike docs/research/2026-09-08-t5-streaming-spike.md ③):
// diff-match-patch 1.0.5 (Apache-2.0) wrapped behind THIS module — the thin
// wrapper is the only touchpoint, so swapping to a maintained fork later is
// a zero-diffusion change. Line mode uses the undocumented
// {chars1, chars2, lineArray} shape (empirically verified in the spike).
// Diff_Timeout bounds the computation in SECONDS; dmp exposes no timeout
// marker, so determinism holds for inputs the budget comfortably covers
// (transcript-length texts).
import DiffMatchPatch from "diff-match-patch";

/** Above this input size the diff degrades to a single whole-text hunk. */
export const DIFF_MAX_INPUT_CHARS = 200_000;
/** Diff computation budget in seconds (dmp's Diff_Timeout unit). */
const DIFF_TIMEOUT_SECONDS = 1;

export interface DiffHunk {
  index: number;
  type: "modified" | "whole-text";
  /** Slice bounds into the ORIGINAL string this hunk replaces. */
  start: number;
  end: number;
  /** Display helpers (the original slice and the replacement text). */
  original: string;
  revised: string;
}

export interface HunkDecision {
  index: number;
  accepted: boolean;
}

/** One line of a run: its text and whether a newline follows it. */
interface LineWithBoundary {
  text: string;
  hasNewline: boolean;
}

function splitKeepBoundaries(run: string): LineWithBoundary[] {
  if (run === "") return [];
  const parts = run.split("\n");
  // A run ending in \n splits into a trailing "" artifact — the newline
  // belongs to the LAST content line, not to a phantom empty line after it.
  if (run.endsWith("\n")) parts.pop();
  const lines: LineWithBoundary[] = [];
  for (let i = 0; i < parts.length; i++) {
    lines.push({
      text: parts[i]!,
      hasNewline: i < parts.length - 1 || run.endsWith("\n"),
    });
  }
  return lines;
}

const lineSpan = (line: LineWithBoundary | undefined): number =>
  line ? line.text.length + (line.hasNewline ? 1 : 0) : 0;

const lineSliceText = (line: LineWithBoundary | undefined): string =>
  line ? line.text + (line.hasNewline ? "\n" : "") : "";

/**
 * Build per-paragraph change hunks between original and polished text.
 * The line-mode diff runs first; equal runs advance the original offset,
 * and each delete+insert run is split into line pairs — a differing pair
 * becomes a modified hunk whose [start, end) slice is EXACTLY the pair's
 * bytes in the original (newline included) and whose revised text is the
 * pair's bytes from the revised run. Inputs beyond DIFF_MAX_INPUT_CHARS
 * degrade to a single whole-text hunk (full side-by-side, one decision).
 */
export function buildHunks(original: string, revised: string): DiffHunk[] {
  if (original === revised) return [];
  if (
    original.length > DIFF_MAX_INPUT_CHARS ||
    revised.length > DIFF_MAX_INPUT_CHARS
  ) {
    return [
      {
        index: 0,
        type: "whole-text",
        start: 0,
        end: original.length,
        original,
        revised,
      },
    ];
  }

  const engine = new DiffMatchPatch();
  engine.Diff_Timeout = DIFF_TIMEOUT_SECONDS;
  const { chars1, chars2, lineArray } = engine.diff_linesToChars_(
    original,
    revised,
  );
  const diffs = engine.diff_main(chars1, chars2, false);
  engine.diff_charsToLines_(diffs, lineArray);

  const hunks: DiffHunk[] = [];
  let origOffset = 0;
  let deleteRun = "";
  let insertRun = "";

  const flushRun = () => {
    if (deleteRun === "" && insertRun === "") return;
    const origLines = splitKeepBoundaries(deleteRun);
    const revLines = splitKeepBoundaries(insertRun);
    const pairs = Math.max(origLines.length, revLines.length);
    for (let i = 0; i < pairs; i++) {
      const o = origLines[i];
      const r = revLines[i];
      // Equal pair (text AND newline boundary): pure context — skip its span.
      if (o && r && o.text === r.text && o.hasNewline === r.hasNewline) {
        origOffset += lineSpan(o);
        continue;
      }
      const start = origOffset;
      const end = origOffset + lineSpan(o);
      hunks.push({
        index: hunks.length,
        type: "modified",
        start,
        end,
        original: lineSliceText(o),
        revised: lineSliceText(r),
      });
      origOffset = end;
    }
    deleteRun = "";
    insertRun = "";
  };

  for (const [op, text] of diffs as Array<[number, string]>) {
    if (op === 0) {
      flushRun();
      origOffset += text.length;
    } else if (op === -1) {
      deleteRun += text;
    } else {
      insertRun += text;
    }
  }
  flushRun();
  return hunks;
}

/**
 * Merge accept/reject decisions: walk the ORIGINAL string, replacing each
 * accepted hunk's [start, end) slice with its revised text; rejected
 * hunks keep the original bytes. Reject-all therefore reproduces the
 * original byte-for-byte; accept-all reproduces the revised.
 */
export function mergeHunkDecisions(
  original: string,
  decisions: HunkDecision[],
  hunks: DiffHunk[],
): string {
  const byIndex = new Map(decisions.map((d) => [d.index, d.accepted]));
  let out = "";
  let cursor = 0;
  for (const hunk of hunks) {
    out += original.slice(cursor, hunk.start);
    const accepted = byIndex.get(hunk.index) ?? false;
    out += accepted ? hunk.revised : original.slice(hunk.start, hunk.end);
    cursor = hunk.end;
  }
  return out + original.slice(cursor);
}
