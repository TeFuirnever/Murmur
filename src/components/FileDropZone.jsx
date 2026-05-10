import React from "react";

/**
 * 格式化文件大小为可读字符串
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * 文件拖放/选择区域组件
 * 点击选择音频文件，未来支持拖拽
 */
export default function FileDropZone({ fileInfo, onSelectFile }) {
  if (fileInfo) {
    return (
      <div className="bg-slate-50 dark:bg-gray-800 rounded-xl p-4 border border-slate-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-blue-600 dark:text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {fileInfo.fileName}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatFileSize(fileInfo.fileSize)}{" "}
              {fileInfo.extension?.toUpperCase()}
            </p>
          </div>
          <button
            onClick={onSelectFile}
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex-shrink-0"
          >
            更换文件
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onSelectFile}
      className="w-full py-8 px-4 border-2 border-dashed border-slate-300 dark:border-gray-600 rounded-xl hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all duration-200 cursor-pointer group"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-gray-700 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
          <svg
            className="w-6 h-6 text-slate-400 dark:text-gray-500 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            点击选择音频文件或拖拽到此处
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            支持 WAV、MP3、M4A、FLAC 格式
          </p>
        </div>
      </div>
    </button>
  );
}
