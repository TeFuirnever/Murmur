// [20260815_Fix_AiMaxTokensDefault] Component contract test for the AI
// settings section's 最大输出长度 slider. The old ceiling (4096) was too low
// for reasoning models, whose thinking tokens count against max_tokens and
// could exhaust the budget before any content was emitted (see
// 20260815_Fix_AiEmptyContent). This locks the slider to the new bounds
// (1024–16384) and pins the default 8192 onto the slider's notch grid.
// @vitest-environment happy-dom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AIConfigSection } from "../../../src/settings/sections/AIConfigSection";
import type { SettingsState } from "../../../src/settings/useSettings";

// t() echoes its fallback arg — deterministic, no i18n backend required.
vi.mock("react-i18next", () => {
  const t = (key: string, fallback?: string) => fallback ?? key;
  return { useTranslation: () => ({ t }) };
});

const BASE_SETTINGS: SettingsState = {
  ai_api_key: "sk-test",
  ai_base_url: "https://api.deepseek.com",
  ai_model: "deepseek-v4-flash",
  ai_temperature: 0.3,
  ai_max_tokens: 8192,
  enable_ai_optimization: true,
  // [20260905_Fix_249_DefaultModeUi] new settings key
  default_mode: "auto",
  window_always_on_top: true,
  auto_paste: "paste",
  close_behavior: "hide",
  theme: "system",
  // [20260905_Fix_246_HotkeySettingsUi] new settings key
  hotkey: "CommandOrControl+Shift+Space",
  hotwords: "",
  bot_shape: "circle",
  bot_color: "auto",
  bot_expression: "neutral",
  // [20260926_Refactor_403_SettingsSchema] new SettingsState key
  show_notifications: true,
  // [20260926_Issue404] new SettingsState key
  auto_start: false,
};

function renderSection(settings: SettingsState = BASE_SETTINGS) {
  return render(
    <AIConfigSection
      settings={settings}
      onInputChange={vi.fn()}
      customModel={false}
      setCustomModel={vi.fn()}
      resolvedProviderPresets={[]}
      providerPresets={[]}
      applyProviderPreset={vi.fn()}
      showApiKey={false}
      setShowApiKey={vi.fn()}
      apiKeyInputRef={{ current: null }}
      testing={false}
      testResult={null}
      testAIConfiguration={vi.fn()}
      showQuickStart={false}
    />,
  );
}

function findMaxTokensSlider(): HTMLInputElement {
  const label = screen.getByText("最大输出长度");
  // The label and its slider share the wrapping <div> block.
  const block = label.closest("div")!.parentElement!;
  const slider = block.querySelector(
    'input[type="range"]',
  ) as HTMLInputElement | null;
  expect(slider).not.toBeNull();
  return slider!;
}

describe("AIConfigSection max output tokens slider", () => {
  it("allows up to 16384 tokens (reasoning models need headroom)", () => {
    renderSection();
    const slider = findMaxTokensSlider();
    expect(slider.max).toBe("16384");
    expect(slider.min).toBe("1024");
  });

  it("keeps the 8192 default on the slider's notch grid", () => {
    renderSection();
    const slider = findMaxTokensSlider();
    const min = parseInt(slider.min, 10);
    const step = parseInt(slider.step, 10);
    // Independent truth: 8192 = 1024 + 30×256, so the default value must sit
    // exactly on a notch — otherwise the thumb renders off the saved value.
    expect((8192 - min) % step).toBe(0);
    expect(slider.value).toBe("8192");
  });
});

// [20260926_Perf_402_TextInputDebounce] The API-key, base-URL, and custom
// model inputs persist debounced (issue #402); leaving a field flushes the
// pending write. The AI-model dropdown stays a discrete select: its change
// must reach onInputChange flagged immediate so the hook persists it in the
// same tick instead of after the 400ms debounce window.
describe("AIConfigSection text-input flush + immediate select (issue #402)", () => {
  interface RenderOverrides {
    onInputChange?: (
      key: string,
      value: unknown,
      options?: { immediate?: boolean },
    ) => void;
    onInputBlur?: () => void;
    customModel?: boolean;
  }

  function renderWithOverrides(overrides: RenderOverrides = {}) {
    return render(
      <AIConfigSection
        settings={BASE_SETTINGS}
        onInputChange={overrides.onInputChange ?? (() => undefined)}
        onInputBlur={overrides.onInputBlur}
        customModel={overrides.customModel ?? false}
        setCustomModel={vi.fn()}
        resolvedProviderPresets={[]}
        providerPresets={[]}
        applyProviderPreset={vi.fn()}
        showApiKey={false}
        setShowApiKey={vi.fn()}
        apiKeyInputRef={{ current: null }}
        testing={false}
        testResult={null}
        testAIConfiguration={vi.fn()}
        showQuickStart={false}
      />,
    );
  }

  it("requests a pending-write flush when a text input blurs", () => {
    const onInputBlur = vi.fn();
    renderWithOverrides({ onInputBlur });
    fireEvent.blur(screen.getByPlaceholderText("请输入您的AI API Key"));
    fireEvent.blur(screen.getByPlaceholderText("https://api.openai.com/v1"));
    expect(onInputBlur).toHaveBeenCalledTimes(2);
  });

  it("flags the AI-model dropdown change as immediate", () => {
    const onInputChange = vi.fn();
    renderWithOverrides({ onInputChange });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "gpt-6-luna" },
    });
    expect(onInputChange).toHaveBeenCalledWith("ai_model", "gpt-6-luna", {
      immediate: true,
    });
  });
});
