// [20260910_Feat_237_StreamDegradation] Spec #193 T10 (ticket #237):
// settings-page view of the stream-degradation memory — gateways that
// proved unable to stream are listed (normalized base_url + when), and the
// whole memory can be reset. Read-only otherwise: entries are written by
// the polish pipeline, never edited by hand.
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface DegradationEntry {
  baseUrl: string;
  at: number;
}

export const StreamDegradationManager: React.FC = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = React.useState<DegradationEntry[]>([]);

  const reload = React.useCallback(async () => {
    if (!window.electronAPI?.listStreamDegradations) return;
    try {
      const result = await window.electronAPI.listStreamDegradations();
      if (result.success) setEntries(result.entries);
    } catch {
      // Bridge failure leaves the current list; the next mount retries.
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const reset = async () => {
    if (
      !window.confirm(
        t(
          "settings.general.streamDegradationResetConfirm",
          "确定重置全部流式降级记忆吗？",
        ),
      )
    ) {
      return;
    }
    try {
      const result = await window.electronAPI?.resetStreamDegradations?.();
      if (!result?.success) {
        toast.error(
          t("settings.general.streamDegradationResetFailed", "重置失败"),
        );
        return;
      }
    } catch {
      toast.error(
        t("settings.general.streamDegradationResetFailed", "重置失败"),
      );
      return;
    }
    await reload();
  };

  return (
    <div data-testid="stream-degradation-manager" className="space-y-3">
      <h3 className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
        {t("settings.general.streamDegradationTitle", "流式降级记忆")}
      </h3>
      <p className="text-xs text-[#86868b]">
        {t(
          "settings.general.streamDegradationHint",
          "当某个 AI 网关不支持流式响应时，Murmur 会记住它，之后直接发送整段请求，不再每次先失败一次。本地地址不会被记录。",
        )}
      </p>
      <div className="flex items-center gap-2">
        <p className="text-xs text-[#86868b]">
          {t("settings.general.streamDegradationCount", "{{count}} 个网关", {
            count: entries.length,
          })}
        </p>
        {entries.length > 0 && (
          <button
            type="button"
            data-testid="stream-degradation-reset"
            onClick={() => void reset()}
            className="px-2 py-1 text-xs rounded-md border border-[#d2d2d7] dark:border-[#3a3a3c] text-[#ff5f57]"
          >
            {t("settings.general.streamDegradationReset", "重置")}
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p
          data-testid="stream-degradation-empty"
          className="text-xs text-[#86868b]"
        >
          {t("settings.general.streamDegradationEmpty", "暂无记录")}
        </p>
      ) : (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {entries.map((entry) => (
            <li
              key={entry.baseUrl}
              className="flex items-center gap-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <span className="font-mono text-xs">{entry.baseUrl}</span>
              <span className="text-xs text-[#86868b]">
                {new Date(entry.at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
// [20260910_Feat_237_StreamDegradation] END
