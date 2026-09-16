// [20260908_Feat_240_VocabCorrections] TDD for Spec #193 T13 (ticket #240):
// the vocabulary corrections table — wrong-word→right-word pairs captured
// when the user rejects a rewrite change. DB contracts: wrong-word UNIQUE,
// length caps on both sides, control-char/lone-surrogate rejection, FIFO
// eviction at 1000 entries. Injection filter: ≤20 entries by most-recent
// use, ONLY entries whose wrong word appears in the pending text, wrapped
// inside the XML envelope so the injection guard covers it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import DatabaseManager from "../../src/helpers/database";
import {
  VOCAB_MAX_ENTRIES,
  VOCAB_MAX_TERM_CHARS,
  filterVocabForInjection,
  buildVocabDirective,
} from "../../src/helpers/vocab";

let db: InstanceType<typeof DatabaseManager>;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vocab-test-"));
  db = new DatabaseManager();
  db.initialize(tmpDir);
});

afterEach(() => {
  // [20260908_Fix_240_Review] DB-test convention: close + rmSync per run.
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("[20260908_Feat_240_VocabCorrections] DB layer", () => {
  it("adds and lists a correction pair", () => {
    db.addVocabCorrection("会义室", "会议室");
    const rows = db.listVocabCorrections();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ wrong: "会义室", right: "会议室" });
  });

  it("re-inserting the same wrong word updates the pair in place (unique)", () => {
    db.addVocabCorrection("会义室", "会议室");
    db.addVocabCorrection("会义室", "会议室B");
    const rows = db.listVocabCorrections();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.right).toBe("会议室B");
  });

  it("rejects terms over the length cap on either side", () => {
    expect(() =>
      db.addVocabCorrection("a".repeat(VOCAB_MAX_TERM_CHARS + 1), "x"),
    ).toThrow();
    expect(() =>
      db.addVocabCorrection("x", "b".repeat(VOCAB_MAX_TERM_CHARS + 1)),
    ).toThrow();
    // At exactly the cap the term is valid.
    expect(() =>
      db.addVocabCorrection("a".repeat(VOCAB_MAX_TERM_CHARS), "x"),
    ).not.toThrow();
  });

  it("rejects empty terms and control characters / lone surrogates", () => {
    expect(() => db.addVocabCorrection("", "x")).toThrow();
    expect(() => db.addVocabCorrection("x", "")).toThrow();
    expect(() => db.addVocabCorrection("a\u0000b", "x")).toThrow();
    expect(() => db.addVocabCorrection("\ud800", "x")).toThrow();
  });

  it("evicts the OLDEST entries beyond the FIFO cap", () => {
    // [20260910_Fix_WinFlakyVocabFifo] Insert via the batch API: 1005
    // per-call transactions (each with its own fsync) blew past the test
    // timeout on the Windows CI runner (26s observed). addVocabCorrectionsBatch
    // exists precisely for this — one transaction, one eviction check
    // (see 20260908_Fix_240_WinPerf in database.ts).
    db.addVocabCorrectionsBatch(
      Array.from({ length: VOCAB_MAX_ENTRIES + 5 }, (_, i) => [
        `词${i}`,
        `正${i}`,
      ]),
    );
    const rows = db.listVocabCorrections();
    expect(rows).toHaveLength(VOCAB_MAX_ENTRIES);
    // The first five inserted pairs were evicted.
    expect(rows.some((r) => r.wrong === "词0")).toBe(false);
    expect(rows.some((r) => r.wrong === `词${VOCAB_MAX_ENTRIES + 4}`)).toBe(
      true,
    );
  });

  it("deletes a pair and clears all", () => {
    db.addVocabCorrection("a", "b");
    db.addVocabCorrection("c", "d");
    db.deleteVocabCorrection("a");
    expect(db.listVocabCorrections()).toHaveLength(1);
    db.clearVocabCorrections();
    expect(db.listVocabCorrections()).toHaveLength(0);
  });

  it("re-touching an existing wrong word moves it to most-recent", () => {
    db.addVocabCorrection("a", "1");
    db.addVocabCorrection("b", "2");
    db.addVocabCorrection("a", "1"); // touch
    const rows = db.listVocabCorrections();
    expect(rows[0]!.wrong).toBe("b"); // oldest first
    expect(rows[1]!.wrong).toBe("a"); // a is now most recent
  });
});

describe("[20260908_Feat_240_VocabCorrections] injection filter", () => {
  it("keeps only entries whose wrong word appears in the pending text, ≤20 by recency", () => {
    // Non-overlapping keys (CJK substring semantics: 词1 ⊂ 词10 would
    // both match, conflating the test).
    const entries = Array.from({ length: 30 }, (_, i) => ({
      wrong: `错${i}词`,
      right: `正${i}词`,
    }));
    const filtered = filterVocabForInjection(
      "这里出现了 错5词 和 错10词 还有 错25词",
      entries,
    );
    expect(filtered.map((e) => e.wrong).sort()).toEqual(
      ["错10词", "错25词", "错5词"].sort(),
    );

    // Over 20 matches: the 20 most RECENT entries win (highest index here).
    const many = Array.from({ length: 30 }, (_, i) => ({
      wrong: `w${i}`,
      right: `r${i}`,
    }));
    const text = many.map((e) => e.wrong).join(" ");
    const capped = filterVocabForInjection(text, many);
    expect(capped).toHaveLength(20);
    expect(capped[0]!.wrong).toBe("w10"); // oldest of the kept 20
    expect(capped[19]!.wrong).toBe("w29");
  });

  it("returns an empty list when nothing matches", () => {
    expect(
      filterVocabForInjection("没有任何匹配", [{ wrong: "x", right: "y" }]),
    ).toEqual([]);
  });

  it("builds the directive inside the XML envelope scope", () => {
    const directive = buildVocabDirective([
      { wrong: "会义室", right: "会议室" },
    ]);
    expect(directive).toContain("会义室");
    expect(directive).toContain("会议室");
    // Structure: a labeled corrections block the prompt builder places
    // INSIDE the <transcript> envelope (injection-guard covered).
    expect(directive).toMatch(/\[|【/);
  });

  it("empty entries build no directive", () => {
    expect(buildVocabDirective([])).toBe("");
  });
});

// [20260908_Feat_240_RewriteReview] T13 ①: rewrite-class modes show the
// whole-text before/after panel with one-click revert — NO per-hunk
// controls (spec: 逐段 diff is meaningless under full rewrite).
// ② the correction-pair annotation flow (reject-time capture).
// @vitest-environment jsdom
import "../setup/react";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: "zh-CN" },
  }),
}));

import { RewriteReviewPanel } from "../../src/components/RewriteReviewPanel";

describe("[20260908_Feat_240_RewriteReview] RewriteReviewPanel", () => {
  const onAddCorrection = vi.fn();
  beforeEach(() => vi.clearAllMocks());
  const onAccept = vi.fn();
  const onRevert = vi.fn();

  function mount() {
    return render(
      React.createElement(RewriteReviewPanel, {
        original: "原始的转写文本",
        rewritten: "重写后的精彩文本",
        onAddCorrection,
        onAccept,
        onRevert,
      }),
    );
  }

  it("renders the whole-text side-by-side (no per-hunk controls)", () => {
    mount();
    expect(screen.getByTestId("rewrite-original")).toHaveTextContent(
      "原始的转写文本",
    );
    expect(screen.getByTestId("rewrite-result")).toHaveTextContent(
      "重写后的精彩文本",
    );
    // NO per-hunk accept/reject buttons (rewrite-class contract).
    expect(screen.queryAllByRole("button", { name: "接受" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "拒绝" })).toHaveLength(0);
  });

  it("revert calls onRevert (one-click back to original)", () => {
    mount();
    fireEvent.click(screen.getByTestId("rewrite-revert"));
    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("accept sends the rewritten text", () => {
    mount();
    fireEvent.click(screen.getByTestId("rewrite-accept"));
    expect(onAccept).toHaveBeenCalledWith("重写后的精彩文本");
  });

  it("annotation flow captures a wrong→right pair", () => {
    mount();
    fireEvent.click(screen.getByTestId("rewrite-annotate"));
    fireEvent.change(screen.getByLabelText("错误词"), {
      target: { value: "会义室" },
    });
    fireEvent.change(screen.getByLabelText("正确词"), {
      target: { value: "会议室" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记入修正表" }));
    expect(onAddCorrection).toHaveBeenCalledWith("会义室", "会议室");
  });

  it("empty pairs are not submitted", () => {
    mount();
    fireEvent.click(screen.getByTestId("rewrite-annotate"));
    fireEvent.click(screen.getByRole("button", { name: "记入修正表" }));
    expect(onAddCorrection).not.toHaveBeenCalled();
    // [20260908_Fix_240_Review] A half-filled/empty submit keeps the form
    // open with its contents (no silent input loss).
    expect(screen.getByTestId("correction-form")).toBeInTheDocument();
  });
});
