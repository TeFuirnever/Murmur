import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { Toaster, toast } from "sonner";
import { useTranslation } from "react-i18next";
import { assertElectronAPI } from "./bootstrap/assertElectronAPI.js";
import type {
  AICheckStatusResult,
  UpdateCheckResult,
  UpdateProgressData,
  UpdateCompleteData,
} from "./types/ipc";
import {
  Settings,
  Save,
  Eye,
  EyeOff,
  X,
  Loader2,
  TestTube,
  CheckCircle,
  XCircle,
  Mic,
  Shield,
  Download,
  RefreshCw,
} from "lucide-react";
import { usePermissions } from "./hooks/usePermissions";
import PermissionCard from "./components/ui/permission-card";

const SettingsPage = () => {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState({
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
  });

  const [customModel, setCustomModel] = useState(false);
  const [providerPresets, setProviderPresets] = useState<
    {
      name: string;
      label: string;
      base_url: string;
      models: string[];
      requires_api_key: boolean;
    }[]
  >([]);
  const [detectedLocalModels, setDetectedLocalModels] = useState<
    { name: string; label: string; models: string[] }[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AICheckStatusResult | null>(
    null,
  );

  // 更新检查
  const [appVersion, setAppVersion] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<UpdateProgressData | null>(null);
  const [downloadedUpdate, setDownloadedUpdate] =
    useState<UpdateCompleteData | null>(null);

  // 权限管理
  const showAlert = (alert: { title: string; description: string }) => {
    toast(alert.title, {
      description: alert.description,
      duration: 4000,
    });
  };

  const {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
  } = usePermissions(showAlert);

  const applyTheme = (theme: string) => {
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
  };

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      if (window.electronAPI) {
        const allSettings = await window.electronAPI.getAllSettings();
        const loadedSettings = {
          ai_api_key: (allSettings.ai_api_key || "") as string,
          ai_base_url: (allSettings.ai_base_url ||
            "https://api.openai.com/v1") as string,
          ai_model: (allSettings.ai_model || "gpt-3.5-turbo") as string,
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

        // 检查是否使用自定义模型
        const predefinedModels = [
          "gpt-3.5-turbo",
          "gpt-4",
          "gpt-4-turbo",
          "gpt-4o",
          "gpt-4o-mini",
          "qwen3-30b-a3b-instruct-2507",
        ];
        setCustomModel(!predefinedModels.includes(loadedSettings.ai_model));
      }
    } catch (error) {
      console.error("加载设置失败:", error);
      toast.error("加载设置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载设置
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
      .then(setProviderPresets)
      .catch(() => {});
    window.electronAPI
      .detectLocalModels()
      .then(setDetectedLocalModels)
      .catch(() => {});
  }, []);

  // 保存设置
  const saveSettings = async () => {
    try {
      setSaving(true);
      if (window.electronAPI) {
        // 保存每个设置项
        if (!settings.ai_api_key.startsWith("****")) {
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

        toast.success("设置保存成功");
      }
    } catch (error) {
      console.error("保存设置失败:", error);
      toast.error("保存设置失败");
    } finally {
      setSaving(false);
    }
  };

  // 处理输入变化
  const handleInputChange = (key: string, value: unknown) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // AI provider presets loaded from backend + local model detection
  const isLocalDetected = (name: string) =>
    detectedLocalModels.some((d) => d.name === name);

  const getDetectedModels = (name: string) =>
    detectedLocalModels.find((d) => d.name === name)?.models || [];

  const AI_PROVIDER_PRESETS =
    providerPresets.length > 0
      ? providerPresets.map((p) => ({
          label: isLocalDetected(p.name) ? `${p.label} ✓` : p.label,
          baseUrl: p.base_url,
          model: isLocalDetected(p.name)
            ? getDetectedModels(p.name)[0] || p.models[0]
            : p.models[0],
          noApiKey: !p.requires_api_key,
        }))
      : [];

  const applyProviderPreset = (preset: Record<string, unknown>) => {
    setSettings((prev) => ({
      ...prev,
      ai_base_url: preset.baseUrl as string,
      ai_model: preset.model as string,
    }));
    setCustomModel(true);
    toast.info(`已应用 ${preset.label} 预设`);
  };

  // 测试AI配置
  const testAIConfiguration = async () => {
    try {
      setTesting(true);
      setTestResult(null);

      // 验证当前输入的配置
      const isLocalModel =
        settings.ai_base_url.includes("localhost") ||
        settings.ai_base_url.includes("127.0.0.1");
      if (!settings.ai_api_key.trim() && !isLocalModel) {
        setTestResult({
          available: false,
          error: "请先输入API密钥",
          details: "API密钥不能为空",
        });
        toast.error("配置不完整", {
          description: "请先输入API密钥",
        });
        return;
      }

      if (window.electronAPI) {
        // 使用当前页面的配置进行测试，而不是已保存的配置
        const testConfig = {
          ai_api_key: settings.ai_api_key.trim(),
          ai_base_url:
            settings.ai_base_url.trim() || "https://api.openai.com/v1",
          ai_model: settings.ai_model.trim() || "gpt-3.5-turbo",
        };

        const result = await window.electronAPI.checkAIStatus(testConfig);
        setTestResult(result);

        if (result.available) {
          toast.success("AI配置测试成功！", {
            description: `模型: ${result.model || "未知"} - 连接正常`,
          });
        } else {
          toast.error("AI配置测试失败", {
            description: result.error || "未知错误",
          });
        }
      }
    } catch (error) {
      console.error("测试AI配置失败:", error);
      setTestResult({
        available: false,
        error: (error as Error).message || "测试失败",
      });
      toast.error("测试失败", {
        description: (error as Error).message || "未知错误",
      });
    } finally {
      setTesting(false);
    }
  };

  // 检查更新
  const checkForUpdates = async () => {
    try {
      setCheckingUpdate(true);
      setUpdateInfo(null);
      if (window.electronAPI) {
        const result = await window.electronAPI.checkForUpdates();
        setUpdateInfo(result);
      }
    } catch (_error) {
      setUpdateInfo({
        hasUpdate: false,
        currentVersion: appVersion,
        error: "检查更新失败",
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const startDownload = async () => {
    if (!updateInfo?.hasUpdate || !updateInfo?.downloadUrl) return;
    setDownloadProgress({
      progress: 0,
      downloaded: 0,
      total: updateInfo.downloadSize || 0,
    });
    try {
      await window.electronAPI.downloadUpdate({
        downloadUrl: updateInfo.downloadUrl!,
        checksumsUrl: updateInfo.checksumsUrl!,
        latestVersion: updateInfo.latestVersion!,
      });
    } catch (_error) {
      setDownloadProgress(null);
    }
  };

  useEffect(() => {
    if (!window.electronAPI) return;
    const unsub1 = window.electronAPI.onUpdateDownloadProgress?.((data) => {
      setDownloadProgress(data);
    });
    const unsub2 = window.electronAPI.onUpdateDownloadComplete?.((data) => {
      setDownloadProgress(null);
      setDownloadedUpdate(data);
    });
    const unsub3 = window.electronAPI.onUpdateDownloadError?.((data) => {
      setDownloadProgress(null);
      setUpdateInfo((prev: UpdateCheckResult | null) =>
        prev ? { ...prev, error: data.error } : prev,
      );
    });
    return () => {
      unsub1?.();
      unsub2?.();
      unsub3?.();
    };
  }, []);

  // 关闭窗口
  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.hideSettingsWindow();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#1c1c1e] flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#0071e3]" />
          <span className="text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80">
            加载设置中...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#f5f5f7] dark:bg-[#1c1c1e] flex flex-col">
      {/* 标题栏 - 固定 */}
      <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-sm border-b border-[#d2d2d7] dark:border-[#3a3a3c] px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-[#0071e3]" />
            <h1 className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-heading">
              设置
            </h1>
          </div>
          <button
            onClick={handleClose}
            aria-label="关闭设置"
            className="p-2 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#86868b]" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 主要内容 - 可滚动 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-2xl mx-auto p-6 pb-8">
          {/* 通用设置 */}
          <div className="bg-white dark:bg-[#2c2c2e] rounded-xl shadow-lg border border-[#d2d2d7] dark:border-[#3a3a3c] mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-heading">
                  通用设置
                </h2>
                <p className="text-xs text-[#86868b] mt-1">
                  调整应用的基本行为和外观。
                </p>
              </div>

              <div className="space-y-4">
                {/* 窗口置顶 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      窗口始终置顶
                    </label>
                    <p className="text-xs text-[#86868b]">
                      将应用窗口保持在最前面
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.window_always_on_top !== false}
                    onClick={() => {
                      const newVal = settings.window_always_on_top === false;
                      handleInputChange("window_always_on_top", newVal);
                      if (window.electronAPI?.setAlwaysOnTop) {
                        window.electronAPI.setAlwaysOnTop(newVal);
                      }
                    }}
                    className={`${
                      settings.window_always_on_top !== false
                        ? "bg-[#0071e3]"
                        : "bg-[#d2d2d7] dark:bg-[#3a3a3c]"
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#0071e3] focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.window_always_on_top !== false
                          ? "translate-x-4"
                          : "translate-x-0"
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 自动粘贴行为 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      转录完成后
                    </label>
                    <p className="text-xs text-[#86868b]">
                      语音识别完成后的操作方式
                    </p>
                  </div>
                  <select
                    value={settings.auto_paste}
                    onChange={(e) =>
                      handleInputChange("auto_paste", e.target.value)
                    }
                    className="text-sm px-3 py-1.5 border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-[#0071e3] focus:border-transparent"
                  >
                    <option value="paste">自动粘贴到当前应用</option>
                    <option value="clipboard_only">仅复制到剪贴板</option>
                  </select>
                </div>

                {/* 关闭行为 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      关闭窗口时
                    </label>
                    <p className="text-xs text-[#86868b]">
                      点击关闭按钮后的行为
                    </p>
                  </div>
                  <select
                    value={settings.close_behavior}
                    onChange={(e) =>
                      handleInputChange("close_behavior", e.target.value)
                    }
                    className="text-sm px-3 py-1.5 border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-[#0071e3] focus:border-transparent"
                  >
                    <option value="hide">隐藏到菜单栏</option>
                    <option value="quit">退出应用</option>
                  </select>
                </div>

                {/* 外观主题 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {t("settings.appearance.theme")}
                    </label>
                  </div>
                  <select
                    value={settings.theme}
                    onChange={(e) => {
                      handleInputChange("theme", e.target.value);
                      applyTheme(e.target.value);
                    }}
                    className="text-sm px-3 py-1.5 border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-[#0071e3] focus:border-transparent"
                  >
                    <option value="system">
                      {t("settings.appearance.system")}
                    </option>
                    <option value="light">
                      {t("settings.appearance.light")}
                    </option>
                    <option value="dark">
                      {t("settings.appearance.dark")}
                    </option>
                  </select>
                </div>

                {/* 语言设置 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {t("settings.language.label")}
                    </label>
                  </div>
                  <select
                    value={i18n.language}
                    onChange={(e) => {
                      i18n.changeLanguage(e.target.value);
                      localStorage.setItem("language", e.target.value);
                      document.documentElement.lang = e.target.value;
                    }}
                    className="text-sm px-3 py-1.5 border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-[#0071e3] focus:border-transparent"
                  >
                    <option value="zh-CN">{t("settings.language.zhCN")}</option>
                    <option value="en">{t("settings.language.en")}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* 权限管理部分 */}
          <div className="bg-white dark:bg-[#2c2c2e] rounded-xl shadow-lg border border-[#d2d2d7] dark:border-[#3a3a3c] mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-heading">
                  权限管理
                </h2>
                <p className="text-xs text-[#86868b] mt-1">
                  测试和管理应用权限，确保麦克风和辅助功能正常工作。
                </p>
              </div>

              <div className="space-y-2">
                <PermissionCard
                  icon={Mic}
                  title="麦克风权限"
                  description="录制语音所需的权限"
                  granted={micPermissionGranted}
                  onRequest={requestMicPermission}
                  buttonText="测试麦克风"
                />

                <PermissionCard
                  icon={Shield}
                  title="辅助功能权限"
                  description="自动粘贴文本所需的权限"
                  granted={accessibilityPermissionGranted}
                  onRequest={testAccessibilityPermission}
                  buttonText="测试权限"
                />
              </div>
            </div>
          </div>

          {/* AI配置部分 */}
          <div className="bg-white dark:bg-[#2c2c2e] rounded-xl shadow-lg border border-[#d2d2d7] dark:border-[#3a3a3c]">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-heading">
                  AI 文本优化（可选）
                </h2>
                <p className="text-xs text-[#86868b] mt-1">
                  AI
                  用于对识别出的文字做润色和优化，是可选功能。语音识别本身使用本地
                  FunASR 模型，无需在此配置。API Key
                  无效或留空时，将直接使用原始转录文本。
                </p>
              </div>

              <div className="space-y-4">
                {/* AI优化开关 */}
                <div className="flex items-center justify-between pt-4">
                  <label
                    htmlFor="ai-optimization-toggle"
                    className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]"
                  >
                    启用AI文本优化
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.enable_ai_optimization}
                    onClick={() =>
                      handleInputChange(
                        "enable_ai_optimization",
                        !settings.enable_ai_optimization,
                      )
                    }
                    className={`${
                      settings.enable_ai_optimization
                        ? "bg-[#0071e3]"
                        : "bg-[#d2d2d7] dark:bg-[#3a3a3c]"
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#0071e3] focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.enable_ai_optimization
                          ? "translate-x-4"
                          : "translate-x-0"
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-xs font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-1">
                    API Key *
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={settings.ai_api_key}
                      onChange={(e) =>
                        handleInputChange("ai_api_key", e.target.value)
                      }
                      placeholder="请输入您的AI API Key"
                      className="w-full px-3 py-2 pr-10 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                    >
                      {showApiKey ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-[#86868b]">
                    用于AI文本优化功能的API密钥
                  </p>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-xs font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-1">
                    API Base URL
                  </label>
                  <input
                    type="url"
                    value={settings.ai_base_url}
                    onChange={(e) =>
                      handleInputChange("ai_base_url", e.target.value)
                    }
                    placeholder="https://api.openai.com/v1"
                    className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                  <p className="mt-1 text-xs text-[#86868b]">
                    AI服务的API端点地址，支持OpenAI兼容的API
                  </p>
                </div>

                {/* Model */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80">
                      AI模型
                    </label>
                    <div className="flex flex-wrap items-center gap-1">
                      {AI_PROVIDER_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => applyProviderPreset(preset)}
                          className="text-xs px-2 py-0.5 bg-[#e8f4fd] text-[#0071e3] dark:bg-blue-900/30 dark:text-blue-400 rounded hover:bg-[#d0eafb] dark:hover:bg-blue-900/50 transition-colors"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="predefined-model"
                        name="model-type"
                        checked={!customModel}
                        onChange={() => setCustomModel(false)}
                        className="w-3 h-3 text-[#0071e3] border-[#d2d2d7] focus:ring-[#0071e3]"
                      />
                      <label
                        htmlFor="predefined-model"
                        className="text-xs text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80"
                      >
                        预定义模型
                      </label>
                    </div>

                    {!customModel && (
                      <select
                        value={settings.ai_model}
                        onChange={(e) =>
                          handleInputChange("ai_model", e.target.value)
                        }
                        className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
                      >
                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                        <option value="gpt-4">GPT-4</option>
                        <option value="gpt-4-turbo">GPT-4 Turbo</option>
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                        <option value="qwen3-30b-a3b-instruct-2507">
                          Qwen3-30B (推荐)
                        </option>
                      </select>
                    )}

                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="custom-model"
                        name="model-type"
                        checked={customModel}
                        onChange={() => setCustomModel(true)}
                        className="w-3 h-3 text-[#0071e3] border-[#d2d2d7] focus:ring-[#0071e3]"
                      />
                      <label
                        htmlFor="custom-model"
                        className="text-xs text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80"
                      >
                        自定义模型
                      </label>
                    </div>

                    {customModel && (
                      <input
                        type="text"
                        value={settings.ai_model}
                        onChange={(e) =>
                          handleInputChange("ai_model", e.target.value)
                        }
                        placeholder="输入自定义模型名称，如：qwen3-30b-a3b-instruct-2507"
                        className="w-full px-3 py-2 text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] rounded-lg focus:ring-2 focus:ring-[#0071e3] focus:border-transparent bg-[#f5f5f7] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]"
                      />
                    )}
                  </div>

                  <p className="mt-1 text-xs text-[#86868b]">
                    选择用于文本优化的AI模型。推荐使用阿里云Qwen3模型获得更好的中文处理效果。
                  </p>

                  {/* AI 参数调节 */}
                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="flex justify-between">
                        <label className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {t("settings.ai_temperature", "创造性 (Temperature)")}
                        </label>
                        <span className="text-xs text-[#86868b]">
                          {settings.ai_temperature.toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={settings.ai_temperature}
                        onChange={(e) =>
                          handleInputChange(
                            "ai_temperature",
                            parseFloat(e.target.value),
                          )
                        }
                        className="w-full h-1.5 bg-[#d2d2d7] dark:bg-[#3a3a3c] rounded-full appearance-none cursor-pointer accent-[#0071e3]"
                      />
                      <div className="flex justify-between text-[10px] text-[#86868b]">
                        <span>精确</span>
                        <span>创造</span>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between">
                        <label className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {t("settings.ai_max_tokens", "最大输出长度")}
                        </label>
                        <span className="text-xs text-[#86868b]">
                          {settings.ai_max_tokens}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="500"
                        max="4096"
                        step="256"
                        value={settings.ai_max_tokens}
                        onChange={(e) =>
                          handleInputChange(
                            "ai_max_tokens",
                            parseInt(e.target.value, 10),
                          )
                        }
                        className="w-full h-1.5 bg-[#d2d2d7] dark:bg-[#3a3a3c] rounded-full appearance-none cursor-pointer accent-[#0071e3]"
                      />
                      <div className="flex justify-between text-[10px] text-[#86868b]">
                        <span>500</span>
                        <span>4096</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 测试结果显示 */}
              {testResult && (
                <div
                  className={`mt-4 p-3 rounded-lg border ${
                    testResult.available
                      ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
                      : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    {testResult.available ? (
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                    )}
                    <span
                      className={`font-medium ${
                        testResult.available
                          ? "text-green-800 dark:text-green-200"
                          : "text-red-800 dark:text-red-200"
                      }`}
                    >
                      {testResult.available
                        ? "AI配置测试成功"
                        : "AI配置测试失败"}
                    </span>
                  </div>

                  {testResult.available && (
                    <div className="mt-2 space-y-1">
                      {testResult.model && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          <strong>模型:</strong> {testResult.model}
                        </p>
                      )}
                      {testResult.details && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          <strong>状态:</strong> {testResult.details}
                        </p>
                      )}
                      {testResult.response && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          <strong>AI回复:</strong> {testResult.response}
                        </p>
                      )}
                      {testResult.usage && (
                        <p className="text-xs text-green-600 dark:text-green-400">
                          Token使用: {testResult.usage.total_tokens || "N/A"}
                        </p>
                      )}
                    </div>
                  )}

                  {!testResult.available && (
                    <div className="mt-2 space-y-1">
                      {testResult.error && (
                        <p className="text-xs text-red-700 dark:text-red-300">
                          <strong>错误:</strong> {testResult.error}
                        </p>
                      )}
                      {testResult.details && (
                        <p className="text-xs text-red-600 dark:text-red-400">
                          {testResult.details}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#d2d2d7] dark:border-[#3a3a3c]">
                <div className="flex flex-col">
                  <button
                    onClick={testAIConfiguration}
                    disabled={testing}
                    className="flex items-center space-x-2 px-3 py-1.5 text-sm bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <TestTube className="w-3 h-3" />
                    )}
                    <span>{testing ? "测试中..." : "测试配置"}</span>
                  </button>
                  <p className="mt-1 text-xs text-[#86868b]">
                    测试当前编辑的配置（无需保存）
                  </p>
                </div>

                <button
                  onClick={saveSettings}
                  aria-label="保存设置"
                  disabled={
                    saving ||
                    (settings.enable_ai_optimization && !settings.ai_api_key)
                  }
                  className="flex items-center space-x-2 px-4 py-1.5 text-sm bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  <span>{saving ? "保存中..." : "保存设置"}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 关于 Murmur */}
          <div className="mt-4 bg-white dark:bg-[#2c2c2e] rounded-xl shadow-lg border border-[#d2d2d7] dark:border-[#3a3a3c]">
            <div className="p-4">
              <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-heading mb-3">
                关于 Murmur
              </h2>
              <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] p-3 rounded-lg">
                <p className="text-xs text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 mb-1">
                  🎤 <strong>Murmur</strong> -
                  基于FunASR和AI的中文语音转文字应用
                </p>
                {appVersion && (
                  <p className="text-xs text-[#86868b] mb-2">
                    当前版本：v{appVersion}
                  </p>
                )}
                <p className="text-xs text-[#86868b]">
                  • 高精度中文语音识别
                  <br />
                  • AI智能文本优化
                  <br />
                  • 实时语音处理
                  <br />• 隐私保护设计
                </p>
              </div>

              {/* 更新检查 */}
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <button
                    onClick={checkForUpdates}
                    disabled={checkingUpdate}
                    className="flex items-center space-x-2 px-3 py-1.5 text-sm text-[#0071e3] hover:bg-[#e8f4fd] dark:hover:bg-blue-900/30 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {checkingUpdate ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    <span>
                      {checkingUpdate
                        ? t("settings.update.checking")
                        : t("settings.update.check")}
                    </span>
                  </button>

                  {updateInfo && !updateInfo.hasUpdate && !updateInfo.error && (
                    <span className="text-xs text-[#86868b]">
                      {t("settings.update.upToDate")}
                    </span>
                  )}

                  {updateInfo?.error && (
                    <span className="text-xs text-red-500">
                      {updateInfo.error}
                    </span>
                  )}
                </div>

                {updateInfo?.hasUpdate &&
                  !downloadProgress &&
                  !downloadedUpdate && (
                    <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-green-700 dark:text-green-400">
                          {t("settings.update.available", {
                            version: `v${updateInfo.latestVersion}`,
                          })}
                        </span>
                        <span className="text-xs text-[#86868b]">
                          {updateInfo.downloadSize
                            ? `${(updateInfo.downloadSize / 1048576).toFixed(1)} MB`
                            : ""}
                        </span>
                      </div>
                      {updateInfo.releaseNotes && (
                        <p className="text-xs text-[#1d1d1f]/60 dark:text-[#f5f5f7]/60 mb-2 line-clamp-3 whitespace-pre-line">
                          {updateInfo.releaseNotes
                            .replace(/## What's Changed.*$/s, "")
                            .slice(0, 300)}
                        </p>
                      )}
                      <button
                        onClick={startDownload}
                        className="flex items-center space-x-1.5 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        <span>{t("settings.update.download")}</span>
                      </button>
                    </div>
                  )}

                {downloadProgress && (
                  <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-blue-700 dark:text-blue-400">
                        {t("settings.update.downloading", {
                          progress: downloadProgress.progress,
                        })}
                      </span>
                      <button
                        onClick={() =>
                          window.electronAPI?.cancelUpdateDownload?.()
                        }
                        className="text-xs text-[#86868b] hover:text-red-500"
                      >
                        {t("settings.update.cancel")}
                      </button>
                    </div>
                    <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-1.5">
                      <div
                        className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${downloadProgress.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {downloadedUpdate && (
                  <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                    <p className="text-xs text-green-700 dark:text-green-400 mb-2">
                      {t("settings.update.downloaded", {
                        version: `v${downloadedUpdate.version}`,
                      })}
                    </p>
                    <button
                      onClick={() =>
                        window.electronAPI?.installUpdate?.(
                          downloadedUpdate.filePath,
                        )
                      }
                      className="flex items-center space-x-1.5 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                    >
                      <span>{t("settings.update.install")}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 导出组件供App.jsx使用
export { SettingsPage };

// 如果是直接访问settings.html，则渲染应用
if (document.getElementById("settings-root") && assertElectronAPI()) {
  const root = ReactDOM.createRoot(document.getElementById("settings-root")!);
  root.render(
    <React.Fragment>
      <SettingsPage />
      <Toaster position="top-right" />
    </React.Fragment>,
  );
}
