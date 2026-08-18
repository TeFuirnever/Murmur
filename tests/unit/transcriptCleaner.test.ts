// [20260819_T9_TranscriptCleaner] Ticket #182 (spec #177 T9): the
// engine-agnostic transcription text cleaner — conservative rules that
// protect natural Chinese spoken repetition while folding degenerate
// model loops/hallucinations. Golden-set acceptance: normal corpus (incl.
// "对对对"/"好的好的"/laughter runs) must be byte-identical after cleaning;
// pathological corpus must collapse exactly as specified. RED first.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import {
  cleanTranscriptionText,
  PHRASE_MIN_REPEATS,
} from "../../src/helpers/transcriptCleaner";

const golden = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../fixtures/transcript-cleaner-golden.json"),
    "utf-8",
  ),
) as {
  normal: string[];
  pathological: { input: string; expected: string; note: string }[];
};

describe("[20260819_T9_TranscriptCleaner] golden normal corpus — zero changes", () => {
  it.each(golden.normal.map((text, i) => [i, text] as const))(
    "normal[%i] passes through byte-identical",
    (_i, text) => {
      expect(cleanTranscriptionText(text)).toBe(text);
    },
  );

  it("normal corpus is non-trivial (≥10 samples including repetition cases)", () => {
    expect(golden.normal.length).toBeGreaterThanOrEqual(10);
    expect(golden.normal.some((t) => t.includes("对对对"))).toBe(true);
    expect(golden.normal.some((t) => t.includes("好的好的"))).toBe(true);
    expect(golden.normal.some((t) => t.includes("哈哈哈哈"))).toBe(true);
  });
});

describe("[20260819_T9_TranscriptCleaner] golden pathological corpus", () => {
  it.each(golden.pathological.map((c, i) => [i, c] as const))(
    "pathological[%i] collapses exactly",
    (_i, c) => {
      expect(cleanTranscriptionText(c.input)).toBe(c.expected);
    },
  );

  it("aggregate elimination rate on pathological corpus ≥ 50%", () => {
    const inLen = golden.pathological.reduce((n, c) => n + c.input.length, 0);
    const outLen = golden.pathological.reduce(
      (n, c) => n + cleanTranscriptionText(c.input).length,
      0,
    );
    expect((inLen - outLen) / inLen).toBeGreaterThanOrEqual(0.5);
  });
});

describe("[20260819_T9_TranscriptCleaner] rules & exemptions", () => {
  it("short inputs are exempt (below the smallest triggerable pattern)", () => {
    // 4 chars < SHORT_INPUT_EXEMPTION (6) — even though a char-run rule
    // threshold could otherwise be argued, sub-minimum inputs pass through.
    expect(cleanTranscriptionText("嗯嗯嗯嗯")).toBe("嗯嗯嗯嗯");
    expect(cleanTranscriptionText("对对对对")).toBe("对对对对");
  });

  it("exactly-at-threshold phrase repeat (6 chars) DOES fold", () => {
    expect(cleanTranscriptionText("好的好的好的")).toBe("好的");
  });

  it("non-consecutive natural phrase repeats are untouched", () => {
    const text = "好的我们开始,中间讨论了很多,好的那就这样";
    expect(cleanTranscriptionText(text)).toBe(text);
  });

  it("empty and whitespace-only inputs pass through", () => {
    expect(cleanTranscriptionText("")).toBe("");
    expect(cleanTranscriptionText("   ")).toBe("   ");
  });

  it("threshold semantics: PHRASE_MIN_REPEATS is 3 (spec: 仅连续 ≥3 次)", () => {
    expect(PHRASE_MIN_REPEATS).toBe(3);
  });

  // [T9 review fixup] The 6-vs-4 threshold deviation lives exactly at this
  // boundary — lock both sides so the line cannot drift silently.
  it("exactly-6 identical run folds to 3; exactly-5 run is preserved", () => {
    expect(cleanTranscriptionText("笑死哈哈哈哈哈哈真的")).toBe(
      "笑死哈哈哈真的",
    );
    expect(cleanTranscriptionText("笑死哈哈哈哈哈真的")).toBe(
      "笑死哈哈哈哈哈真的",
    );
  });

  it("punctuated natural repeats pass through (review MAJOR regression lock)", () => {
    expect(cleanTranscriptionText("对,对,对,是这个意思")).toBe(
      "对,对,对,是这个意思",
    );
    expect(cleanTranscriptionText("嗯,嗯,嗯,我在听")).toBe("嗯,嗯,嗯,我在听");
  });

  it("digit runs carry information and never fold (char or phrase pass)", () => {
    expect(cleanTranscriptionText("订单号888888已发货")).toBe(
      "订单号888888已发货",
    );
    expect(cleanTranscriptionText("验证码是111111,五分钟内有效")).toBe(
      "验证码是111111,五分钟内有效",
    );
  });
});

describe("[20260819_T9_TranscriptCleaner] linear-time guarantee", () => {
  it("100k-char degenerate input cleans in <500ms", () => {
    const pathological = "我知道了".repeat(25_000);
    const start = performance.now();
    const out = cleanTranscriptionText(pathological);
    const elapsed = performance.now() - start;
    expect(out).toBe("我知道了");
    expect(elapsed).toBeLessThan(500);
  });

  it("100k-char mixed realistic input cleans in <500ms", () => {
    const chunk = "这个方案的预算超出了原定计划的百分之十五,".repeat(2_500);
    const start = performance.now();
    cleanTranscriptionText(chunk);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

// [20260819_T9_TranscriptCleaner] END
