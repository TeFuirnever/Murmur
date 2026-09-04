// [20260905_Feat_BloubSettings] Settings section exposing the bot mascot's
// catalogue (shape / colour / expression) per spec #224 ticket 5 and decision
// #220. Three pickers, one settings key each; writes go through the shared
// handleInputChange so they persist immediately and broadcast to the main
// window (onSettingsUpdate), where the mascot hot-swaps.
// Catalogue item labels resolve via i18n keys with the capitalised id as the
// inline default, so missing keys degrade to a readable English name.

import { useTranslation } from "react-i18next";
import type React from "react";
import type { SettingsState } from "../useSettings";
import { COLORS, SHAPES } from "../../bot/skins";
import { EXPRESSIONS } from "../../bot/expressions";

interface BotSectionProps {
  settings: SettingsState;
  onInputChange: (key: string, value: unknown) => void;
}

const cap = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

const COLOR_OPTIONS: Array<{
  value: string;
  labelKey: string;
  fallback: string;
}> = [
  {
    value: "auto",
    labelKey: "settings.bot.autoColor",
    fallback: "Follow theme",
  },
  ...COLORS.map((c) => ({
    value: c.id,
    labelKey: `settings.bot.color.${c.id}`,
    fallback: cap(c.id),
  })),
];

export const BotSection: React.FC<BotSectionProps> = ({
  settings,
  onInputChange,
}) => {
  const { t } = useTranslation();

  const selects: Array<{
    labelKey: string;
    labelFallback: string;
    value: string;
    key: string;
    options: Array<{ value: string; label: string }>;
  }> = [
    {
      labelKey: "settings.bot.shape",
      labelFallback: "Shape",
      value: settings.bot_shape,
      key: "bot_shape",
      options: SHAPES.map((s) => ({
        value: s.id,
        label: t(`settings.bot.shape.${s.id}`, cap(s.id)),
      })),
    },
    {
      labelKey: "settings.bot.color",
      labelFallback: "Colour",
      value: settings.bot_color,
      key: "bot_color",
      options: COLOR_OPTIONS.map((o) => ({
        value: o.value,
        label: t(o.labelKey, o.fallback),
      })),
    },
    {
      labelKey: "settings.bot.expression",
      labelFallback: "Expression",
      value: settings.bot_expression,
      key: "bot_expression",
      options: EXPRESSIONS.map((e) => ({
        value: e.id,
        label: t(`settings.bot.expression.${e.id}`, cap(e.id)),
      })),
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-xs text-[#86868b]">
        {t(
          "settings.bot.description",
          "The title-bar mascot. Colours follow the light/dark theme until you pick one.",
        )}
      </p>
      {selects.map((sel) => (
        <div key={sel.key} className="flex items-center justify-between">
          <label
            htmlFor={`bot-${sel.key}`}
            className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]"
          >
            {t(sel.labelKey, sel.labelFallback)}
          </label>
          <select
            id={`bot-${sel.key}`}
            value={sel.value}
            onChange={(e) => onInputChange(sel.key, e.target.value)}
            className="rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-transparent px-3 py-1.5 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]"
          >
            {sel.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
};
