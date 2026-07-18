import type React from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Download, X } from "lucide-react";
import type {
  UpdateCheckResult,
  UpdateProgressData,
  UpdateCompleteData,
} from "../../types/ipc";

interface AboutSectionProps {
  appVersion: string;
  checkingUpdate: boolean;
  updateInfo: UpdateCheckResult | null;
  downloadProgress: UpdateProgressData | null;
  downloadedUpdate: UpdateCompleteData | null;
  checkForUpdates: () => void;
  startDownload: () => void;
}

export const AboutSection: React.FC<AboutSectionProps> = ({
  appVersion,
  checkingUpdate,
  updateInfo,
  downloadProgress,
  downloadedUpdate,
  checkForUpdates,
  startDownload,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* [20260713_Fix_NoHardcodedChinese] Application info card */}
      <div className="bg-[#f5f5f7] dark:bg-[#1c1c1e] p-4 rounded-lg">
        <p className="text-sm text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-1">
          🎤 <strong>Murmur</strong> —{" "}
          {t("app.subtitle", "基于FunASR和AI的中文语音转文字应用")}
        </p>
        {appVersion && (
          <p className="text-xs text-[#86868b] mb-2">
            {t("app.currentVersion", { version: appVersion })}
          </p>
        )}
        <p className="text-xs text-[#86868b]">
          • {t("app.features.recognition", "高精度中文语音识别")}
          <br />• {t("app.features.ai", "AI智能文本优化")}
          <br />• {t("app.features.realtime", "实时语音处理")}
          <br />• {t("app.features.privacy", "隐私保护设计")}
        </p>
      </div>

      {/* 更新检查 */}
      <div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={checkForUpdates}
            disabled={checkingUpdate}
            className="flex items-center space-x-2 px-3 py-1.5 text-sm text-[#0071e3] hover:bg-[#e8f4fd] dark:hover:bg-blue-900/30 rounded-lg transition-colors disabled:opacity-50"
          >
            {checkingUpdate ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            <span>
              {checkingUpdate
                ? t("settings.update.checking")
                : t("settings.update.check")}
            </span>
          </button>

          {updateInfo && !updateInfo.hasUpdate && !updateInfo.error && (
            <span className="text-xs text-[#86868b]">
              {t("settings.update.upToDate")}
            </span>
          )}

          {updateInfo?.error && (
            <span className="text-xs text-red-500">{updateInfo.error}</span>
          )}
        </div>

        {updateInfo?.hasUpdate && !downloadProgress && !downloadedUpdate && (
          <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-green-700 dark:text-green-400">
                {t("settings.update.available", {
                  version: `v${updateInfo.latestVersion}`,
                })}
              </span>
              <span className="text-xs text-[#86868b]">
                {updateInfo.downloadSize
                  ? `${(updateInfo.downloadSize / 1048576).toFixed(1)} MB`
                  : ""}
              </span>
            </div>
            {updateInfo.releaseNotes && (
              <p className="text-xs text-[#1d1d1f]/60 dark:text-[#f5f5f7]/60 mb-2 line-clamp-3 whitespace-pre-line">
                {updateInfo.releaseNotes
                  .replace(/## What's Changed.*$/s, "")
                  .slice(0, 300)}
              </p>
            )}
            <button
              type="button"
              onClick={startDownload}
              className="flex items-center space-x-1.5 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              <Download className="w-3 h-3" />
              <span>{t("settings.update.download")}</span>
            </button>
          </div>
        )}

        {downloadProgress && (
          <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-blue-700 dark:text-blue-400">
                {t("settings.update.downloading", {
                  progress: `${downloadProgress.progress}%`,
                })}
              </span>
              {/* [20260712_Fix_CancelUpdateDownload] Restore cancel button
                  that was lost during refactor. Users need to be able to
                  abort an in-progress download. */}
              <button
                type="button"
                onClick={() => window.electronAPI?.cancelUpdateDownload?.()}
                className="flex items-center space-x-1 text-xs text-[#86868b] hover:text-red-500 transition-colors"
              >
                <X className="w-3 h-3" />
                <span>{t("settings.update.cancel")}</span>
              </button>
            </div>
            <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-1.5">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${downloadProgress.progress}%` }}
              />
            </div>
          </div>
        )}

        {downloadedUpdate && (
          <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <p className="text-xs text-green-700 dark:text-green-400 mb-2">
              {t("settings.update.downloaded", {
                version: `v${downloadedUpdate.version}`,
              })}
            </p>
            <button
              type="button"
              onClick={() =>
                window.electronAPI?.installUpdate?.(downloadedUpdate.filePath)
              }
              className="flex items-center space-x-1.5 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              <span>{t("settings.update.install")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
