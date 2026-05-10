import React from "react";

/**
 * 格式化毫秒为 M:SS 格式
 */
function formatMs(ms) {
  if (!ms && ms !== 0) return "--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const PHASES = [
  { key: "vad", label: "语音检测" },
  { key: "asr", label: "语音识别" },
  { key: "punc", label: "标点恢复" },
];

/**
 * 转录进度指示器组件
 * 显示阶段进度和取消按钮
 */
export default function TranscriptionProgress({
  phase,
  message,
  processedMs,
  totalMs,
  onCancel,
}) {
  const currentPhaseIndex = PHASES.findIndex((p) => p.key === phase);

  return (
    <div className="bg-slate-50 dark:bg-gray-800 rounded-xl p-6 border border-slate-200 dark:border-gray-700">
      {/* 阶段指示器 */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {PHASES.map((p, index) => {
          const isCompleted = currentPhaseIndex > index;
          const isCurrent = currentPhaseIndex === index;
          const isPending = currentPhaseIndex < index;

          return (
            <React.Fragment key={p.key}>
              {index > 0 && (
                <div
                  className={`w-8 h-0.5 ${
                    isCompleted
                      ? "bg-blue-500"
                      : "bg-slate-200 dark:bg-gray-600"
                  }`}
                />
              )}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`w-3 h-3 rounded-full ${
                    isCompleted
                      ? "bg-blue-500"
                      : isCurrent
                        ? "bg-blue-500 animate-pulse"
                        : "bg-slate-200 dark:bg-gray-600"
                  }`}
                />
                <span
                  className={`text-xs font-medium ${
                    isCompleted
                      ? "text-blue-600 dark:text-blue-400"
                      : isCurrent
                        ? "text-gray-900 dark:text-gray-100"
                        : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  {p.label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* 旋转加载图标 + 状态消息 */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <svg
          className="w-5 h-5 text-blue-500 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <span className="text-sm text-gray-700 dark:text-gray-300 status-text">
          {message || "正在处理..."}
        </span>
      </div>

      {/* ASR阶段时间进度 */}
      {phase === "asr" && totalMs > 0 && (
        <div className="text-center mb-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            已处理 {formatMs(processedMs)} / {formatMs(totalMs)}
          </span>
          <div className="w-full h-1.5 bg-slate-200 dark:bg-gray-600 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{
                width: `${totalMs > 0 ? Math.min((processedMs / totalMs) * 100, 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 取消按钮 */}
      <div className="flex justify-center">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors border border-red-200 dark:border-red-800"
        >
          取消转录
        </button>
      </div>
    </div>
  );
}
