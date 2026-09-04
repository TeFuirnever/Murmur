import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
// [ADR-015] Use theme-aware wrapper instead of bare sonner, and position at
// bottom-center so the toast never overlaps form content or action buttons.
import { Toaster } from "./components/ui/sonner";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { assertElectronAPI } from "./bootstrap/assertElectronAPI.js";
import { useSettings } from "./settings/useSettings";
import {
  SettingsSidebar,
  type SettingsSection,
} from "./settings/SettingsSidebar";
import { GeneralSection } from "./settings/sections/GeneralSection";
import { BotSection } from "./settings/sections/BotSection";
import { PermissionsSection } from "./settings/sections/PermissionsSection";
import { AIConfigSection } from "./settings/sections/AIConfigSection";
import { AboutSection } from "./settings/sections/AboutSection";

const sectionTitles: Record<SettingsSection, string> = {
  general: "settings.sections.general",
  bot: "settings.sidebar.bot",
  permissions: "settings.sections.permissions",
  ai: "settings.sections.ai",
  about: "settings.sections.about",
};

// [20260713_Fix_NoHardcodedChinese] Fallback defaults are now plain English
// (the i18n key resolves to the correct language at runtime).
const sectionTitleDefaults: Record<SettingsSection, string> = {
  general: "General",
  bot: "Bot",
  permissions: "Permissions",
  ai: "AI Configuration",
  about: "About Murmur",
};

const SettingsPage = () => {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");

  const {
    settings,
    loading,
    saving,
    handleInputChange,
    saveSettings,
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
    showQuickStart,
    appVersion,
    checkingUpdate,
    updateInfo,
    downloadProgress,
    downloadedUpdate,
    checkForUpdates,
    startDownload,
  } = useSettings();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#1c1c1e] flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#0071e3]" />
          <span className="text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80">
            {t("settings.loading", "加载设置中...")}
          </span>
        </div>
      </div>
    );
  }

  const title = t(
    sectionTitles[activeSection],
    sectionTitleDefaults[activeSection],
  );

  return (
    <div className="h-screen bg-[#f5f5f7] dark:bg-[#1c1c1e] flex flex-col">
      {/* 标题栏 */}
      <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-sm border-b border-[#d2d2d7] dark:border-[#3a3a3c] px-4 py-3 flex items-center justify-between flex-shrink-0">
        <h1 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          {title}
        </h1>
        <button
          type="button"
          onClick={() => {
            if (window.electronAPI?.hideSettingsWindow) {
              window.electronAPI.hideSettingsWindow();
            }
          }}
          className="p-1.5 hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] rounded-md transition-colors"
          aria-label={t("settings.close", "关闭设置")}
        >
          <X className="w-4 h-4 text-[#86868b]" />
        </button>
      </div>

      {/* 主体：侧边栏 + 内容 */}
      <div className="flex-1 flex min-h-0">
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />

        {/* 内容面板 */}
        <main
          className="flex-1 overflow-y-auto"
          role="tabpanel"
          aria-label={title}
        >
          <div className="max-w-xl mx-auto p-6">
            <div className="bg-white dark:bg-[#2c2c2e] rounded-xl shadow-sm border border-[#d2d2d7] dark:border-[#3a3a3c] p-5">
              {activeSection === "general" && (
                <GeneralSection
                  settings={settings}
                  onInputChange={handleInputChange}
                />
              )}
              {activeSection === "bot" && (
                // [20260905_Feat_BloubSettings] bot mascot catalogue pickers
                <BotSection
                  settings={settings}
                  onInputChange={handleInputChange}
                />
              )}
              {activeSection === "permissions" && <PermissionsSection />}
              {activeSection === "ai" && (
                <AIConfigSection
                  settings={settings}
                  onInputChange={handleInputChange}
                  customModel={customModel}
                  setCustomModel={setCustomModel}
                  resolvedProviderPresets={resolvedProviderPresets}
                  providerPresets={providerPresets}
                  applyProviderPreset={applyProviderPreset}
                  showApiKey={showApiKey}
                  setShowApiKey={setShowApiKey}
                  apiKeyInputRef={apiKeyInputRef}
                  testing={testing}
                  testResult={testResult}
                  testAIConfiguration={testAIConfiguration}
                  saveSettings={saveSettings}
                  saving={saving}
                  showQuickStart={showQuickStart}
                />
              )}
              {activeSection === "about" && (
                <AboutSection
                  appVersion={appVersion}
                  checkingUpdate={checkingUpdate}
                  updateInfo={updateInfo}
                  downloadProgress={downloadProgress}
                  downloadedUpdate={downloadedUpdate}
                  checkForUpdates={checkForUpdates}
                  startDownload={startDownload}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export { SettingsPage };

if (document.getElementById("settings-root") && assertElectronAPI()) {
  const root = ReactDOM.createRoot(document.getElementById("settings-root")!);
  root.render(
    <React.Fragment>
      <SettingsPage />
      <Toaster position="bottom-center" />
    </React.Fragment>,
  );
}
