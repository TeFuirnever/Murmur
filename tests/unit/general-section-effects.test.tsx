// [20260729_Test_GeneralSectionEffects]
// @vitest-environment jsdom
import "../setup/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

// Mock react-i18next: return the fallback string so we can assert label text
// without depending on i18n resource files.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback,
    i18n: {
      language: "zh-CN",
      changeLanguage: () => {
        // no-op in tests
      },
    },
  }),
}));

import { GeneralSection } from "../../src/settings/sections/GeneralSection";
import type { SettingsState } from "../../src/settings/useSettings";

// Build a complete SettingsState so we only override the field under test.
function buildSettings(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    ai_api_key: "",
    ai_base_url: "https://api.openai.com/v1",
    ai_model: "gpt-3.5-turbo",
    ai_temperature: 0.3,
    ai_max_tokens: 2000,
    enable_ai_optimization: true,
    window_always_on_top: false,
    auto_paste: "paste",
    close_behavior: "hide",
    theme: "system",
    effects_enabled: false,
    ...overrides,
  };
}

// GeneralSection references window.electronAPI on the always-on-top toggle
// click; the effects toggle does not use it, but keep window consistent.
beforeEach(() => {
  (window as unknown as { electronAPI: unknown }).electronAPI = {};
});

describe("[20260729_Test_GeneralSectionEffects] GeneralSection effects toggle", () => {
  it("renders effects toggle as unchecked when effects_enabled is false", () => {
    const onInputChange = vi.fn();
    const ui: ReactElement = (
      <GeneralSection
        settings={buildSettings({ effects_enabled: false })}
        onInputChange={onInputChange}
      />
    );
    render(ui);

    // The effects switch is the one adjacent to the "启用视觉特效" label.
    const label = screen.getByText("启用视觉特效");
    const section = label.closest("div.flex.items-center.justify-between");
    const toggle = section?.querySelector('button[role="switch"]');
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("renders effects toggle as checked when effects_enabled is true", () => {
    const onInputChange = vi.fn();
    const ui: ReactElement = (
      <GeneralSection
        settings={buildSettings({ effects_enabled: true })}
        onInputChange={onInputChange}
      />
    );
    render(ui);

    const label = screen.getByText("启用视觉特效");
    const section = label.closest("div.flex.items-center.justify-between");
    const toggle = section?.querySelector('button[role="switch"]');
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("calls onInputChange with (effects_enabled, true) when toggled from off", async () => {
    const onInputChange = vi.fn();
    const user = userEvent.setup();
    const ui: ReactElement = (
      <GeneralSection
        settings={buildSettings({ effects_enabled: false })}
        onInputChange={onInputChange}
      />
    );
    render(ui);

    const label = screen.getByText("启用视觉特效");
    const section = label.closest("div.flex.items-center.justify-between");
    const toggle = section?.querySelector(
      'button[role="switch"]',
    ) as HTMLButtonElement;

    await user.click(toggle);

    expect(onInputChange).toHaveBeenCalledTimes(1);
    expect(onInputChange).toHaveBeenCalledWith("effects_enabled", true);
  });

  it("shows the i18n fallback text for the effects toggle label and description", () => {
    const onInputChange = vi.fn();
    const ui: ReactElement = (
      <GeneralSection
        settings={buildSettings({ effects_enabled: false })}
        onInputChange={onInputChange}
      />
    );
    render(ui);

    expect(screen.getByText("启用视觉特效")).toBeInTheDocument();
    expect(
      screen.getByText("在历史记录窗口显示动画背景（需要 WebGL 支持）"),
    ).toBeInTheDocument();
  });
});
