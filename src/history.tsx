import React from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
// [20260905_Fix_247_I18nMainHistory] Initialize i18n for the history window
// (main.tsx does it for the main window; each HTML entry must do its own).
import "./i18n";
import { useTranslation } from "react-i18next";
// [20260815_Refactor_ToasterWrapper] Route through the theme-aware wrapper
// (same as main.tsx / settings.tsx) instead of mounting sonner's raw Toaster.
import { Toaster } from "./components/ui/sonner";
// [20260816_Refactor_MinimalHistory] Inline hand-written SVGs replaced with
// lucide-react icons (the project icon library).
import { Search, FileText, Calendar, Copy, Trash2, Pencil } from "lucide-react";
import "./index.css";
import { assertElectronAPI } from "./bootstrap/assertElectronAPI.js";
import type { TranscriptionRecord } from "./types/ipc";

// [20260816_Refactor_RemoveEffects] The visual-effects layer (Aurora/BlurText
// via ogl+motion, the Sparkles header toggle, and the effects_enabled
// setting) was removed wholesale — a default-off decorative feature that cost
// two npm dependencies and a CI isolation gate.

// 历史记录页面组件
// eslint-disable-next-line react-refresh/only-export-components
const HistoryPage = () => {
  // [20260905_Fix_247_I18nMainHistory] All user-visible text routed through
  // i18n (issue #247: switching language only affected the settings window).
  const { t } = useTranslation();
  const handleCopy = async (text: string) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.copyText(text);
        // [20260815_Refactor_HistoryToast] Reuse sonner instead of hand-built
        // DOM toast (createElement/appendChild/setTimeout/removeChild). The
        // failure path stays console-only, matching the original behavior.
        toast.success(t("common.copiedToClipboard", "文本已复制到剪贴板"));
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch (error) {
      console.error("复制失败:", error);
    }
  };

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.closeHistoryWindow();
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#1c1c1e]">
      {/* 使用历史记录组件，但作为全屏页面而不是模态框 */}
      <div className="h-screen flex flex-col relative z-10">
        {/* 标题栏 */}
        <div className="glass-effect flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2c2c2e] shadow-sm sticky top-0">
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]/80 text-heading">
              {`Murmur - ${t("history.windowTitle", "转录历史")}`}
            </h1>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-[#86868b] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]/80 hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
            >
              {t("history.close", "关闭窗口")}
            </button>
          </div>
        </div>

        {/* 历史记录内容 */}
        <div className="flex-1 overflow-hidden">
          <HistoryContent onCopy={handleCopy} />
        </div>
      </div>
    </div>
  );
};

// 历史记录内容组件
// eslint-disable-next-line react-refresh/only-export-components
const HistoryContent = ({
  onCopy,
}: {
  onCopy: (text: string) => Promise<void>;
}) => {
  const { t, i18n } = useTranslation();
  const [transcriptions, setTranscriptions] = React.useState<
    TranscriptionRecord[]
  >([]);
  const [loading, setLoading] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  // [20260905_Fix_248_HistoryClearExport] Export format for the bulk export
  // (issue #248: the button was hardcoded to txt while the IPC handler
  // already supports txt/srt/vtt/md/docx via exportFormatters).
  const [exportFormat, setExportFormat] = React.useState("txt");

  // [20260906_Feat_ManualEditProtection] Spec #193 T2 (ticket #229): the
  // minimal manual edit-save entry (survey confirmed no edit UI existed).
  // One record at a time: editingId selects the card, editText holds the
  // draft, savingEdit debounces double submits. Saving routes through the
  // TRANSCRIPTION.UPDATE write-back channel with manually_edited=true so the
  // end-of-recording auto-polish can never overwrite this record.
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editText, setEditText] = React.useState("");
  const [savingEdit, setSavingEdit] = React.useState(false);

  // [20260815_Refactor_HistoryDerivedState] filteredTranscriptions was a
  // second useState synced by a useEffect — derivable state, now a useMemo.
  const filteredTranscriptions = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return transcriptions;
    return transcriptions.filter(
      (item) =>
        item.text?.toLowerCase().includes(query) ||
        item.processed_text?.toLowerCase().includes(query),
    );
  }, [transcriptions, searchQuery]);

  // 加载转录历史
  // [20260905_Fix_247_I18nMainHistory] useCallback so the mount effect below
  // can list it without re-fetching on every render (t is stable per language).
  const loadTranscriptions = React.useCallback(async () => {
    if (!window.electronAPI) return;

    setLoading(true);
    try {
      const result = await window.electronAPI.getTranscriptions(100, 0);
      setTranscriptions(result || []);
    } catch (error) {
      console.error("加载历史记录失败:", error);
      toast.error(t("history.loadFailed", "加载历史记录失败"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 组件挂载时加载数据
  React.useEffect(() => {
    loadTranscriptions();
  }, [loadTranscriptions]);

  // [20260905_Fix_249_ReviewMinor] Live language propagation: the settings
  // window broadcasts SETTINGS_UPDATE {key:"language"} through the main
  // process; this window follows immediately instead of at next start. The
  // broadcast carries only the KEY — the value lives in the settings DB,
  // read back via IPC.
  React.useEffect(() => {
    if (!window.electronAPI?.onSettingsUpdate) return;
    const unsub = window.electronAPI.onSettingsUpdate((data) => {
      if (data.key === "language") {
        window.electronAPI
          ?.getSetting?.("language", "zh-CN")
          .then((value) => {
            i18n.changeLanguage(
              typeof value === "string" && value ? value : "zh-CN",
            );
          })
          .catch(() => {
            // Broadcast raced window teardown — nothing to apply.
          });
      }
    });
    return unsub;
  }, [i18n]);

  // [20260905_Fix_247_LanguageOnMount] A freshly opened window boots with
  // the navigator language (i18n init has no async IPC available); the
  // user's persisted choice lives in the settings DB — apply it on mount so
  // an opened-later window matches the language the user picked.
  React.useEffect(() => {
    if (!window.electronAPI?.getSetting) return;
    window.electronAPI
      .getSetting("language", "zh-CN")
      .then((value) => {
        i18n.changeLanguage(
          typeof value === "string" && value ? value : "zh-CN",
        );
      })
      .catch(() => {
        // Settings read raced window teardown — keep navigator language.
      });
  }, [i18n]);

  // [20260905_Fix_248_HistoryClearExport] Bulk export with a user-chosen
  // format; the main-process handler resolves the formatter and the save
  // dialog. Cancelled dialogs stay silent.
  const handleExportAll = async () => {
    if (!window.electronAPI) return;
    try {
      const result =
        await window.electronAPI.exportTranscriptions(exportFormat);
      if (result.success) {
        toast.success(t("history.exportSuccess", "导出成功"));
      } else if (!result.canceled) {
        toast.error(t("history.exportFailed", "导出失败"));
      }
    } catch (error) {
      console.error("导出失败:", error);
      toast.error(t("history.exportFailed", "导出失败"));
    }
  };

  // [20260905_Fix_248_HistoryClearExport] Clear-all entry (issue #248): the
  // CLEAR IPC chain was fully wired (preload → handler → databaseManager)
  // with no UI. Destructive — gated behind a native confirm dialog, then the
  // list resets to the empty state.
  const handleClearAll = async () => {
    if (!window.electronAPI) return;
    if (
      !window.confirm(t("history.clearConfirm", "确定清空所有转录记录吗？"))
    ) {
      return;
    }
    try {
      const result = await window.electronAPI.clearAllTranscriptions();
      if (result.success) {
        toast.success(t("history.clearSuccess", "已清空所有转录记录"));
        setTranscriptions([]);
      } else {
        toast.error(t("history.clearFailed", "清空失败"));
      }
    } catch (error) {
      console.error("清空失败:", error);
      toast.error(t("history.clearFailed", "清空失败"));
    }
  };

  // 删除转录记录
  const handleDelete = async (id: number) => {
    if (!window.electronAPI) return;

    try {
      await window.electronAPI.deleteTranscription(id);
      setTranscriptions((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      console.error("删除记录失败:", error);
      toast.error(t("history.deleteFailed", "删除记录失败"));
    }
  };

  // [20260906_Feat_ManualEditProtection] Open the inline editor pre-filled
  // with the record's current final text.
  const handleEditStart = (id: number, text: string) => {
    setEditingId(id);
    setEditText(text);
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditText("");
  };

  // [20260906_Feat_ManualEditProtection] Persist the edit: text AND
  // processed_text carry the new final content (same two-column rule as the
  // T1 polish write-back, so the copy button and the result cards stay
  // consistent); manually_edited=true marks the record so the auto-polish
  // write-back path skips it forever. raw_text is NOT in the UPDATE
  // whitelist and always keeps the original ASR output. A blank edit is
  // refused client-side — the DB would otherwise accept an empty overwrite.
  const handleEditSave = async (id: number) => {
    if (!window.electronAPI?.updateTranscription) return;
    const trimmed = editText.trim();
    if (!trimmed) return;

    setSavingEdit(true);
    try {
      const result = await window.electronAPI.updateTranscription(id, {
        text: trimmed,
        processed_text: trimmed,
        manually_edited: true,
      });
      if (result?.success) {
        setTranscriptions((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  text: result.text ?? trimmed,
                  processed_text: result.processed_text ?? trimmed,
                  // [20260906_Feat_ManualEditProtection_Review] keep the
                  // local flag in sync so a future badge doesn't go stale
                  manually_edited: true,
                }
              : item,
          ),
        );
        handleEditCancel();
        toast.success(t("history.editSaved", "记录已更新"));
      } else {
        toast.error(t("history.editFailed", "更新记录失败"));
      }
    } catch (error) {
      console.error("更新记录失败:", error);
      toast.error(t("history.editFailed", "更新记录失败"));
    } finally {
      setSavingEdit(false);
    }
  };

  // 格式化日期
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    // [20260905_Fix_247_I18nMainHistory] Relative-day labels and locale-aware
    // time formatting follow the active i18n language, not hardcoded zh-CN.
    const time = date.toLocaleTimeString(i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (diffDays === 1) {
      return t("history.today", "今天 {{time}}", { time });
    } else if (diffDays === 2) {
      return t("history.yesterday", "昨天 {{time}}", { time });
    } else if (diffDays <= 7) {
      return t("history.daysAgo", "{{days}}天前", { days: diffDays - 1 });
    } else {
      return date.toLocaleDateString(i18n.language, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 搜索栏 */}
      <div className="p-6 bg-white dark:bg-[#2c2c2e] border-b border-gray-100 dark:border-gray-700">
        <div className="max-w-4xl mx-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#86868b] dark:text-[#86868b]" />
            <input
              type="text"
              placeholder={t("history.searchPlaceholder", "搜索转录内容...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-[#d2d2d7] dark:border-gray-600 bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-white rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent text-content text-lg"
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-[#86868b] dark:text-[#86868b]">
              {t("history.recordCount", "共 {{total}} 条记录", {
                total: filteredTranscriptions.length,
              })}
            </span>
            {/* [20260905_Fix_248_HistoryClearExport] Format selector + export
                (handler-supported formats), and the clear-all entry gated by
                a confirm dialog. */}
            <div className="flex items-center gap-2">
              <select
                data-testid="export-format"
                aria-label={t("history.formatLabel", "导出格式")}
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
                className="px-3 py-2 text-sm border border-[#d2d2d7] dark:border-gray-600 bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-white rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent"
              >
                <option value="txt">TXT</option>
                <option value="srt">SRT</option>
                <option value="vtt">VTT</option>
                <option value="md">Markdown</option>
                <option value="docx">DOCX</option>
              </select>
              <button
                data-testid="export-all"
                onClick={handleExportAll}
                className="px-4 py-2 bg-[#0071e3] hover:bg-[#0077ed] dark:bg-[#0071e3] dark:hover:bg-[#0077ed] text-white rounded-lg transition-colors text-sm"
              >
                {t("history.exportAll", "导出全部")}
              </button>
              <button
                data-testid="clear-all"
                onClick={handleClearAll}
                className="px-4 py-2 text-sm border border-[#d2d2d7] dark:border-gray-600 text-[#86868b] hover:text-red-500 hover:border-red-300 dark:hover:border-red-500/50 rounded-lg transition-colors"
              >
                {t("history.clear", "清空所有")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0071e3]"></div>
              <span className="ml-3 text-[#86868b] dark:text-[#86868b]">
                {t("common.loading", "加载中...")}
              </span>
            </div>
          ) : filteredTranscriptions.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-[#86868b] dark:text-[#86868b] mx-auto mb-4" />
              <p className="text-[#86868b] dark:text-[#86868b] text-content text-lg">
                {searchQuery
                  ? t("history.noMatch", "没有找到匹配的记录")
                  : t("history.emptyHistory", "暂无转录历史")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTranscriptions.map((item) => (
                <div
                  key={item.id}
                  className="bg-white dark:bg-[#2c2c2e] rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3 text-sm text-[#86868b] dark:text-[#86868b]">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(item.created_at)}</span>
                      {item.confidence && (
                        <span className="bg-blue-100 dark:bg-blue-900/50 text-[#0071e3] dark:text-[#2997ff] px-2 py-1 rounded text-xs">
                          {t("history.confidence", "置信度: {{value}}%", {
                            value: Math.round(item.confidence * 100),
                          })}
                        </span>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      {/* [20260906_Feat_ManualEditProtection] Inline edit
                          entry — hidden while this card's editor is open. */}
                      {editingId !== item.id && (
                        <button
                          onClick={() => handleEditStart(item.id, item.text)}
                          className="p-2 hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
                          title={t("history.editTooltip", "编辑记录")}
                          aria-label={t("history.editTooltip", "编辑记录")}
                        >
                          <Pencil className="w-4 h-4 text-[#86868b] dark:text-[#86868b]" />
                        </button>
                      )}
                      <button
                        onClick={() => onCopy(item.processed_text || item.text)}
                        className="p-2 hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
                        title={t("history.copyTooltip", "复制文本")}
                      >
                        <Copy className="w-4 h-4 text-[#86868b] dark:text-[#86868b]" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        title={t("history.deleteTooltip", "删除记录")}
                      >
                        <Trash2 className="w-4 h-4 text-red-500 dark:text-red-400" />
                      </button>
                    </div>
                  </div>

                  {/* 最终文本 */}
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-2">
                      {t("history.finalResult", "最终结果:")}
                    </h4>
                    {/* [20260906_Feat_ManualEditProtection] While editing,
                        the final-text block becomes the inline editor: a
                        textarea plus save/cancel. Save is disabled for a
                        blank draft so the record can never be overwritten
                        with empty text. */}
                    {editingId === item.id ? (
                      <div className="space-y-2">
                        <textarea
                          data-testid="edit-textarea"
                          aria-label={t("history.editTooltip", "编辑记录")}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={4}
                          className="w-full text-content leading-relaxed bg-[#f5f5f7] dark:bg-[#3a3a3c] p-4 rounded-lg border border-[#0071e3] dark:border-[#2997ff] focus:ring-2 focus:ring-[#0071e3] focus:border-transparent resize-y"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            data-testid="edit-cancel"
                            onClick={handleEditCancel}
                            className="px-4 py-2 text-sm text-[#86868b] dark:text-[#86868b] hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
                          >
                            {t("history.editCancel", "取消")}
                          </button>
                          <button
                            data-testid="edit-save"
                            disabled={savingEdit || !editText.trim()}
                            onClick={() => handleEditSave(item.id)}
                            className="px-4 py-2 text-sm bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t("history.editSave", "保存")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-content leading-relaxed bg-[#f5f5f7] dark:bg-[#3a3a3c] p-4 rounded-lg border dark:border-gray-600/30">
                        {item.text}
                      </p>
                    )}
                  </div>

                  {/* AI优化文本 */}
                  {item.processed_text &&
                    item.processed_text.trim() !==
                      (item.raw_text || "").trim() && (
                      <div className="mb-4">
                        <h4 className="text-sm font-medium text-[#0071e3] dark:text-[#2997ff] mb-2">
                          {t("history.aiOptimized", "AI优化:")}
                        </h4>
                        <p className="text-content leading-relaxed bg-[#e8f4fd] dark:bg-[#0a2540] p-4 rounded-lg border border-[#b3d7f5] dark:border-[#1a3a5c]">
                          {item.processed_text}
                        </p>
                      </div>
                    )}

                  {/* 原始识别文本 */}
                  {item.raw_text &&
                    item.raw_text.trim() !== item.text.trim() && (
                      <div>
                        <h4 className="text-sm font-medium text-[#86868b] dark:text-[#86868b] mb-2">
                          {t("history.rawRecognition", "原始识别:")}
                        </h4>
                        <p className="text-xs text-content leading-relaxed bg-[#f5f5f7] dark:bg-[#3a3a3c] p-3 rounded-lg border dark:border-gray-600/20 text-[#86868b] dark:text-[#f5f5f7]/80">
                          {item.raw_text}
                        </p>
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 渲染应用
const container = document.getElementById("history-root");
if (container && assertElectronAPI()) {
  const root = createRoot(container);
  root.render(
    <React.Fragment>
      <HistoryPage />
      <Toaster position="top-right" />
    </React.Fragment>,
  );
}
