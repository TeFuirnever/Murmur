// [20260908_Feat_239_DiffReview] TDD for the S4a diff-review component:
// side-by-side hunk view with per-hunk accept/reject, 无改动 state, and
// accessibility (tab-focusable controls with aria-labels).
// @vitest-environment jsdom
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: "zh-CN" },
  }),
}));

import { DiffReviewPanel } from "../../src/components/DiffReviewPanel";

const ORIG = [
  "我们明天上午十点在会义室开会，",
  "嗯，记得带上周报，",
  "这个方案我我我觉得挺好。",
].join("\n");
const POLISHED = [
  "我们明天上午十点在会议室开会，",
  "记得带上周报，",
  "这个方案我觉得挺好。",
].join("\n");

describe("[20260908_Feat_239_DiffReview] DiffReviewPanel", () => {
  const onApply = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => vi.clearAllMocks());

  it("renders modified hunks as side-by-side pairs with per-hunk controls", () => {
    render(
      <DiffReviewPanel
        original={ORIG}
        revised={POLISHED}
        onApply={onApply}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/会义室/)).toBeInTheDocument();
    expect(screen.getByText(/会议室/)).toBeInTheDocument();
    // Per-hunk accept/reject buttons exist for each modified hunk.
    expect(
      screen.getAllByRole("button", { name: "接受" }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByRole("button", { name: "拒绝" }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("shows the 无改动 state for identical texts", () => {
    render(
      <DiffReviewPanel
        original={MOOD}
        revised={MOOD}
        onApply={onApply}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("无改动")).toBeInTheDocument();
  });
  const MOOD = "这个方案吧，我觉得还挺不错的呀。";

  it("toggling a hunk updates the merged preview", () => {
    render(
      <DiffReviewPanel
        original={ORIG}
        revised={POLISHED}
        onApply={onApply}
        onCancel={onCancel}
      />,
    );
    // Default: all accepted → apply sends the polished text.
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    expect(onApply).toHaveBeenCalledWith(POLISHED);

    // Reject the FIRST hunk (the room homophone fix) — its original
    // contains 会义室 and rejecting restores it in the merge.
    const rejectButtons = screen.getAllByRole("button", { name: "拒绝" });
    fireEvent.click(rejectButtons[0]!);
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    const merged = onApply.mock.calls[1]![0] as string;
    expect(merged).toContain("会义室"); // rejected room fix keeps original
    expect(merged).not.toContain("会议室");
    expect(merged).not.toContain("我我我"); // other hunks still accepted
  });

  it("controls are keyboard reachable with aria-labels", () => {
    render(
      <DiffReviewPanel
        original={ORIG}
        revised={POLISHED}
        onApply={onApply}
        onCancel={onCancel}
      />,
    );
    for (const name of ["接受", "拒绝", "应用修改", "放弃修改"]) {
      const btn = screen.getAllByRole("button", { name })[0]!;
      expect(btn.getAttribute("tabindex")).not.toBe("-1");
      expect(btn.getAttribute("aria-label")).toContain(name);
    }
  });

  it("cancel button calls onCancel without applying", () => {
    render(
      <DiffReviewPanel
        original={ORIG}
        revised={POLISHED}
        onApply={onApply}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("oversized input renders the whole-text fallback", () => {
    render(
      <DiffReviewPanel
        original={"甲".repeat(200_001)}
        revised={"乙".repeat(200_001)}
        onApply={onApply}
        onCancel={onCancel}
      />,
    );
    // Whole-text mode: one accept/reject pair only.
    expect(screen.getAllByRole("button", { name: "接受" })).toHaveLength(1);
  });
});
