import * as React from "react";
import { X, Copy, Trash2, Search, Calendar, FileText } from "lucide-react";
import { toast } from "sonner";

interface TranscriptionItem {
  id: number;
  text?: string;
  raw_text?: string;
  processed_text?: string;
  confidence?: number;
  created_at: string;
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCopy?: (text: string) => Promise<void>;
}

const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose, onCopy }) => {
  const [transcriptions, setTranscriptions] = React.useState<TranscriptionItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filteredTranscriptions, setFilteredTranscriptions] = React.useState<TranscriptionItem[]>([]);

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
      toast.error("加载历史记录失败");
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

  // 当模态框打开时加载数据
  React.useEffect(() => {
    if (isOpen) {
      loadTranscriptions();
    }
  }, [isOpen]);

  // 删除转录记录
  const handleDelete = async (id: number) => {
    if (!window.electronAPI) return;

    try {
      await window.electronAPI.deleteTranscription(id);
      setTranscriptions((prev) => prev.filter((item) => item.id !== id));
      toast.success("记录已删除");
    } catch (error) {
      console.error("删除记录失败:", error);
      toast.error("删除记录失败");
    }
  };

  // 复制文本
  const handleCopy = async (text: string) => {
    try {
      if (onCopy) {
        await onCopy(text);
      } else if (window.electronAPI) {
        await window.electronAPI.copyText(text);
        toast.success("文本已复制到剪贴板");
      }
    } catch {
      toast.error("复制失败");
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#2c2c2e] rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="glass-effect flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <FileText className="w-6 h-6 text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80" />
            <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]/80 text-heading">
              转录历史
            </h2>
            <span className="bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#86868b] px-2 py-1 rounded-full text-sm">
              {filteredTranscriptions.length} 条记录
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#86868b]" />
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="p-6 border-b border-gray-100 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#86868b]" />
            <input
              type="text"
              placeholder="搜索转录内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-[#d2d2d7] dark:border-gray-600 bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-white rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent text-content"
            />
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0071e3]"></div>
              <span className="ml-3 text-[#86868b]">加载中...</span>
            </div>
          ) : filteredTranscriptions.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-[#86868b] mx-auto mb-4" />
              <p className="text-[#86868b] text-content">
                {searchQuery ? "没有找到匹配的记录" : "暂无转录历史"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTranscriptions.map((item) => (
                <div
                  key={item.id}
                  className="bg-[#f5f5f7] dark:bg-[#3a3a3c] rounded-lg p-4 hover:bg-[#e8e8ed] dark:hover:bg-[#48484a] transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-2 text-sm text-[#86868b]">
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
                        onClick={() =>
                          handleCopy(item.processed_text || item.text)
                        }
                        className="p-1 hover:bg-[#d2d2d7] dark:hover:bg-[#636366] rounded transition-colors"
                        title="复制文本"
                      >
                        <Copy className="w-4 h-4 text-[#86868b]" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                        title="删除记录"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>

                  {/* 原始文本 */}
                  {item.text && (
                    <div className="mb-3">
                      <h4 className="text-sm font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-1">
                        原始识别:
                      </h4>
                      <p className="text-[#1d1d1f] dark:text-[#f5f5f7]/80 text-content leading-relaxed bg-white dark:bg-[#2c2c2e] p-3 rounded border border-[#d2d2d7] dark:border-gray-600">
                        {item.text}
                      </p>
                    </div>
                  )}

                  {/* AI优化文本 */}
                  {item.processed_text && item.processed_text !== item.text && (
                    <div>
                      <h4 className="text-sm font-medium text-[#0071e3] dark:text-[#2997ff] mb-1">
                        AI优化:
                      </h4>
                      <p className="text-[#1d1d1f] dark:text-[#f5f5f7]/80 text-content leading-relaxed bg-[#e8f4fd] dark:bg-[#0a2540] p-3 rounded border border-[#b3d7f5] dark:border-[#1a3a5c]">
                        {item.processed_text}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        {filteredTranscriptions.length > 0 && (
          <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-b-xl">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#86868b]">
                共 {filteredTranscriptions.length} 条记录
              </p>
              <button
                onClick={() => {
                  if (window.electronAPI) {
                    window.electronAPI.exportTranscriptions("txt");
                    toast.success("导出功能已触发");
                  }
                }}
                className="px-4 py-2 bg-[#0071e3] text-white rounded-lg hover:bg-[#0077ed] transition-colors text-sm"
              >
                导出全部
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryModal;
