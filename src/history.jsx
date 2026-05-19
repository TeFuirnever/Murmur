import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
// 历史记录页面组件
// eslint-disable-next-line react-refresh/only-export-components
const HistoryPage = () => {
  const handleCopy = async (text) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.copyText(text);
        // 可以添加一个简单的提示
        const toast = document.createElement("div");
        toast.textContent = "文本已复制到剪贴板";
        toast.className =
          "fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50";
        document.body.appendChild(toast);
        setTimeout(() => {
          document.body.removeChild(toast);
        }, 2000);
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
      <div className="h-screen flex flex-col">
        {/* 标题栏 */}
        <div className="glass-effect flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2c2c2e] shadow-sm sticky top-0">
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]/80 text-heading">
              Murmur - 转录历史
            </h1>
          </div>
          <button
            onClick={handleClose}
            className="px-4 py-2 text-[#86868b] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]/80 hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
          >
            关闭窗口
          </button>
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
const HistoryContent = ({ onCopy }) => {
  const [transcriptions, setTranscriptions] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filteredTranscriptions, setFilteredTranscriptions] = React.useState(
    [],
  );

  // 加载转录历史
  const loadTranscriptions = async () => {
    if (!window.electronAPI) return;

    setLoading(true);
    try {
      const result = await window.electronAPI.getTranscriptions(100, 0);
      setTranscriptions(result || []);
      setFilteredTranscriptions(result || []);
    } catch (error) {
      console.error("加载历史记录失败:", error);
    } finally {
      setLoading(false);
    }
  };

  // 搜索功能
  React.useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTranscriptions(transcriptions);
    } else {
      const filtered = transcriptions.filter(
        (item) =>
          item.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.processed_text
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()),
      );
      setFilteredTranscriptions(filtered);
    }
  }, [searchQuery, transcriptions]);

  // 组件挂载时加载数据
  React.useEffect(() => {
    loadTranscriptions();
  }, []);

  // 删除转录记录
  const handleDelete = async (id) => {
    if (!window.electronAPI) return;

    try {
      await window.electronAPI.deleteTranscription(id);
      setTranscriptions((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      console.error("删除记录失败:", error);
    }
  };

  // 格式化日期
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
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
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#86868b] dark:text-[#86868b]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
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
              <svg
                className="w-12 h-12 text-[#86868b] dark:text-[#86868b] mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
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
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
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
                        <svg
                          className="w-4 h-4 text-[#86868b] dark:text-[#86868b]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                        title="删除记录"
                      >
                        <svg
                          className="w-4 h-4 text-red-500 dark:text-red-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
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
const root = createRoot(container);
root.render(<HistoryPage />);
