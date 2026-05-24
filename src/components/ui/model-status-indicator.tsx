import * as React from "react";
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  Download,
  Clock,
} from "lucide-react";

interface ModelProgress {
  progress: number;
  status: "waiting" | "downloading" | "completed" | "error";
}

interface ModelStatus {
  stage: string;
  isDownloading?: boolean;
  isLoading?: boolean;
  downloadProgress?: number;
  progress?: number;
  error?: string;
  modelProgress?: Record<string, ModelProgress>;
}

interface ModelStatusIndicatorProps {
  modelStatus: ModelStatus;
  className?: string;
  onDownload?: (() => void) | null;
}

export const ModelStatusIndicator: React.FC<ModelStatusIndicatorProps> = ({
  modelStatus,
  className = "",
  onDownload = null,
}) => {
  const getStatusIcon = () => {
    switch (modelStatus.stage) {
      case "checking":
        return (
          <Loader2 className="w-4 h-4 animate-spin text-[#0071e3] model-loading" />
        );
      case "need_download":
        return <Download className="w-4 h-4 text-orange-500" />;
      case "downloading":
        return (
          <Loader2 className="w-4 h-4 animate-spin text-[#0071e3] model-downloading" />
        );
      case "loading":
        return <Clock className="w-4 h-4 text-[#0071e3] model-loading" />;
      case "ready":
        return <CheckCircle className="w-4 h-4 text-[#34c759] model-ready" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-[#ff3b30] model-error" />;
      default:
        return <Download className="w-4 h-4 text-[#86868b]" />;
    }
  };

  const getStatusText = () => {
    switch (modelStatus.stage) {
      case "checking":
        return "检查语音模型...";
      case "need_download":
        return "需要下载语音模型";
      case "downloading":
        return "正在下载语音模型...";
      case "loading":
        return "语音模型加载中...";
      case "ready":
        return "语音识别就绪";
      case "error":
        return "语音识别错误";
      default:
        return "语音模型状态未知";
    }
  };

  const getStatusColor = () => {
    switch (modelStatus.stage) {
      case "checking":
      case "downloading":
      case "loading":
        return "text-[#0071e3]";
      case "need_download":
        return "text-orange-600";
      case "ready":
        return "text-[#34c759]";
      case "error":
        return "text-[#ff3b30]";
      default:
        return "text-[#86868b]";
    }
  };

  const getProgressText = () => {
    if (modelStatus.isDownloading && (modelStatus.downloadProgress ?? 0) > 0) {
      return `${modelStatus.downloadProgress}%`;
    }
    if (modelStatus.isLoading && (modelStatus.progress ?? 0) > 0) {
      return `${modelStatus.progress}%`;
    }
    return null;
  };

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      {getStatusIcon()}
      <span className={`text-sm font-medium ${getStatusColor()}`}>
        {getStatusText()}
      </span>
      {getProgressText() && (
        <span className="text-xs text-[#86868b]">({getProgressText()})</span>
      )}
      {modelStatus.stage === "need_download" && onDownload && (
        <button
          onClick={onDownload}
          className="ml-2 px-2 py-1 text-xs bg-[#0071e3] text-white rounded hover:bg-[#0077ed] transition-colors"
        >
          下载
        </button>
      )}
    </div>
  );
};

/**
 * 简化的模型状态图标组件
 * 仅显示图标，用于空间受限的地方
 */
interface ModelStatusIconProps {
  modelStatus: ModelStatus;
  size?: string;
  showTooltip?: boolean;
}

export const ModelStatusIcon: React.FC<ModelStatusIconProps> = ({
  modelStatus,
  size = "w-5 h-5",
  showTooltip = true,
}) => {
  const getStatusIcon = () => {
    switch (modelStatus.stage) {
      case "checking":
        return (
          <Loader2
            className={`${size} animate-spin text-[#0071e3] model-loading`}
          />
        );
      case "need_download":
        return <Download className={`${size} text-orange-500`} />;
      case "downloading":
        return (
          <Loader2
            className={`${size} animate-spin text-[#0071e3] model-downloading`}
          />
        );
      case "loading":
        return <Clock className={`${size} text-[#0071e3] model-loading`} />;
      case "ready":
        return <CheckCircle className={`${size} text-[#34c759] model-ready`} />;
      case "error":
        return <AlertCircle className={`${size} text-[#ff3b30] model-error`} />;
      default:
        return <Download className={`${size} text-[#86868b]`} />;
    }
  };

  const getTooltipText = () => {
    switch (modelStatus.stage) {
      case "checking":
        return "🔍 正在检查语音模型状态...";
      case "need_download":
        return "📥 需要下载语音识别模型（约1.1GB）";
      case "downloading":
        return `⬇️ 正在下载语音模型... ${modelStatus.downloadProgress || 0}%`;
      case "loading":
        return "🎙️ 语音模型加载中，请稍候...";
      case "ready":
        return "✅ 语音识别就绪，可以开始录音";
      case "error":
        return `❌ 语音识别错误: ${modelStatus.error || "未知错误"}`;
      default:
        return "⏳ 语音模型状态未知";
    }
  };

  const icon = getStatusIcon();

  if (!showTooltip) {
    return icon;
  }

  return (
    <div className="relative group">
      {icon}
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-white model-status-tooltip rounded-lg whitespace-nowrap z-10 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none">
        <span className="text-xs font-medium">{getTooltipText()}</span>
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-black/85"></div>
      </div>
    </div>
  );
};

/**
 * 模型下载进度组件
 * 显示详细的下载进度信息
 */
interface ModelDownloadProgressProps {
  modelStatus: ModelStatus;
  onDownload?: () => void;
  onCancel?: () => void;
}

export const ModelDownloadProgress: React.FC<ModelDownloadProgressProps> = ({
  modelStatus,
  onDownload,
  onCancel,
}) => {
  if (modelStatus.stage === "need_download") {
    return (
      <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Download className="w-5 h-5 text-orange-500" />
            <div>
              <h3 className="text-sm font-medium text-orange-800 dark:text-orange-200">
                需要下载语音识别模型
              </h3>
              <p className="text-xs text-orange-600 dark:text-orange-300">
                首次使用需下载约1.1GB的本地语音模型（FunASR）
              </p>
            </div>
          </div>
          <button
            onClick={onDownload}
            disabled={modelStatus.isDownloading}
            className={`px-4 py-2 text-white rounded-lg transition-colors text-sm font-medium ${
              modelStatus.isDownloading
                ? "bg-[#86868b] cursor-not-allowed"
                : "bg-orange-500 hover:bg-orange-600"
            }`}
          >
            {modelStatus.isDownloading ? "准备下载..." : "开始下载"}
          </button>
        </div>
      </div>
    );
  }

  if (modelStatus.stage === "downloading") {
    const models = modelStatus.modelProgress
      ? [
          { key: "asr", label: "ASR 语音识别", size: "840MB" },
          { key: "vad", label: "VAD 语音检测", size: "1.6MB" },
          { key: "punc", label: "标点恢复", size: "278MB" },
        ]
      : [];

    return (
      <div className="bg-[#0071e3]/5 dark:bg-[#0071e3]/10 border border-[#0071e3]/20 dark:border-[#0071e3]/30 rounded-lg p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Loader2 className="w-5 h-5 animate-spin text-[#0071e3]" />
              <div>
                <h3 className="text-sm font-medium text-[#0071e3] dark:text-[#0071e3]">
                  正在下载模型文件
                </h3>
                <p className="text-xs text-[#0071e3]/80 dark:text-[#0071e3]/70">
                  请保持网络连接，下载可能需要几分钟
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="px-3 py-1 text-xs text-[#0071e3] hover:text-[#0071e3]/80 transition-colors"
                >
                  取消
                </button>
              )}
              <span className="text-sm font-medium text-[#0071e3]">
                {modelStatus.downloadProgress || 0}%
              </span>
            </div>
          </div>

          {/* 总进度条 */}
          <div className="w-full bg-[#0071e3]/20 dark:bg-[#0071e3]/30 rounded-full h-2">
            <div
              className="bg-[#0071e3] h-2 rounded-full transition-all duration-300"
              style={{ width: `${modelStatus.downloadProgress || 0}%` }}
            />
          </div>

          {/* 每个模型的进度 */}
          {modelStatus.modelProgress && (
            <div className="space-y-2 mt-2">
              {models.map((m) => {
                const mp = modelStatus.modelProgress![m.key];
                if (!mp) return null;
                const done = mp.status === "completed";
                return (
                  <div key={m.key} className="flex items-center gap-2 text-xs">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        done
                          ? "model-done bg-[#34c759]"
                          : mp.status === "downloading"
                            ? "bg-[#0071e3] animate-pulse"
                            : "bg-[#86868b]/40"
                      }`}
                    />
                    <span className="text-[#1d1d1f]/70 dark:text-[#f5f5f7]/70 min-w-[100px]">
                      {m.label}
                    </span>
                    <div className="flex-1 bg-[#0071e3]/10 dark:bg-[#0071e3]/15 rounded-full h-1">
                      <div
                        className={`h-1 rounded-full transition-all duration-300 ${
                          done ? "bg-[#34c759]" : "bg-[#0071e3]"
                        }`}
                        style={{ width: `${mp.progress}%` }}
                      />
                    </div>
                    <span className="text-[#86868b] dark:text-[#98989d] w-10 text-right">
                      {done ? "✓" : `${mp.progress}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};
