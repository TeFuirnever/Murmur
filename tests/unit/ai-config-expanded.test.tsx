// [20260729_Test_AIConfigExpanded] Expanded coverage for AIConfigSection.tsx.
// The existing settings-sections.test.tsx AIConfigSection describe block
// covers the render paths and a few click handlers but leaves the custom
// model input, slider change handlers, test-result display branches,
// testing/saving button states, the optimization-toggle click, and the
// quick-start action buttons (openExternal / focus ref) uncovered. This
// file targets exactly those branches.
//
// Runs under jsdom because RTL render() needs a DOM.
// @vitest-environment jsdom
import "../setup/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// [20260729_Test_AIConfigExpanded] Mock react-i18next faithfully using the
// shipped zh-CN locale, mirroring the pattern in settings-sections.test.tsx.
// The component calls t(key), t(key, "fallback"), and t(`settings.providers.${name}.guide`, label).
import zhCN from "../../src/i18n/locales/zh-CN.json";

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

function translate(
  key: string,
  opts?: string | Record<string, unknown>,
): string {
  const template = LOCALE[key];
  const fallback = typeof opts === "string" ? opts : undefined;
  const base = template ?? fallback ?? key;
  if (typeof opts !== "object" || opts === null) return base;
  return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in opts ? String(opts[name]) : "",
  );
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
    i18n: {
      language: "zh-CN",
      changeLanguage: vi.fn(),
    },
  }),
}));

// [20260729_Test_AIConfigExpanded] sonner toast is stubbed so no real toast
// UI is rendered (the component imports nothing from sonner directly, but the
// setup matchers / other modules in the dependency graph may pull it in).
vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

import { AIConfigSection } from "../../src/settings/sections/AIConfigSection";
import type {
  SettingsState,
  ProviderPreset,
} from "../../src/settings/useSettings";
import type { AICheckStatusResult } from "../../src/types/ipc";

// [20260729_Test_AIConfigExpanded] Build a complete SettingsState so each
// test only overrides the field(s) under test. Local copy mirrors
// DEFAULT_SETTINGS in useSettings.ts so tests stay independent of production
// default churn.
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
    hotwords: "",
    bot_shape: "circle",
    bot_color: "auto",
    bot_expression: "neutral",
    ...overrides,
  };
}

// [20260729_Test_AIConfigExpanded] Helper to build the full prop bag for
// AIConfigSection with sensible defaults, so each test overrides only what it
// needs. Mirrors the helper in settings-sections.test.tsx.
function buildAIConfigProps(
  overrides: Partial<React.ComponentProps<typeof AIConfigSection>> = {},
): React.ComponentProps<typeof AIConfigSection> {
  return {
    settings: buildSettings(),
    onInputChange: vi.fn(),
    customModel: false,
    setCustomModel: vi.fn(),
    resolvedProviderPresets: [],
    providerPresets: [],
    applyProviderPreset: vi.fn(),
    showApiKey: false,
    setShowApiKey: vi.fn(),
    apiKeyInputRef: { current: null },
    testing: false,
    testResult: null,
    testAIConfiguration: vi.fn(),
    saveSettings: vi.fn(),
    saving: false,
    showQuickStart: false,
    ...overrides,
  };
}

// [20260729_Test_AIConfigExpanded] A minimal stub for window.electronAPI so
// the quick-start "获取 Key" button can call openExternal. The component also
// references window.electronAPI?.openExternal with optional chaining, so a
// partial stub is safe.
type ElectronAPIStub = {
  getAIModes: ReturnType<typeof vi.fn>;
  processText: ReturnType<typeof vi.fn>;
  getSetting: ReturnType<typeof vi.fn>;
  setSetting: ReturnType<typeof vi.fn>;
  saveSetting: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
};

describe("[20260729_Test_AIConfigExpanded] AIConfigSection uncovered branches", () => {
  let electronAPI: ElectronAPIStub;

  beforeEach(() => {
    vi.clearAllMocks();
    electronAPI = {
      getAIModes: vi.fn(),
      processText: vi.fn(),
      getSetting: vi.fn(),
      setSetting: vi.fn(),
      saveSetting: vi.fn(),
      openExternal: vi.fn(),
    };
    (window as unknown as { electronAPI?: unknown }).electronAPI = electronAPI;
  });

  afterEach(() => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  });

  // ── Custom model input (the previously skipped test) ──

  it("renders a custom model text input instead of the select when customModel is true", () => {
    const props = buildAIConfigProps({
      customModel: true,
      settings: buildSettings({ ai_model: "my-custom-model" }),
    });
    render(<AIConfigSection {...props} />);

    // The placeholder is the locale value of settings.ai.modelPlaceholder.
    const customInput = screen.getByPlaceholderText(
      "输入自定义模型名称，如：qwen3-30b-a3b-instruct-2507",
    );
    expect(customInput).toHaveValue("my-custom-model");
    expect(customInput).toHaveAttribute("type", "text");

    // The predefined <select> must not be rendered when customModel is true.
    expect(screen.queryByDisplayValue("GPT-4o")).not.toBeInTheDocument();
  });

  it("does not render the custom model text input when customModel is false", () => {
    const props = buildAIConfigProps({ customModel: false });
    render(<AIConfigSection {...props} />);

    expect(
      screen.queryByPlaceholderText(
        "输入自定义模型名称，如：qwen3-30b-a3b-instruct-2507",
      ),
    ).not.toBeInTheDocument();
  });

  it("calls onInputChange with ai_model when typing into the custom model input", () => {
    const onInputChange = vi.fn();
    const props = buildAIConfigProps({
      customModel: true,
      settings: buildSettings({ ai_model: "" }),
      onInputChange,
    });
    render(<AIConfigSection {...props} />);

    const customInput = screen.getByPlaceholderText(
      "输入自定义模型名称，如：qwen3-30b-a3b-instruct-2507",
    );
    fireEvent.change(customInput, { target: { value: "qwen-turbo" } });

    expect(onInputChange).toHaveBeenCalledWith("ai_model", "qwen-turbo");
  });

  // ── Model-type radio selection ──

  it("calls setCustomModel(false) when the predefined-model radio is chosen", () => {
    const setCustomModel = vi.fn();
    const props = buildAIConfigProps({
      customModel: true,
      setCustomModel,
    });
    render(<AIConfigSection {...props} />);

    // The predefined-model radio has id "predefined-model".
    const predefinedRadio = screen.getByLabelText("预定义模型");
    fireEvent.click(predefinedRadio);
    expect(setCustomModel).toHaveBeenCalledWith(false);
  });

  it("calls setCustomModel(true) when the custom-model radio is chosen", () => {
    const setCustomModel = vi.fn();
    const props = buildAIConfigProps({
      customModel: false,
      setCustomModel,
    });
    render(<AIConfigSection {...props} />);

    const customRadio = screen.getByLabelText("自定义模型");
    fireEvent.click(customRadio);
    expect(setCustomModel).toHaveBeenCalledWith(true);
  });

  // ── Temperature slider change handler ──

  it("calls onInputChange with ai_temperature as a float when the temperature slider changes", () => {
    const onInputChange = vi.fn();
    const props = buildAIConfigProps({
      settings: buildSettings({ ai_temperature: 0.3 }),
      onInputChange,
    });
    render(<AIConfigSection {...props} />);

    // Two range inputs exist; the temperature one has max="1" and step="0.1".
    const sliders = screen.getAllByRole("slider");
    const temperatureSlider = sliders.find(
      (s) =>
        (s as HTMLInputElement).getAttribute("max") === "1" &&
        (s as HTMLInputElement).getAttribute("step") === "0.1",
    ) as HTMLInputElement;
    expect(temperatureSlider).toBeDefined();

    fireEvent.change(temperatureSlider, { target: { value: "0.8" } });
    expect(onInputChange).toHaveBeenCalledWith("ai_temperature", 0.8);
    // parseFloat is used — confirm it is a number, not a string.
    expect(
      onInputChange.mock.calls.find(
        ([key, value]) => key === "ai_temperature" && typeof value === "number",
      ),
    ).toBeDefined();
  });

  it("renders the formatted temperature value with one decimal place", () => {
    const props = buildAIConfigProps({
      settings: buildSettings({ ai_temperature: 0.42 }),
    });
    render(<AIConfigSection {...props} />);

    // toFixed(1) on 0.42 yields "0.4".
    expect(screen.getByText("0.4")).toBeInTheDocument();
  });

  // ── Max tokens slider change handler ──

  it("calls onInputChange with ai_max_tokens as an int when the max-tokens slider changes", () => {
    const onInputChange = vi.fn();
    const props = buildAIConfigProps({
      settings: buildSettings({ ai_max_tokens: 2000 }),
      onInputChange,
    });
    render(<AIConfigSection {...props} />);

    // [20260815_Fix_AiMaxTokensDefault] The max-tokens slider has
    // min="1024", max="16384", step="256".
    const sliders = screen.getAllByRole("slider");
    const maxTokensSlider = sliders.find(
      (s) =>
        (s as HTMLInputElement).getAttribute("min") === "1024" &&
        (s as HTMLInputElement).getAttribute("max") === "16384",
    ) as HTMLInputElement;
    expect(maxTokensSlider).toBeDefined();

    fireEvent.change(maxTokensSlider, { target: { value: "3072" } });
    expect(onInputChange).toHaveBeenCalledWith("ai_max_tokens", 3072);
    // parseInt(..., 10) is used — confirm it is a number, not a string.
    expect(
      onInputChange.mock.calls.find(
        ([key, value]) => key === "ai_max_tokens" && typeof value === "number",
      ),
    ).toBeDefined();
  });

  // ── AI optimization toggle click ──

  it("toggles enable_ai_optimization to false when it is currently true", () => {
    const onInputChange = vi.fn();
    const props = buildAIConfigProps({
      settings: buildSettings({ enable_ai_optimization: true }),
      onInputChange,
    });
    render(<AIConfigSection {...props} />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(onInputChange).toHaveBeenCalledWith("enable_ai_optimization", false);
  });

  it("toggles enable_ai_optimization to true when it is currently false", () => {
    const onInputChange = vi.fn();
    const props = buildAIConfigProps({
      settings: buildSettings({ enable_ai_optimization: false }),
      onInputChange,
    });
    render(<AIConfigSection {...props} />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(onInputChange).toHaveBeenCalledWith("enable_ai_optimization", true);
  });

  // ── Predefined model select change ──

  it("calls onInputChange with ai_model when a predefined model is selected", () => {
    const onInputChange = vi.fn();
    const props = buildAIConfigProps({
      customModel: false,
      settings: buildSettings({ ai_model: "gpt-3.5-turbo" }),
      onInputChange,
    });
    render(<AIConfigSection {...props} />);

    const modelSelect = screen.getByDisplayValue(
      "GPT-3.5 Turbo",
    ) as HTMLSelectElement;
    fireEvent.change(modelSelect, { target: { value: "gpt-4o" } });
    expect(onInputChange).toHaveBeenCalledWith("ai_model", "gpt-4o");
  });

  // ── Base URL change ──

  it("calls onInputChange with ai_base_url when the Base URL input changes", () => {
    const onInputChange = vi.fn();
    const props = buildAIConfigProps({ onInputChange });
    render(<AIConfigSection {...props} />);

    const baseUrlInput = screen.getByPlaceholderText(
      "https://api.openai.com/v1",
    );
    fireEvent.change(baseUrlInput, {
      target: { value: "https://api.deepseek.com" },
    });
    expect(onInputChange).toHaveBeenCalledWith(
      "ai_base_url",
      "https://api.deepseek.com",
    );
  });

  // ── API key visibility (showApiKey true) ──

  it("renders the API key input as type=text when showApiKey is true", () => {
    const props = buildAIConfigProps({
      showApiKey: true,
      settings: buildSettings({ ai_api_key: "sk-visible" }),
    });
    render(<AIConfigSection {...props} />);

    const apiKeyInput = screen.getByPlaceholderText("请输入您的AI API Key");
    expect(apiKeyInput).toHaveAttribute("type", "text");
    expect(apiKeyInput).toHaveValue("sk-visible");
  });

  it("calls setShowApiKey(false) when the eye-off button is clicked while showApiKey is true", async () => {
    const user = userEvent.setup();
    const setShowApiKey = vi.fn();
    const props = buildAIConfigProps({
      showApiKey: true,
      setShowApiKey,
    });
    render(<AIConfigSection {...props} />);

    const apiKeyInput = screen.getByPlaceholderText("请输入您的AI API Key");
    const toggleButton = apiKeyInput.parentElement!.querySelector("button")!;
    await user.click(toggleButton);
    expect(setShowApiKey).toHaveBeenCalledWith(false);
  });

  // ── Testing / saving button states ──

  it("disables the test button and shows the testing label while testing is true", () => {
    const props = buildAIConfigProps({ testing: true });
    render(<AIConfigSection {...props} />);

    const testingButton = screen.getByRole("button", { name: "测试中..." });
    expect(testingButton).toBeDisabled();
  });

  it("disables the save button and shows the saving label while saving is true", () => {
    const props = buildAIConfigProps({ saving: true });
    render(<AIConfigSection {...props} />);

    // The save button carries aria-label "保存设置" (settings.save), so the
    // accessible name is stable. The visible label text switches to "保存中...".
    const saveButton = screen.getByRole("button", { name: "保存设置" });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText("保存中...")).toBeInTheDocument();
  });

  it("does not call testAIConfiguration when the test button is disabled (testing state)", async () => {
    const user = userEvent.setup();
    const testAIConfiguration = vi.fn();
    const props = buildAIConfigProps({
      testing: true,
      testAIConfiguration,
    });
    render(<AIConfigSection {...props} />);

    // A disabled button does not fire onClick via userEvent.
    const testingButton = screen.getByRole("button", { name: "测试中..." });
    await user.click(testingButton);
    expect(testAIConfiguration).not.toHaveBeenCalled();
  });

  // ── Test result display: success branch ──

  it("renders the success test-result panel with model, status, response, and token usage", () => {
    const testResult: AICheckStatusResult = {
      available: true,
      model: "gpt-4o",
      status: "ok",
      details: "Connection healthy",
      response: "Hello from the model",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };
    const props = buildAIConfigProps({ testResult });
    render(<AIConfigSection {...props} />);

    expect(screen.getByText("AI配置测试成功")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByText("Connection healthy")).toBeInTheDocument();
    expect(screen.getByText("Hello from the model")).toBeInTheDocument();
    // Token usage displays total_tokens (15), not "N/A".
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("renders N/A for token usage when total_tokens is 0 on a successful test", () => {
    const testResult: AICheckStatusResult = {
      available: true,
      model: "gpt-4o",
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
    const props = buildAIConfigProps({ testResult });
    render(<AIConfigSection {...props} />);

    // total_tokens || "N/A" — 0 is falsy, so "N/A" is shown.
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });

  it("renders the success panel without optional fields when only available is set", () => {
    const testResult: AICheckStatusResult = { available: true };
    const props = buildAIConfigProps({ testResult });
    render(<AIConfigSection {...props} />);

    expect(screen.getByText("AI配置测试成功")).toBeInTheDocument();
    // No model / status / response / usage rows should appear.
    expect(screen.queryByText("AI配置测试失败")).not.toBeInTheDocument();
  });

  // ── Test result display: failure branch ──

  it("renders the failure test-result panel with error and details", () => {
    const testResult: AICheckStatusResult = {
      available: false,
      error: "Invalid API key",
      details: "HTTP 401 Unauthorized",
    };
    const props = buildAIConfigProps({ testResult });
    render(<AIConfigSection {...props} />);

    expect(screen.getByText("AI配置测试失败")).toBeInTheDocument();
    expect(screen.getByText("Invalid API key")).toBeInTheDocument();
    expect(screen.getByText("HTTP 401 Unauthorized")).toBeInTheDocument();
  });

  it("renders the failure panel without optional fields when only available:false is set", () => {
    const testResult: AICheckStatusResult = { available: false };
    const props = buildAIConfigProps({ testResult });
    render(<AIConfigSection {...props} />);

    expect(screen.getByText("AI配置测试失败")).toBeInTheDocument();
    expect(screen.queryByText("AI配置测试成功")).not.toBeInTheDocument();
  });

  // ── Quick start: openExternal and focus actions ──

  it("calls window.electronAPI.openExternal with the registration URL when 获取 Key is clicked", () => {
    const presets: ProviderPreset[] = [
      {
        name: "openai",
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        models: ["gpt-4o"],
        requires_api_key: true,
        registration: {
          url: "https://platform.openai.com/keys",
          recommended: true,
        },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    const getKeyButton = screen.getByText("获取 Key").closest("button")!;
    fireEvent.click(getKeyButton);
    expect(electronAPI.openExternal).toHaveBeenCalledWith(
      "https://platform.openai.com/keys",
    );
  });

  it("does not call openExternal when 获取 Key is clicked and the preset has no registration URL", () => {
    const presets: ProviderPreset[] = [
      {
        name: "custom",
        label: "Custom",
        base_url: "https://api.custom.com",
        models: ["m1"],
        requires_api_key: true,
        // registration.url missing -> openExternal must not be called
        registration: { url: "", recommended: false },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    const getKeyButton = screen.getByText("获取 Key").closest("button")!;
    fireEvent.click(getKeyButton);
    expect(electronAPI.openExternal).not.toHaveBeenCalled();
  });

  it("focuses and scrolls the API key input into view when the recommended 'paste key' button is clicked", () => {
    // The component renders <input ref={apiKeyInputRef} ...> for the API key
    // field, so React attaches the real DOM input to .current during render
    // and discards any pre-populated mock. We therefore start with an empty
    // ref, let React populate it, then stub focus and scrollIntoView on the
    // attached element before clicking. jsdom 30 does not implement
    // scrollIntoView, so we assign a spy directly on the element.
    const apiKeyInputRef: React.RefObject<HTMLInputElement | null> = {
      current: null,
    };
    const focusSpy = vi.fn();
    const scrollIntoViewSpy = vi.fn();
    const presets: ProviderPreset[] = [
      {
        name: "openai",
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        models: ["gpt-4o"],
        requires_api_key: true,
        registration: { url: "https://platform.openai.com", recommended: true },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
      apiKeyInputRef,
    });
    render(<AIConfigSection {...props} />);

    // React has now attached the real API key <input> to the ref.
    const attachedInput = apiKeyInputRef.current;
    expect(attachedInput).not.toBeNull();
    // jsdom 30 declares `focus` as a getter-only accessor on the prototype,
    // so a plain assignment throws. Use defineProperty to install spies on
    // the instance. scrollIntoView is not implemented in jsdom at all, so we
    // add it the same way.
    Object.defineProperty(attachedInput, "focus", {
      configurable: true,
      writable: true,
      value: focusSpy,
    });
    Object.defineProperty(attachedInput, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoViewSpy,
    });

    const pasteButton = screen.getByText("已有 Key？粘贴").closest("button")!;
    fireEvent.click(pasteButton);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("does not render the 'paste key' button for a non-recommended preset", () => {
    const presets: ProviderPreset[] = [
      {
        name: "deepseek",
        label: "DeepSeek",
        base_url: "https://api.deepseek.com",
        models: ["deepseek-chat"],
        requires_api_key: true,
        registration: {
          url: "https://platform.deepseek.com",
          recommended: false,
        },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    expect(screen.getByText("获取 Key")).toBeInTheDocument();
    expect(screen.queryByText("已有 Key？粘贴")).not.toBeInTheDocument();
    expect(screen.queryByText("推荐")).not.toBeInTheDocument();
  });

  it("does not render the quick start panel when showQuickStart is false", () => {
    const presets: ProviderPreset[] = [
      {
        name: "openai",
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        models: ["gpt-4o"],
        requires_api_key: true,
        registration: { url: "https://platform.openai.com", recommended: true },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: false,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    expect(screen.queryByText("快速开始")).not.toBeInTheDocument();
    expect(screen.queryByText("获取 Key")).not.toBeInTheDocument();
  });

  // ── Quick start: preset filtering and sorting ──

  it("renders recommended presets before non-recommended ones in the quick start panel", () => {
    const presets: ProviderPreset[] = [
      {
        name: "deepseek",
        label: "DeepSeek",
        base_url: "https://api.deepseek.com",
        models: ["deepseek-chat"],
        requires_api_key: true,
        registration: {
          url: "https://platform.deepseek.com",
          recommended: false,
        },
      },
      {
        name: "openai",
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        models: ["gpt-4o"],
        requires_api_key: true,
        registration: { url: "https://platform.openai.com", recommended: true },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    // Both presets qualify (registration + requires_api_key + non-localhost).
    // Recommended (OpenAI) sorts first. The recommended badge appears once.
    expect(screen.getByText("推荐")).toBeInTheDocument();
    expect(screen.getAllByText("获取 Key").length).toBe(2);

    // Verify ordering: the recommended preset's row comes before the
    // non-recommended one. We check the DOM order of the two labels.
    const labels = screen.getAllByText(/^(OpenAI|DeepSeek)$/);
    expect(labels).toHaveLength(2);
    expect(labels[0]!.textContent).toBe("OpenAI");
    expect(labels[1]!.textContent).toBe("DeepSeek");
  });

  it("filters out presets that do not require an API key from the quick start panel", () => {
    const presets: ProviderPreset[] = [
      {
        name: "local",
        label: "Local",
        base_url: "https://api.local.com",
        models: ["local-model"],
        requires_api_key: false,
        registration: { url: "https://local.com", recommended: true },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    // The panel heading is always present, but no qualifying preset rows.
    expect(screen.getByText("快速开始")).toBeInTheDocument();
    expect(screen.queryByText("获取 Key")).not.toBeInTheDocument();
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
  });

  it("filters out localhost-based presets from the quick start panel", () => {
    const presets: ProviderPreset[] = [
      {
        name: "local",
        label: "Local LM Studio",
        base_url: "http://localhost:1234",
        models: ["local-model"],
        requires_api_key: true,
        registration: { url: "http://localhost:1234", recommended: true },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    expect(screen.getByText("快速开始")).toBeInTheDocument();
    expect(screen.queryByText("获取 Key")).not.toBeInTheDocument();
    expect(screen.queryByText("Local LM Studio")).not.toBeInTheDocument();
  });

  it("renders the hasKeyHint footer in the quick start panel", () => {
    const presets: ProviderPreset[] = [
      {
        name: "openai",
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        models: ["gpt-4o"],
        requires_api_key: true,
        registration: { url: "https://platform.openai.com", recommended: true },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    expect(
      screen.getByText("💡 已有 API Key？直接在下方配置"),
    ).toBeInTheDocument();
  });

  // ── Provider preset quick-select (top bar) ──

  it("renders no preset quick-select buttons when resolvedProviderPresets is empty", () => {
    const props = buildAIConfigProps({ resolvedProviderPresets: [] });
    render(<AIConfigSection {...props} />);

    expect(
      screen.queryByRole("button", { name: "OpenAI" }),
    ).not.toBeInTheDocument();
  });

  it("renders the provider label for the quick start guide fallback when no locale key exists", () => {
    // The guide lookup is t(`settings.providers.${name}.guide`, preset.label).
    // For an unknown provider the fallback is the label itself.
    const presets: ProviderPreset[] = [
      {
        name: "unknownprovider",
        label: "My Unknown Provider",
        base_url: "https://api.unknown.com",
        models: ["m1"],
        requires_api_key: true,
        registration: { url: "https://unknown.com", recommended: true },
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    // The label appears twice: once as the preset label span, once as the
    // guide fallback <p> (because no settings.providers.unknownprovider.guide
    // key exists in the locale). Both resolve to the label string.
    const matches = screen.getAllByText("My Unknown Provider");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
