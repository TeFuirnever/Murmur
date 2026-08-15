// [20260815_Fix_AiMaxTokensDefault] Component contract test for the AI
// settings section's 最大输出长度 slider. The old ceiling (4096) was too low
// for reasoning models, whose thinking tokens count against max_tokens and
// could exhaust the budget before any content was emitted (see
// 20260815_Fix_AiEmptyContent). This locks the slider to the new bounds
// (1024–16384) and pins the default 8192 onto the slider's notch grid.
// @vitest-environment happy-dom
import React from "react";
import { render, screen } from "@testing-library/react";
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
  window_always_on_top: true,
  auto_paste: "paste",
  close_behavior: "hide",
  theme: "system",
  effects_enabled: false,
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
      saveSettings={vi.fn().mockResolvedValue(true)}
      saving={false}
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
