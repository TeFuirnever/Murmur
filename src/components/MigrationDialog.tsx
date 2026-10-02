// [20261002_T9_MigrationUx] Ticket #420 (spec #412 user stories 3/5): the
// old-user migration dialog. On the first launch after the ONNX upgrade it
// EXPLICITLY tells the user a model re-download (~671 MB, computed from the
// pin) is required before the new engine can transcribe — never a silent
// background pull — with resume-able download / defer / retry actions, and
// an actionable settings pointer when the network or a proxy fails. Shown
// only in the UPGRADE shape (ONNX missing + old torch generation present, so
// the app keeps working while deferred); the fresh-install download flow
// stays owned by the legacy need_download screen.
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Download, Settings, Loader2 } from "lucide-react";
import { useModelStatus } from "../hooks/useModelStatus";

const BYTES_PER_MB = 1024 * 1024;

// [20261002_T9_MigrationUx] Tolerant defaults: some tests mock the context
// with a partial surface; the dialog must render "nothing to see" there
// instead of crashing on undefined fields.
const DEFAULT_MIGRATION = {
  checked: false,
  needed: false,
  torchFallbackAvailable: false,
  totalBytes: 0,
  remainingBytes: 0,
  dismissed: false,
  error: null as string | null,
};

const MigrationDialog: React.FC = () => {
  const { t } = useTranslation();
  const {
    migration = DEFAULT_MIGRATION,
    dismissMigration = () => {},
    downloadOnnxModels = () => Promise.resolve({ success: false }),
    isDownloading = false,
    downloadProgress = 0,
  } = useModelStatus();

  // Dialog visibility: upgrade shape only, once per launch until dismissed.
  const visible =
    migration.checked &&
    migration.needed &&
    migration.torchFallbackAvailable &&
    !migration.dismissed;

  // MB volume for the告知; clamped so a weird status never renders "0 MB".
  const sizeMb = Math.max(1, Math.round(migration.totalBytes / BYTES_PER_MB));

  if (!visible) return null;

  return (
    <div
      data-testid="migration-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("migration.title", "语音识别引擎升级")}
    >
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#2c2c2e] p-5 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <Download className="w-5 h-5 text-[#0071e3]" />
          <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {t("migration.title", "语音识别引擎升级")}
          </h2>
        </div>

        <p
          data-testid="migration-body"
          className="text-sm text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 leading-relaxed"
        >
          {t("migration.body", {
            size: sizeMb,
            defaultValue:
              "新版应用需要重新下载语音识别模型（约 {{size}} MB），下载完成前无法使用新引擎转写。下载支持断点续传，中断后重试将从断点继续。",
          })}
        </p>
        <p
          data-testid="migration-fallback-note"
          className="mt-2 text-xs text-[#86868b] dark:text-[#98989d]"
        >
          {t(
            "migration.fallbackNote",
            "下载完成前，将继续使用旧模型进行转写；暂缓不影响当前使用。",
          )}
        </p>

        {isDownloading ? (
          <div className="mt-4" data-testid="migration-progress">
            <div className="flex items-center gap-2 text-sm text-[#0071e3]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {t("migration.downloading", {
                  progress: Math.round(downloadProgress),
                  defaultValue: "正在下载语音识别模型... {{progress}}%",
                })}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-[#e8e8ed] dark:bg-[#3a3a3c] overflow-hidden">
              <div
                className="h-full bg-[#0071e3] transition-all"
                style={{ width: `${Math.min(100, downloadProgress)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[#86868b] dark:text-[#98989d]">
              {t(
                "migration.resumeHint",
                "已下载部分已保留，中断后重试将自动断点续传",
              )}
            </p>
          </div>
        ) : (
          <>
            {migration.error && (
              <div
                data-testid="migration-error"
                className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3"
              >
                <p className="text-xs text-red-700 dark:text-red-300 break-words">
                  {migration.error}
                </p>
                <p
                  data-testid="migration-error-guidance"
                  className="mt-1 text-xs text-red-700/80 dark:text-red-300/80"
                >
                  {t(
                    "migration.errorGuidance",
                    "请检查网络连接或代理设置；如反复失败，可打开设置指引调整后重试。",
                  )}
                </p>
                <button
                  data-testid="migration-open-settings"
                  onClick={() => {
                    // The actionable pointer: the settings window holds the
                    // download-directory and diagnostics entries.
                    window.electronAPI?.openSettingsWindow();
                  }}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-[#0071e3] hover:underline"
                >
                  <Settings className="w-3 h-3" />
                  {t("migration.openSettings", "打开设置")}
                </button>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                data-testid="migration-defer"
                onClick={dismissMigration}
                className="px-4 py-2 text-sm rounded-lg text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors"
              >
                {t("migration.defer", "暂缓")}
              </button>
              <button
                data-testid="migration-download"
                onClick={() => {
                  void downloadOnnxModels();
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0071e3] hover:bg-[#0077ed] rounded-lg transition-colors shadow-sm"
              >
                {migration.error
                  ? t("migration.retry", "重试")
                  : t("migration.downloadNow", "立即下载")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MigrationDialog;
