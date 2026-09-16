// [20260908_Feat_239_DiffReview] TDD for Spec #193 T12 (ticket #239):
// minimal-edit diff hunks — line-level diff → per-paragraph change blocks
// → accept/reject merge semantics, plus the oversized-input degradation.
// Chinese fixtures pin the three minimal-edit shapes (filler removal,
// homophone fix, mood-particle preservation) byte-exactly.
import { describe, it, expect } from "vitest";
import {
  buildHunks,
  mergeHunkDecisions,
  DIFF_MAX_INPUT_CHARS,
} from "../../src/helpers/polish-diff";

const FILLER_ORIG = [
  "我们明天上午十点在会义室开会，",
  "嗯，记得带上周报，",
  "这个方案我我我觉得挺好。",
].join("\n");
const FILLER_POLISHED = [
  "我们明天上午十点在会议室开会，",
  "记得带上周报，",
  "这个方案我觉得挺好。",
].join("\n");

const HOMOPHONE_ORIG = "他今天心情很好,笑的很大声。";
const HOMOPHONE_POLISHED = "他今天心情很好，笑得很大声。";

const MOOD_ORIG = "这个方案吧，我觉得还挺不错的呀。";
const MOOD_POLISHED = "这个方案吧，我觉得还挺不错的呀。"; // unchanged — 无改动状态

describe("[20260908_Feat_239_DiffReview] buildHunks", () => {
  it("returns an empty list for identical texts (无改动 state)", () => {
    expect(buildHunks(MOOD_ORIG, MOOD_POLISHED)).toEqual([]);
  });

  it("groups filler-removal edits into hunks with original/revised pairs", () => {
    const hunks = buildHunks(FILLER_ORIG, FILLER_POLISHED);
    expect(hunks.length).toBeGreaterThan(0);
    const modified = hunks.filter((h) => h.type === "modified");
    expect(modified.length).toBeGreaterThanOrEqual(2);
    // The homophone fix 場所: 会义室 → 会议室
    const roomFix = modified.find((h) => h.revised.includes("会议室"));
    expect(roomFix?.original).toContain("会义室");
    // The filler line 嗯， disappears entirely
    const filler = modified.find((h) => h.original.includes("嗯，"));
    expect(filler?.revised.includes("嗯，")).toBe(false);
  });

  it("skips fully-identical lines (no hunk for unchanged context)", () => {
    const hunks = buildHunks(
      "同样的一行\n变了的一行",
      "同样的一行\n变化的一行",
    );
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.original).toContain("变了的一行");
    expect(hunks[0]!.start).toBe("同样的一行\n".length);
  });

  it("handles homophone punctuation fixes as minimal hunks", () => {
    const hunks = buildHunks(HOMOPHONE_ORIG, HOMOPHONE_POLISHED);
    const modified = hunks.filter((h) => h.type === "modified");
    expect(modified.length).toBe(1);
    expect(modified[0]!.original).toContain("笑的");
    expect(modified[0]!.revised).toContain("笑得");
  });

  it("degrades to a single whole-text hunk on oversized input", () => {
    const huge = "字".repeat(DIFF_MAX_INPUT_CHARS + 1);
    const hunks = buildHunks(huge, huge + "尾");
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.type).toBe("whole-text");
    expect(hunks[0]!.revised).toBe(huge + "尾");
  });

  // [20260908_Fix_239_ReviewByteDrift] The hunk model must represent blank
  // lines, trailing newlines and CRLF — reject-all is byte-identical to the
  // original, accept-all to the revised, on ALL shapes (review HIGH ×3).
  it("reject-all is byte-identical for blank-line / trailing-newline / CRLF shapes", () => {
    const shapes: Array<[string, string]> = [
      ["第一行\n第二行\n", "第一行\n第二行"],
      ["段一\n\n段二", "段一\n段二"],
      ["\n开头", "开头"],
      ["甲\r\n乙\r\n", "甲\r\n乙"],
      ["一\n二\n三", "一\n二三"],
    ];
    for (const [orig, rev] of shapes) {
      const hunks = buildHunks(orig, rev);
      const rejected = mergeHunkDecisions(
        orig,
        hunks.map((h) => ({ index: h.index, accepted: false })),
        hunks,
      );
      expect(rejected, JSON.stringify([orig, rev])).toBe(orig);
      const accepted = mergeHunkDecisions(
        orig,
        hunks.map((h) => ({ index: h.index, accepted: true })),
        hunks,
      );
      expect(accepted, JSON.stringify([orig, rev])).toBe(rev);
    }
  });

  it("blank-line-only differences produce a visible modified hunk (not 无改动)", () => {
    const hunks = buildHunks("a\n\nb", "a\nb");
    expect(hunks.some((h) => h.type === "modified")).toBe(true);
    expect(buildHunks("a\n", "a").some((h) => h.type === "modified")).toBe(
      true,
    );
  });

  it("is deterministic (idempotent on re-run)", () => {
    const a = buildHunks(FILLER_ORIG, FILLER_POLISHED);
    const b = buildHunks(FILLER_ORIG, FILLER_POLISHED);
    expect(a).toEqual(b);
  });
});

describe("[20260908_Feat_239_DiffReview] mergeHunkDecisions", () => {
  it("accept-all yields the polished text", () => {
    const hunks = buildHunks(FILLER_ORIG, FILLER_POLISHED);
    const merged = mergeHunkDecisions(
      FILLER_ORIG,
      hunks.map((h) => ({ index: h.index, accepted: true })),
      hunks,
    );
    expect(merged).toBe(FILLER_POLISHED);
  });

  it("reject-all yields the original text", () => {
    const hunks = buildHunks(FILLER_ORIG, FILLER_POLISHED);
    const merged = mergeHunkDecisions(
      FILLER_ORIG,
      hunks.map((h) => ({ index: h.index, accepted: false })),
      hunks,
    );
    expect(merged).toBe(FILLER_ORIG);
  });

  it("mixed decisions splice accepted revisions into rejected originals in order", () => {
    const hunks = buildHunks(FILLER_ORIG, FILLER_POLISHED);
    const modified = hunks.filter((h) => h.type === "modified");
    expect(modified.length).toBeGreaterThanOrEqual(2);
    // Accept the room fix, reject the filler removal.
    const acceptRoom = modified.find((h) => h.revised.includes("会议室"))!;
    const decisions = hunks.map((h) => ({
      index: h.index,
      accepted: h === acceptRoom,
    }));
    const merged = mergeHunkDecisions(FILLER_ORIG, decisions, hunks);
    expect(merged).toContain("会议室");
    expect(merged).toContain("嗯，");
    expect(merged).not.toContain("会义室");
  });

  it("whole-text hunk accepts to revised, rejects to original", () => {
    const hunks = buildHunks("甲", "乙");
    // force whole-text shape via one-char texts is not oversized; use API
    const whole = buildHunks("x".repeat(DIFF_MAX_INPUT_CHARS + 1), "y");
    expect(whole[0]!.type).toBe("whole-text");
    expect(
      mergeHunkDecisions(
        "x".repeat(DIFF_MAX_INPUT_CHARS + 1),
        [{ index: 0, accepted: true }],
        whole,
      ),
    ).toBe("y");
    expect(
      mergeHunkDecisions(
        "x".repeat(DIFF_MAX_INPUT_CHARS + 1),
        [{ index: 0, accepted: false }],
        whole,
      ),
    ).toBe("x".repeat(DIFF_MAX_INPUT_CHARS + 1));
    void hunks;
  });
});
