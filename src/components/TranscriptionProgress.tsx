import React from "react";

interface TranscriptionProgressProps {
  phase?: string;
  message?: string;
  totalMs?: number;
  progressPct?: number;
  onCancel: () => void;
  fileName?: string;
}

function formatMs(ms?: number): string {
  if (!ms && ms !== 0) return "--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const PHASE_LABELS: Record<string, string> = {
  convert: "格式转换中",
  vad: "语音检测中",
  asr: "语音识别中",
  punc: "标点恢复中",
};

function estimateRemaining(
  progressPct?: number,
  elapsedMs?: number,
): string | null {
  if (!progressPct || progressPct < 5 || !elapsedMs || elapsedMs < 2000)
    return null;
  const totalEstimated = elapsedMs / (progressPct / 100);
  const remaining = totalEstimated - elapsedMs;
  if (remaining < 5000) return "即将完成";
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  if (mins > 0) return `预计 ${mins}分${secs}秒`;
  return `预计 ${secs}秒`;
}

export default function TranscriptionProgress({
  phase,
  message,
  totalMs,
  progressPct,
  onCancel,
  fileName,
}: TranscriptionProgressProps) {
  const isDone = phase === "done";

  const phaseLabel = PHASE_LABELS[phase || ""] || message || "正在处理...";

  const pct = isDone ? 100 : (progressPct ?? -1);

  const [elapsedStart] = React.useState(() => Date.now());
  const [eta, setEta] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isDone || pct < 0) return;
    const timer = setInterval(() => {
      const elapsed = Date.now() - elapsedStart;
      setEta(estimateRemaining(pct, elapsed));
    }, 1000);
    return () => clearInterval(timer);
  }, [isDone, pct, elapsedStart]);

  return (
    <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl p-6 border border-[#d2d2d7] dark:border-[#383838]">
      {/* 文件名上下文 */}
      {fileName && (
        <p className="text-xs text-[#86868b] text-center mb-4 truncate max-w-full">
          {fileName}
        </p>
      )}

      {/* spinner + 阶段文字 */}
      <div className="flex items-center justify-center gap-2.5 mb-5">
        {isDone ? (
          <svg
            className="w-5 h-5 text-[#30d158]"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        ) : (
          <svg
            className="w-4 h-4 text-[#0071e3] animate-spin"
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
        )}
        <span
          className={`text-sm font-medium ${isDone ? "text-[#30d158]" : "text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80"}`}
        >
          {isDone ? "转录完成" : phaseLabel}
        </span>
      </div>

      {/* 进度条 */}
      {pct >= 0 ? (
        <div className="mb-4">
          <div className="w-full h-1.5 bg-[#e8e8ed] dark:bg-[#383838] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out ${isDone ? "bg-[#30d158]" : "bg-[#0071e3]"}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-xs text-[#86868b]">
              {phase === "asr" && (totalMs ?? 0) > 0
                ? `音频时长 ${formatMs(totalMs)}`
                : ""}
            </span>
            <span className="text-xs text-[#86868b]">
              {!isDone && eta ? eta : ""}
            </span>
          </div>
        </div>
      ) : (
        phase === "asr" &&
        (totalMs ?? 0) > 0 && (
          <div className="mb-4">
            <div className="flex justify-between">
              <span className="text-xs text-[#86868b]">
                音频时长 {formatMs(totalMs)}
              </span>
            </div>
            <div className="w-full h-1.5 bg-[#e8e8ed] dark:bg-[#383838] rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-[#0071e3] rounded-full animate-indeterminate" />
            </div>
          </div>
        )
      )}

      {/* 取消按钮 */}
      {!isDone && (
        <div className="flex justify-center">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm font-medium text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded-lg transition-colors border border-[#ff3b30]/40"
          >
            取消转录
          </button>
        </div>
      )}
    </div>
  );
}
