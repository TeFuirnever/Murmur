import React from "react";
import { useFileTranscription } from "../hooks/useFileTranscription";
import FileDropZone from "./FileDropZone";
import TranscriptionProgress from "./TranscriptionProgress";
import TranscriptionResult from "./TranscriptionResult";
import ExportPanel from "./ExportPanel";

/**
 * 文件导入容器组件
 * 根据转录状态渲染对应的子组件
 */
export default function FileImport() {
  const {
    state,
    fileInfo,
    progress,
    result,
    error,
    selectFile,
    startTranscription,
    cancelTranscription,
    reset,
  } = useFileTranscription();

  // 空闲或已选择文件：显示文件选择区域 + 开始按钮
  if (state === "idle" || state === "selected") {
    return (
      <div className="space-y-4">
        <FileDropZone fileInfo={fileInfo} onSelectFile={selectFile} />
        {state === "selected" && (
          <button
            onClick={startTranscription}
            className="w-full py-2.5 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg transition-colors shadow-sm"
          >
            开始转录
          </button>
        )}
      </div>
    );
  }

  // 转录中：显示进度
  if (state === "transcribing") {
    return (
      <TranscriptionProgress
        phase={progress?.phase}
        message={progress?.message}
        processedMs={progress?.processed_ms}
        totalMs={progress?.total_ms}
        onCancel={cancelTranscription}
      />
    );
  }

  // 转录完成：显示结果 + 导出
  if (state === "done" && result) {
    return (
      <div className="space-y-4">
        <TranscriptionResult
          text={result.text}
          segments={result.segments}
          duration={result.duration}
        />
        <ExportPanel transcriptionId={result.id} />
        <button
          onClick={reset}
          className="w-full py-2 px-4 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          导入新文件
        </button>
      </div>
    );
  }

  // 错误状态
  if (state === "error") {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 border border-red-200 dark:border-red-800">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                转录失败
              </p>
              <p className="text-sm text-red-600 dark:text-red-400/80 mt-1">
                {error || "未知错误"}
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={reset}
          className="w-full py-2 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg transition-colors shadow-sm"
        >
          重新选择文件
        </button>
      </div>
    );
  }

  // 已取消状态
  if (state === "cancelled") {
    return (
      <div className="space-y-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-3">
            <svg
              className="w-5 h-5 text-amber-500 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              />
            </svg>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              转录已取消
            </p>
          </div>
        </div>
        <button
          onClick={reset}
          className="w-full py-2 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg transition-colors shadow-sm"
        >
          重新选择文件
        </button>
      </div>
    );
  }

  return null;
}
