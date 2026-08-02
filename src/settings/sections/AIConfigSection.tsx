// [20260713_Fix_NoHardcodedChinese] All user-visible strings now go through
// t() — no hardcoded Chinese remains in JSX.
import React, { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Eye,
  EyeOff,
  Loader2,
  TestTube,
  CheckCircle,
  XCircle,
  Save,
  ExternalLink,
  Sparkles,
  Check,
} from "lucide-react";
import type { AICheckStatusResult } from "../../types/ipc";
import type { SettingsState, ProviderPreset } from "../useSettings";

interface AIConfigSectionProps {
  settings: SettingsState;
  onInputChange: (key: string, value: unknown) => void;
  customModel: boolean;
  setCustomModel: (v: boolean) => void;
  resolvedProviderPresets: {
    label: string;
    baseUrl: string;
    model: string;
    noApiKey: boolean;
  }[];
  providerPresets: ProviderPreset[];
  applyProviderPreset: (preset: {
    label: string;
    baseUrl: string;
    model: string;
  }) => void;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  apiKeyInputRef: React.RefObject<HTMLInputElement | null>;
  testing: boolean;
  // [20260712_Fix_AICheckStatusResultImport] Use canonical IPC type instead
  // of an inline subset to prevent type drift when fields are added.
  testResult: AICheckStatusResult | null;
  testAIConfiguration: () => void;
  saveSettings: () => Promise<boolean>;
  saving: boolean;
  showQuickStart: boolean;
}

export const AIConfigSection: React.FC<AIConfigSectionProps> = ({
  settings,
  onInputChange,
  customModel,
  setCustomModel,
  resolvedProviderPresets,
  providerPresets,
  applyProviderPreset,
  showApiKey,
  setShowApiKey,
  apiKeyInputRef,
  testing,
  testResult,
  testAIConfiguration,
  saveSettings,
  saving,
  showQuickStart,
}) => {
  const { t } = useTranslation();
  // [ADR-015] savedFlash: briefly show "✓ 已保存" on the save button after
  // a successful save. Only triggers when saveSettings returns true.
  const [savedFlash, setSavedFlash] = useState(false);
  // [CodeReview] Track timeout so it can be cleared on unmount to prevent
  // React "state update on unmounted component" warning.
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSave = useCallback(async () => {
    const ok = await saveSettings();
    if (ok) {
      setSavedFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 1500);
    }
  }, [saveSettings]);

  // [CodeReview] Cleanup: clear any pending flash timer on unmount.
  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  return (
    <div className="space-y-5">
      {/* 说明文字 */}
      <p className="text-xs text-[#86868b]">
        {t(
          "settings.ai.description",
          "AI 用于对识别出的文字做润色和优化，是可选功能。语音识别本身使用本地 FunASR 模型，无需在此配置。API Key 无效或留空时，将直接使用原始转录文本。",
        )}
      </p>

      {/* AI优化开关 */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="ai-optimization-toggle"
          className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          {t("settings.ai.enableOptimization", "启用AI文本优化")}
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enable_ai_optimization}
          onClick={() =>
            onInputChange(
              "enable_ai_optimization",
              !settings.enable_ai_optimization,
            )
          }
          className={`${
            settings.enable_ai_optimization
              ? "bg-[#0071e3]"
              : "bg-[#d2d2d7] dark:bg-[#3a3a3c]"
          } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#0071e3] focus:ring-offset-2`}
        >
          <span
            aria-hidden="true"
            className={`${
              settings.enable_ai_optimization
                ? "translate-x-4"
                : "translate-x-0"
            } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
          />
        </button>
      </div>

      {/* Quick Start 引导 */}
      {showQuickStart && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Sparkles className="w-4 h-4 text-[#0071e3]" />
            <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {t("settings.quickStart.title", "快速开始")}
            </h3>
          </div>
          <div className="space-y-2">
            {providerPresets
              .filter(
                (p) =>
                  p.registration &&
                  p.requires_api_key &&
                  !p.base_url.includes("localhost"),
              )
              .sort(
                (a, b) =>
                  (b.registration?.recommended ? 1 : 0) -
                  (a.registration?.recommended ? 1 : 0),
              )
              .map((preset) => (
                <div
                  key={preset.name}
                  className="flex items-center justify-between p-2.5 bg-white/80 dark:bg-[#2c2c2e]/80 rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {preset.label}
                      </span>
                      {preset.registration?.recommended && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-[#0071e3] text-white rounded-full font-medium">
                          {t("settings.quickStart.recommended", "推荐")}
                        </span>
                      )}
                    </div>
                    {/* [20260712_Fix_RegistrationGuideI18n] Look up guide text
                        via i18n key instead of reading preset.registration.guide
                        (which was Chinese-only hardcoded in providerPresets.js). */}
                    <p className="text-[11px] text-[#86868b] mt-0.5 truncate">
                      {t(
                        `settings.providers.${preset.name}.guide`,
                        preset.label,
                      )}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2 ml-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (preset.registration?.url) {
                          window.electronAPI?.openExternal(
                            preset.registration.url,
                          );
                        }
                      }}
                      className="flex items-center space-x-1 px-2 py-1 text-[11px] text-[#0071e3] hover:bg-[#e8f4fd] dark:hover:bg-blue-900/30 rounded-md transition-colors whitespace-nowrap"
                    >
                      <span>{t("settings.quickStart.getKey", "获取 Key")}</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    {preset.registration?.recommended && (
                      <button
                        type="button"
                        onClick={() => {
                          apiKeyInputRef.current?.focus();
                          apiKeyInputRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        }}
                        className="px-2 py-1 text-[11px] bg-[#0071e3] text-white rounded-md hover:bg-[#0077ed] transition-colors whitespace-nowrap"
                      >
                        {t("settings.quickStart.pasteKey", "已有 Key？粘贴")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
          <p className="text-[11px] text-[#86868b] mt-2">
            {t(
              "settings.quickStart.hasKeyHint",
              "💡 已有 API Key？直接在下方配置",
            )}
          </p>
        </div>
      )}

      {/* Provider 快捷选择 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80">
            {t("settings.ai.providerLabel", "提供商")}
          </label>
          <div className="flex flex-wrap items-center gap-1">
            {resolvedProviderPresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyProviderPreset(preset)}
                className="text-xs px-2 py-0.5 bg-[#e8f4fd] text-[#0071e3] dark:bg-blue-900/30 dark:text-blue-400 rounded hover:bg-[#d0eafb] dark:hover:bg-blue-900/50 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* API Key */}
      <div>
        <label className="block text-xs font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-1">
          {t("settings.ai.apiKey", "API Key")}
        </label>
        <div className="relative">
          <input
            type={showApiKey ? "text" : "password"}
            value={settings.ai_api_key}
            onChange={(e) => onInputChange("ai_api_key", e.target.value)}
            placeholder={t(
              "settings.ai.apiKeyPlaceholder",
              "请输入您的AI API Key",
            )}
            ref={apiKeyInputRef}
            className="w-full px-3 py-2 pr-10 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
          >
            {showApiKey ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Base URL */}
      <div>
        <label className="block text-xs font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-1">
          {t("settings.ai.baseUrl", "API Base URL")}
        </label>
        <input
          type="url"
          value={settings.ai_base_url}
          onChange={(e) => onInputChange("ai_base_url", e.target.value)}
          placeholder="https://api.openai.com/v1"
          className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
        />
        <p className="mt-1 text-xs text-[#86868b]">
          {t(
            "settings.ai.baseUrlDesc",
            "AI服务的API端点地址，支持OpenAI兼容的API",
          )}
        </p>
      </div>

      {/* Model */}
      <div>
        <label className="block text-xs font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-1">
          {t("settings.ai.model", "AI模型")}
        </label>
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <input
              type="radio"
              id="predefined-model"
              name="model-type"
              checked={!customModel}
              onChange={() => setCustomModel(false)}
              className="w-3 h-3 text-[#0071e3] border-[#d2d2d7] focus:ring-[#0071e3]"
            />
            <label
              htmlFor="predefined-model"
              className="text-xs text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80"
            >
              {t("settings.ai.predefinedModel", "预定义模型")}
            </label>
          </div>
          {!customModel && (
            <select
              value={settings.ai_model}
              onChange={(e) => onInputChange("ai_model", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4o-mini">GPT-4o Mini</option>
              <option value="qwen3-30b-a3b-instruct-2507">
                {t("settings.ai.qwenRecommended", "Qwen3-30B (推荐)")}
              </option>
            </select>
          )}
          <div className="flex items-center space-x-2">
            <input
              type="radio"
              id="custom-model"
              name="model-type"
              checked={customModel}
              onChange={() => setCustomModel(true)}
              className="w-3 h-3 text-[#0071e3] border-[#d2d2d7] focus:ring-[#0071e3]"
            />
            <label
              htmlFor="custom-model"
              className="text-xs text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80"
            >
              {t("settings.ai.customModel", "自定义模型")}
            </label>
          </div>
          {customModel && (
            <input
              type="text"
              value={settings.ai_model}
              onChange={(e) => onInputChange("ai_model", e.target.value)}
              placeholder={t(
                "settings.ai.modelPlaceholder",
                "输入自定义模型名称",
              )}
              className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
          )}
        </div>
        <p className="mt-1 text-xs text-[#86868b]">
          {t("settings.ai.modelDesc", "选择用于文本优化的AI模型")}
        </p>
      </div>

      {/* AI 参数调节 */}
      <div className="space-y-3">
        <div>
          <div className="flex justify-between">
            <label className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
              {t("settings.ai_temperature", "创造性 (Temperature)")}
            </label>
            <span className="text-xs text-[#86868b]">
              {settings.ai_temperature.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.ai_temperature}
            onChange={(e) =>
              onInputChange("ai_temperature", parseFloat(e.target.value))
            }
            className="w-full h-1.5 bg-[#d2d2d7] dark:bg-[#3a3a3c] rounded-full appearance-none cursor-pointer accent-[#0071e3]"
          />
          <div className="flex justify-between text-[10px] text-[#86868b]">
            <span>{t("settings.ai.precise", "精确")}</span>
            <span>{t("settings.ai.creative", "创造")}</span>
          </div>
        </div>

        <div>
          <div className="flex justify-between">
            <label className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
              {t("settings.ai_max_tokens", "最大输出长度")}
            </label>
            <span className="text-xs text-[#86868b]">
              {settings.ai_max_tokens}
            </span>
          </div>
          <input
            type="range"
            min="500"
            max="4096"
            step="256"
            value={settings.ai_max_tokens}
            onChange={(e) =>
              onInputChange("ai_max_tokens", parseInt(e.target.value, 10))
            }
            className="w-full h-1.5 bg-[#d2d2d7] dark:bg-[#3a3a3c] rounded-full appearance-none cursor-pointer accent-[#0071e3]"
          />
          <div className="flex justify-between text-[10px] text-[#86868b]">
            <span>500</span>
            <span>4096</span>
          </div>
        </div>
      </div>

      {/* 测试结果显示 */}
      {testResult && (
        <div
          className={`p-3 rounded-lg border ${
            testResult.available
              ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
              : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
          }`}
        >
          <div className="flex items-center space-x-2">
            {testResult.available ? (
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
            ) : (
              <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
            )}
            <span
              className={`text-sm font-medium ${
                testResult.available
                  ? "text-green-800 dark:text-green-200"
                  : "text-red-800 dark:text-red-200"
              }`}
            >
              {testResult.available
                ? t("settings.ai.testSuccess", "AI配置测试成功")
                : t("settings.ai.testFailed", "AI配置测试失败")}
            </span>
          </div>
          {testResult.available ? (
            <div className="mt-2 space-y-1">
              {testResult.model && (
                <p className="text-xs text-green-700 dark:text-green-300">
                  <strong>{t("settings.ai.model", "模型")}:</strong>{" "}
                  {testResult.model}
                </p>
              )}
              {testResult.details && (
                <p className="text-xs text-green-700 dark:text-green-300">
                  <strong>{t("settings.ai.status", "状态")}:</strong>{" "}
                  {testResult.details}
                </p>
              )}
              {testResult.response && (
                <p className="text-xs text-green-700 dark:text-green-300">
                  <strong>{t("settings.ai.response", "AI回复")}:</strong>{" "}
                  {testResult.response}
                </p>
              )}
              {/* [20260712_Fix_TestResultUsage] Restore token usage display
                  that was lost during refactor. Power users use this to
                  diagnose model cost. */}
              {testResult.usage && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  <strong>{t("settings.ai.tokenUsage", "Token使用")}:</strong>{" "}
                  {testResult.usage.total_tokens || "N/A"}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-1">
              {testResult.error && (
                <p className="text-xs text-red-700 dark:text-red-300">
                  <strong>{t("settings.ai.unknownError", "错误")}:</strong>{" "}
                  {testResult.error}
                </p>
              )}
              {testResult.details && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {testResult.details}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center justify-between pt-4 border-t border-[#d2d2d7] dark:border-[#3a3a3c]">
        <button
          type="button"
          onClick={testAIConfiguration}
          disabled={testing}
          className="flex items-center space-x-2 px-3 py-1.5 text-sm bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <TestTube className="w-3 h-3" />
          )}
          <span>
            {testing
              ? t("settings.ai.testing", "测试中...")
              : t("settings.ai.testConfig", "测试配置")}
          </span>
        </button>
        <button
          type="button"
          onClick={handleSave}
          aria-label={t("settings.save", "保存设置")}
          disabled={saving}
          className={`flex items-center space-x-2 px-4 py-1.5 text-sm text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            savedFlash ? "bg-[#34c759]" : "bg-[#0071e3] hover:bg-[#0077ed]"
          }`}
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : savedFlash ? (
            <Check className="w-3 h-3" />
          ) : (
            <Save className="w-3 h-3" />
          )}
          <span>
            {saving
              ? t("settings.saving", "保存中...")
              : savedFlash
                ? t("settings.saved", "已保存")
                : t("settings.save", "保存设置")}
          </span>
        </button>
      </div>
    </div>
  );
};
