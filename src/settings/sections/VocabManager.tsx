// [20260908_Feat_240_VocabCorrections] Spec #193 T13 (ticket #240):
// settings-page management for the vocabulary corrections table —
// view/add/delete/clear with the privacy disclosure (entries ship with
// polish requests to the configured provider).
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface VocabEntry {
  wrong: string;
  right: string;
}

export const VocabManager: React.FC = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = React.useState<VocabEntry[]>([]);
  const [wrong, setWrong] = React.useState("");
  const [right, setRight] = React.useState("");

  const reload = React.useCallback(async () => {
    if (!window.electronAPI?.listVocabCorrections) return;
    try {
      const result = await window.electronAPI.listVocabCorrections();
      if (result.success) setEntries(result.entries);
    } catch {
      // Bridge failure leaves the current list; the next mount retries.
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const add = async () => {
    if (!wrong.trim() || !right.trim()) return;
    const result = await window.electronAPI?.addVocabCorrection?.(
      wrong.trim(),
      right.trim(),
    );
    if (result?.success) {
      setWrong("");
      setRight("");
      await reload();
    } else {
      toast.error(t("settings.general.vocabAddFailed", "添加失败"));
    }
  };

  // [20260908_Fix_240_Review] Uniform failure surface: the rate limiter
  // resolves {success:false} instead of rejecting, so EVERY mutation must
  // check the envelope or fail invisibly.
  const remove = async (target: string) => {
    const result = await window.electronAPI?.deleteVocabCorrection?.(target);
    if (!result?.success) {
      toast.error(t("settings.general.vocabAddFailed", "添加失败"));
      return;
    }
    await reload();
  };

  const clearAll = async () => {
    if (
      !window.confirm(
        t("settings.general.vocabClearConfirm", "确定清空全部修正词对吗？"),
      )
    ) {
      return;
    }
    const result = await window.electronAPI?.clearVocabCorrections?.();
    if (!result?.success) {
      toast.error(t("settings.general.vocabAddFailed", "添加失败"));
      return;
    }
    await reload();
  };

  return (
    <div data-testid="vocab-manager" className="space-y-3">
      <h3 className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
        {t("settings.general.vocabTitle", "修正表")}
      </h3>
      {/* Privacy disclosure: entries ship with polish requests. */}
      <p className="text-xs text-[#86868b]">
        {t(
          "settings.general.vocabPrivacy",
          "隐私说明：修正表内容会随润色请求发送至你所配置的 AI 服务商，用于纠正惯用错词；不会发送到其他任何地方。可随时在此编辑或清空。",
        )}
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          aria-label={t("rewrite.wrongWord", "错误词")}
          value={wrong}
          onChange={(e) => setWrong(e.target.value)}
          className="w-32 px-2 py-1 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-md bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        />
        <span className="text-[#86868b]">→</span>
        <input
          type="text"
          aria-label={t("rewrite.rightWord", "正确词")}
          value={right}
          onChange={(e) => setRight(e.target.value)}
          className="w-32 px-2 py-1 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-md bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        />
        <button
          type="button"
          data-testid="vocab-add"
          onClick={() => void add()}
          className="px-2 py-1 text-xs rounded-md bg-[#0071e3] text-white"
        >
          {t("settings.general.vocabAdd", "添加词对")}
        </button>
        <button
          type="button"
          data-testid="vocab-clear"
          onClick={() => void clearAll()}
          className="px-2 py-1 text-xs rounded-md border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#ff5f57]"
        >
          {t("settings.general.vocabClear", "清空全部")}
        </button>
      </div>
      <p className="text-xs text-[#86868b]">
        {t("settings.general.vocabCount", "{{count}} 条词对", {
          count: entries.length,
        })}
      </p>
      {entries.length === 0 ? (
        <p className="text-xs text-[#86868b]">
          {t("settings.general.vocabEmpty", "暂无修正词对")}
        </p>
      ) : (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {[...entries].reverse().map((e) => (
            <li
              key={e.wrong}
              className="flex items-center gap-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <span className="line-through text-[#86868b]">{e.wrong}</span>
              <span>→</span>
              <span>{e.right}</span>
              <button
                type="button"
                aria-label={t("settings.general.vocabDelete", "删除")}
                onClick={() => void remove(e.wrong)}
                className="ml-auto text-xs text-[#ff5f57]"
              >
                {t("settings.general.vocabDelete", "删除")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
