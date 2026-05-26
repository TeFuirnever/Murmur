import * as React from "react";
import { LoadingDots } from "./ui/loading-dots";
import ExportPanel from "./ExportPanel";
import ProcessingPanel from "./ProcessingPanel";
import type { AIMode } from "../types/ipc";

interface Segment {
  start_ms: number;
  end_ms: number;
  text: string;
  speaker?: string;
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
  const [modes, setModes] = React.useState<AIMode[]>([]);
  const [currentMode, setCurrentMode] = React.useState("optimize");
  const [isDiarizing, setIsDiarizing] = React.useState(false);
  const [diarizedSegments, setDiarizedSegments] = React.useState<
    Segment[] | null
  >(null);
  const [diarizeError, setDiarizeError] = React.useState<string | null>(null);

  const displaySegments: Segment[] = (diarizedSegments ||
    segments) as Segment[];
  const speakerColors = [
    "text-[#ff6b6b]",
    "text-[#4ecdc4]",
    "text-[#45b7d1]",
    "text-[#96ceb4]",
    "text-[#feca57]",
  ];

  const handleDiarize = async () => {
    if (!id || !window.electronAPI?.diarizeAudio) return;
    setIsDiarizing(true);
    setDiarizeError(null);
    try {
      const result = await window.electronAPI.diarizeAudio(id);
      if (result.success && result.segments) {
        setDiarizedSegments(result.segments);
      } else {
        setDiarizeError(result.error || "说话人分离失败");
      }
    } catch (err) {
      setDiarizeError((err as Error).message);
    } finally {
      setIsDiarizing(false);
    }
  };

  React.useEffect(() => {
    if (window.electronAPI?.getAIModes) {
      window.electronAPI
        .getAIModes()
        .then((fetched: AIMode[]) => {
          if (fetched?.length) setModes(fetched);
        })
        .catch(() => {});
    }
  }, []);

  const hasSegments = segments && segments.length > 0;

  const displayText = optimizedText || text || "";
  const displayRawText = rawText && rawText !== displayText ? rawText : null;
  const hasAIResult = displayRawText !== null;

  const handleAIOptimize = async () => {
    if (!text) return;
    setIsOptimizingInternal(true);
    setOptimizeError(null);
    try {
      if (window.electronAPI?.processText) {
        const result = (await Promise.race([
          window.electronAPI.processText(text, currentMode),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("AI优化超时，已使用原文")),
              30000,
            ),
          ),
        ])) as { success?: boolean; text?: string };
        if (result?.success && result?.text) {
          setOptimizedText(result.text);
        } else {
          setOptimizeError("AI处理失败，请重试");
        }
      } else if (onAIOptimize) {
        const result = await onAIOptimize(text);
        setOptimizedText(result);
      } else {
        setOptimizeError("AI功能不可用");
      }
    } catch (err) {
      setOptimizeError((err as Error).message || "优化失败");
    } finally {
      setIsOptimizingInternal(false);
    }
  };

  const showOptimizing = isOptimizing || isOptimizingInternal;

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
                <svg
                  className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <rect
                    x="9"
                    y="9"
                    width="13"
                    height="13"
                    rx="2"
                    strokeWidth="2"
                  />
                  <path
                    d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                    strokeWidth="2"
                  />
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
            <h4 className="text-xs font-medium text-[#86868b] mb-2">
              转录文本
            </h4>
            {onCopy && (
              <button
                onClick={() => onCopy(displayText)}
                className="p-1 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] rounded-md transition-colors"
                title="复制文本"
              >
                <svg
                  className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <rect
                    x="9"
                    y="9"
                    width="13"
                    height="13"
                    rx="2"
                    strokeWidth="2"
                  />
                  <path
                    d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                    strokeWidth="2"
                  />
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

      {/* AI processing panel */}
      {text && modes.length > 0 && (
        <ProcessingPanel
          modes={modes}
          currentMode={currentMode}
          onModeChange={setCurrentMode}
          onApply={handleAIOptimize}
          isProcessing={showOptimizing}
          error={optimizeError}
          onDismissError={() => setOptimizeError(null)}
        />
      )}

      {/* Speaker diarization button */}
      {hasSegments && id && !isDiarizing && (
        <button
          onClick={handleDiarize}
          className="px-3 py-1.5 text-xs font-medium text-[#0071e3] bg-[#e8f4fd] dark:bg-[#0a2540] hover:bg-[#d1e8f8] rounded-lg transition-colors"
          aria-label={diarizedSegments ? "重新识别说话人" : "识别说话人"}
        >
          {diarizedSegments ? "重新识别说话人" : "识别说话人"}
        </button>
      )}
      {isDiarizing && (
        <div className="flex items-center gap-2 text-xs text-[#86868b]">
          <LoadingDots />
          <span>正在识别说话人...</span>
        </div>
      )}
      {diarizeError && <p className="text-xs text-[#ff3b30]">{diarizeError}</p>}

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
              {displaySegments.map((segment, index) => {
                const spk = segment.speaker;
                const colorIdx = spk
                  ? (spk.charCodeAt(spk.length - 1) || 0) % speakerColors.length
                  : -1;
                return (
                  <div
                    key={index}
                    className="flex gap-3 p-2 rounded-lg text-sm transition-colors hover:bg-[#f5f5f7] dark:hover:bg-[#383838]/50"
                  >
                    <span className="text-xs text-[#86868b] font-mono whitespace-nowrap pt-0.5 flex-shrink-0">
                      {formatTimestamp(segment.start_ms)} -{" "}
                      {formatTimestamp(segment.end_ms)}
                    </span>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {spk && (
                        <span
                          className={`text-[10px] font-semibold ${colorIdx >= 0 ? speakerColors[colorIdx] : "text-[#86868b]"}`}
                        >
                          {spk}
                        </span>
                      )}
                      <span className="text-content text-[#1d1d1f]/80 dark:text-[#f5f5f7]/60">
                        {segment.text}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Export panel */}
      {id != null && <ExportPanel transcriptionId={id} />}
    </div>
  );
}
