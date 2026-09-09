// [20260908_Feat_240_RewriteReview] Spec #193 T13 (ticket #240): the S4b
// rewrite-class review panel — whole-text before/after with one-click
// revert (NO per-hunk controls: 逐段 diff is meaningless under a full
// rewrite — spec review BL-2), plus the correction-pair annotation flow:
// when the user rejects the rewrite they can point at or type a
// wrong→right pair which the parent persists into the vocabulary table.
import * as React from "react";
import { useTranslation } from "react-i18next";

interface RewriteReviewPanelProps {
  original: string;
  rewritten: string;
  /** Persist one correction pair (parent routes to the vocabulary table). */
  onAddCorrection: (wrong: string, right: string) => void;
  /** Accept the rewrite (parent writes back via the UPDATE channel). */
  onAccept: (text: string) => void;
  /** Revert to the original text; optionally annotate a correction pair. */
  onRevert: () => void;
}

export const RewriteReviewPanel: React.FC<RewriteReviewPanelProps> = ({
  original,
  rewritten,
  onAddCorrection,
  onAccept,
  onRevert,
}) => {
  const { t } = useTranslation();
  const [wrong, setWrong] = React.useState("");
  const [right, setRight] = React.useState("");
  const [annotating, setAnnotating] = React.useState(false);

  // [20260908_Fix_240_Review] An invalid (half-filled) submit keeps the
  // form open with its contents — only a successful save collapses it.
  const submitPair = () => {
    if (!wrong.trim() || !right.trim()) return;
    onAddCorrection(wrong.trim(), right.trim());
    setWrong("");
    setRight("");
    setAnnotating(false);
  };

  return (
    <div data-testid="rewrite-review" className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-[#86868b] mb-1">
            {t("rewrite.originalLabel", "原文")}
          </p>
          <p
            data-testid="rewrite-original"
            className="text-sm text-[#1d1d1f]/70 dark:text-[#f5f5f7]/70 whitespace-pre-wrap bg-[#f5f5f7] dark:bg-[#3a3a3c] rounded-lg p-2"
          >
            {original}
          </p>
        </div>
        <div>
          <p className="text-xs text-[#86868b] mb-1">
            {t("rewrite.rewrittenLabel", "重写结果")}
          </p>
          <p
            data-testid="rewrite-result"
            className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap bg-[#e8f4fd] dark:bg-[#0a2540] rounded-lg p-2"
          >
            {rewritten}
          </p>
        </div>
      </div>
      {annotating && (
        <div data-testid="correction-form" className="flex items-center gap-2">
          <input
            type="text"
            aria-label={t("rewrite.wrongWord", "错误词")}
            value={wrong}
            onChange={(e) => setWrong(e.target.value)}
            placeholder={t("rewrite.wrongWord", "错误词")}
            className="w-32 px-2 py-1 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-md bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
          />
          <span className="text-[#86868b]">→</span>
          <input
            type="text"
            aria-label={t("rewrite.rightWord", "正确词")}
            value={right}
            onChange={(e) => setRight(e.target.value)}
            placeholder={t("rewrite.rightWord", "正确词")}
            className="w-32 px-2 py-1 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-md bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
          />
          <button
            type="button"
            aria-label={t("rewrite.saveCorrection", "记入修正表")}
            onClick={submitPair}
            className="px-2 py-1 text-xs rounded-md bg-[#0071e3] text-white"
          >
            {t("rewrite.saveCorrection", "记入修正表")}
          </button>
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          aria-label={t("rewrite.revert", "回退原文")}
          data-testid="rewrite-revert"
          onClick={onRevert}
          className="px-3 py-1.5 text-sm rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          {t("rewrite.revert", "回退原文")}
        </button>
        <button
          type="button"
          aria-label={t("rewrite.annotate", "标注修正")}
          data-testid="rewrite-annotate"
          onClick={() => setAnnotating((prev) => !prev)}
          className="px-3 py-1.5 text-sm rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          {t("rewrite.annotate", "标注修正")}
        </button>
        <button
          type="button"
          aria-label={t("rewrite.accept", "采用重写")}
          data-testid="rewrite-accept"
          onClick={() => onAccept(rewritten)}
          className="px-3 py-1.5 text-sm rounded-lg bg-[#0071e3] text-white hover:bg-[#0077ed]"
        >
          {t("rewrite.accept", "采用重写")}
        </button>
      </div>
    </div>
  );
};
