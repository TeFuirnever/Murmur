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
    <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl p-6 border border-[#d2d2d7] dark:border-[#383838]">
      {/* 阶段指示器 */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {PHASES.map((p, index) => {
          const isCompleted = currentPhaseIndex > index;
          const isCurrent = currentPhaseIndex === index;

          return (
            <React.Fragment key={p.key}>
              {index > 0 && (
                <div
                  className={`w-8 h-0.5 ${
                    isCompleted
                      ? "bg-[#0071e3]"
                      : "bg-[#e8e8ed] dark:bg-[#383838]"
                  }`}
                />
              )}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`w-3 h-3 rounded-full ${
                    isCompleted
                      ? "bg-[#0071e3]"
                      : isCurrent
                        ? "bg-[#0071e3] animate-pulse"
                        : "bg-[#d2d2d7] dark:bg-[#383838]"
                  }`}
                />
                <span
                  className={`text-xs font-medium ${
                    isCompleted
                      ? "text-[#0071e3]"
                      : isCurrent
                        ? "text-[#1d1d1f] dark:text-[#f5f5f7]"
                        : "text-[#86868b]"
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
          className="w-5 h-5 text-[#0071e3] animate-spin"
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
        <span className="text-sm text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 text-content">
          {message || "正在处理..."}
        </span>
      </div>

      {/* ASR阶段时间进度 */}
      {phase === "asr" && totalMs > 0 && (
        <div className="text-center mb-4">
          <span className="text-sm text-[#86868b]">
            已处理 {formatMs(processedMs)} / {formatMs(totalMs)}
          </span>
          <div className="w-full h-1.5 bg-[#e8e8ed] dark:bg-[#383838] rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-[#0071e3] rounded-full transition-all duration-300"
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
          className="px-4 py-1.5 text-sm font-medium text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded-lg transition-colors border border-[#ff3b30]/40"
        >
          取消转录
        </button>
      </div>
    </div>
  );
}
