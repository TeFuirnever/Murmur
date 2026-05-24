import { useFileTranscription } from "../hooks/useFileTranscription";
import FileDropZone from "./FileDropZone";
import TranscriptionProgress from "./TranscriptionProgress";
import TranscriptionResult from "./TranscriptionResult";

export default function FileImport() {
  const {
    state,
    fileInfo,
    progress,
    result,
    error,
    selectFile,
    selectFileFromPath,
    startTranscription,
    cancelTranscription,
    reset,
  } = useFileTranscription();

  if (state === "idle" || state === "selected") {
    return (
      <div className="space-y-4">
        <FileDropZone fileInfo={fileInfo} onSelectFile={selectFile} onSelectFileFromPath={selectFileFromPath} />
        {state === "selected" && (
          <button
            onClick={startTranscription}
            className="w-full py-2.5 px-4 text-sm font-medium text-white bg-[#0071e3] hover:bg-[#0077ed] rounded-lg transition-colors shadow-sm"
          >
            开始转录
          </button>
        )}
      </div>
    );
  }

  if (state === "transcribing") {
    return (
      <TranscriptionProgress
        phase={progress?.phase}
        message={progress?.message}
        totalMs={progress?.total_ms}
        progressPct={progress?.progress_pct}
        onCancel={cancelTranscription}
        fileName={fileInfo?.fileName}
      />
    );
  }

  if (state === "done" && result) {
    const handleCopy = async (text: string) => {
      try {
        if (window.electronAPI?.copyText) {
          await window.electronAPI.copyText(text);
        } else {
          await navigator.clipboard.writeText(text);
        }
      } catch {
        try { await navigator.clipboard.writeText(text); } catch { /* no clipboard available */ }
      }
    };

    const handleAIOptimize = async (_text: string) => {
      if (!window.electronAPI?.aiReviewTranscription || !result.id) {
        throw new Error("AI 优化功能不可用");
      }
      const reviewResult = await window.electronAPI.aiReviewTranscription(result.id);
      if (reviewResult.success && reviewResult.reviewText) {
        return reviewResult.reviewText;
      }
      throw new Error(reviewResult.error || "AI 优化失败");
    };

    return (
      <div className="space-y-4">
        <TranscriptionResult
          text={result.text}
          segments={result.segments}
          duration={result.duration}
          id={result.id}
          onCopy={handleCopy}
          onAIOptimize={handleAIOptimize}
        />
        <button
          onClick={reset}
          className="w-full py-2 px-4 text-sm font-medium text-white bg-[#0071e3] hover:bg-[#0077ed] rounded-lg transition-colors shadow-sm"
        >
          导入新文件
        </button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-4">
        <div className="bg-[#ff3b30]/5 dark:bg-[#3a1c1c] rounded-xl p-4 border border-[#ff3b30]/40">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-[#ff3b30] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24">
              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-[#ff3b30]">转录失败</p>
              <p className="text-sm text-[#ff3b30]/80 mt-1">{error || "未知错误"}</p>
            </div>
          </div>
        </div>
        <button
          onClick={reset}
          className="w-full py-2 px-4 text-sm font-medium text-white bg-[#0071e3] hover:bg-[#0077ed] rounded-lg transition-colors shadow-sm"
        >
          重新选择文件
        </button>
      </div>
    );
  }

  if (state === "cancelled") {
    return (
      <div className="space-y-4">
        <div className="bg-[#ff9500]/5 dark:bg-[#3a2c1c] rounded-xl p-4 border border-[#ff9500]/40">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-[#ff9500] flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <p className="text-sm font-medium text-[#ff9500]">转录已取消</p>
          </div>
        </div>
        <button
          onClick={reset}
          className="w-full py-2 px-4 text-sm font-medium text-white bg-[#0071e3] hover:bg-[#0077ed] rounded-lg transition-colors shadow-sm"
        >
          重新选择文件
        </button>
      </div>
    );
  }

  return null;
}
