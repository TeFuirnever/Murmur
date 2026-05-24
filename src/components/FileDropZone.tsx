import * as React from "react";

interface FileInfo {
  fileName: string;
  fileSize: number;
  extension?: string;
}

interface FileDropZoneProps {
  fileInfo: FileInfo | null;
  onSelectFile: () => void;
  onSelectFileFromPath?: (path: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function WaveformIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4" />
    </svg>
  );
}

export default function FileDropZone({
  fileInfo,
  onSelectFile,
  onSelectFileFromPath,
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = React.useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const filePath = (files[0] as File & { path?: string }).path;
      if (filePath && onSelectFileFromPath) {
        onSelectFileFromPath(filePath);
      } else {
        onSelectFile();
      }
    }
  };

  if (fileInfo) {
    return (
      <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl p-4 border border-[#d2d2d7] dark:border-[#383838]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#e8f4fd] dark:bg-[#0a2540] flex items-center justify-center flex-shrink-0">
            <WaveformIcon className="w-5 h-5 text-[#0071e3] dark:text-[#2997ff]" />
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
    <div
      onClick={onSelectFile}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`w-full py-8 px-4 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer group ${
        isDragging
          ? "border-[#0071e3] bg-[#e8f4fd]/30 dark:bg-[#e8f4fd]/10 scale-[1.02]"
          : "border-[#d2d2d7] dark:border-[#383838] hover:border-[#0071e3] hover:bg-[#e8f4fd]/30 dark:hover:bg-[#e8f4fd]/10"
      }`}
    >
      <div className="flex flex-col items-center gap-3">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
          isDragging
            ? "bg-[#e8f4fd] dark:bg-[#0a2540]"
            : "bg-[#f5f5f7] dark:bg-[#2c2c2e] group-hover:bg-[#e8f4fd] dark:group-hover:bg-[#0a2540] group-hover:-translate-y-0.5"
        }`}>
          <WaveformIcon className={`w-6 h-6 transition-colors ${
            isDragging
              ? "text-[#0071e3]"
              : "text-[#86868b] group-hover:text-[#0071e3]"
          }`} />
        </div>
        <div className="text-center">
          <p className={`text-sm font-medium ${
            isDragging
              ? "text-[#0071e3]"
              : "text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80"
          }`}>
            {isDragging ? "松开以导入音频文件" : "点击选择音频文件或拖拽到此处"}
          </p>
          <p className="text-xs text-[#86868b] mt-1">
            支持 WAV、MP3、M4A、FLAC、OGG、WMA、AAC 格式
          </p>
        </div>
      </div>
    </div>
  );
}
