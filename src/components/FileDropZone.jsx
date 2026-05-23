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
      <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl p-4 border border-[#d2d2d7] dark:border-[#383838]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#e8f4fd] dark:bg-[#0a2540] flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-[#0071e3] dark:text-[#2997ff]"
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
            <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
              {fileInfo.fileName}
            </p>
            <p className="text-xs text-[#86868b]">
              {formatFileSize(fileInfo.fileSize)}{" "}
              {fileInfo.extension?.toUpperCase()}
            </p>
          </div>
          <button
            onClick={onSelectFile}
            className="text-xs text-[#0071e3] hover:text-[#0077ed] font-medium flex-shrink-0"
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
      className="w-full py-8 px-4 border-2 border-dashed border-[#d2d2d7] dark:border-[#383838] rounded-xl hover:border-[#0071e3] hover:bg-[#e8f4fd]/30 dark:hover:bg-[#e8f4fd]/10 transition-all duration-200 cursor-pointer group"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center group-hover:bg-[#e8f4fd] dark:group-hover:bg-[#0a2540] transition-colors">
          <svg
            className="w-6 h-6 text-[#86868b] group-hover:text-[#0071e3] transition-colors"
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
          <p className="text-sm font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80">
            点击选择音频文件或拖拽到此处
          </p>
          <p className="text-xs text-[#86868b] mt-1">
            支持 WAV、MP3、M4A、FLAC 格式
          </p>
        </div>
      </div>
    </button>
  );
}
