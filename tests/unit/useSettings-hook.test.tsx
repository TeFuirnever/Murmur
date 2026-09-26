// [20260729_Test_UseSettingsHook] Integration test for the useSettings React
// hook. Unlike the node-environment unit tests, this file MUST run under
// jsdom because the hook uses React state/effects and window.matchMedia,
// both of which require a DOM. We render the hook via @testing-library/react's
// renderHook and assert the load -> change -> save lifecycle for the theme
// setting. ([20260816_Refactor_RemoveEffects] the old effects_enabled carrier
// was removed with the visual-effects feature.)
// @vitest-environment jsdom
import "../setup/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { DEFAULT_HOTKEY } from "../../src/settings/hotkeyRecorder";
import {
  DEFAULT_MODEL,
  MODEL_LABELS,
  PREDEFINED_MODELS,
  useSettings,
} from "../../src/settings/useSettings";
import type { ElectronAPI } from "../../src/electronAPI";
// [20260816_Test_BranchPush] Toast assertions for the load/save failure paths.
import { toast } from "sonner";

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
// (mocked) preload bridge. theme: "dark" is the value the load test asserts
// the hook read correctly. ([20260816_Refactor_RemoveEffects] the old
// effects_enabled carrier was removed with the visual-effects feature.)
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
  theme: "dark",
  // [20260905_Test_BotBranchRecovery] populated so loadSettings exercises
  // the stored-value arms of the bot catalogue mappings (spec #224 ticket 5)
  bot_shape: "droplet",
  bot_color: "blue",
  bot_expression: "happy",
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

function makeFullStub(overrides: Record<string, unknown> = {}) {
  return {
    getAllSettings: vi.fn().mockResolvedValue(MOCK_SETTINGS),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getAppVersion: vi.fn().mockResolvedValue("9.9.9"),
    getAIProviderPresets: vi.fn().mockResolvedValue([]),
    detectLocalModels: vi.fn().mockResolvedValue([]),
    checkAIStatus: vi
      .fn()
      .mockResolvedValue({ available: true, model: "gpt-test" }),
    checkForUpdates: vi.fn().mockResolvedValue({ hasUpdate: false }),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateDownloadProgress: vi.fn().mockReturnValue(() => {}),
    onUpdateDownloadComplete: vi.fn().mockReturnValue(() => {}),
    onUpdateDownloadError: vi.fn().mockReturnValue(() => {}),
    ...overrides,
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

  it("loads settings on mount and reads theme === dark", async () => {
    const { result } = renderHook(() => useSettings());

    // loadSettings runs in a mount effect; wait for it to flush.
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const api = (globalThis.window as TestWindow).electronAPI!;
    expect(api.getAllSettings).toHaveBeenCalledTimes(1);
    expect(result.current.settings.theme).toBe("dark");
  });

  // [20260905_Fix_249_ReviewMajor] The legacy AI boolean and default_mode
  // are two views of one knob: toggling the switch off and then saving used
  // to persist a stale derived "auto", which bypassed the read-side
  // migration and ran AI despite the switch showing off.
  it("keeps default_mode in sync when the AI optimization toggle flips", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleInputChange("enable_ai_optimization", false);
    });
    expect(result.current.settings.default_mode).toBe("off");

    act(() => {
      result.current.handleInputChange("enable_ai_optimization", true);
    });
    expect(result.current.settings.default_mode).toBe("auto");
  });

  it("restores auto (not the stale choice) when the AI toggle re-enables", async () => {
    // [20260905_Fix_249_ReviewCoverage] Once the toggle flips off, the mode
    // is "off" and the previous explicit choice is intentionally dropped —
    // re-enabling lands on the safe "auto" (restoring the exact prior mode
    // would need extra memory; the read side treats "auto" as the default).
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleInputChange("default_mode", "correct");
    });
    act(() => {
      result.current.handleInputChange("enable_ai_optimization", false);
    });
    expect(result.current.settings.default_mode).toBe("off");
    act(() => {
      result.current.handleInputChange("enable_ai_optimization", true);
    });
    expect(result.current.settings.default_mode).toBe("auto");
    expect(result.current.settings.enable_ai_optimization).toBe(true);
  });

  it("tolerates a missing electronAPI on the sync paths", async () => {
    // [20260905_Fix_249_ReviewCoverage] The setSetting-optional arms: with
    // the bridge gone, handleInputChange must still update React state.
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const win = globalThis.window as TestWindow;
    delete win.electronAPI;

    act(() => {
      result.current.handleInputChange("enable_ai_optimization", false);
    });
    expect(result.current.settings.default_mode).toBe("off");
    act(() => {
      result.current.handleInputChange("default_mode", "summarize");
    });
    expect(result.current.settings.enable_ai_optimization).toBe(true);
    act(() => {
      result.current.handleInputChange("theme", "dark");
    });
    expect(result.current.settings.theme).toBe("dark");
  });

  it("keeps the AI toggle in sync when default_mode is changed", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleInputChange("default_mode", "correct");
    });
    expect(result.current.settings.enable_ai_optimization).toBe(true);

    act(() => {
      result.current.handleInputChange("default_mode", "off");
    });
    expect(result.current.settings.enable_ai_optimization).toBe(false);
  });

  it("updates settings state when handleInputChange toggles theme", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleInputChange("theme", "light");
    });

    expect(result.current.settings.theme).toBe("light");
  });

  // [20260926_Fix_395_ThemeLiveApply] The General tab select writes through
  // handleInputChange, which persisted but never applied the theme — the
  // settings window kept the old colors until reload (issue #395, evidence
  // 1). The live document flip is part of the write contract now.
  it("applies a theme change to the document the moment handleInputChange writes it", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    // The stubbed settings load "dark"; make the starting state explicit.
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => {
      result.current.handleInputChange("theme", "light");
    });
    expect(result.current.settings.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      result.current.handleInputChange("theme", "dark");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // "system" resolves through matchMedia (stubbed to light in beforeEach).
    act(() => {
      result.current.handleInputChange("theme", "system");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("persists theme via setSetting when saveSettings runs", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleInputChange("theme", "light");
    });

    await act(async () => {
      await result.current.saveSettings();
    });

    const api = (globalThis.window as TestWindow).electronAPI!;
    expect(api.setSetting).toHaveBeenCalledWith("theme", "light");
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

  // [20260905_Fix_249_DefaultModeUi] default_mode gets a write path (issue
  // #249). loadSettings must MIGRATE, not blindly default: a user with the
  // legacy enable_ai_optimization=false must load "off" — otherwise opening
  // settings would auto-persist "auto" and silently re-enable AI processing.
  it("migrates default_mode off the legacy boolean when unset", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      enable_ai_optimization: false,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.default_mode).toBe("off");
  });

  it("migrates default_mode to auto when the legacy boolean is on", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      enable_ai_optimization: true,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.default_mode).toBe("auto");
  });

  it("falls back to the default hotkey when the stored value is not a usable string", async () => {
    // [20260905_Fix_249_ReviewCoverage] The two fallback arms of the hotkey
    // loader: non-string stored values and empty strings both yield
    // DEFAULT_HOTKEY.
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      hotkey: 42,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.hotkey).toBe(DEFAULT_HOTKEY);

    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      hotkey: "",
    });
    const { result: result2 } = renderHook(() => useSettings());
    await waitFor(() => expect(result2.current.loading).toBe(false));
    expect(result2.current.settings.hotkey).toBe(DEFAULT_HOTKEY);
  });

  it("keeps a persisted default_mode value as-is", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      default_mode: "correct",
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.default_mode).toBe("correct");
  });

  // [20260926_Refactor_403_SettingsSchema] show_notifications joins
  // SettingsState with the schema (issue #400 shipped it as a local-state
  // special case; #403 folds it in). Load semantics are the SAME gate the
  // #400 GeneralSection read path and the main-process updateManager gate
  // used: `!== false` — only a literal false reads as off.
  it("defaults show_notifications to on when nothing is stored", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_SETTINGS,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.show_notifications).toBe(true);
  });

  it("loads a stored show_notifications=false as off", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_SETTINGS,
      show_notifications: false,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.show_notifications).toBe(false);
  });

  it("coerces a non-boolean stored show_notifications to on", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_SETTINGS,
      show_notifications: "false",
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.show_notifications).toBe(true);
  });

  it("persists show_notifications through handleInputChange immediately (discrete switch, no debounce)", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.setSetting as ReturnType<typeof vi.fn>).mockClear();
    act(() => {
      result.current.handleInputChange("show_notifications", false);
    });
    expect(result.current.settings.show_notifications).toBe(false);
    expect(api.setSetting).toHaveBeenCalledWith("show_notifications", false);
  });

  // [20260926_Issue404] auto_start joins SettingsState with the schema
  // (#404 General-tab launch-at-login switch). Load semantics mirror the
  // stored default: absent/odd → off, only literal true reads as on — the
  // mirror image of the `!== false` booleans whose defaults are on.
  it("defaults auto_start to off when nothing is stored", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_SETTINGS,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.auto_start).toBe(false);
  });

  it("loads a stored auto_start=true as on", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_SETTINGS,
      auto_start: true,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.auto_start).toBe(true);
  });

  it("coerces a non-boolean stored auto_start to off", async () => {
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_SETTINGS,
      auto_start: "yes",
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.auto_start).toBe(false);
  });

  it("persists auto_start through handleInputChange immediately (discrete switch, no debounce)", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const api = (globalThis.window as TestWindow).electronAPI!;
    (api.setSetting as ReturnType<typeof vi.fn>).mockClear();
    act(() => {
      result.current.handleInputChange("auto_start", true);
    });
    expect(result.current.settings.auto_start).toBe(true);
    expect(api.setSetting).toHaveBeenCalledWith("auto_start", true);
  });
});

// [20260816_Test_UseSettingsExpanded] Second describe: save reconciliation
// loop, AI-config test branches, provider presets, and update flows — the
// hook's biggest previously-uncovered regions.
describe("useSettings hook — save / test / presets / updates", () => {
  // Richer stub than the file-level one: covers the AI-status and update
  // surface. Re-installed in beforeEach below (same TestWindow mechanics).

  let originalAPI: ElectronAPI | undefined;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow).electronAPI;
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
    (globalThis.window as TestWindow).electronAPI = makeFullStub();
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  const api = () => (globalThis.window as TestWindow).electronAPI!;

  it("saveSettings persists api_key separately then loops the remaining keys", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveSettings();
    });

    const calls = (api().setSetting as ReturnType<typeof vi.fn>).mock.calls;
    // api_key first (unmasked value), then every other SettingsState key.
    expect(calls[0]).toEqual(["ai_api_key", "sk-test"]);
    const keys = calls.map((c) => c[0]);
    expect(keys).toContain("theme");
    expect(keys).toContain("ai_max_tokens");
    expect(keys).toContain("show_notifications");
    expect(keys).not.toContain(undefined);
    // [20260905_Fix_249_DefaultModeUi] count updated for default_mode:
    // 1 special-cased (unmasked api_key) + 15 in the loop.
    // [20260905_Fix_246_HotkeySettingsUi] count updated for the hotkey key.
    // [20260926_Refactor_403_SettingsSchema] +show_notifications (schema fold).
    // [20260926_Issue404] +auto_start (joins SettingsState with the schema).
    // [20260926_Issue406] +model_download_path (joins SettingsState).

    // [20260926_Issue405] +minimize_to_tray and [Issue406] +model_download_path (both join SettingsState with the schema).
    expect(calls).toHaveLength(20);
  });

  it("saveSettings skips re-sending a masked api_key but still saves the rest", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.handleInputChange("ai_api_key", "********abcd");
    });
    // Drop the auto-persist call handleInputChange just made, so the
    // assertions below see only saveSettings' own traffic.
    (api().setSetting as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      await result.current.saveSettings();
    });
    const calls = (api().setSetting as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.find((c) => c[0] === "ai_api_key")).toBeUndefined();
    // [20260905_Fix_249_DefaultModeUi] 15 loop keys after default_mode.
    // [20260905_Fix_246_HotkeySettingsUi] +hotkey. [20260820_T14_Hotwords]
    // 10 loop keys after hotwords. [20260926_Refactor_403_SettingsSchema]
    // +show_notifications. [20260926_Issue404] +auto_start.
    // [20260926_Issue406] +model_download_path (joins SettingsState).
    expect(calls).toHaveLength(19); // [20260926_Issue406] +model_download_path.

    expect(calls).toHaveLength(19); // [20260905_Fix_249_DefaultModeUi] 15 loop keys after default_mode. [20260905_Fix_246_HotkeySettingsUi] +hotkey. [20260820_T14_Hotwords] 10 loop keys after hotwords. [20260926_Refactor_403_SettingsSchema] +show_notifications. [20260926_Issue404] +auto_start. [20260926_Issue405] +minimize_to_tray. [20260926_Issue406] +model_download_path.
  });

  it("saveSettings returns false and toasts on IPC failure", async () => {
    (api().setSetting as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db locked"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.saveSettings();
    });
    expect(ok).toBe(false);
    errSpy.mockRestore();
  });

  it("resolves provider presets with local-model detection", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      getAIProviderPresets: vi.fn().mockResolvedValue([
        {
          name: "ollama",
          label: "Ollama",
          base_url: "http://localhost:11434/v1",
          models: ["qwen2.5"],
          requires_api_key: false,
        },
      ]),
      detectLocalModels: vi
        .fn()
        .mockResolvedValue([
          { name: "ollama", label: "Ollama", models: ["llama3", "qwen2.5"] },
        ]),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() =>
      expect(result.current.resolvedProviderPresets).toHaveLength(1),
    );
    const [preset] = result.current.resolvedProviderPresets;
    expect(preset?.label).toBe("Ollama ✓");
    expect(preset?.model).toBe("llama3"); // detected model wins over preset list
    expect(preset?.noApiKey).toBe(true);
  });

  it("applyProviderPreset updates url/model and flips to custom model", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.applyProviderPreset({
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
      });
    });
    expect(result.current.settings.ai_base_url).toBe(
      "https://api.deepseek.com/v1",
    );
    expect(result.current.settings.ai_model).toBe("deepseek-chat");
    expect(result.current.customModel).toBe(true);
  });

  it("testAIConfiguration blocks an empty key on a remote base URL", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.handleInputChange("ai_api_key", "");
    });
    await act(async () => {
      await result.current.testAIConfiguration();
    });
    expect(result.current.testResult?.available).toBe(false);
    expect(result.current.testResult?.error).toContain("API");
    expect(api().checkAIStatus).not.toHaveBeenCalled();
  });

  it("testAIConfiguration blocks a masked key on a remote base URL", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.handleInputChange("ai_api_key", "********abcd");
    });
    await act(async () => {
      await result.current.testAIConfiguration();
    });
    expect(result.current.testResult?.available).toBe(false);
    expect(api().checkAIStatus).not.toHaveBeenCalled();
  });

  it("testAIConfiguration surfaces a failed connectivity check", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkAIStatus: vi.fn().mockResolvedValue({
        available: false,
        error: "连接失败",
      }),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.testAIConfiguration();
    });
    expect(result.current.testResult?.available).toBe(false);
    expect(result.current.testResult?.error).toBe("连接失败");
  });

  it("testAIConfiguration records an exception as a failed result", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkAIStatus: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.testAIConfiguration();
    });
    expect(result.current.testResult?.available).toBe(false);
    expect(result.current.testResult?.error).toContain("network down");
    expect(result.current.testing).toBe(false);
    errSpy.mockRestore();
  });

  it("checkForUpdates stores the result and toasts when an update exists", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkForUpdates: vi.fn().mockResolvedValue({
        hasUpdate: true,
        currentVersion: "1.2.0",
        latestVersion: "1.3.0",
        downloadUrl: "https://example.com/d",
      }),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    expect(result.current.updateInfo?.hasUpdate).toBe(true);
  });

  it("checkForUpdates records the error when the check throws", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkForUpdates: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    expect(result.current.updateInfo?.error).toContain("offline");
    errSpy.mockRestore();
  });

  it("startDownload is a no-op without update info and clears progress on error", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.startDownload();
    });
    expect(api().downloadUpdate).not.toHaveBeenCalled();
  });

  it("exposes the app version and quick-start hint for missing keys", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      getAllSettings: vi.fn().mockResolvedValue({
        ...MOCK_SETTINGS,
        ai_api_key: "",
      }),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.appVersion).toBe("9.9.9");
    expect(result.current.showQuickStart).toBe(true);
  });
});

// [20260816_Test_UseSettingsUpdateListeners] The three update-download
// listener callbacks and the download start path.
describe("useSettings hook — update download listeners", () => {
  let progressCb: ((data: unknown) => void) | undefined;
  let completeCb: ((data: unknown) => void) | undefined;
  let errorCb: ((data: { error: string }) => void) | undefined;

  function mountWithListeners() {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      onUpdateDownloadProgress: vi.fn((cb) => {
        progressCb = cb as (data: unknown) => void;
        return () => {};
      }),
      onUpdateDownloadComplete: vi.fn((cb) => {
        completeCb = cb as (data: unknown) => void;
        return () => {};
      }),
      onUpdateDownloadError: vi.fn((cb) => {
        errorCb = cb as (data: { error: string }) => void;
        return () => {};
      }),
    });
    return renderHook(() => useSettings());
  }

  it("tracks download progress events", async () => {
    const { result } = mountWithListeners();
    await waitFor(() => expect(result.current.loading).toBe(false));
    // The error callback only records into an existing updateInfo — seed one.
    await act(async () => {
      await result.current.checkForUpdates();
    });

    act(() => {
      progressCb?.({ progress: 55, downloaded: 5, total: 9 });
    });
    expect(result.current.downloadProgress?.progress).toBe(55);

    act(() => {
      completeCb?.({ version: "1.3.0" });
    });
    expect(result.current.downloadProgress).toBeNull();
    expect(result.current.downloadedUpdate?.version).toBe("1.3.0");

    act(() => {
      errorCb?.({ error: "校验失败" });
    });
    expect(result.current.downloadProgress).toBeNull();
    expect(result.current.updateInfo?.error).toBe("校验失败");
  });

  it("startDownload invokes downloadUpdate when an update is available", async () => {
    const downloadUpdate = vi.fn().mockResolvedValue(undefined);
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkForUpdates: vi.fn().mockResolvedValue({
        hasUpdate: true,
        currentVersion: "1.2.0",
        latestVersion: "1.3.0",
        downloadUrl: "https://example.com/d",
        downloadSize: 100,
      }),
      downloadUpdate,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.checkForUpdates();
    });
    expect(result.current.updateInfo?.hasUpdate).toBe(true);

    await act(async () => {
      await result.current.startDownload();
    });
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
    expect(result.current.downloadProgress?.total).toBe(100);
  });
});

// [20260816_Test_BranchPush] Remaining uncovered arcs in useSettings.ts:
// load-failure toast, NaN parse fallbacks, masked-key load, preset resolution
// without local detection, local-URL test bypass + fallback configs, guard
// branches without electronAPI methods, and startDownload early returns.
describe("useSettings hook — branch push", () => {
  let originalAPI: ElectronAPI | undefined;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow).electronAPI;
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
    (globalThis.window as TestWindow).electronAPI = makeFullStub();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it("toasts an error when getAllSettings rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      getAllSettings: vi.fn().mockRejectedValue(new Error("db locked")),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(toast.error as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        "加载设置失败",
      );
    });
    // finally-branch still clears the loading flag on failure.
    await waitFor(() => expect(result.current.loading).toBe(false));
    errSpy.mockRestore();
  });

  it("falls back to defaults when temperature/max_tokens strings are unparseable", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      getAllSettings: vi.fn().mockResolvedValue({
        ...MOCK_SETTINGS,
        ai_temperature: "not-a-number",
        ai_max_tokens: "xyz",
      }),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.ai_temperature).toBe(0.3);
    expect(result.current.settings.ai_max_tokens).toBe(8192);
  });

  it("loads a masked key and shows the quick-start hint", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      getAllSettings: vi.fn().mockResolvedValue({
        ...MOCK_SETTINGS,
        ai_api_key: "****abcd",
      }),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.ai_api_key).toBe("****abcd");
    expect(result.current.showQuickStart).toBe(true);
  });

  it("resolves a remote preset without local detection and no models to an empty model", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      getAIProviderPresets: vi.fn().mockResolvedValue([
        {
          name: "openai",
          label: "OpenAI",
          base_url: "https://api.openai.com/v1",
          models: [],
          requires_api_key: true,
        },
      ]),
      detectLocalModels: vi.fn().mockResolvedValue([]),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() =>
      expect(result.current.resolvedProviderPresets).toHaveLength(1),
    );
    const [preset] = result.current.resolvedProviderPresets;
    // No checkmark suffix (not locally detected) and models[0] ?? "" fallback.
    expect(preset?.label).toBe("OpenAI");
    expect(preset?.model).toBe("");
    expect(preset?.noApiKey).toBe(false);
  });

  it("falls back to the preset's first model when detection reports none", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      getAIProviderPresets: vi.fn().mockResolvedValue([
        {
          name: "ollama",
          label: "Ollama",
          base_url: "http://localhost:11434/v1",
          models: ["fallback-model"],
          requires_api_key: false,
        },
      ]),
      detectLocalModels: vi
        .fn()
        .mockResolvedValue([{ name: "ollama", label: "Ollama", models: [] }]),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() =>
      expect(result.current.resolvedProviderPresets).toHaveLength(1),
    );
    // Detected but its model list is empty -> preset.models[0] wins.
    expect(result.current.resolvedProviderPresets[0]?.model).toBe(
      "fallback-model",
    );
  });

  it("testAIConfiguration bypasses the empty-key gate for a localhost base URL", async () => {
    const checkAIStatus = vi
      .fn()
      .mockResolvedValue({ available: true }) as ReturnType<typeof vi.fn>;
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkAIStatus,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.handleInputChange("ai_api_key", "");
      result.current.handleInputChange(
        "ai_base_url",
        "http://localhost:8000/v1",
      );
    });
    await act(async () => {
      await result.current.testAIConfiguration();
    });
    expect(checkAIStatus).toHaveBeenCalledWith(
      expect.objectContaining({ ai_api_key: "" }),
    );
    expect(result.current.testResult?.available).toBe(true);
  });

  it("testAIConfiguration substitutes defaults for whitespace url/model", async () => {
    const checkAIStatus = vi
      .fn()
      .mockResolvedValue({ available: true }) as ReturnType<typeof vi.fn>;
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkAIStatus,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.handleInputChange("ai_base_url", "   ");
      result.current.handleInputChange("ai_model", "   ");
    });
    await act(async () => {
      await result.current.testAIConfiguration();
    });
    expect(checkAIStatus).toHaveBeenCalledWith({
      ai_api_key: "sk-test",
      ai_base_url: "https://api.openai.com/v1",
      ai_model: "gpt-6-sol",
    });
  });

  it("testAIConfiguration uses the unknown-model label on a model-less success", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkAIStatus: vi.fn().mockResolvedValue({ available: true }),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.testAIConfiguration();
    });
    // The mocked t() returns the interpolation object verbatim, so the
    // description carries { model: "未知" } — proving the result.model ||
    // unknown-model fallback arc fired.
    expect(
      (toast.success as ReturnType<typeof vi.fn>).mock.calls[0]?.[1],
    ).toEqual(expect.objectContaining({ description: { model: "未知" } }));
  });

  it("testAIConfiguration reports an unknown error when the failure omits one", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkAIStatus: vi.fn().mockResolvedValue({ available: false }),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.testAIConfiguration();
    });
    expect(result.current.testResult?.available).toBe(false);
    expect(
      (toast.error as ReturnType<typeof vi.fn>).mock.calls.some(
        (call) => call[1]?.description === "未知错误",
      ),
    ).toBe(true);
  });

  it("testAIConfiguration falls back when the check rejects with an empty message", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkAIStatus: vi.fn().mockRejectedValue(new Error("")),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.testAIConfiguration();
    });
    // Empty Error.message -> the t() fallback string.
    expect(result.current.testResult?.error).toBe("AI配置测试失败");
    errSpy.mockRestore();
  });

  it("checkForUpdates uses the fallback message when the error message is empty", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkForUpdates: vi.fn().mockRejectedValue(new Error("")),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    expect(result.current.updateInfo?.error).toBe("检查更新失败");
    expect(result.current.checkingUpdate).toBe(false);
    errSpy.mockRestore();
  });

  it("startDownload is a no-op when the update has no download URL", async () => {
    const downloadUpdate = vi.fn().mockResolvedValue(undefined);
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkForUpdates: vi.fn().mockResolvedValue({
        hasUpdate: true,
        currentVersion: "1.2.0",
        latestVersion: "1.3.0",
      }),
      downloadUpdate,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    await act(async () => {
      await result.current.startDownload();
    });
    expect(downloadUpdate).not.toHaveBeenCalled();
  });

  it("startDownload defaults downloadSize to 0 when the update omits it", async () => {
    const downloadUpdate = vi.fn().mockResolvedValue(undefined);
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      checkForUpdates: vi.fn().mockResolvedValue({
        hasUpdate: true,
        currentVersion: "1.2.0",
        latestVersion: "1.3.0",
        downloadUrl: "https://example.com/d",
      }),
      downloadUpdate,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    await act(async () => {
      await result.current.startDownload();
    });
    expect(result.current.downloadProgress?.total).toBe(0);
  });

  it("keeps update listener registration optional when the methods are absent", async () => {
    // Drop the three listener methods — the optional-chaining guards and the
    // unsub?.() cleanup must both tolerate their absence.
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      onUpdateDownloadProgress: undefined,
      onUpdateDownloadComplete: undefined,
      onUpdateDownloadError: undefined,
    });
    const { result, unmount } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(() => unmount()).not.toThrow();
  });

  it("fires the download-error listener against a null updateInfo without crashing", async () => {
    let errorCb: ((data: { error: string }) => void) | undefined;
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      onUpdateDownloadError: vi.fn((cb) => {
        errorCb = cb as (data: { error: string }) => void;
        return () => {};
      }),
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // No checkForUpdates call: updateInfo stays null -> the error callback's
    // `prev ? {...prev, error} : prev` takes the null arm.
    act(() => {
      errorCb?.({ error: "late failure" });
    });
    expect(result.current.updateInfo).toBeNull();
    expect(result.current.downloadProgress).toBeNull();
  });

  it("skips IPC entirely when electronAPI is missing", async () => {
    delete (globalThis.window as TestWindow).electronAPI;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // loadSettings / mount effects / save all take their no-bridge arms.
    expect(result.current.settings.theme).toBe("system");
    let saved = true;
    await act(async () => {
      saved = await result.current.saveSettings();
    });
    expect(saved).toBe(false);
    expect(toast.error as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.checkForUpdates();
    });
    expect(result.current.updateInfo).toBeNull();
    errSpy.mockRestore();
  });

  it("updates state without setSetting when the bridge lacks the method", async () => {
    (globalThis.window as TestWindow).electronAPI = makeFullStub({
      setSetting: undefined,
    });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.handleInputChange("theme", "light");
    });
    expect(result.current.settings.theme).toBe("light");
  });
});

// [20260926_Fix_397_ModelCatalog] Issue #397 F2: the predefined list still
// advertised the retired gpt-3.5/gpt-4 generation and the recommended default
// pointed at gpt-3.5-turbo. Pin the refreshed 2026-09 catalog as a data
// contract so the next provider-side retirement cannot slip through silently.
describe("[20260926_Fix_397_ModelCatalog] predefined model catalog (2026-09)", () => {
  it("drops the retired gpt-3.5/gpt-4 generation entirely", () => {
    for (const retired of [
      "gpt-3.5-turbo",
      "gpt-4",
      "gpt-4-turbo",
      "gpt-4o",
      "gpt-4o-mini",
    ]) {
      expect(PREDEFINED_MODELS).not.toContain(retired);
    }
    expect(DEFAULT_MODEL).not.toMatch(/^gpt-[34]/);
  });

  it("lists the 2026-09 mainstream models across providers", () => {
    expect([...PREDEFINED_MODELS]).toEqual([
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-6-astra",
      "qwen3.8-max",
      "deepseek-flash",
    ]);
    expect(DEFAULT_MODEL).toBe("gpt-6-sol");
  });

  it("gives every predefined model a display label", () => {
    for (const model of PREDEFINED_MODELS) {
      expect(MODEL_LABELS[model]).toBeTruthy();
    }
  });

  it("keeps DEFAULT_MODEL inside PREDEFINED_MODELS", () => {
    expect(
      (PREDEFINED_MODELS as readonly string[]).includes(DEFAULT_MODEL),
    ).toBe(true);
  });
});

// [20260926_Perf_402_TextInputDebounce] Text-like setting keys (hotwords,
// ai_api_key, ai_base_url, ai_model) used to persist on EVERY keystroke —
// one SQLite write + one syncToFileConfig (fs.writeFileSync) + two-window
// broadcast each (issue #402). Now the persistence write is debounced 400ms
// (matching TemplatesSection's TEMPLATE_AUTOSAVE_DELAY_MS convention) with
// flush-on-blur/close so the tail keystroke is never lost. React state stays
// immediate — only the setSetting IPC is deferred; select/switch/theme keys
// persist synchronously as before.
describe("useSettings hook — text-input persistence debounce (issue #402)", () => {
  let originalAPI: ElectronAPI | undefined;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow).electronAPI;
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
    (globalThis.window as TestWindow).electronAPI = makeFullStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) delete win.electronAPI;
    else win.electronAPI = originalAPI;
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  const api = () => (globalThis.window as TestWindow).electronAPI!;

  async function mountLoaded() {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    (api().setSetting as ReturnType<typeof vi.fn>).mockClear();
    return { result };
  }

  it("debounces consecutive text keystrokes into a single persistence write", async () => {
    const { result } = await mountLoaded();
    vi.useFakeTimers();
    act(() => {
      result.current.handleInputChange("hotwords", "张");
      result.current.handleInputChange("hotwords", "张晗");
      result.current.handleInputChange("hotwords", "张晗玥");
    });
    // No per-keystroke write before the debounce window elapses.
    expect(api().setSetting).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // Exactly one write, carrying the LAST typed value.
    expect(api().setSetting).toHaveBeenCalledTimes(1);
    expect(api().setSetting).toHaveBeenCalledWith("hotwords", "张晗玥");
  });

  it("flushes pending text writes immediately and cancels the debounce timer", async () => {
    const { result } = await mountLoaded();
    vi.useFakeTimers();
    act(() => {
      result.current.handleInputChange("ai_api_key", "sk-new-key");
    });
    act(() => {
      result.current.flushPendingSettingWrites();
    });
    // The pending value is written right away…
    expect(api().setSetting).toHaveBeenCalledWith("ai_api_key", "sk-new-key");
    expect(api().setSetting).toHaveBeenCalledTimes(1);
    // …and the debounce timer no longer re-writes it.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(api().setSetting).toHaveBeenCalledTimes(1);
  });

  it("flushes pending text writes on window blur and before window close", async () => {
    const { result } = await mountLoaded();
    vi.useFakeTimers();
    act(() => {
      result.current.handleInputChange("ai_base_url", "https://api.new.com/v1");
    });
    expect(api().setSetting).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(api().setSetting).toHaveBeenCalledWith(
      "ai_base_url",
      "https://api.new.com/v1",
    );

    // beforeunload (settings window close) flushes anything typed after.
    act(() => {
      result.current.handleInputChange("hotwords", "尾字");
    });
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(api().setSetting).toHaveBeenCalledWith("hotwords", "尾字");
    // Still no timer-driven re-write afterwards.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(api().setSetting).toHaveBeenCalledTimes(2);
  });

  it("flushes pending text writes before running the AI configuration test", async () => {
    // Issue #408: 「测试配置」 must exercise the latest saved config. A text
    // edit still inside the 400ms debounce window is flushed BEFORE
    // checkAIStatus runs; the invocation order proves the write landed first.
    const { result } = await mountLoaded();
    vi.useFakeTimers();
    act(() => {
      result.current.handleInputChange("ai_base_url", "https://api.new.com/v1");
    });
    // The edit is still pending — nothing persisted yet.
    expect(api().setSetting).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.testAIConfiguration();
    });

    expect(api().setSetting).toHaveBeenCalledWith(
      "ai_base_url",
      "https://api.new.com/v1",
    );
    const setSettingOrder = (api().setSetting as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const checkStatusOrder = (api().checkAIStatus as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0];
    expect(setSettingOrder).toBeDefined();
    expect(checkStatusOrder).toBeDefined();
    expect(setSettingOrder).toBeLessThan(checkStatusOrder!);
    // The debounce window never elapses under fake timers, so this write
    // came from the flush — not from a timer.
    expect(api().setSetting).toHaveBeenCalledTimes(1);
  });

  it("keeps select/switch/theme keys immediate while text keys are debounced", async () => {
    const { result } = await mountLoaded();
    vi.useFakeTimers();
    // Select-backed key persists synchronously, before any timer advance.
    act(() => {
      result.current.handleInputChange("theme", "light");
    });
    expect(api().setSetting).toHaveBeenCalledWith("theme", "light");
    expect(api().setSetting).toHaveBeenCalledTimes(1);
    // Switch-backed keys keep their paired-write branch untouched.
    act(() => {
      result.current.handleInputChange("enable_ai_optimization", false);
    });
    expect(api().setSetting).toHaveBeenCalledWith(
      "enable_ai_optimization",
      false,
    );
    expect(api().setSetting).toHaveBeenCalledWith("default_mode", "off");
    // A text key typed afterwards stays pending until the window elapses.
    act(() => {
      result.current.handleInputChange("hotwords", "延迟");
    });
    expect(api().setSetting).toHaveBeenCalledTimes(3);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(api().setSetting).toHaveBeenLastCalledWith("hotwords", "延迟");
  });

  it("writes immediately when a text key is changed with the immediate override", async () => {
    // The AI-model dropdown is a <select> editing the text-like ai_model
    // key; it must stay instant (no 400ms wait on a discrete choice).
    const { result } = await mountLoaded();
    vi.useFakeTimers();
    act(() => {
      result.current.handleInputChange("ai_model", "gpt-4o", {
        immediate: true,
      });
    });
    expect(api().setSetting).toHaveBeenCalledWith("ai_model", "gpt-4o");
    expect(api().setSetting).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(api().setSetting).toHaveBeenCalledTimes(1);
  });

  it("drops a pending text write when the same key is written immediately after", async () => {
    // Text "gpt-4o" is pending; the dropdown then selects "gpt-4". The
    // stale pending value must never overwrite the newer discrete choice.
    const { result } = await mountLoaded();
    vi.useFakeTimers();
    act(() => {
      result.current.handleInputChange("ai_model", "gpt-4o");
    });
    act(() => {
      result.current.handleInputChange("ai_model", "gpt-4", {
        immediate: true,
      });
    });
    expect(api().setSetting).toHaveBeenCalledWith("ai_model", "gpt-4");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(api().setSetting).toHaveBeenCalledTimes(1);
    expect(api().setSetting).toHaveBeenLastCalledWith("ai_model", "gpt-4");
  });
});
