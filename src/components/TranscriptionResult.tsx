import * as React from "react";
import { LoadingDots } from "./ui/loading-dots";
import ExportPanel from "./ExportPanel";

interface Segment {
  start_ms: number;
  end_ms: number;
  text: string;
}

interface TranscriptionResultProps {
  text?: string;
  rawText?: string;
  segments?: Segment[];
  duration?: number;
  id?: number;
  isOptimizing?: boolean;
  onCopy?: (text: string) => void;
  onAIOptimize?: (text: string) => Promise<string>;
}

function formatTimestamp(ms?: number): string {
  if (!ms && ms !== 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}秒`;
  return `${mins}分${secs}秒`;
}

export default function TranscriptionResult({
  text,
  rawText,
  segments,
  duration,
  id,
  isOptimizing,
  onCopy,
  onAIOptimize,
}: TranscriptionResultProps) {
  const [expandedSegment, setExpandedSegment] = React.useState<
    string | number | null
  >(null);
  const [showRaw, setShowRaw] = React.useState(false);
  const [optimizedText, setOptimizedText] = React.useState<string | null>(null);
  const [isOptimizingInternal, setIsOptimizingInternal] = React.useState(false);
  const [optimizeError, setOptimizeError] = React.useState<string | null>(null);

  const hasSegments = segments && segments.length > 0;

  const displayText = optimizedText || text || "";
  const displayRawText = rawText && rawText !== displayText ? rawText : null;
  const hasAIResult = displayRawText !== null;

  const handleAIOptimize = async () => {
    if (!onAIOptimize || !text) return;
    setIsOptimizingInternal(true);
    setOptimizeError(null);
    try {
      const result = await onAIOptimize(text);
      setOptimizedText(result);
    } catch (err) {
      setOptimizeError((err as Error).message || "优化失败");
    } finally {
      setIsOptimizingInternal(false);
    }
  };

  const showOptimizing = isOptimizing || isOptimizingInternal;
  const canOptimize = onAIOptimize && !optimizedText;

  return (
    <div className="space-y-4">
      {/* Duration header */}
      {(duration ?? 0) > 0 && (
        <div className="flex items-center gap-2 text-sm text-[#86868b]">
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
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>音频时长: {formatDuration(duration)}</span>
        </div>
      )}

      {/* AI optimized text / optimizing state (blue card) */}
      {(hasAIResult || showOptimizing) && displayText && (
        <div className="bg-[#e8f4fd] dark:bg-[#0a2540] rounded-xl p-4 border-l-4 border-[#0071e3]">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-[#0071e3] dark:text-[#2997ff]">
              AI 优化后
            </h4>
            {onCopy && !showOptimizing && (
              <button
                onClick={() => onCopy(displayText)}
                className="p-1 hover:bg-[#d1e8f8] dark:hover:bg-[#0a2540]/70 rounded-md transition-colors"
                title="复制文本"
              >
                <svg className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2" />
                </svg>
              </button>
            )}
          </div>
          {showOptimizing ? (
            <div className="flex items-center space-x-2 text-[#0071e3] dark:text-[#2997ff]">
              <LoadingDots />
              <span className="text-sm">AI正在优化文本...</span>
            </div>
          ) : (
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]/80 whitespace-pre-wrap">
              {displayText}
            </p>
          )}
        </div>
      )}

      {/* Raw text (gray card) */}
      {displayText && !hasAIResult && !showOptimizing && (
        <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg p-4 max-h-48 overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-[#86868b] mb-2">转录文本</h4>
            {onCopy && (
              <button
                onClick={() => onCopy(displayText)}
                className="p-1 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] rounded-md transition-colors"
                title="复制文本"
              >
                <svg className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2" />
                </svg>
              </button>
            )}
          </div>
          <p className="text-content text-[#1d1d1f] dark:text-[#f5f5f7]/80 text-sm whitespace-pre-wrap">
            {displayText}
          </p>
        </div>
      )}

      {/* Collapsed raw text toggle */}
      {displayRawText && (
        <div>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs font-medium text-[#0071e3] hover:text-[#0077ed] transition-colors"
          >
            {showRaw ? "收起原文" : "查看原文"}
          </button>
          {showRaw && (
            <div className="mt-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg p-3">
              <p className="text-sm text-[#1d1d1f]/70 dark:text-[#f5f5f7]/60 whitespace-pre-wrap">
                {displayRawText}
              </p>
            </div>
          )}
        </div>
      )}

      {/* AI optimize button */}
      {canOptimize && !showOptimizing && (
        <div className="space-y-2">
          <button
            onClick={handleAIOptimize}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0071e3] hover:bg-[#0077ed] rounded-lg transition-colors"
          >
            AI 优化
          </button>
          {optimizeError && (
            <p className="text-xs text-[#ff3b30]">{optimizeError}</p>
          )}
        </div>
      )}

      {/* Segment timeline */}
      {hasSegments && (
        <div>
          <button
            onClick={() =>
              setExpandedSegment(expandedSegment === "all" ? null : "all")
            }
            className="text-xs font-medium text-[#0071e3] hover:text-[#0077ed] transition-colors mb-2"
          >
            {expandedSegment === "all" ? "收起分段详情" : "查看分段详情"}
          </button>

          {expandedSegment === "all" && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
              {segments.map((segment, index) => (
                <div
                  key={index}
                  className="flex gap-3 p-2 rounded-lg text-sm transition-colors hover:bg-[#f5f5f7] dark:hover:bg-[#383838]/50"
                >
                  <span className="text-xs text-[#86868b] font-mono whitespace-nowrap pt-0.5 flex-shrink-0">
                    {formatTimestamp(segment.start_ms)} -{" "}
                    {formatTimestamp(segment.end_ms)}
                  </span>
                  <span className="text-content text-[#1d1d1f]/80 dark:text-[#f5f5f7]/60">
                    {segment.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Export panel */}
      {id != null && <ExportPanel transcriptionId={id} />}
    </div>
  );
}
