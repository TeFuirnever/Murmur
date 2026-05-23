import { Copy, Download } from "lucide-react";
import { LoadingDots } from "./ui/loading-dots";

export const TextDisplay = ({
  originalText,
  processedText,
  isProcessing,
  onCopy,
  onExport,
  onPaste,
}: {
  originalText: string;
  processedText: string;
  isProcessing: boolean;
  onCopy: (text: string) => void;
  onExport: (text: string) => void;
  onPaste: (text: string) => void;
}) => {
  if (!originalText && !processedText) {
    return null;
  }

  return (
    <div className="space-y-4">
      {originalText && (
        <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-content text-gray-800 dark:text-gray-200 flex-1 truncate pr-2">
              {originalText}
            </p>
            <button
              onClick={() => onCopy(originalText)}
              className="p-1.5 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] rounded-md transition-colors flex-shrink-0"
              title="复制识别文本"
            >
              <Copy className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
            </button>
          </div>
        </div>
      )}

      {(processedText || isProcessing) && (
        <div className="bg-[#e8f4fd] dark:bg-[#0a2540] rounded-xl p-5 border-l-4 border-[#0071e3] shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-heading text-[#0071e3] dark:text-[#2997ff]">
              AI优化后
            </h3>
            <div className="flex space-x-2">
              {processedText && (
                <>
                  <button
                    onClick={() => onPaste(processedText)}
                    className="p-2 hover:bg-[#d1e8f8] dark:hover:bg-[#0a2540]/70 rounded-lg transition-colors shadow-sm"
                    title="粘贴优化文本"
                  >
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
                        d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => onCopy(processedText)}
                    className="p-2 hover:bg-[#d1e8f8] dark:hover:bg-[#0a2540]/70 rounded-lg transition-colors shadow-sm"
                    title="复制优化文本"
                  >
                    <Copy className="w-5 h-5 text-[#0071e3] dark:text-[#2997ff]" />
                  </button>
                  <button
                    onClick={() => onExport(processedText)}
                    className="p-2 hover:bg-[#d1e8f8] dark:hover:bg-[#0a2540]/70 rounded-lg transition-colors shadow-sm"
                    title="导出文本"
                  >
                    <Download className="w-5 h-5 text-[#0071e3] dark:text-[#2997ff]" />
                  </button>
                </>
              )}
            </div>
          </div>
          {isProcessing ? (
            <div className="flex items-center space-x-3 text-[#0071e3] dark:text-[#2997ff]">
              <LoadingDots />
              <span className="text-content">AI正在优化文本...</span>
            </div>
          ) : (
            <p className="text-content leading-loose fade-in text-gray-800 dark:text-gray-200">
              {processedText}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
