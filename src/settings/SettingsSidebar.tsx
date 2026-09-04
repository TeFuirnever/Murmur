import type React from "react";
import { Settings, Shield, Bot, Info, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

// [20260905_Feat_BloubSettings] "bot" section added (spec #224 ticket 5)
export type SettingsSection =
  | "general"
  | "bot"
  | "permissions"
  | "ai"
  | "about";

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

const SECTIONS: {
  id: SettingsSection;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
}[] = [
  { id: "general", icon: Settings, labelKey: "settings.sidebar.general" },
  // [20260905_Feat_BloubSettings] bot mascot section
  { id: "bot", icon: Sparkles, labelKey: "settings.sidebar.bot" },
  { id: "permissions", icon: Shield, labelKey: "settings.sidebar.permissions" },
  { id: "ai", icon: Bot, labelKey: "settings.sidebar.ai" },
  { id: "about", icon: Info, labelKey: "settings.sidebar.about" },
];

// [20260713_Fix_NoHardcodedChinese] Fallback defaults are now plain English
// (the i18n key resolves to the correct language at runtime). No hardcoded
// Chinese remains in this file.
const sectionLabelFallbacks: Record<SettingsSection, string> = {
  general: "General",
  bot: "Bot",
  permissions: "Permissions",
  ai: "AI Config",
  about: "About",
};

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();

  return (
    <nav
      className="w-[180px] flex-shrink-0 border-r border-[#d2d2d7] dark:border-[#3a3a3c] py-3 px-2"
      aria-label={t("settings.title", "Settings")}
    >
      <ul className="space-y-0.5" role="list">
        {SECTIONS.map(({ id, icon: Icon, labelKey }) => {
          const isActive = activeSection === id;
          const label = t(labelKey, sectionLabelFallbacks[id]);
          return (
            <li key={id}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSectionChange(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  isActive
                    ? "bg-[#0071e3]/10 text-[#0071e3] font-medium"
                    : "text-[#1d1d1f]/70 dark:text-[#f5f5f7]/70 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
