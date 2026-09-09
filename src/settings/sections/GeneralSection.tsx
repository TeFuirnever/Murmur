import { useTranslation } from "react-i18next";
import { useState } from "react";
import type React from "react";
import type { SettingsState } from "../useSettings";
// [20260905_Fix_246_HotkeySettingsUi] Hotkey recorder (issue #246: the
// settings entry the main-window failure toast pointed at did not exist).
import { buildAccelerator, formatAccelerator } from "../hotkeyRecorder";
// [20260908_Feat_240_VocabCorrections] T13: corrections-table management.
import { VocabManager } from "./VocabManager";

interface GeneralSectionProps {
  settings: SettingsState;
  onInputChange: (key: string, value: unknown) => void;
}

export const GeneralSection: React.FC<GeneralSectionProps> = ({
  settings,
  onInputChange,
}) => {
  const { t, i18n } = useTranslation();
  // [20260905_Fix_246_HotkeySettingsUi] Recording state for the hotkey
  // capture zone. The captured combo is persisted immediately through
  // onInputChange("hotkey", ...) — the main window re-registers on
  // SETTINGS_UPDATE (App.tsx).
  const [recording, setRecording] = useState(false);

  const handleCaptureKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // The capture zone only renders while recording, so no !recording guard
    // is needed here (an unreachable branch would just rot).
    event.preventDefault();
    event.stopPropagation();
    // Escape is the recorder's cancel key (buildAccelerator rejects it).
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    const combo = buildAccelerator(event.nativeEvent);
    if (combo !== null) {
      onInputChange("hotkey", combo);
      setRecording(false);
    }
    // Modifier-only and modifier-less presses (null) keep recording.
  };

  return (
    <div className="space-y-6">
      {/* [20260712_Fix_SetAlwaysOnTop] Restore live setAlwaysOnTop side-effect
          that was lost during refactor. The toggle must call the IPC immediately
          so the window state changes without requiring Save + reload. */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
            {t("settings.recognition.alwaysOnTop", "窗口始终置顶")}
          </label>
          // [20260906_Test_AxeA11y] #6e6e73 passes 4.5:1 (small text); the //
          former #86868b measured ~3.5:1 and failed the axe gate.
          <p className="text-xs text-[#6e6e73]">
            {t("settings.general.alwaysOnTopDesc", "将应用窗口保持在最前面")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label={t("settings.recognition.alwaysOnTop", "窗口始终置顶")}
          aria-checked={settings.window_always_on_top}
          onClick={() => {
            const newVal = !settings.window_always_on_top;
            onInputChange("window_always_on_top", newVal);
            if (window.electronAPI?.setAlwaysOnTop) {
              window.electronAPI.setAlwaysOnTop(newVal);
            }
          }}
          className={`${
            settings.window_always_on_top
              ? "bg-[#0071e3]"
              : "bg-[#d2d2d7] dark:bg-[#3a3a3c]"
          } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#0071e3] focus:ring-offset-2`}
        >
          <span
            aria-hidden="true"
            className={`${
              settings.window_always_on_top ? "translate-x-4" : "translate-x-0"
            } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
          />
        </button>
      </div>

      {/* [20260816_Refactor_RemoveEffects] The visual-effects toggle was
          removed with the whole effects feature (ogl/motion deps). */}

      {/* [20260712_Fix_AutoPasteValue] CRITICAL: option value must be
          "clipboard_only" (not "clipboard") to match App.tsx's runtime
          check: if (autoPaste === "clipboard_only"). Using "clipboard"
          would cause auto-paste even when user chose clipboard-only. */}
      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          {t("settings.recognition.autoPaste", "自动粘贴行为")}
        </label>
        <select
          aria-label={t("settings.recognition.autoPaste", "自动粘贴行为")}
          value={settings.auto_paste}
          onChange={(e) => onInputChange("auto_paste", e.target.value)}
          className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          <option value="paste">
            {t("settings.recognition.pasteOption", "自动粘贴到光标处")}
          </option>
          <option value="clipboard_only">
            {t("settings.recognition.clipboardOption", "仅复制到剪贴板")}
          </option>
          <option value="none">
            {t("settings.recognition.noneOption", "不自动操作")}
          </option>
        </select>
        <p className="mt-1 text-xs text-[#6e6e73]">
          {t(
            "settings.recognition.autoPasteDesc",
            "语音识别完成后的文本处理方式",
          )}
        </p>
      </div>

      {/* [20260905_Fix_249_DefaultModeUi] Default AI processing mode for the
          recording / file-transcription pipelines (issue #249: the read side
          honored "default_mode" but nothing could write it). "auto" picks by
          text length, "off" disables, the rest map to built-in modes. */}
      <div>
        <label
          htmlFor="default-mode"
          className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1"
        >
          {t("settings.general.defaultModeLabel", "默认 AI 处理模式")}
        </label>
        <select
          id="default-mode"
          data-testid="default-mode"
          value={settings.default_mode}
          onChange={(e) => onInputChange("default_mode", e.target.value)}
          className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          <option value="auto">
            {t("settings.general.defaultModeAuto", "智能判断（按文本长度）")}
          </option>
          <option value="optimize">
            {t("settings.general.defaultModeOptimize", "智能润色")}
          </option>
          <option value="optimize_long">
            {t("settings.general.defaultModeOptimizeLong", "长文本整理")}
          </option>
          <option value="correct">
            {t("settings.general.defaultModeCorrect", "校对纠错")}
          </option>
          <option value="summarize">
            {t("settings.general.defaultModeSummarize", "摘要总结")}
          </option>
          <option value="off">
            {t("settings.general.defaultModeOff", "关闭 AI 处理")}
          </option>
        </select>
        <p className="mt-1 text-xs text-[#6e6e73]">
          {t(
            "settings.general.defaultModeDesc",
            "录音与文件导入完成后自动应用的 AI 处理方式；单次结果面板仍可临时切换。",
          )}
        </p>
      </div>

      {/* 关闭行为 */}
      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          {t("settings.recognition.closeBehavior", "关闭行为")}
        </label>
        <select
          aria-label={t("settings.recognition.closeBehavior", "关闭行为")}
          value={settings.close_behavior}
          onChange={(e) => onInputChange("close_behavior", e.target.value)}
          className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          <option value="hide">
            {t("settings.recognition.hideBehavior", "隐藏到托盘")}
          </option>
          <option value="quit">
            {t("settings.recognition.quitBehavior", "退出应用")}
          </option>
        </select>
        <p className="mt-1 text-xs text-[#6e6e73]">
          {t(
            "settings.recognition.closeBehaviorDesc",
            "点击窗口关闭按钮时的行为",
          )}
        </p>
      </div>

      {/* 外观主题 */}
      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          {t("settings.appearance.theme", "外观主题")}
        </label>
        <select
          aria-label={t("settings.appearance.theme", "外观主题")}
          value={settings.theme}
          onChange={(e) => onInputChange("theme", e.target.value)}
          className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          <option value="system">
            {t("settings.appearance.system", "跟随系统")}
          </option>
          <option value="light">
            {t("settings.appearance.light", "浅色")}
          </option>
          <option value="dark">{t("settings.appearance.dark", "深色")}</option>
        </select>
      </div>

      {/* [20260712_Fix_LanguagePersistence] Restore localStorage.setItem
          so the language choice persists across app restarts. i18n/index.js
          reads localStorage on init via savedLanguage. */}
      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          {t("settings.language.label", "语言")}
        </label>
        <select
          aria-label={t("settings.language.label", "语言")}
          value={i18n.language}
          onChange={(e) => {
            i18n.changeLanguage(e.target.value);
            localStorage.setItem("language", e.target.value);
            document.documentElement.lang = e.target.value;
            // [20260905_Fix_249_ReviewMinor] Go through the setting pipeline
            // so the main/history windows can follow the language switch live
            // (SETTINGS_UPDATE broadcast), not only at next start.
            onInputChange("language", e.target.value);
          }}
          className="text-sm px-3 py-2 border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-[#0071e3] focus:border-transparent"
        >
          <option value="zh-CN">{t("settings.language.zhCN", "中文")}</option>
          <option value="en">{t("settings.language.en", "English")}</option>
        </select>
      </div>

      {/* [20260820_T14_Hotwords] Hotword editor: raw multi-line storage;
          full sanitization happens at the injection boundary
          (src/helpers/hotwords.ts). Limits surface in the hint so paste
          accidents are visible instead of silently capped later. */}
      <div>
        <label
          htmlFor="hotwords-input"
          className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1"
        >
          {t("settings.general.hotwordsLabel", "热词")}
        </label>
        <p className="text-xs text-[#6e6e73] mb-2">
          {t(
            "settings.general.hotwordsDesc",
            "每行一个。识别时优先匹配这些词,提升生僻专名命中率。",
          )}
        </p>
        <textarea
          id="hotwords-input"
          value={settings.hotwords}
          onChange={(e) => onInputChange("hotwords", e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={t("settings.general.hotwordsPlaceholder", "张晗玥…")}
          aria-describedby="hotwords-hint"
          className="w-full text-sm px-3 py-2 border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-[#0071e3] focus:border-transparent resize-y"
        />
        <p id="hotwords-hint" className="text-xs text-[#6e6e73] mt-1">
          {t("settings.general.hotwordsLimit", "最多 200 行,每行 32 字")}
        </p>
      </div>

      {/* [20260905_Fix_246_HotkeySettingsUi] Recording-hotkey recorder. The
          captured combo is persisted immediately (onInputChange) — the main
          window re-registers the global shortcut on SETTINGS_UPDATE. */}
      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          {t("settings.general.hotkeyLabel", "录音快捷键")}
        </label>
        <p className="text-xs text-[#6e6e73] mb-2">
          {t(
            "settings.general.hotkeyDesc",
            "全局快捷键,任意界面按下即可开始/停止录音。",
          )}
        </p>
        <div className="flex items-center gap-3">
          <span
            data-testid="hotkey-current"
            className="px-3 py-1.5 text-sm font-mono border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
          >
            {formatAccelerator(
              settings.hotkey,
              t("settings.general.hotkeySpace", "空格"),
            )}
          </span>
          <button
            type="button"
            data-testid="hotkey-record"
            // [20260905_Fix_249_ReviewMinor] The capture zone's onBlur ends
            // recording — clicking the button would focus it first (blur →
            // false) and then toggle back to true, so 取消 re-entered capture.
            // Keeping focus on the button lets onClick end it cleanly.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setRecording((prev) => !prev)}
            className="px-3 py-1.5 text-sm rounded-lg bg-[#0071e3] text-white hover:bg-[#0077ed] focus:outline-none focus:ring-2 focus:ring-[#0071e3] focus:ring-offset-2"
          >
            {recording
              ? t("settings.general.hotkeyCancel", "取消")
              : t("settings.general.hotkeyStart", "更改")}
          </button>
        </div>
        {recording && (
          <div
            data-testid="hotkey-capture"
            tabIndex={0}
            onKeyDown={handleCaptureKeyDown}
            // [20260905_Fix_246_HotkeyRecorderBlur] Clicking elsewhere must
            // end the capture — otherwise the UI keeps showing "press a key"
            // while nothing is captured until refocus.
            onBlur={() => setRecording(false)}
            autoFocus
            className="mt-2 px-3 py-2 text-sm border-2 border-[#0071e3] rounded-lg bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none"
          >
            {t(
              "settings.general.hotkeyRecording",
              "请按下新的快捷键组合(Esc 取消)…",
            )}
          </div>
        )}
      </div>
      {/* [20260908_Feat_240_VocabCorrections] T13 corrections management. */}
      <VocabManager />
    </div>
  );
};
