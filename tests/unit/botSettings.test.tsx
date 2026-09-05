// [20260905_Feat_BloubSettings] Ticket 5 (spec #224): expose the bot
// catalogue through settings. Pins the allowlist side of the 4-places
// contract (the only place not enforced by the compiler) and the BotSection
// UI contract (three pickers writing the right settings keys).

// @vitest-environment jsdom
import "../setup/react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { validateSetting } from "../../src/helpers/ipc/settingsHandlers";
import { BotSection } from "../../src/settings/sections/BotSection";
import { COLORS, SHAPES } from "../../src/bot/skins";
import { EXPRESSIONS } from "../../src/bot/expressions";
import zhCN from "../../src/i18n/locales/zh-CN.json";
import en from "../../src/i18n/locales/en.json";
import type { SettingsState } from "../../src/settings/useSettings";

const BASE: SettingsState = {
  ai_api_key: "",
  ai_base_url: "",
  ai_model: "",
  ai_temperature: 0.3,
  ai_max_tokens: 8192,
  enable_ai_optimization: true,
  window_always_on_top: true,
  auto_paste: "paste",
  close_behavior: "hide",
  theme: "system",
  hotwords: "",
  bot_shape: "circle",
  bot_color: "auto",
  bot_expression: "neutral",
};

describe("bot settings keys are writable through the IPC allowlist", () => {
  it("accepts the three bot keys with plausible values", () => {
    expect(validateSetting("bot_shape", "circle")).toBe(true);
    expect(validateSetting("bot_color", "auto")).toBe(true);
    expect(validateSetting("bot_color", "blue")).toBe(true);
    expect(validateSetting("bot_expression", "neutral")).toBe(true);
  });

  it("still rejects unknown keys", () => {
    expect(validateSetting("bot_shapee", "circle")).toBe(false);
    expect(validateSetting("effects_enabled", true)).toBe(false);
  });
});

describe("BotSection", () => {
  it("renders shape, colour and expression pickers", () => {
    render(<BotSection settings={BASE} onInputChange={vi.fn()} />);
    expect(screen.getByLabelText(/Shape/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Colour/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Expression/)).toBeInTheDocument();
  });

  it("colour picker offers the follow-theme default plus the 12-colour catalogue", () => {
    render(<BotSection settings={BASE} onInputChange={vi.fn()} />);
    const colorSelect = screen.getByLabelText(/Colour/) as HTMLSelectElement;
    expect(colorSelect.options.length).toBe(13); // auto + 12 colours
  });

  it("writes bot_shape on change", async () => {
    const onInputChange = vi.fn();
    render(<BotSection settings={BASE} onInputChange={onInputChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/Shape/), "droplet");
    expect(onInputChange).toHaveBeenCalledWith("bot_shape", "droplet");
  });

  it("writes bot_color on change", async () => {
    const onInputChange = vi.fn();
    render(<BotSection settings={BASE} onInputChange={onInputChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/Colour/), "blue");
    expect(onInputChange).toHaveBeenCalledWith("bot_color", "blue");
  });

  it("writes bot_expression on change", async () => {
    const onInputChange = vi.fn();
    render(<BotSection settings={BASE} onInputChange={onInputChange} />);
    await userEvent.selectOptions(screen.getByLabelText(/Expression/), "happy");
    expect(onInputChange).toHaveBeenCalledWith("bot_expression", "happy");
  });
});

describe("bot label keys exist in both locales", () => {
  // the section resolves labels as t(`settings.bot.<dim>.${id}`, fallback);
  // a typo'd id or key would silently degrade to the capitalised id in the
  // UI, so pin every catalogue id against both locale files
  const locales: Array<[string, typeof zhCN]> = [
    ["zh-CN", zhCN],
    ["en", en],
  ];

  it("covers every catalogue id under settings.bot.*", () => {
    for (const [name, data] of locales) {
      const bot = data.settings.bot;
      for (const s of SHAPES)
        expect(bot.shape[s.id], `${name} shape ${s.id}`).toBeDefined();
      for (const c of COLORS)
        expect(bot.color[c.id], `${name} colour ${c.id}`).toBeDefined();
      for (const e of EXPRESSIONS)
        expect(
          bot.expression[e.id],
          `${name} expression ${e.id}`,
        ).toBeDefined();
      expect(bot.autoColor).toBeDefined();
      expect(data.settings.sections.bot).toBeDefined();
      expect(data.settings.sidebar.bot).toBeDefined();
    }
  });

  it("does not carry the dead color.auto key", () => {
    for (const [, data] of locales) {
      // record view: "auto" was deleted from the locales, so typed access
      // would be a compile error — the absence is exactly what we pin
      const color = data.settings.bot.color as Record<string, unknown>;
      expect(color.auto).toBeUndefined();
    }
  });
});
