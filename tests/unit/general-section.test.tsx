// @vitest-environment jsdom
// [20260816_Test_GeneralSection] GeneralSection was 0% — render + interaction
// coverage for the always-on-top toggle (live IPC side effect), theme select,
// and auto-paste/close-behavior selects.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: "zh-CN", changeLanguage: vi.fn() },
  }),
}));

import { GeneralSection } from "../../src/settings/sections/GeneralSection";
import type { SettingsState } from "../../src/settings/useSettings";

const BASE: SettingsState = {
  ai_api_key: "",
  ai_base_url: "https://api.openai.com/v1",
  ai_model: "gpt-3.5-turbo",
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

type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI?: { setAlwaysOnTop: (v: boolean) => void };
};

describe("[20260816_Test_GeneralSection] GeneralSection", () => {
  const onInputChange = vi.fn();
  const setAlwaysOnTop = vi.fn();
  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.window as unknown as TestWindow).electronAPI = {
      setAlwaysOnTop,
    };
  });

  afterEach(() => {
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
  });

  it("renders the always-on-top switch reflecting the setting", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("toggling always-on-top persists the change AND applies it live via IPC", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.click(screen.getByRole("switch"));
    // [20260712_Fix_SetAlwaysOnTop] regression lock: the IPC call must fire
    // immediately, not only on Save.
    expect(onInputChange).toHaveBeenCalledWith("window_always_on_top", false);
    expect(setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it("changing the theme select reports the new value", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    // Labels have no htmlFor; target selects by their current display value.
    fireEvent.change(screen.getByDisplayValue("跟随系统"), {
      target: { value: "dark" },
    });
    expect(onInputChange).toHaveBeenCalledWith("theme", "dark");
  });

  it("changing auto-paste behavior reports the selected mode", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.change(screen.getByDisplayValue("自动粘贴到光标处"), {
      target: { value: "clipboard_only" },
    });
    expect(onInputChange).toHaveBeenCalledWith("auto_paste", "clipboard_only");
  });

  it("switching the language persists it and updates the document lang", () => {
    window.localStorage.clear();
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.change(screen.getByDisplayValue("中文"), {
      target: { value: "en" },
    });
    expect(window.localStorage.getItem("language")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("changing close behavior reports the selected mode", () => {
    render(<GeneralSection settings={BASE} onInputChange={onInputChange} />);
    fireEvent.change(screen.getByDisplayValue("隐藏到托盘"), {
      target: { value: "quit" },
    });
    expect(onInputChange).toHaveBeenCalledWith("close_behavior", "quit");
  });
});
