// [20260908_Feat_239_DiffReview] Spec #193 T12 (ticket #239): minimal-edit
// diff review — line-level diff (diff-match-patch, selected by the T5 spike)
// aggregated into per-paragraph change hunks with accept/reject merge.
// Pure functions: no clocks, no IPC — fully unit-testable.
//
// Library note (T5 spike docs/research/2026-09-08-t5-streaming-spike.md ③):
// diff-match-patch 1.0.5 (Apache-2.0) wrapped behind THIS module — the thin
// wrapper is the only touchpoint, so swapping to a maintained fork later is
// a zero-diffusion change. Line mode uses the undocumented
// {chars1, chars2, lineArray} shape (empirically verified in the spike).
import DiffMatchPatch from "diff-match-patch";

/** Above this input size the diff degrades to a single whole-text hunk. */
export const DIFF_MAX_INPUT_CHARS = 200_000;
/** Wall-clock budget for one diff computation before degradation. */
const DIFF_TIMEOUT_MS = 1_000;

export interface DiffHunk {
  index: number;
  type: "modified" | "unchanged" | "whole-text";
  original: string;
  revised: string;
}

export interface HunkDecision {
  index: number;
  accepted: boolean;
}

const dmp = () => {
  const instance = new DiffMatchPatch();
  // [T5 spike] explicit timeout: the watchdog degrades instead of hanging.
  instance.Diff_Timeout = DIFF_TIMEOUT_MS / 1000;
  return instance;
};

/**
 * Build per-line change hunks between original and polished text.
 * Lines are diffed via dmp's line mode (chars↔lines mapping), then runs of
 * consecutive equal lines collapse into `unchanged` hunks and runs of
 * changed lines become `modified` hunks carrying the original/revised
 * paragraph pair. Inputs beyond DIFF_MAX_INPUT_CHARS (or a diff that blew
 * the timeout budget, signaled by dmp's non-optimal marker) degrade to a
 * single whole-text hunk so the UI can still show a full side-by-side.
 */
export function buildHunks(original: string, revised: string): DiffHunk[] {
  if (original === revised) return [];
  if (
    original.length > DIFF_MAX_INPUT_CHARS ||
    revised.length > DIFF_MAX_INPUT_CHARS
  ) {
    return [{ index: 0, type: "whole-text", original, revised }];
  }

  const engine = dmp();
  const { chars1, chars2, lineArray } = engine.diff_linesToChars_(
    original,
    revised,
  );
  const diffs = engine.diff_main(chars1, chars2, false);
  engine.diff_charsToLines_(diffs, lineArray);

  // Aggregate the op runs into hunks. A modified run carries a multi-line
  // paragraph pair: line-level diff grouped whole changed regions together,
  // so split the run by lines and zip original/revised lines — differing
  // line pairs become individual modified hunks (per-段 accept targets),
  // equal pairs become unchanged context, and length mismatches pair with
  // empty strings (pure insertions/deletions).
  const hunks: DiffHunk[] = [];
  let origRun = "";
  let revRun = "";
  const flushRun = () => {
    if (!origRun && !revRun) return;
    const origLines = origRun ? origRun.split("\n") : [];
    const revLines = revRun ? revRun.split("\n") : [];
    // Trailing empty strings from the split on a trailing \n are diff
    // artifacts, not content lines.
    while (origLines.length && origLines[origLines.length - 1] === "")
      origLines.pop();
    while (revLines.length && revLines[revLines.length - 1] === "")
      revLines.pop();
    const pairs = Math.max(origLines.length, revLines.length);
    for (let i = 0; i < pairs; i++) {
      const o = origLines[i] ?? "";
      const r = revLines[i] ?? "";
      if (o === r) {
        hunks.push({ index: -1, type: "unchanged", original: o, revised: r });
      } else {
        hunks.push({ index: -1, type: "modified", original: o, revised: r });
      }
    }
    origRun = "";
    revRun = "";
  };
  for (const [op, text] of diffs as Array<[number, string]>) {
    if (op === 0) {
      flushRun();
      // Equal context may span several lines — keep one hunk per line so
      // the merge concatenates with the same \n separators.
      for (const line of text.split("\n")) {
        if (line === "") continue;
        hunks.push({
          index: -1,
          type: "unchanged",
          original: line,
          revised: line,
        });
      }
    } else if (op === -1) {
      origRun += text;
    } else {
      revRun += text;
    }
  }
  flushRun();
  return hunks.map((h, i) => ({ ...h, index: i }));
}

/**
 * Merge accept/reject decisions back into a full text: accepted hunks
 * contribute their revised text, rejected ones their original; unchanged
 * hunks always pass through. A whole-text hunk takes the decision wholesale.
 */
export function mergeHunkDecisions(
  decisions: HunkDecision[],
  hunks: DiffHunk[],
): string {
  const byIndex = new Map(decisions.map((d) => [d.index, d.accepted]));
  return hunks
    .map((h) => {
      if (h.type === "unchanged") return h.original;
      const accepted = byIndex.get(h.index) ?? false;
      return accepted ? h.revised : h.original;
    })
    .join("\n");
}
