// [20260729_Test_SettingsSections] Integration tests for the three settings
// section components: AboutSection, PermissionsSection, AIConfigSection.
// Each section renders user-visible strings via react-i18next's t(); we mock
// useTranslation to return the fallback string so we can assert on stable
// text without loading i18n resource files. The file runs under jsdom because
// RTL's render() needs a DOM.
// @vitest-environment jsdom
import "../setup/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// [20260729_Test_SettingsSections] Mock react-i18next faithfully. The section
// components call t() in three shapes:
//   t(key)                       -> no fallback (e.g. settings.update.check)
//   t(key, "fallback string")    -> string fallback
//   t(key, { version: "1.2.3" }) -> interpolation object (e.g. app.currentVersion)
// To assert on real, stable user-visible text we load the shipped zh-CN locale
// and resolve keys against it, then apply mustache-style {{var}} interpolation.
// When a key is absent from the locale, fall back to a provided string fallback,
// otherwise return the key itself. This mirrors how react-i18next behaves.
import zhCN from "../../src/i18n/locales/zh-CN.json";
import type { UpdateCheckResult } from "../../src/types/ipc";

// Flatten the nested locale into dot-notation keys for O(1) lookup.
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

// [20260729_Test_SettingsSections] sonner toast is imported by
// PermissionsSection; stub it so no real toast UI is rendered.
vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

// [20260729_Test_SettingsSections] PermissionsSection delegates to the
// usePermissions hook. Mock the hook so we can control the granted state and
// spy on the request callbacks without exercising navigator.mediaDevices or
// window.electronAPI.pasteText (which require real Electron).
const mockUsePermissions = {
  micPermissionGranted: false,
  accessibilityPermissionGranted: false,
  requestMicPermission: vi.fn(),
  testAccessibilityPermission: vi.fn(),
};
vi.mock("../../src/hooks/usePermissions", () => ({
  usePermissions: () => mockUsePermissions,
}));

import { AboutSection } from "../../src/settings/sections/AboutSection";
import { PermissionsSection } from "../../src/settings/sections/PermissionsSection";
import { AIConfigSection } from "../../src/settings/sections/AIConfigSection";
import type {
  SettingsState,
  ProviderPreset,
} from "../../src/settings/useSettings";

// [20260729_Test_SettingsSections] Build a complete SettingsState so each
// AIConfigSection test only overrides the field(s) under test. This mirrors
// DEFAULT_SETTINGS in useSettings.ts but is local to keep tests independent
// of production default churn.
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

// [20260729_Test_SettingsSections] Helper to build the full prop bag for
// AIConfigSection with sensible defaults, so each test overrides only what it
// needs. This keeps the render call readable.
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

describe("[20260729_Test_SettingsSections] AboutSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the app subtitle and version info when appVersion is provided", () => {
    const { container } = render(
      <AboutSection
        appVersion="1.2.3"
        checkingUpdate={false}
        updateInfo={null}
        downloadProgress={null}
        downloadedUpdate={null}
        checkForUpdates={vi.fn()}
        startDownload={vi.fn()}
      />,
    );
    // Check the full container text content for the subtitle and version.
    expect(container.textContent).toContain(
      "基于FunASR和AI的中文语音转文字应用",
    );
    expect(container.textContent).toContain("1.2.3");
  });

  it("renders the feature list description", () => {
    const { container } = render(
      <AboutSection
        appVersion=""
        checkingUpdate={false}
        updateInfo={null}
        downloadProgress={null}
        downloadedUpdate={null}
        checkForUpdates={vi.fn()}
        startDownload={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("高精度中文语音识别");
    expect(container.textContent).toContain("AI智能文本优化");
    expect(container.textContent).toContain("实时语音处理");
    expect(container.textContent).toContain("隐私保护设计");
  });

  it("renders the check-for-updates button", () => {
    const checkForUpdates = vi.fn();
    render(
      <AboutSection
        appVersion="1.0.0"
        checkingUpdate={false}
        updateInfo={null}
        downloadProgress={null}
        downloadedUpdate={null}
        checkForUpdates={checkForUpdates}
        startDownload={vi.fn()}
      />,
    );

    // The check button uses the locale string "检查更新" (settings.update.check).
    const checkButton = screen.getByRole("button", { name: "检查更新" });
    expect(checkButton).toBeInTheDocument();
    expect(checkButton).not.toBeDisabled();
  });

  it("disables the check button and shows checking state while checkingUpdate is true", () => {
    render(
      <AboutSection
        appVersion="1.0.0"
        checkingUpdate={true}
        updateInfo={null}
        downloadProgress={null}
        downloadedUpdate={null}
        checkForUpdates={vi.fn()}
        startDownload={vi.fn()}
      />,
    );

    // The button label switches to "检查中..." (settings.update.checking) and
    // is disabled while a check is in flight.
    const checkingButton = screen.getByRole("button", { name: "检查中..." });
    expect(checkingButton).toBeDisabled();
  });

  it("calls checkForUpdates when the check button is clicked", async () => {
    const user = userEvent.setup();
    const checkForUpdates = vi.fn();
    render(
      <AboutSection
        appVersion="1.0.0"
        checkingUpdate={false}
        updateInfo={null}
        downloadProgress={null}
        downloadedUpdate={null}
        checkForUpdates={checkForUpdates}
        startDownload={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "检查更新" }));
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("shows the 'up to date' message when no update is available", () => {
    render(
      <AboutSection
        appVersion="1.0.0"
        checkingUpdate={false}
        updateInfo={{ hasUpdate: false, currentVersion: "1.0.0" }}
        downloadProgress={null}
        downloadedUpdate={null}
        checkForUpdates={vi.fn()}
        startDownload={vi.fn()}
      />,
    );

    expect(screen.getByText("已是最新版本")).toBeInTheDocument();
  });

  it("shows the download button and calls startDownload when an update is available", async () => {
    const user = userEvent.setup();
    const startDownload = vi.fn();
    render(
      <AboutSection
        appVersion="1.0.0"
        checkingUpdate={false}
        updateInfo={{
          hasUpdate: true,
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          downloadUrl: "https://example.com/update",
          releaseNotes: "Bug fixes",
        }}
        downloadProgress={null}
        downloadedUpdate={null}
        checkForUpdates={vi.fn()}
        startDownload={startDownload}
      />,
    );

    const downloadButton = screen.getByRole("button", { name: "下载更新" });
    expect(downloadButton).toBeInTheDocument();
    await user.click(downloadButton);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it("displays a download progress bar when downloadProgress is set", () => {
    render(
      <AboutSection
        appVersion="1.0.0"
        checkingUpdate={false}
        updateInfo={{
          hasUpdate: true,
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          downloadUrl: "https://example.com/update",
        }}
        downloadProgress={{ progress: 42, downloaded: 100, total: 250 }}
        downloadedUpdate={null}
        checkForUpdates={vi.fn()}
        startDownload={vi.fn()}
      />,
    );

    // The progress label is "下载中... {{progress}}%" (settings.update.downloading).
    expect(screen.getByText(/下载中\.\.\. 42%/)).toBeInTheDocument();
    // The cancel button is rendered during an active download.
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });
});

describe("[20260729_Test_SettingsSections] PermissionsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mocked hook state to defaults before each test.
    mockUsePermissions.micPermissionGranted = false;
    mockUsePermissions.accessibilityPermissionGranted = false;
  });

  it("renders the section description and both permission cards", () => {
    render(<PermissionsSection />);

    expect(
      screen.getByText("测试和管理应用权限，确保麦克风和辅助功能正常工作。"),
    ).toBeInTheDocument();
    expect(screen.getByText("麦克风权限")).toBeInTheDocument();
    expect(screen.getByText("辅助功能权限")).toBeInTheDocument();
  });

  it("renders the microphone test button when mic permission is not granted", () => {
    render(<PermissionsSection />);
    expect(
      screen.getByRole("button", { name: "测试麦克风" }),
    ).toBeInTheDocument();
  });

  it("renders the accessibility test button when accessibility permission is not granted", () => {
    render(<PermissionsSection />);
    expect(
      screen.getByRole("button", { name: "测试权限" }),
    ).toBeInTheDocument();
  });

  it("shows the granted state for microphone instead of a button when permission is granted", () => {
    mockUsePermissions.micPermissionGranted = true;
    render(<PermissionsSection />);

    // When granted, the button is replaced by a "已授予" label.
    expect(screen.getByText("已授予")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "测试麦克风" }),
    ).not.toBeInTheDocument();
  });

  it("calls requestMicPermission when the microphone test button is clicked", async () => {
    const user = userEvent.setup();
    render(<PermissionsSection />);

    await user.click(screen.getByRole("button", { name: "测试麦克风" }));
    expect(mockUsePermissions.requestMicPermission).toHaveBeenCalledTimes(1);
  });

  it("calls testAccessibilityPermission when the accessibility test button is clicked", async () => {
    const user = userEvent.setup();
    render(<PermissionsSection />);

    await user.click(screen.getByRole("button", { name: "测试权限" }));
    expect(
      mockUsePermissions.testAccessibilityPermission,
    ).toHaveBeenCalledTimes(1);
  });
});

describe("[20260729_Test_SettingsSections] AIConfigSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the AI optimization toggle reflecting enable_ai_optimization", () => {
    const props = buildAIConfigProps({
      settings: buildSettings({ enable_ai_optimization: true }),
    });
    render(<AIConfigSection {...props} />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("renders the API key input with the current value", () => {
    const props = buildAIConfigProps({
      settings: buildSettings({ ai_api_key: "sk-secret-key" }),
    });
    render(<AIConfigSection {...props} />);

    const apiKeyInput = screen.getByPlaceholderText("请输入您的AI API Key");
    expect(apiKeyInput).toBeInTheDocument();
    expect(apiKeyInput).toHaveValue("sk-secret-key");
    // Password is hidden by default.
    expect(apiKeyInput).toHaveAttribute("type", "password");
  });

  it("calls onInputChange when the API key value changes", async () => {
    const user = userEvent.setup();
    const onInputChange = vi.fn();
    const props = buildAIConfigProps({ onInputChange });
    render(<AIConfigSection {...props} />);

    const apiKeyInput = screen.getByPlaceholderText("请输入您的AI API Key");
    await user.type(apiKeyInput, "x");

    expect(onInputChange).toHaveBeenCalled();
    // The first call payload is (key, value); we only assert the key shape.
    expect(onInputChange).toHaveBeenCalledWith(
      "ai_api_key",
      expect.any(String),
    );
  });

  it("toggles API key visibility when the eye button is clicked", async () => {
    const user = userEvent.setup();
    const setShowApiKey = vi.fn();
    const props = buildAIConfigProps({ showApiKey: false, setShowApiKey });
    render(<AIConfigSection {...props} />);

    // The eye/eye-off button is the only button inside the API key wrapper.
    const apiKeyInput = screen.getByPlaceholderText("请输入您的AI API Key");
    const toggleButton = apiKeyInput.parentElement!.querySelector("button")!;
    await user.click(toggleButton);

    expect(setShowApiKey).toHaveBeenCalledWith(true);
  });

  it("renders the Base URL input with the current value", () => {
    const props = buildAIConfigProps({
      settings: buildSettings({ ai_base_url: "https://my.endpoint/v1" }),
    });
    render(<AIConfigSection {...props} />);

    const baseUrlInput = screen.getByPlaceholderText(
      "https://api.openai.com/v1",
    );
    expect(baseUrlInput).toHaveValue("https://my.endpoint/v1");
  });

  it("renders the predefined model select when customModel is false", () => {
    const props = buildAIConfigProps({
      customModel: false,
      settings: buildSettings({ ai_model: "gpt-4o" }),
    });
    render(<AIConfigSection {...props} />);

    const modelSelect = screen.getByDisplayValue("GPT-4o") as HTMLSelectElement;
    expect(modelSelect).toBeInTheDocument();
    expect(modelSelect.tagName).toBe("SELECT");
  });

  it("renders a custom model text input when customModel is true", () => {
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
  });

  it("renders the temperature range input with the current value", () => {
    const props = buildAIConfigProps({
      settings: buildSettings({ ai_temperature: 0.7 }),
    });
    render(<AIConfigSection {...props} />);

    // The temperature slider is the range input bound to ai_temperature.
    // Two range inputs exist (temperature + max_tokens); identify by value.
    const sliders = screen.getAllByRole("slider");
    const temperatureSlider = sliders.find(
      (s) => (s as HTMLInputElement).value === "0.7",
    ) as HTMLInputElement;
    expect(temperatureSlider).toBeDefined();
    expect(temperatureSlider).toHaveAttribute("min", "0");
    expect(temperatureSlider).toHaveAttribute("max", "1");
    expect(temperatureSlider).toHaveAttribute("step", "0.1");
  });

  it("renders the max tokens range input with the current value", () => {
    const props = buildAIConfigProps({
      settings: buildSettings({ ai_max_tokens: 1500 }),
    });
    render(<AIConfigSection {...props} />);

    const sliders = screen.getAllByRole("slider");
    const maxTokensSlider = sliders.find(
      (s) => (s as HTMLInputElement).value === "1500",
    ) as HTMLInputElement;
    expect(maxTokensSlider).toBeDefined();
    // [20260815_Fix_AiMaxTokensDefault] Bounds raised 500–4096 → 1024–16384
    // (reasoning models need headroom for thinking tokens).
    expect(maxTokensSlider).toHaveAttribute("min", "1024");
    expect(maxTokensSlider).toHaveAttribute("max", "16384");
    expect(maxTokensSlider).toHaveAttribute("step", "256");
  });

  it("renders provider preset quick-select buttons", () => {
    const props = buildAIConfigProps({
      resolvedProviderPresets: [
        {
          label: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o",
          noApiKey: false,
        },
        {
          label: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-chat",
          noApiKey: false,
        },
      ],
    });
    render(<AIConfigSection {...props} />);

    expect(screen.getByRole("button", { name: "OpenAI" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "DeepSeek" }),
    ).toBeInTheDocument();
  });

  it("calls applyProviderPreset when a provider preset button is clicked", async () => {
    const user = userEvent.setup();
    const applyProviderPreset = vi.fn();
    const preset = {
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      noApiKey: false,
    };
    const props = buildAIConfigProps({
      resolvedProviderPresets: [preset],
      applyProviderPreset,
    });
    render(<AIConfigSection {...props} />);

    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(applyProviderPreset).toHaveBeenCalledWith(preset);
  });

  it("renders and invokes the test configuration button", async () => {
    const user = userEvent.setup();
    const testAIConfiguration = vi.fn();
    const props = buildAIConfigProps({ testAIConfiguration });
    render(<AIConfigSection {...props} />);

    const testButton = screen.getByRole("button", { name: "测试配置" });
    expect(testButton).not.toBeDisabled();
    await user.click(testButton);
    expect(testAIConfiguration).toHaveBeenCalledTimes(1);
  });

  it("renders and invokes the save button", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn();
    const props = buildAIConfigProps({ saveSettings });
    render(<AIConfigSection {...props} />);

    const saveButton = screen.getByRole("button", { name: "保存设置" });
    await user.click(saveButton);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it("renders the quick start panel with registration-required presets when showQuickStart is true", () => {
    const presets: ProviderPreset[] = [
      {
        name: "openai",
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        models: ["gpt-4o"],
        requires_api_key: true,
        registration: { url: "https://platform.openai.com", recommended: true },
      },
      {
        name: "local",
        label: "Local",
        base_url: "http://localhost:1234",
        models: ["local-model"],
        requires_api_key: false,
      },
    ];
    const props = buildAIConfigProps({
      showQuickStart: true,
      providerPresets: presets,
    });
    render(<AIConfigSection {...props} />);

    // The quick start panel heading is always present.
    expect(screen.getByText("快速开始")).toBeInTheDocument();
    // "OpenAI" appears as both the preset label and its guide fallback, so use
    // getAllByText. The local preset (no registration / localhost) is filtered
    // out, so no "Local" text should be rendered.
    expect(screen.getAllByText("OpenAI").length).toBeGreaterThan(0);
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
    // The recommended badge + the "获取 Key" link only show for the qualifying
    // preset, confirming the registration filter worked.
    expect(screen.getByText("推荐")).toBeInTheDocument();
    expect(screen.getByText("获取 Key")).toBeInTheDocument();
  });
});

// [20260816_Test_AboutSection] Update-flow buttons drive the injected
// callbacks (the AboutSection props surface).
describe("[20260816_Test_AboutSection] AboutSection update flow", () => {
  const base = {
    appVersion: "1.2.0",
    checkingUpdate: false,
    updateInfo: null,
    downloadProgress: null,
    downloadedUpdate: null,
  };

  it("invokes checkForUpdates from the check button", () => {
    const checkForUpdates = vi.fn();
    render(
      <AboutSection
        {...(base as unknown as React.ComponentProps<typeof AboutSection>)}
        checkForUpdates={checkForUpdates}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-progress download and installs a downloaded one", () => {
    const cancelUpdateDownload = vi.fn();
    const installUpdate = vi.fn();
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      cancelUpdateDownload,
      installUpdate,
    };
    render(
      <AboutSection
        {...(base as unknown as React.ComponentProps<typeof AboutSection>)}
        downloadProgress={{ progress: 40, downloaded: 4, total: 10 } as never}
        downloadedUpdate={
          { version: "1.3.0", filePath: "/tmp/murmur.dmg" } as never
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(cancelUpdateDownload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /安装/ }));
    expect(installUpdate).toHaveBeenCalledWith("/tmp/murmur.dmg");
  });

  it("invokes startDownload when an update is available", () => {
    const startDownload = vi.fn();
    render(
      <AboutSection
        {...(base as unknown as React.ComponentProps<typeof AboutSection>)}
        startDownload={startDownload}
        updateInfo={
          {
            hasUpdate: true,
            currentVersion: "1.2.0",
            latestVersion: "1.3.0",
            downloadUrl: "https://example.com/d",
          } as unknown as UpdateCheckResult
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /下载|安装/ }));
    expect(startDownload).toHaveBeenCalledTimes(1);
  });
});
