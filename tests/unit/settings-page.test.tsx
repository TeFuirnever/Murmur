// @vitest-environment jsdom
// [20260816_Test_SettingsPage] src/settings.tsx was 0% — component coverage
// for SettingsPage (section switching, save flow) plus the module's mount
// entry (#settings-root + preload assertion guard).
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// sonner: stub Toaster (portal issues under jsdom), spy on toast.
vi.mock("sonner", () => ({
  Toaster: () =>
    React.createElement("div", { "data-testid": "sonner-toaster" }),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// [20260816_Test_SettingsPage] Resolve t() against the shipped zh-CN locale
// (flattened) like misc-components.test.tsx so sidebar tab names match.
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => LOCALE[key] ?? fallback ?? key,
    i18n: { language: "zh-CN", changeLanguage: vi.fn() },
  }),
}));

// Controlled useSettings fixture — the hook itself has its own suite.
const saveSettingsMock = vi.fn().mockResolvedValue(true);
const handleInputChangeMock = vi.fn();
vi.mock("../../src/settings/useSettings", async (importOriginal) => {
  // Keep the real constants (PREDEFINED_MODELS / MODEL_LABELS / applyTheme...)
  // — only the hook is controlled.
  const actual =
    await importOriginal<typeof import("../../src/settings/useSettings")>();
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        ai_api_key: "sk-test",
        ai_base_url: "https://api.openai.com/v1",
        ai_model: "gpt-4o",
        ai_temperature: 0.3,
        ai_max_tokens: 8192,
        enable_ai_optimization: true,
        window_always_on_top: true,
        auto_paste: "paste",
        close_behavior: "hide",
        theme: "system",
      },
      loading: false,
      saving: false,
      handleInputChange: handleInputChangeMock,
      saveSettings: saveSettingsMock,
      customModel: false,
      setCustomModel: vi.fn(),
      providerPresets: [],
      resolvedProviderPresets: [],
      applyProviderPreset: vi.fn(),
      showApiKey: false,
      setShowApiKey: vi.fn(),
      apiKeyInputRef: { current: null },
      testing: false,
      testResult: null,
      testAIConfiguration: vi.fn(),
      showQuickStart: false,
      appVersion: "1.2.0",
      checkingUpdate: false,
      updateInfo: null,
      downloadProgress: null,
      downloadedUpdate: null,
      checkForUpdates: vi.fn(),
      startDownload: vi.fn(),
    }),
  };
});

import { SettingsPage } from "../../src/settings";

describe("[20260816_Test_SettingsPage] SettingsPage component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the General section by default with the sidebar tabs", () => {
    render(<SettingsPage />);
    // Sidebar tabs (role=tab per SettingsSidebar).
    expect(screen.getByRole("tab", { name: "通用" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "权限" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "AI 配置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "关于" })).toBeInTheDocument();
    // General section content is visible; AI content is not.
    expect(screen.getByText("应用的颜色主题")).toBeInTheDocument();
    expect(screen.queryByText("预定义模型")).not.toBeInTheDocument();
  });

  it("switches to the AI section via the sidebar", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "AI 配置" }));
    expect(screen.getByText("预定义模型")).toBeInTheDocument();
    expect(screen.queryByText("应用的颜色主题")).not.toBeInTheDocument();
  });

  it("switches to the About section and shows the app version", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "关于" }));
    // t mock returns the raw zh-CN template ({{version}} not interpolated).
    expect(screen.getByText(/当前版本/)).toBeInTheDocument();
  });

  it("hides the settings window via the header close button", async () => {
    const hideSettingsWindow = vi.fn();
    (globalThis.window as unknown as { electronAPI?: unknown }).electronAPI = {
      hideSettingsWindow,
    };
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /关闭|设置/ }));
    expect(hideSettingsWindow).toHaveBeenCalledTimes(1);
  });

  it("invokes saveSettings from the AI section's save button", async () => {
    // The save button lives in AIConfigSection — switch there first.
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "AI 配置" }));
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => {
      expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    });
  });

  it("changes a general setting through the section's handler", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("switch"));
    expect(handleInputChangeMock).toHaveBeenCalledWith(
      "window_always_on_top",
      false,
    );
  });
});

describe("[20260816_Test_SettingsPage] settings entry mount", () => {
  it("mounts SettingsPage into #settings-root when the bridge exists", async () => {
    vi.resetModules();
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: vi.fn(() => true),
    }));
    document.body.innerHTML = '<div id="settings-root"></div>';
    await import("../../src/settings");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "通用" })).toBeInTheDocument();
    });
  });

  it("leaves #settings-root empty when the preload bridge is missing", async () => {
    vi.resetModules();
    vi.doMock("../../src/bootstrap/assertElectronAPI.js", () => ({
      assertElectronAPI: vi.fn(() => false),
    }));
    document.body.innerHTML = '<div id="settings-root"></div>';
    await import("../../src/settings");
    // Give React a tick to prove nothing mounted.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById("settings-root")?.childElementCount).toBe(0);
  });
});
