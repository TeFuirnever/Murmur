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

export interface SettingsState {
  ai_api_key: string;
  ai_base_url: string;
  ai_model: string;
  ai_temperature: number;
  ai_max_tokens: number;
  enable_ai_optimization: boolean;
  window_always_on_top: boolean;
  auto_paste: string;
  close_behavior: string;
  theme: string;
}

// [20260712_Fix_ProviderPresetType] Use the canonical AIProviderPreset
// type directly instead of redefining the shape. This ensures a single
// source of truth in src/types/ipc.ts.
export type ProviderPreset = AIProviderPreset;

export interface DetectedLocalModel {
  name: string;
  label: string;
  models: string[];
}

export const PREDEFINED_MODELS = [
  "gpt-3.5-turbo",
  "gpt-4",
  "gpt-4-turbo",
  "gpt-4o",
  "gpt-4o-mini",
  "qwen3-30b-a3b-instruct-2507",
] as const;

export const DEFAULT_MODEL = "gpt-3.5-turbo";

export function isMaskedKey(key: string): boolean {
  return key.startsWith("****");
}

const DEFAULT_SETTINGS: SettingsState = {
  ai_api_key: "",
  ai_base_url: "https://api.openai.com/v1",
  ai_model: "gpt-3.5-turbo",
  ai_temperature: 0.3,
  ai_max_tokens: 2000,
  enable_ai_optimization: true,
  window_always_on_top: true,
  auto_paste: "paste",
  close_behavior: "hide",
  theme: "system",
};

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

export function useSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

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
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      if (window.electronAPI) {
        const allSettings = await window.electronAPI.getAllSettings();
        const loadedSettings: SettingsState = {
          ai_api_key: (allSettings.ai_api_key || "") as string,
          ai_base_url: (allSettings.ai_base_url ||
            "https://api.openai.com/v1") as string,
          ai_model: (allSettings.ai_model || DEFAULT_MODEL) as string,
          ai_temperature:
            parseFloat(allSettings.ai_temperature as string) || 0.3,
          ai_max_tokens:
            parseInt(allSettings.ai_max_tokens as string, 10) || 2000,
          enable_ai_optimization: allSettings.enable_ai_optimization !== false,
          window_always_on_top: allSettings.window_always_on_top !== false,
          auto_paste: (allSettings.auto_paste || "paste") as string,
          close_behavior: (allSettings.close_behavior || "hide") as string,
          theme: (allSettings.theme || "system") as string,
        };
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
  const saveSettings = useCallback(async () => {
    try {
      setSaving(true);
      if (window.electronAPI) {
        if (!isMaskedKey(settings.ai_api_key)) {
          await window.electronAPI.setSetting(
            "ai_api_key",
            settings.ai_api_key,
          );
        }
        await window.electronAPI.setSetting(
          "ai_base_url",
          settings.ai_base_url,
        );
        await window.electronAPI.setSetting("ai_model", settings.ai_model);
        await window.electronAPI.setSetting(
          "ai_temperature",
          settings.ai_temperature,
        );
        await window.electronAPI.setSetting(
          "ai_max_tokens",
          settings.ai_max_tokens,
        );
        await window.electronAPI.setSetting(
          "enable_ai_optimization",
          settings.enable_ai_optimization,
        );
        await window.electronAPI.setSetting(
          "window_always_on_top",
          settings.window_always_on_top,
        );
        await window.electronAPI.setSetting("auto_paste", settings.auto_paste);
        await window.electronAPI.setSetting(
          "close_behavior",
          settings.close_behavior,
        );
        await window.electronAPI.setSetting("theme", settings.theme);
        applyTheme(settings.theme);

        toast.success(t("settings.saveSuccess", "设置已保存"));
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(t("settings.saveFailed", "保存设置失败"));
    } finally {
      setSaving(false);
    }
  }, [settings, t]);

  // --- 输入变更 ---
  const handleInputChange = useCallback((key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

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

  const resolvedProviderPresets = useMemo(
    () =>
      providerPresets.length > 0
        ? providerPresets.map((p) => ({
            label: isLocalDetected(p.name) ? `${p.label} ✓` : p.label,
            baseUrl: p.base_url,
            model: isLocalDetected(p.name)
              ? (getDetectedModels(p.name)[0] ?? p.models[0] ?? "")
              : (p.models[0] ?? ""),
            noApiKey: !p.requires_api_key,
          }))
        : [],
    [providerPresets, isLocalDetected, getDetectedModels],
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
          ai_model: settings.ai_model.trim() || "gpt-3.5-turbo",
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
