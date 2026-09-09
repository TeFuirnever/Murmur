// [20260908_Feat_239_DiffReview] Spec #193 T12 (ticket #239): the S4a
// diff-review panel for minimal-edit polish modes — side-by-side hunks with
// per-hunk accept/reject, a live merged preview, the 无改动 empty state,
// and keyboard-reachable aria-labelled controls. Merge/write-back goes
// through the T1 UPDATE channel (handled by the parent via onApply).
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  buildHunks,
  mergeHunkDecisions,
  type DiffHunk,
} from "../helpers/polish-diff";

interface DiffReviewPanelProps {
  original: string;
  revised: string;
  onApply: (mergedText: string) => void;
  onCancel: () => void;
}

export const DiffReviewPanel: React.FC<DiffReviewPanelProps> = ({
  original,
  revised,
  onApply,
  onCancel,
}) => {
  const { t } = useTranslation();
  const hunks = React.useMemo(
    () => buildHunks(original, revised),
    [original, revised],
  );
  const modified = hunks; // v2 model: hunks are modified/whole-text only
  const [decisions, setDecisions] = React.useState<Record<number, boolean>>(
    () =>
      Object.fromEntries(modified.map((h) => [h.index, true])) as Record<
        number,
        boolean
      >,
  );
  // [20260908_Fix_239_Review] Hunk indices are positional — reset the
  // decisions when the inputs change so stale toggles never collide with a
  // new hunk set (parent may reuse the panel across results).
  React.useEffect(() => {
    setDecisions(
      Object.fromEntries(modified.map((h) => [h.index, true])) as Record<
        number,
        boolean
      >,
    );
  }, [original, revised]); // eslint-disable-line react-hooks/exhaustive-deps

  const merged = React.useMemo(
    () =>
      mergeHunkDecisions(
        original,
        Object.entries(decisions).map(([index, accepted]) => ({
          index: Number(index),
          accepted,
        })),
        hunks,
      ),
    [decisions, hunks, original],
  );

  // [20260908_Fix_239_ReviewByteDrift] The no-change state keys on input
  // identity — a blank-line-only difference IS a visible modified hunk.
  if (original === revised) {
    return (
      <div data-testid="diff-review" className="space-y-2">
        <p className="text-sm text-[#86868b]">
          {t("diff.noChanges", "无改动")}
        </p>
        <button
          type="button"
          aria-label={t("diff.discard", "放弃修改")}
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          {t("diff.discard", "放弃修改")}
        </button>
      </div>
    );
  }

  return (
    <div data-testid="diff-review" className="space-y-3">
      <div className="space-y-2">
        {hunks.map((hunk: DiffHunk, i: number) => {
          // Context between hunks: the original bytes the previous hunk
          // ended and this one begins (v2 offset model).
          const prevEnd = i === 0 ? 0 : hunks[i - 1]!.end;
          const context = original.slice(prevEnd, hunk.start);
          const contextNode = context ? (
            <p
              key={`ctx-${hunk.index}`}
              className="text-sm text-[#86868b] dark:text-[#86868b] whitespace-pre-wrap"
            >
              {context}
            </p>
          ) : null;
          const accepted = decisions[hunk.index] ?? true;
          return (
            <React.Fragment key={hunk.index}>
              {contextNode}
              <div
                className={`rounded-lg border p-2 transition-colors ${
                  accepted
                    ? "border-[#b3d7f5] dark:border-[#1a3a5c] bg-[#e8f4fd] dark:bg-[#0a2540]"
                    : "border-[#d2d2d7] dark:border-[#3a3a3c] bg-[#f5f5f7] dark:bg-[#3a3a3c]"
                }`}
              >
                <div className="grid grid-cols-2 gap-2">
                  <p className="text-sm text-[#1d1d1f]/70 dark:text-[#f5f5f7]/70 line-through whitespace-pre-wrap">
                    {hunk.original || t("diff.emptySide", "（空）")}
                  </p>
                  <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap">
                    {hunk.revised || t("diff.emptySide", "（空）")}
                  </p>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    aria-label={t("diff.accept", "接受")}
                    onClick={() =>
                      setDecisions((prev) => ({ ...prev, [hunk.index]: true }))
                    }
                    className={`px-2 py-1 text-xs rounded-md ${
                      accepted
                        ? "bg-[#0071e3] text-white"
                        : "bg-[#e8f4fd] dark:bg-[#0a2540] text-[#0071e3]"
                    }`}
                  >
                    {t("diff.accept", "接受")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("diff.reject", "拒绝")}
                    onClick={() =>
                      setDecisions((prev) => ({ ...prev, [hunk.index]: false }))
                    }
                    className={`px-2 py-1 text-xs rounded-md ${
                      !accepted
                        ? "bg-[#ff5f57] text-white"
                        : "bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#ff5f57]"
                    }`}
                  >
                    {t("diff.reject", "拒绝")}
                  </button>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          aria-label={t("diff.discard", "放弃修改")}
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          {t("diff.discard", "放弃修改")}
        </button>
        <button
          type="button"
          aria-label={t("diff.apply", "应用修改")}
          onClick={() => onApply(merged)}
          className="px-3 py-1.5 text-sm rounded-lg bg-[#0071e3] text-white hover:bg-[#0077ed]"
        >
          {t("diff.apply", "应用修改")}
        </button>
      </div>
    </div>
  );
};
