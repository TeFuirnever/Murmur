import * as React from "react";
import { toast } from "sonner";

const EXPORT_FORMATS = [
  { key: "txt", label: "TXT", desc: "纯文本" },
  { key: "srt", label: "SRT", desc: "字幕文件" },
  { key: "vtt", label: "VTT", desc: "Web字幕" },
  { key: "md", label: "MD", desc: "Markdown" },
  { key: "docx", label: "DOCX", desc: "Word文档" },
];

interface ExportPanelProps {
  transcriptionId: number;
}

/**
 * 导出面板组件
 * 提供多种格式的导出按钮
 */
export default function ExportPanel({ transcriptionId }: ExportPanelProps) {
  const [exportingFormat, setExportingFormat] = React.useState<string | null>(
    null,
  );

  const handleExport = async (format: string) => {
    if (!window.electronAPI || !window.electronAPI.exportTranscription) {
      toast.error("导出功能不可用");
      return;
    }

    setExportingFormat(format);
    try {
      const response = await window.electronAPI.exportTranscription(
        transcriptionId,
        format,
      );

      if (response && response.success) {
        toast.success(`已导出为 ${format.toUpperCase()} 格式`);
      } else {
        toast.error(response?.error || "导出失败");
      }
    } catch (err) {
      toast.error("导出失败: " + ((err as Error).message || "未知错误"));
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-[#86868b]">导出格式</h4>
      <div className="flex gap-2">
        {EXPORT_FORMATS.map((fmt) => {
          const isExporting = exportingFormat === fmt.key;
          return (
            <button
              key={fmt.key}
              onClick={() => handleExport(fmt.key)}
              disabled={isExporting || !!exportingFormat}
              className="flex-1 px-3 py-2 text-xs font-medium rounded-lg border border-[#d2d2d7] dark:border-[#383838] bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f]/80 dark:text-[#f5f5f7]/60 hover:bg-[#e8e8ed] dark:hover:bg-[#383838] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={fmt.desc}
            >
              {isExporting ? (
                <span className="flex items-center justify-center gap-1">
                  <svg
                    className="w-3 h-3 animate-spin"
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
                </span>
              ) : (
                fmt.label
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
