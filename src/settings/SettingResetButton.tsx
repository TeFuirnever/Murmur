// [20260926_Issue407] Per-setting modified indicator + single-item reset
// (VS Code convention, research suggestion #6 of Epic #392): every discrete
// control shows a small dot while its value differs from the SCHEMA default,
// and clicking it writes the default back through the section's existing
// onInputChange pipeline — the same auto-persist path every control uses, so
// the reset takes effect immediately and broadcasts to the other windows like
// any settings change. No new IPC, no global reset.
//
// Schema-derived by design (issue #403 made the schema the single source of
// truth): the button reads the default AND the description key from
// settingsSchema.ts, so a schema default change flows here automatically and
// sections never hardcode defaults. The modified check is strict !==, which
// is exactly right for the string/number/boolean values a schema entry can
// carry.
//
// Scope note: wired for the General / AI / Bot tabs' DISCRETE controls
// (switch / select / slider, plus the hotkey recorder — all write atomically,
// so a stray click cannot destroy work-in-progress typing). Text-like inputs
// (hotwords, ai_api_key, ai_base_url, model_download_path) are deliberately
// NOT wired: their debounced write pipeline (#402) plus long-text values make
// an accidental reset destructive with no undo. Templates/Permissions/About
// carry no settings-state keys.

import { useTranslation } from "react-i18next";
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA,
  type SettingsState,
} from "./settingsSchema";

interface SettingResetButtonProps {
  /** The settings-state key this button watches/resets (schema-derived). */
  settingKey: keyof SettingsState;
  /** Current value from the section's settings state. */
  value: unknown;
  /** The section's write path — onInputChange (existing persistence pipeline). */
  onReset: (key: string, value: unknown) => void;
}

/**
 * Modified-dot + reset control for one setting. Renders NOTHING while the
 * value equals the schema default (zero layout impact at defaults); once
 * modified it renders a small dot button whose title carries the default
 * value and whose click writes the default back.
 */
export function SettingResetButton({
  settingKey,
  value,
  onReset,
}: SettingResetButtonProps) {
  const { t } = useTranslation();
  const defaultValue: unknown = DEFAULT_SETTINGS[settingKey];
  const modified = value !== defaultValue;
  if (!modified) {
    return null;
  }

  // descriptionKey is optional per definition, so narrow via `in` before use.
  const def = SETTINGS_SCHEMA[settingKey];
  const descriptionKey =
    "descriptionKey" in def ? def.descriptionKey : undefined;
  // Hover tooltip: the mandated VS Code-style hint 「已修改，默认值：X」.
  const title = t("settings.resetHint", { value: String(defaultValue) });
  // Screen readers get the action, not just the state; keys with a schema
  // descriptionKey name WHAT is being reset ("重置为默认值：将应用窗口保持在
  // 最前面"), bare keys degrade to the action alone next to their visible
  // label ("重置为默认值").
  const ariaLabel = descriptionKey
    ? `${t("settings.resetToDefault")}：${t(descriptionKey)}`
    : t("settings.resetToDefault");

  return (
    <button
      type="button"
      data-testid={`reset-${settingKey}`}
      title={title}
      aria-label={ariaLabel}
      onClick={() => onReset(settingKey, defaultValue)}
      className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[#86868b] hover:bg-[#e8e8ed] hover:text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3] dark:hover:bg-[#3a3a3c] dark:hover:text-[#f5f5f7]"
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-[#0071e3]"
      />
    </button>
  );
}
