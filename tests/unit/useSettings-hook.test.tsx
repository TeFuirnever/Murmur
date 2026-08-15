// [20260729_Test_UseSettingsHook] Integration test for the useSettings React
// hook. Unlike the node-environment unit tests, this file MUST run under
// jsdom because the hook uses React state/effects and window.matchMedia,
// both of which require a DOM. We render the hook via @testing-library/react's
// renderHook and assert the load -> change -> save lifecycle for the
// effects_enabled setting (the recently-added visual-effects toggle).
// @vitest-environment jsdom
import "../setup/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSettings } from "../../src/settings/useSettings";
import type { ElectronAPI } from "../../src/electronAPI";

// [20260729_Test_UseSettingsHook] useSettings depends on useTranslation for
// toast copy. Stub react-i18next so t() echoes its fallback (second arg) or
// the key — deterministic, no i18n backend required. vitest hoists vi.mock
// above the static import above, so the mock is active when the module loads.
//
// CRITICAL: `t` is defined inside the factory (module scope of the mock), so
// it is a STABLE reference across renders. The real useTranslation memoizes
// t; if our mock returned a new function each call, useSettings' `loadSettings`
// useCallback (dep [t]) would get a new identity every render, retriggering
// the mount effect in an infinite loop. Defining t at factory scope fixes that.
vi.mock("react-i18next", () => {
  const t = (key: string, fallback?: string) => fallback ?? key;
  return { useTranslation: () => ({ t }) };
});

// [20260729_Test_UseSettingsHook] useSettings imports `toast` from sonner at
// module top-level. Mock it to a no-op so no real toast UI is rendered.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// [20260729_Test_UseSettingsHook] Full settings object returned by the
// (mocked) preload bridge. effects_enabled: true is the value the load test
// asserts the hook read correctly.
const MOCK_SETTINGS = {
  ai_api_key: "sk-test",
  ai_base_url: "https://api.openai.com/v1",
  ai_model: "gpt-4o",
  ai_temperature: "0.5",
  ai_max_tokens: "1000",
  enable_ai_optimization: true,
  window_always_on_top: true,
  auto_paste: "paste",
  close_behavior: "hide",
  theme: "system",
  effects_enabled: true,
};

// [20260729_Test_UseSettingsHook] Window shape this test manipulates: the
// production declaration makes `electronAPI` required, but the test installs
// and tears down its own stub, so Omit the required prop and re-add it as
// optional. Cast through `unknown` only; never `any`.
type TestWindow = Omit<Window, "electronAPI"> & { electronAPI?: ElectronAPI };

// [20260729_Test_UseSettingsHook] Minimal ElectronAPI stub covering every
// method the hook touches on mount and during save. Methods not exercised by
// these tests are still present (no-ops) so mount effects don't throw.
function makeElectronAPIStub(): ElectronAPI {
  return {
    getAllSettings: vi.fn().mockResolvedValue(MOCK_SETTINGS),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getAppVersion: vi.fn().mockResolvedValue("1.0.0"),
    getAIProviderPresets: vi.fn().mockResolvedValue([]),
    detectLocalModels: vi.fn().mockResolvedValue([]),
  } as unknown as ElectronAPI;
}

describe("useSettings hook", () => {
  let originalAPI: ElectronAPI | undefined;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow).electronAPI;
    // [20260729_Test_UseSettingsHook] jsdom does not implement matchMedia;
    // useSettings.applyTheme() calls it for the "system" theme. Stub a minimal
    // MediaQueryList-like object before rendering.
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub();
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) {
      delete win.electronAPI;
    } else {
      win.electronAPI = originalAPI;
    }
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it("loads settings on mount and reads effects_enabled === true", async () => {
    const { result } = renderHook(() => useSettings());

    // loadSettings runs in a mount effect; wait for it to flush.
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const api = (globalThis.window as TestWindow).electronAPI!;
    expect(api.getAllSettings).toHaveBeenCalledTimes(1);
    // loadSettings sets effects_enabled only when the DB value === true.
    expect(result.current.settings.effects_enabled).toBe(true);
  });

  it("updates settings state when handleInputChange toggles effects_enabled off", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleInputChange("effects_enabled", false);
    });

    expect(result.current.settings.effects_enabled).toBe(false);
  });

  it("persists effects_enabled via setSetting when saveSettings runs", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleInputChange("effects_enabled", false);
    });

    await act(async () => {
      await result.current.saveSettings();
    });

    const api = (globalThis.window as TestWindow).electronAPI!;
    expect(api.setSetting).toHaveBeenCalledWith("effects_enabled", false);
  });

  // [20260815_Fix_AiMaxTokensDefault] When no ai_max_tokens is persisted,
  // loadSettings must fall back to 8192 (not the old 2000): reasoning models
  // count thinking tokens against max_tokens and 2000 let reasoning alone
  // exhaust the budget (empty-content failures, see 20260815_Fix_AiEmptyContent).
  it("falls back to ai_max_tokens 8192 when no value is persisted", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.settings.ai_max_tokens).toBe(8192);
  });
});
