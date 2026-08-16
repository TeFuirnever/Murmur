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
import { useSettings } from "../../src/settings/useSettings";
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
    expect(keys).not.toContain(undefined);
    // 10 settings keys total (post effects removal): 1 special-cased + 9 in the loop.
    expect(calls).toHaveLength(10);
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
    expect(calls).toHaveLength(9);
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
    expect(result.current.saving).toBe(false);
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
      ai_model: "gpt-3.5-turbo",
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
