import { useTranslation } from "react-i18next";
import type React from "react";
import type { SettingsState } from "../useSettings";

interface GeneralSectionProps {
  settings: SettingsState;
  onInputChange: (key: string, value: unknown) => void;
}

export const GeneralSection: React.FC<GeneralSectionProps> = ({
  settings,
  onInputChange,
}) => {
  const { t, i18n } = useTranslation();

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
          <p className="text-xs text-[#86868b]">
            {t("settings.general.alwaysOnTopDesc", "将应用窗口保持在最前面")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
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

      {/* [20260729_Feat_EffectsToggle] Visual-effects toggle (History window).
          Copy of the always-on-top switch pattern above. Persisted via the
          shared Save button (same mechanism as other settings). Effects are
          opt-in (default off) to protect low-end machines from WebGL software
          rendering. */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
            {t("settings.effects.enableEffects", "启用视觉特效")}
          </label>
          <p className="text-xs text-[#86868b]">
            {t(
              "settings.effects.enableEffectsDesc",
              "在历史记录窗口显示动画背景（需要 WebGL 支持）",
            )}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.effects_enabled}
          onClick={() =>
            onInputChange("effects_enabled", !settings.effects_enabled)
          }
          className={`${
            settings.effects_enabled
              ? "bg-[#0071e3]"
              : "bg-[#d2d2d7] dark:bg-[#3a3a3c]"
          } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#0071e3] focus:ring-offset-2`}
        >
          <span
            aria-hidden="true"
            className={`${
              settings.effects_enabled ? "translate-x-4" : "translate-x-0"
            } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
          />
        </button>
      </div>

      {/* [20260712_Fix_AutoPasteValue] CRITICAL: option value must be
          "clipboard_only" (not "clipboard") to match App.tsx's runtime
          check: if (autoPaste === "clipboard_only"). Using "clipboard"
          would cause auto-paste even when user chose clipboard-only. */}
      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          {t("settings.recognition.autoPaste", "自动粘贴行为")}
        </label>
        <select
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
        <p className="mt-1 text-xs text-[#86868b]">
          {t(
            "settings.recognition.autoPasteDesc",
            "语音识别完成后的文本处理方式",
          )}
        </p>
      </div>

      {/* 关闭行为 */}
      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          {t("settings.recognition.closeBehavior", "关闭行为")}
        </label>
        <select
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
        <p className="mt-1 text-xs text-[#86868b]">
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
          value={i18n.language}
          onChange={(e) => {
            i18n.changeLanguage(e.target.value);
            localStorage.setItem("language", e.target.value);
            document.documentElement.lang = e.target.value;
          }}
          className="text-sm px-3 py-2 border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-[#0071e3] focus:border-transparent"
        >
          <option value="zh-CN">{t("settings.language.zhCN", "中文")}</option>
          <option value="en">{t("settings.language.en", "English")}</option>
        </select>
      </div>
    </div>
  );
};
