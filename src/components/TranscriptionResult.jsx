import React, { useState } from "react";

/**
 * 格式化毫秒为 MM:SS
 */
function formatTimestamp(ms) {
  if (!ms && ms !== 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 格式化时长秒数为可读字符串
 */
function formatDuration(seconds) {
  if (!seconds) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}秒`;
  return `${mins}分${secs}秒`;
}

/**
 * 转录结果展示组件
 * 显示完整文本和按时间段的分段详情
 */
export default function TranscriptionResult({ text, segments, duration }) {
  const [expandedSegment, setExpandedSegment] = useState(null);

  const hasSegments = segments && segments.length > 0;

  return (
    <div className="space-y-4">
      {/* 头部：时长信息 */}
      {duration > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
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

      {/* 完整文本 */}
      {text && (
        <div className="bg-slate-100/80 dark:bg-gray-800/80 rounded-lg p-4 max-h-48 overflow-y-auto custom-scrollbar">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            转录文本
          </h4>
          <p className="chinese-content text-gray-800 dark:text-gray-200 text-sm whitespace-pre-wrap">
            {text}
          </p>
        </div>
      )}

      {/* 分段时间线 */}
      {hasSegments && (
        <div>
          <button
            onClick={() =>
              setExpandedSegment(expandedSegment === "all" ? null : "all")
            }
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors mb-2"
          >
            {expandedSegment === "all" ? "收起分段详情" : "查看分段详情"}
          </button>

          {expandedSegment === "all" && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
              {segments.map((segment, index) => (
                <div
                  key={index}
                  className={`flex gap-3 p-2 rounded-lg text-sm transition-colors ${
                    expandedSegment === index
                      ? "bg-blue-50 dark:bg-blue-900/20"
                      : "hover:bg-slate-50 dark:hover:bg-gray-700/50"
                  }`}
                >
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap pt-0.5 flex-shrink-0">
                    {formatTimestamp(segment.start_ms)} -{" "}
                    {formatTimestamp(segment.end_ms)}
                  </span>
                  <span className="chinese-content text-gray-700 dark:text-gray-300">
                    {segment.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
