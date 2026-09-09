// [20260908_Feat_239_DiffReview] Minimal ambient declarations for
// diff-match-patch@1.0.5 (untyped CJS, Apache-2.0; selected by the T5
// spike — docs/research/2026-09-08-t5-streaming-spike.md ③). Only the
// surface polish-diff.ts consumes is declared.
declare module "diff-match-patch" {
  export default class DiffMatchPatch {
    /** Diff computation budget in seconds; non-optimal diffs degrade. */
    Diff_Timeout: number;
    diff_main(
      a: string,
      b: string,
      checklines?: boolean,
    ): Array<[number, string]>;
    /** Line-mode mapping; returns {chars1, chars2, lineArray} (empirical). */
    diff_linesToChars_(
      a: string,
      b: string,
    ): { chars1: string; chars2: string; lineArray: string[] };
    diff_charsToLines_(
      diffs: Array<[number, string]>,
      lineArray: string[],
    ): void;
    diff_cleanupSemantic(diffs: Array<[number, string]>): void;
  }
}
