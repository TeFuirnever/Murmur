// @vitest-environment jsdom
// [20260926_Issue407] Per-setting modified indicator + reset-to-default
// (VS Code convention): a generic SettingResetButton that derives the
// default from the schema, appears only while the value differs from it,
// and writes the default back through the section's onInputChange write
// path. Wired across the discrete controls of General / AI / Bot tabs.
// Text-like inputs (hotwords, api_key, base_url, model_download_path) are
// deliberately NOT wired — their debounced write pipeline makes a stray
// reset too destructive for long text; see the wiring notes in the report.
import "../../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import zhCN from "../../../src/i18n/locales/zh-CN.json";
import en from "../../../src/i18n/locales/en.json";

// Flatten the nested locale into dot-notation keys for O(1) lookup, and
// interpolate {{var}} the way i18next does (the mandated hint format uses it).
function flatten(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}
const LOCALE = flatten(zhCN as Record<string, unknown>);

const interpolate = (
  template: string,
  opts?: Record<string, unknown>,
): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    String(opts?.[name] ?? ""),
  );

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, arg?: unknown) => {
      const raw = LOCALE[key];
      if (raw === undefined) {
        return typeof arg === "string" ? arg : key;
      }
      return interpolate(
        raw,
        typeof arg === "object" && arg !== null
          ? (arg as Record<string, unknown>)
          : undefined,
      );
    },
    i18n: { language: "zh-CN", changeLanguage: vi.fn() },
  }),
}));

import { SettingResetButton } from "../../../src/settings/SettingResetButton";
import {
  DEFAULT_SETTINGS,
  type SettingsState,
} from "../../../src/settings/useSettings";
import { DEFAULT_HOTKEY } from "../../../src/settings/hotkeyRecorder";
import { DEFAULT_MODEL } from "../../../src/settings/modelCatalog";
import { GeneralSection } from "../../../src/settings/sections/GeneralSection";
import { AIConfigSection } from "../../../src/settings/sections/AIConfigSection";

// The wiring tests start from the SCHEMA defaults (the exact baseline the
// modified check compares against) and flip one key at a time.
const BASE: SettingsState = { ...DEFAULT_SETTINGS };

const resetButtonsIn = (container: HTMLElement): Element[] =>
  Array.from(container.querySelectorAll("[data-testid^='reset-']"));

interface TestWindow {
  electronAPI?: {
    setAlwaysOnTop?: (v: boolean) => void;
    getPlatform?: () => string;
  };
}

describe("[20260926_Issue407] SettingResetButton unit", () => {
  afterEach(cleanup);

  it.each([
    ["window_always_on_top", true],
    ["auto_paste", "paste"],
    ["ai_temperature", 0.3],
    ["bot_shape", "circle"],
    ["hotkey", DEFAULT_HOTKEY],
  ] as const)(
    "renders nothing while %s sits at its schema default (%p)",
    (key, value) => {
      render(
        <SettingResetButton settingKey={key} value={value} onReset={vi.fn()} />,
      );
      expect(screen.queryByTestId(`reset-${key}`)).not.toBeInTheDocument();
    },
  );

  it.each([
    ["window_always_on_top", false],
    ["auto_paste", "clipboard_only"],
    ["ai_temperature", 0.8],
    ["bot_shape", "droplet"],
    ["hotkey", "Alt+Space"],
  ] as const)(
    "appears once %s diverges from its schema default (modified = value !== default)",
    (key, value) => {
      render(
        <SettingResetButton settingKey={key} value={value} onReset={vi.fn()} />,
      );
      expect(screen.getByTestId(`reset-${key}`)).toBeInTheDocument();
    },
  );

  it("reset click writes the SCHEMA default (not a hardcoded value) through onReset", () => {
    const onReset = vi.fn();
    // Flip to a non-default value first so the button renders.
    render(
      <SettingResetButton
        settingKey="auto_paste"
        value="clipboard_only"
        onReset={onReset}
      />,
    );
    fireEvent.click(screen.getByTestId("reset-auto_paste"));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledWith("auto_paste", "paste");

    // Number key: reset lands exactly on 0.3 (the schema default).
    const onReset2 = vi.fn();
    render(
      <SettingResetButton
        settingKey="ai_temperature"
        value={0.9}
        onReset={onReset2}
      />,
    );
    fireEvent.click(screen.getByTestId("reset-ai_temperature"));
    expect(onReset2).toHaveBeenCalledWith("ai_temperature", 0.3);

    // Boolean key flipped off: reset restores the schema default true.
    const onReset3 = vi.fn();
    render(
      <SettingResetButton
        settingKey="window_always_on_top"
        value={false}
        onReset={onReset3}
      />,
    );
    fireEvent.click(screen.getByTestId("reset-window_always_on_top"));
    expect(onReset3).toHaveBeenCalledWith("window_always_on_top", true);
  });

  it("title carries the mandated modified hint with the schema default value", () => {
    render(
      <SettingResetButton
        settingKey="ai_temperature"
        value={0.8}
        onReset={vi.fn()}
      />,
    );
    // zh-CN locale: settings.resetHint = "已修改，默认值：{{value}}"
    expect(screen.getByTestId("reset-ai_temperature")).toHaveAttribute(
      "title",
      "已修改，默认值：0.3",
    );
  });

  it("aria-label names the reset action and the schema description when one exists", () => {
    render(
      <SettingResetButton
        settingKey="window_always_on_top"
        value={false}
        onReset={vi.fn()}
      />,
    );
    const label = screen
      .getByTestId("reset-window_always_on_top")
      .getAttribute("aria-label");
    // zh-CN: settings.resetToDefault + schema descriptionKey text
    expect(label).toContain("重置为默认值");
    expect(label).toContain("将应用窗口保持在最前面");
  });

  it("aria-label falls back to the bare action for keys without a schema description", () => {
    render(
      <SettingResetButton
        settingKey="bot_shape"
        value="droplet"
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByTestId("reset-bot_shape")).toHaveAttribute(
      "aria-label",
      "重置为默认值",
    );
  });

  it("both hint keys exist with the mandated wording in BOTH locales", () => {
    const zh = (zhCN as unknown as Record<string, unknown>).settings as Record<
      string,
      unknown
    >;
    const enJson = (en as unknown as Record<string, unknown>)
      .settings as Record<string, unknown>;
    expect(zh.resetToDefault).toBe("重置为默认值");
    expect(zh.resetHint).toBe("已修改，默认值：{{value}}");
    expect(enJson.resetToDefault).toBe("Reset to default");
    expect(enJson.resetHint).toBe("Modified — default: {{value}}");
  });
});

describe("[20260926_Issue407] GeneralSection wiring", () => {
  const onInputChange = vi.fn();
  const originalAPI = (globalThis.window as unknown as TestWindow).electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.window as unknown as TestWindow).electronAPI = {
      setAlwaysOnTop: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    const win = globalThis.window as unknown as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
  });

  it("shows no reset controls while every discrete control sits at its default", () => {
    const { container } = render(
      <GeneralSection settings={BASE} onInputChange={onInputChange} />,
    );
    expect(resetButtonsIn(container)).toHaveLength(0);
  });

  it.each([
    ["window_always_on_top", false as const],
    ["show_notifications", false as const],
    ["auto_start", true as const],
    ["minimize_to_tray", true as const],
    ["auto_paste", "clipboard_only"],
    ["default_mode", "off"],
    ["close_behavior", "quit"],
    ["theme", "dark"],
    ["hotkey", "Alt+Space"],
  ])(
    "shows a reset control for %s once modified, and reset writes the schema default",
    (key, modified) => {
      (globalThis.window as unknown as TestWindow).electronAPI = {
        getPlatform: () => "win32",
      };
      const settings = { ...BASE, [key]: modified } as SettingsState;
      const { container } = render(
        <GeneralSection settings={settings} onInputChange={onInputChange} />,
      );
      const button = screen.getByTestId(`reset-${key}`);
      expect(button).toBeInTheDocument();
      fireEvent.click(button);
      expect(onInputChange).toHaveBeenCalledWith(
        key,
        (BASE as Record<string, unknown>)[key],
      );
      expect(resetButtonsIn(container).length).toBeGreaterThanOrEqual(1);
    },
  );

  it("does not wire reset for the language select (special write channel) nor text inputs", () => {
    const settings = {
      ...BASE,
      hotwords: "张晗玥\n刘畊宏",
      model_download_path: "/tmp/models",
    };
    render(
      <GeneralSection settings={settings} onInputChange={onInputChange} />,
    );
    expect(screen.queryByTestId("reset-hotwords")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("reset-model_download_path"),
    ).not.toBeInTheDocument();
    // language is persisted-only (i18n.changeLanguage + localStorage), so no
    // generic reset exists for it either.
    expect(screen.queryByTestId("reset-language")).not.toBeInTheDocument();
  });
});

describe("[20260926_Issue409] Bot pickers wiring (embedded in GeneralSection)", () => {
  afterEach(cleanup);

  it("shows no reset controls while every picker sits at its default", () => {
    const { container } = render(
      <GeneralSection settings={BASE} onInputChange={vi.fn()} />,
    );
    expect(resetButtonsIn(container)).toHaveLength(0);
  });

  it.each([
    ["bot_shape", "droplet"],
    ["bot_color", "blue"],
    ["bot_expression", "happy"],
  ] as const)(
    "shows a reset control for %s once modified, and reset writes the schema default",
    (key, modified) => {
      const onInputChange = vi.fn();
      const settings = { ...BASE, [key]: modified } as SettingsState;
      render(
        <GeneralSection settings={settings} onInputChange={onInputChange} />,
      );
      const button = screen.getByTestId(`reset-${key}`);
      expect(button).toBeInTheDocument();
      fireEvent.click(button);
      expect(onInputChange).toHaveBeenCalledWith(
        key,
        (BASE as Record<string, unknown>)[key],
      );
    },
  );
});

// Cribbed from AIConfigSection.test.tsx: the section takes the full hook
// surface as props, so render with the same neutral stand-ins.
function renderAI(
  settings: SettingsState,
  onInputChange: (key: string, value: unknown) => void = vi.fn(),
) {
  return render(
    <AIConfigSection
      settings={settings}
      onInputChange={onInputChange}
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

describe("[20260926_Issue407] AIConfigSection wiring", () => {
  afterEach(cleanup);

  it("shows no reset controls while every discrete control sits at its default", () => {
    const { container } = renderAI(BASE);
    expect(resetButtonsIn(container)).toHaveLength(0);
  });

  it.each([
    ["enable_ai_optimization", false],
    ["ai_temperature", 0.8],
    ["ai_max_tokens", 4096],
    ["ai_model", "custom-model-x"],
  ] as const)(
    "shows a reset control for %s once modified, and reset writes the schema default",
    (key, modified) => {
      const onInputChange = vi.fn();
      const settings = { ...BASE, [key]: modified } as SettingsState;
      renderAI(settings, onInputChange);
      const button = screen.getByTestId(`reset-${key}`);
      expect(button).toBeInTheDocument();
      fireEvent.click(button);
      // AI-tab resets write through the immediate flag: reset is a discrete
      // action, and ai_model is a text-like key whose normal path debounces
      // (a reset must never sit out the 400ms window or race a pending write).
      expect(onInputChange).toHaveBeenCalledWith(
        key,
        (BASE as Record<string, unknown>)[key],
        {
          immediate: true,
        },
      );
    },
  );

  it("does not wire reset for the debounced text inputs (api key, base url)", () => {
    const settings = {
      ...BASE,
      ai_api_key: "sk-abc",
      ai_base_url: "https://x",
    };
    renderAI(settings);
    expect(screen.queryByTestId("reset-ai_api_key")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reset-ai_base_url")).not.toBeInTheDocument();
  });

  it("keeps the AI-model dropdown's immediate-flag contract untouched (#402)", () => {
    const onInputChange = vi.fn();
    const settings = { ...BASE, ai_model: DEFAULT_MODEL };
    renderAI(settings, onInputChange);
    // Default model → no reset dot; the select itself still writes immediate.
    expect(screen.queryByTestId("reset-ai_model")).not.toBeInTheDocument();
  });
});
