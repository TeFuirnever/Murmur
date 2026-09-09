// [20260908_Feat_240_VocabCorrections] Spec #193 T13 (ticket #240): the
// vocabulary corrections layer — pure helpers for the injection discipline.
// DB storage lives in database.ts (vocabulary table); this module owns the
// filtering/directive contracts:
//   - injection keeps ONLY entries whose wrong word appears in the pending
//     text (no bulk shipping of the user's private table)
//   - at most 20 entries, chosen by most-recent use
//   - the directive is a labeled block the prompt builder places INSIDE the
//     <transcript> envelope, so the T4 injection guard covers it
export const VOCAB_MAX_ENTRIES = 1000;
export const VOCAB_MAX_TERM_CHARS = 200;
export const VOCAB_MAX_INJECTED = 20;

export interface VocabEntry {
  wrong: string;
  right: string;
}

/** Reject terms with control chars or lone surrogates (both sides). */
export function isValidVocabTerm(term: string): boolean {
  if (!term || term.length > VOCAB_MAX_TERM_CHARS) return false;

  if (/[\u0000-\u001f\u007f-\u009f]/.test(term)) return false;
  // Lone surrogates: any unpaired \ud800-\udfff.
  for (let i = 0; i < term.length; i++) {
    const code = term.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) {
      const next = i + 1 < term.length ? term.charCodeAt(i + 1) : 0;
      const prev = i > 0 ? term.charCodeAt(i - 1) : 0;
      const isHigh = code <= 0xdbff;
      const paired = isHigh
        ? next >= 0xdc00 && next <= 0xdfff
        : prev >= 0xd800 && prev <= 0xdbff;
      if (!paired) return false;
    }
  }
  return true;
}

/**
 * Entries eligible for one polish run: wrong word present in the text,
 * capped at VOCAB_MAX_INJECTED most-recent entries. `entries` arrives
// oldest-first from the DB; recency = later position (touched entries
 * surface at the end).
 */
export function filterVocabForInjection(
  pendingText: string,
  entries: VocabEntry[],
): VocabEntry[] {
  // [20260908_Fix_240_Review] Defense-in-depth per the hotwords doctrine:
  // re-validate at the injection read — a corrupted DB row with an empty
  // wrong word would otherwise match EVERY text ("".includes semantics).
  const matching = entries.filter(
    (e) => e.wrong.length > 0 && pendingText.includes(e.wrong),
  );
  if (matching.length <= VOCAB_MAX_INJECTED) return matching;
  return matching.slice(matching.length - VOCAB_MAX_INJECTED);
}

/**
 * Build the corrections directive — a labeled line per entry, placed by the
 * prompt builder inside the XML envelope (injection-guard covered).
 */
export function buildVocabDirective(entries: VocabEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- ${e.wrong} → ${e.right}`);
  return `【修正表】以下词对为历史修正,遇到左侧错误词请按右侧写法输出:\n${lines.join("\n")}`;
}
