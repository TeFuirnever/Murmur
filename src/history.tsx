import React from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
// [20260815_Refactor_ToasterWrapper] Route through the theme-aware wrapper
// (same as main.tsx / settings.tsx) instead of mounting sonner's raw Toaster.
import { Toaster } from "./components/ui/sonner";
// [20260816_Refactor_MinimalHistory] Inline hand-written SVGs replaced with
// lucide-react icons (the project icon library).
import { Search, FileText, Calendar, Copy, Trash2 } from "lucide-react";
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
  const handleCopy = async (text: string) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.copyText(text);
        // [20260815_Refactor_HistoryToast] Reuse sonner instead of hand-built
        // DOM toast (createElement/appendChild/setTimeout/removeChild). The
        // failure path stays console-only, matching the original behavior.
        toast.success("文本已复制到剪贴板");
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
              Murmur - 转录历史
            </h1>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-[#86868b] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]/80 hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
            >
              关闭窗口
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
  const [transcriptions, setTranscriptions] = React.useState<
    TranscriptionRecord[]
  >([]);
  const [loading, setLoading] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");

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
  const loadTranscriptions = async () => {
    if (!window.electronAPI) return;

    setLoading(true);
    try {
      const result = await window.electronAPI.getTranscriptions(100, 0);
      setTranscriptions(result || []);
    } catch (error) {
      console.error("加载历史记录失败:", error);
      toast.error("加载历史记录失败");
    } finally {
      setLoading(false);
    }
  };

  // 组件挂载时加载数据
  React.useEffect(() => {
    loadTranscriptions();
  }, []);

  // 删除转录记录
  const handleDelete = async (id: number) => {
    if (!window.electronAPI) return;

    try {
      await window.electronAPI.deleteTranscription(id);
      setTranscriptions((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      console.error("删除记录失败:", error);
      toast.error("删除记录失败");
    }
  };

  // 格式化日期
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    } else if (diffDays === 2) {
      return `昨天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    } else if (diffDays <= 7) {
      return `${diffDays - 1}天前`;
    } else {
      return date.toLocaleDateString("zh-CN", {
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
              placeholder="搜索转录内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-[#d2d2d7] dark:border-gray-600 bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-white rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent text-content text-lg"
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-[#86868b] dark:text-[#86868b]">
              共 {filteredTranscriptions.length} 条记录
            </span>
            <button
              onClick={() => {
                if (window.electronAPI) {
                  window.electronAPI.exportTranscriptions("txt");
                }
              }}
              className="px-4 py-2 bg-[#0071e3] hover:bg-[#0077ed] dark:bg-[#0071e3] dark:hover:bg-[#0077ed] text-white rounded-lg transition-colors text-sm"
            >
              导出全部
            </button>
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
                加载中...
              </span>
            </div>
          ) : filteredTranscriptions.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-[#86868b] dark:text-[#86868b] mx-auto mb-4" />
              <p className="text-[#86868b] dark:text-[#86868b] text-content text-lg">
                {searchQuery ? "没有找到匹配的记录" : "暂无转录历史"}
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
                          置信度: {Math.round(item.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => onCopy(item.processed_text || item.text)}
                        className="p-2 hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
                        title="复制文本"
                      >
                        <Copy className="w-4 h-4 text-[#86868b] dark:text-[#86868b]" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        title="删除记录"
                      >
                        <Trash2 className="w-4 h-4 text-red-500 dark:text-red-400" />
                      </button>
                    </div>
                  </div>

                  {/* 最终文本 */}
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-2">
                      最终结果:
                    </h4>
                    <p className="text-content leading-relaxed bg-[#f5f5f7] dark:bg-[#3a3a3c] p-4 rounded-lg border dark:border-gray-600/30">
                      {item.text}
                    </p>
                  </div>

                  {/* AI优化文本 */}
                  {item.processed_text &&
                    item.processed_text.trim() !==
                      (item.raw_text || "").trim() && (
                      <div className="mb-4">
                        <h4 className="text-sm font-medium text-[#0071e3] dark:text-[#2997ff] mb-2">
                          AI优化:
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
                          原始识别:
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
