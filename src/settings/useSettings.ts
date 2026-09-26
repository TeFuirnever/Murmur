// [20260713_Fix_NoHardcodedChinese] All user-visible toast messages and
// testResult error strings now go through t() — no hardcoded Chinese remains.
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type {
  AICheckStatusResult,
  AIProviderPreset,
  UpdateCheckResult,
  UpdateProgressData,
  UpdateCompleteData,
} from "../types/ipc";
// [20260926_Refactor_403_SettingsSchema] Issue #403: the schema module is
// the single source of truth for every persisted setting key. SettingsState,
// DEFAULT_SETTINGS and the load builder are DERIVED there and re-exported
// below so existing importers (sections, tests) keep their import paths.
// Adding a setting now means ONE schema entry — type, defaults, the IPC
// allowlist, the murmur.json sync filter and the #402 debounce set all
// follow automatically (see tests/unit/settings-schema.test.ts).
import {
  DEFAULT_SETTINGS,
  loadSettingsState,
  type SettingsState,
} from "./settingsSchema";
// [20260926_Fix_397_ModelCatalog] React-free model catalogue (moved out of
// this React-importing module so the schema can reference DEFAULT_MODEL).
import { PREDEFINED_MODELS, DEFAULT_MODEL, MODEL_LABELS } from "./modelCatalog";
// [20260905_Fix_246_HotkeySettingsUi] Single renderer-side default for the
// recording hotkey setting (issue #246: the setting existed in storage and
// the allowlist but nothing read or wrote it).
import { DEFAULT_HOTKEY } from "./hotkeyRecorder";
// [20260926_Perf_402_TextInputDebounce] Debounce/flush engine for the
// text-like persistence writes (issue #402).
import {
  createTextWriteScheduler,
  TEXT_INPUT_SETTING_KEYS,
} from "./textWriteScheduler";

export { DEFAULT_HOTKEY };
// [20260926_Refactor_403_SettingsSchema] Stable re-exports: every consumer
// that used to import these from useSettings keeps working.
export type { SettingsState };
export { DEFAULT_SETTINGS };
export { PREDEFINED_MODELS, DEFAULT_MODEL, MODEL_LABELS };

// [20260712_Fix_ProviderPresetType] Use the canonical AIProviderPreset
// type directly instead of redefining the shape. This ensures a single
// source of truth in src/types/ipc.ts.
export type ProviderPreset = AIProviderPreset;

export interface DetectedLocalModel {
  name: string;
  label: string;
  models: string[];
}

export function isMaskedKey(key: string): boolean {
  return key.startsWith("****");
}

// [20260926_Perf_402_TextInputDebounce] Options for handleInputChange. The
// immediate flag exists for discrete controls (the AI-model dropdown is a
// <select> editing the text-like ai_model key): a select/switch/theme pick
// must never wait out the debounce window, so it persists in the same tick
// and supersedes any pending debounced value for that key.
export interface HandleSettingChangeOptions {
  immediate?: boolean;
}

// [20260926_Perf_402_TextInputDebounce] Debounce window and key list for
// text-input persistence debounce live in ./textWriteScheduler (shared by
// the hook and its unit tests); see the module comment for the issue #402
// rationale. Discrete controls (selects, switches, theme) are deliberately
// absent from the debounce set — they stay instant.
export function applyTheme(theme: string): void {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    root.classList.toggle("dark", prefersDark);
  }
}

// [20260926_Fix_395_ThemeLiveApply] The SETTINGS_UPDATE broadcast (settingsHandlers.ts)
// carries only the KEY — the persisted value lives in the settings DB — so a
// window re-applying a remote theme change must read it back through the
// bridge, the same read-back pattern the language branch uses. App.tsx (main
// window) and history.tsx (history window) share this helper; the settings
// window applies the freshly picked value directly in handleInputChange.
// Callers attach .catch(() => {}) — a rejected read means the broadcast or
// read raced window teardown and there is nothing left to apply.
export function applyPersistedTheme(): Promise<void> {
  const read = window.electronAPI?.getSetting?.("theme", "system");
  if (!read) {
    return Promise.resolve();
  }
  return read.then((theme) => {
    if (typeof theme === "string" && theme) {
      applyTheme(theme);
    }
  });
}

export function useSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  // [20260926_Perf_402_TextInputDebounce] Debounced persistence writer
  // for text-like keys (issue #402): collapses keystroke bursts into one
  // setSetting write, with flush()/cancel() for the blur / hide / close
  // paths. Instance is stable for the hook's lifetime.
  const textWrites = useMemo(
    () =>
      createTextWriteScheduler((key, value) =>
        window.electronAPI?.setSetting(key, value),
      ),
    [],
  );

  const [customModel, setCustomModel] = useState(false);
  const [providerPresets, setProviderPresets] = useState<ProviderPreset[]>([]);
  const [detectedLocalModels, setDetectedLocalModels] = useState<
    DetectedLocalModel[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AICheckStatusResult | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState("");

  // 更新检查
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<UpdateProgressData | null>(null);
  const [downloadedUpdate, setDownloadedUpdate] =
    useState<UpdateCompleteData | null>(null);

  // --- 加载设置 ---
  // [20260926_Refactor_403_SettingsSchema] The per-key builder (and its
  // migration quirks — the default_mode legacy migration, the `!== false`
  // boolean gates, the falsy-number fallbacks) moved verbatim into the
  // schema entries; settings-schema.test.ts pins the value-for-value
  // equivalence against the pre-refactor arms.
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      if (window.electronAPI) {
        const allSettings = await window.electronAPI.getAllSettings();
        const loadedSettings = loadSettingsState(allSettings);
        setSettings((prev) => ({ ...prev, ...loadedSettings }));
        applyTheme(loadedSettings.theme);

        setCustomModel(
          !(PREDEFINED_MODELS as readonly string[]).includes(
            loadedSettings.ai_model,
          ),
        );
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      toast.error(t("settings.loadFailed", "加载设置失败"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // --- 保存设置 ---
  // [ADR-015] Returns boolean so callers can show inline success feedback
  // (savedFlash) only on actual success, not on the catch path.
  // [20260815_Refactor_SaveSettingsLoop] The 11 hand-listed setSetting calls
  // (each with a per-key comment) became a loop over the settings object:
  // handleInputChange already auto-persists every change, so this bulk save
  // only exists as the explicit Save-button reconciliation pass — a loop
  // keeps future settings keys included automatically instead of needing a
  // mandatory new line (the old effects_enabled reviewer finding).
  const saveSettings = useCallback(async (): Promise<boolean> => {
    try {
      setSaving(true);
      if (window.electronAPI) {
        if (!isMaskedKey(settings.ai_api_key)) {
          await window.electronAPI.setSetting(
            "ai_api_key",
            settings.ai_api_key,
          );
        }
        for (const key of Object.keys(settings)) {
          if (key === "ai_api_key") continue;
          await window.electronAPI.setSetting(
            key,
            settings[key as keyof SettingsState],
          );
        }
        applyTheme(settings.theme);
        toast.success(t("settings.saveSuccess", "设置已保存"));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(t("settings.saveFailed", "保存设置失败"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [settings, t]);

  // --- 输入变更 ---
  // [Fix] Auto-persist each setting immediately via setSetting — industry
  // standard for settings pages (macOS System Preferences, VS Code, iOS
  // Settings all apply changes instantly, no Save button). Previously only
  // the AI Config tab's Save button called saveSettings(), so General tab
  // settings (effects_enabled, theme, auto_paste, close_behavior) were stuck
  // in React state and lost when the settings window was destroyed (Alt+F4).
  const handleInputChange = useCallback(
    (key: string, value: unknown, options?: HandleSettingChangeOptions) => {
      // [20260905_Fix_249_ReviewMajor] enable_ai_optimization and default_mode
      // are two views of one knob. They used to diverge when the AI Config
      // toggle was flipped after load: saveSettings then persisted the stale
      // derived "auto" alongside the boolean, and the read-side migration
      // (which only runs when default_mode is null) never saw it — the toggle
      // showed off while AI kept running. Sync both directions here so the
      // auto-persist and the save loop always stay consistent.
      if (key === "enable_ai_optimization") {
        const enabled = value !== false;
        setSettings((prev) => ({
          ...prev,
          enable_ai_optimization: enabled,
          default_mode: enabled
            ? prev.default_mode === "off"
              ? "auto"
              : prev.default_mode
            : "off",
        }));
        if (window.electronAPI?.setSetting) {
          window.electronAPI.setSetting(key, enabled);
          window.electronAPI.setSetting(
            "default_mode",
            enabled ? "auto" : "off",
          );
        }
        return;
      }
      if (key === "default_mode") {
        const mode = typeof value === "string" ? value : "auto";
        setSettings((prev) => ({
          ...prev,
          default_mode: mode,
          enable_ai_optimization: mode !== "off",
        }));
        if (window.electronAPI?.setSetting) {
          window.electronAPI.setSetting(key, mode);
          window.electronAPI.setSetting(
            "enable_ai_optimization",
            mode !== "off",
          );
        }
        return;
      }
      // [20260926_Fix_395_ThemeLiveApply] The General tab theme select writes
      // through this input path; applying the picked value to the document at
      // write time is part of the write contract now (issue #395: the settings
      // window kept the old colors until reload because only loadSettings and
      // the AI-tab Save button called applyTheme).
      if (key === "theme" && typeof value === "string") {
        applyTheme(value);
      }
      setSettings((prev) => ({ ...prev, [key]: value }));
      // [20260926_Perf_402_TextInputDebounce] Text-like keys defer the
      // persistence write to the 400ms debounce; discrete controls and
      // immediate-flagged writes persist in the same tick. An immediate write
      // also cancels the pending value for that key so an older debounced
      // text can never overwrite a newer discrete choice.
      if (!options?.immediate && TEXT_INPUT_SETTING_KEYS.has(key)) {
        textWrites.schedule(key, value);
        return;
      }
      textWrites.cancel(key);
      if (window.electronAPI?.setSetting) {
        window.electronAPI.setSetting(key, value);
      }
    },
    [textWrites],
  );

  // --- Provider presets ---
  const isLocalDetected = useCallback(
    (name: string) => detectedLocalModels.some((d) => d.name === name),
    [detectedLocalModels],
  );

  const getDetectedModels = useCallback(
    (name: string) =>
      detectedLocalModels.find((d) => d.name === name)?.models || [],
    [detectedLocalModels],
  );

  // [20260926_Fix_398_ProviderLabelI18n] "(本地)" was hardcoded Chinese in
  // providerPresets.ts — English UI showed it verbatim. Local presets now
  // carry a locale-neutral is_local flag; the suffix composes here, at the
  // single label-resolution point, so the quick-select buttons and the
  // presetApplied toast stay consistent.
  const resolvedProviderPresets = useMemo(
    () =>
      providerPresets.length > 0
        ? providerPresets.map((p) => {
            const label = p.is_local
              ? `${p.label} (${t("settings.providers.localSuffix", "本地")})`
              : p.label;
            return {
              label: isLocalDetected(p.name) ? `${label} ✓` : label,
              baseUrl: p.base_url,
              model: isLocalDetected(p.name)
                ? (getDetectedModels(p.name)[0] ?? p.models[0] ?? "")
                : (p.models[0] ?? ""),
              noApiKey: !p.requires_api_key,
            };
          })
        : [],
    [providerPresets, isLocalDetected, getDetectedModels, t],
  );

  const applyProviderPreset = useCallback(
    (preset: { label: string; baseUrl: string; model: string }) => {
      setSettings((prev) => ({
        ...prev,
        ai_base_url: preset.baseUrl,
        ai_model: preset.model,
      }));
      setCustomModel(true);
      toast.info(t("settings.ai.presetApplied", { label: preset.label }));
    },
    [t],
  );

  // --- 测试 AI 配置 ---
  const testAIConfiguration = useCallback(async () => {
    try {
      setTesting(true);
      setTestResult(null);

      const isLocalModel =
        settings.ai_base_url.includes("localhost") ||
        settings.ai_base_url.includes("127.0.0.1");
      const maskedKey = isMaskedKey(settings.ai_api_key);

      if (!settings.ai_api_key.trim() && !isLocalModel) {
        setTestResult({
          available: false,
          error: t("settings.ai.missingKey", "请先输入API密钥"),
          details: t("settings.ai.emptyKey", "API密钥不能为空"),
        });
        toast.error(t("settings.ai.incomplete", "配置不完整"), {
          description: t("settings.ai.missingKey", "请先输入API密钥"),
        });
        return;
      }
      if (maskedKey && !isLocalModel) {
        setTestResult({
          available: false,
          error: t("settings.ai.reenterKey", "请重新输入API密钥"),
          details: t(
            "settings.ai.maskedKeyWarning",
            "当前显示的是已保存密钥的遮盖值，请清空后重新输入",
          ),
        });
        toast.error(t("settings.ai.reenterKeyTitle", "需要重新输入密钥"), {
          description: t(
            "settings.ai.maskedKeyAction",
            "请清空API密钥输入框并重新粘贴您的密钥",
          ),
        });
        return;
      }

      if (window.electronAPI) {
        const testConfig = {
          ai_api_key: settings.ai_api_key.trim(),
          ai_base_url:
            settings.ai_base_url.trim() || "https://api.openai.com/v1",
          ai_model: settings.ai_model.trim() || DEFAULT_MODEL,
        };

        const result = await window.electronAPI.checkAIStatus(testConfig);
        setTestResult(result);

        if (result.available) {
          toast.success(t("settings.ai.testSuccessToast", "AI配置测试成功！"), {
            description: t("settings.ai.testSuccessDesc", {
              model: result.model || t("settings.ai.unknownModel", "未知"),
            }),
          });
        } else {
          toast.error(t("settings.ai.testFailedToast", "AI配置测试失败"), {
            description:
              result.error || t("settings.ai.unknownError", "未知错误"),
          });
        }
      }
    } catch (error) {
      console.error("AI config test failed:", error);
      setTestResult({
        available: false,
        error:
          (error as Error).message ||
          t("settings.ai.testFailed", "AI配置测试失败"),
      });
      toast.error(t("settings.ai.testFailedToast", "测试失败"), {
        description:
          (error as Error).message || t("settings.ai.unknownError", "未知错误"),
      });
    } finally {
      setTesting(false);
    }
  }, [settings, t]);

  // --- 更新检查 ---
  const checkForUpdates = useCallback(async () => {
    try {
      setCheckingUpdate(true);
      setUpdateInfo(null);
      if (window.electronAPI?.checkForUpdates) {
        const result = await window.electronAPI.checkForUpdates();
        setUpdateInfo(result);
        if (result.hasUpdate) {
          toast.info(t("settings.update.newVersionFound", "发现新版本"), {
            description: t("settings.update.newVersionDesc", {
              version: result.latestVersion,
            }),
          });
        }
      }
    } catch (error) {
      console.error("Update check failed:", error);
      setUpdateInfo({
        hasUpdate: false,
        currentVersion: appVersion,
        latestVersion: "",
        error:
          (error as Error).message ||
          t("settings.update.checkFailed", "检查更新失败"),
      });
    } finally {
      setCheckingUpdate(false);
    }
  }, [appVersion, t]);

  const startDownload = useCallback(async () => {
    if (!updateInfo?.hasUpdate || !updateInfo?.downloadUrl) return;
    setDownloadProgress({
      progress: 0,
      downloaded: 0,
      total: updateInfo.downloadSize || 0,
    });
    try {
      await window.electronAPI?.downloadUpdate({
        downloadUrl: updateInfo.downloadUrl,
        checksumsUrl: updateInfo.checksumsUrl ?? "",
        latestVersion: updateInfo.latestVersion ?? "",
      });
    } catch (_error) {
      setDownloadProgress(null);
    }
  }, [updateInfo]);

  // --- Effects ---
  useEffect(() => {
    loadSettings();
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then(setAppVersion);
    }
  }, [loadSettings]);

  // [20260926_Perf_402_TextInputDebounce] Safety net for the debounced
  // writes: flush on window blur / hide (document hidden) / beforeunload
  // (window close), and on unmount so a pending timer never survives its
  // hook instance. Without a bridge there is nothing to write to.
  useEffect(() => {
    if (!window.electronAPI) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        textWrites.flush();
      }
    };
    window.addEventListener("blur", textWrites.flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", textWrites.flush);
    return () => {
      window.removeEventListener("blur", textWrites.flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", textWrites.flush);
      textWrites.flush();
    };
  }, [textWrites]);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI
      .getAIProviderPresets()
      .then((p) => setProviderPresets(p as ProviderPreset[]))
      .catch(() => {});
    window.electronAPI
      .detectLocalModels()
      .then((m) => setDetectedLocalModels(m as DetectedLocalModel[]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    const unsub1 = window.electronAPI.onUpdateDownloadProgress?.(
      (data: UpdateProgressData) => {
        setDownloadProgress(data);
      },
    );
    const unsub2 = window.electronAPI.onUpdateDownloadComplete?.(
      (data: UpdateCompleteData) => {
        setDownloadProgress(null);
        setDownloadedUpdate(data);
      },
    );
    const unsub3 = window.electronAPI.onUpdateDownloadError?.(
      (data: { error: string }) => {
        setDownloadProgress(null);
        setUpdateInfo((prev) => (prev ? { ...prev, error: data.error } : prev));
      },
    );
    return () => {
      unsub1?.();
      unsub2?.();
      unsub3?.();
    };
  }, []);

  // --- 派生状态 ---
  // [20260712_Fix_UnusedHookExports] Removed hasApiKey from the return —
  // it was computed but never consumed by any section component.
  const showQuickStart =
    !settings.ai_api_key || isMaskedKey(settings.ai_api_key);

  return {
    // 设置状态
    settings,
    loading,
    saving,
    handleInputChange,
    flushPendingSettingWrites: textWrites.flush,
    saveSettings,

    // AI 配置
    customModel,
    setCustomModel,
    providerPresets,
    resolvedProviderPresets,
    applyProviderPreset,
    showApiKey,
    setShowApiKey,
    apiKeyInputRef,
    testing,
    testResult,
    testAIConfiguration,
    showQuickStart,

    // 关于 / 更新
    appVersion,
    checkingUpdate,
    updateInfo,
    downloadProgress,
    downloadedUpdate,
    checkForUpdates,
    startDownload,
  };
}
