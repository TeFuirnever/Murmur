import React, { useState, useEffect, useRef, useCallback } from "react";
import "./index.css";
import { toast } from "sonner";
import { LoadingDots } from "./components/ui/loading-dots";
import { useHotkey } from "./hooks/useHotkey";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useRecording } from "./hooks/useRecording";
import { useModelStatus } from "./hooks/useModelStatus";
import {
  Settings,
  History,
  Copy,
  Download,
  Minus,
  Square,
  X,
  Maximize2,
} from "lucide-react";
import SettingsPanel from "./components/SettingsPanel";
import { ModelDownloadProgress } from "./components/ui/model-status-indicator";
import FileImport from "./components/FileImport";
import { SoundWaveIcon } from "./components/SoundWaveIcon";
import { LoadingIndicator } from "./components/LoadingIndicator";
import { VoiceWaveIndicator } from "./components/VoiceWaveIndicator";
import { Tooltip } from "./components/Tooltip";
import { TextDisplay } from "./components/TextDisplay";

// 动态导入设置页面组件
const SettingsPage = React.lazy(() =>
  import("./settings").then((module) => ({ default: module.SettingsPage })),
);

export default function App() {
  // 检查URL参数来决定渲染哪个页面
  const urlParams = new URLSearchParams(window.location.search);
  const page = urlParams.get("page");

  const [isHovered, setIsHovered] = useState(false);
  const [originalText, setOriginalText] = useState("");
  const [processedText, setProcessedText] = useState("");
  const [, setShowTextArea] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [appMode, setAppMode] = useState("recording"); // recording | file-import
  const [isMaximized, setIsMaximized] = useState(false);

  const { handleMouseDown, handleMouseMove, handleMouseUp, handleClick } =
    useWindowDrag();
  const modelStatus = useModelStatus();

  const handleRecordingCompleteRef = useRef(null);
  const handleAIOptimizationCompleteRef = useRef(null);

  const {
    isRecording,
    isProcessing: isRecordingProcessing,
    isOptimizing,
    startRecording,
    stopRecording,
    error: recordingError,
  } = useRecording({
    onTranscriptionComplete: (...args) =>
      handleRecordingCompleteRef.current?.(...args),
    onAIOptimizationComplete: (...args) =>
      handleAIOptimizationCompleteRef.current?.(...args),
  });

  // 防重复粘贴的引用
  const lastPasteRef = useRef({ text: "", timestamp: 0 });
  const PASTE_DEBOUNCE_TIME = 1000; // 1秒内相同文本不重复粘贴

  // 缓存设置项，避免每次操作都走 IPC
  const settingsRef = useRef({ auto_paste: "paste", close_behavior: "hide" });

  // 安全粘贴函数
  const safePaste = useCallback(async (text: string) => {
    const now = Date.now();
    const lastPaste = lastPasteRef.current;

    // 防重复粘贴：如果是相同文本且在防抖时间内，则跳过
    if (
      lastPaste.text === text &&
      now - lastPaste.timestamp < PASTE_DEBOUNCE_TIME
    ) {
      return;
    }

    // 更新最后粘贴记录
    lastPasteRef.current = { text, timestamp: now };

    try {
      if (window.electronAPI) {
        const autoPaste = settingsRef.current.auto_paste;
        if (autoPaste === "clipboard_only") {
          await window.electronAPI.copyText(text);
          toast.success("文本已复制到剪贴板");
        } else {
          await window.electronAPI.pasteText(text);
          toast.success("文本已自动粘贴到当前输入框");
        }
      } else {
        await navigator.clipboard.writeText(text);
        toast.info("文本已复制到剪贴板，请手动粘贴");
      }
    } catch {
      toast.error("操作失败", {
        description:
          "请检查辅助功能权限。文本已复制到剪贴板 - 请手动使用 Cmd+V 粘贴。",
      });
    }
  }, []);

  // 处理录音完成（FunASR识别完成）
  const handleRecordingComplete = useCallback(
    async (transcriptionResult: Record<string, unknown>) => {
      if (transcriptionResult.success && transcriptionResult.text) {
        // 立即显示FunASR识别的原始文本
        setOriginalText(transcriptionResult.text as string);
        setShowTextArea(true);

        // 清空之前的处理结果，等待AI优化
        setProcessedText("");

        // 注意：不在这里保存到数据库，由 useRecording.js 统一处理保存逻辑

        toast.success("🎤 语音识别完成，AI正在优化文本...");
      }
    },
    [],
  );

  // 处理AI优化完成
  const handleAIOptimizationComplete = useCallback(
    async (optimizedResult: Record<string, unknown>) => {
      if (
        optimizedResult.success &&
        optimizedResult.enhanced_by_ai &&
        optimizedResult.text
      ) {
        // 显示AI优化后的文本
        setProcessedText(optimizedResult.text as string);

        // 自动粘贴AI优化后的文本
        await safePaste(optimizedResult.text as string);

        toast.success("🤖 AI文本优化完成并已自动粘贴！");
      } else {
        // 如果AI优化失败，则粘贴原始文本
        if (originalText) {
          await safePaste(originalText);
          toast.info("AI优化失败，已粘贴原始识别文本");
        }
      }
    },
    [safePaste, originalText],
  );

  handleRecordingCompleteRef.current = handleRecordingComplete;
  handleAIOptimizationCompleteRef.current = handleAIOptimizationComplete;

  // 处理复制文本
  const handleCopyText = async (text: string) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.copyText(text);
        toast.success("文本已复制到剪贴板");
      } else {
        await navigator.clipboard.writeText(text);
        toast.success("文本已复制到剪贴板");
      }
    } catch (error) {
      toast.error(`无法复制文本到剪贴板: ${error.message}`);
    }
  };

  // 处理导出文本
  const handleExportText = async (text: string) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.exportTranscriptions("txt");
        toast.success("文本已导出到文件");
      } else {
        // Web环境下载文件
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Murmur转录_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      toast.error("无法导出文本文件");
    }
  };

  // 处理模型下载
  const handleDownloadModels = useCallback(async () => {
    try {
      toast.info("📥 开始下载模型文件...");

      const result = await modelStatus.downloadModels();
      if (result.success) {
        toast.success("🎉 模型下载完成，正在加载...");
      } else {
        toast.error(`❌ 模型下载失败: ${result.error}`);
      }
    } catch (error) {
      toast.error(`❌ 模型下载失败: ${error.message}`);
    }
  }, [modelStatus]);

  // 切换录音状态
  const toggleRecording = useCallback(() => {
    // 检查模型状态
    if (modelStatus.stage === "need_download") {
      toast.warning("📥 请先下载AI模型文件");
      return;
    }

    if (modelStatus.stage === "downloading") {
      toast.warning("⬇️ 模型正在下载中，请稍候...");
      return;
    }

    if (modelStatus.stage === "loading") {
      toast.warning("🤖 模型正在加载中，请稍候...");
      return;
    }

    if (modelStatus.stage === "error") {
      toast.error(`❌ 模型错误: ${modelStatus.error}`);
      return;
    }

    if (!modelStatus.isReady) {
      toast.warning("⏳ 模型未就绪，请稍候...");
      return;
    }

    if (!isRecording && !isRecordingProcessing) {
      startRecording();
    } else if (isRecording) {
      stopRecording();
    }
  }, [
    modelStatus,
    isRecording,
    isRecordingProcessing,
    startRecording,
    stopRecording,
  ]);

  // 使用热键Hook，不再使用F2双击功能
  const { hotkey, syncRecordingState, registerHotkey } = useHotkey();

  // 注册传统热键监听
  useEffect(() => {
    const initializeHotkey = async () => {
      try {
        // 注册默认热键 CommandOrControl+Shift+Space
        await registerHotkey("CommandOrControl+Shift+Space");
      } catch {
        // 热键注册失败时静默处理，不影响应用功能
      }
    };

    if (registerHotkey) {
      initializeHotkey();
    }
  }, [registerHotkey]);

  // 处理关闭窗口
  const handleClose = () => {
    if (window.electronAPI) {
      const closeBehavior = settingsRef.current.close_behavior;
      if (closeBehavior === "quit") {
        window.electronAPI.closeApp();
      } else {
        window.electronAPI.hideWindow();
      }
    }
  };

  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.minimizeWindow();
    }
  };

  const handleMaximize = () => {
    if (window.electronAPI) {
      window.electronAPI.maximizeWindow();
    }
  };

  useEffect(() => {
    if (window.electronAPI?.onWindowMaximizeChange) {
      const unsub = window.electronAPI.onWindowMaximizeChange((maximized) => {
        setIsMaximized(maximized);
      });
      return unsub;
    }
  }, []);

  // 缓存设置项：挂载时加载一次
  useEffect(() => {
    if (!window.electronAPI?.getSetting) return;
    window.electronAPI.getSetting("auto_paste", "paste").then((v) => {
      settingsRef.current.auto_paste = v as string;
    });
    window.electronAPI.getSetting("close_behavior", "hide").then((v) => {
      settingsRef.current.close_behavior = v as string;
    });
  }, []);

  // 设置变更时刷新缓存
  useEffect(() => {
    if (!window.electronAPI?.onSettingsUpdate) return;
    const unsub = window.electronAPI.onSettingsUpdate(() => {
      if (!window.electronAPI?.getSetting) return;
      window.electronAPI.getSetting("auto_paste", "paste").then((v) => {
        settingsRef.current.auto_paste = v as string;
      });
      window.electronAPI.getSetting("close_behavior", "hide").then((v) => {
        settingsRef.current.close_behavior = v as string;
      });
    });
    return unsub;
  }, []);

  // 处理打开设置
  const handleOpenSettings = () => {
    if (window.electronAPI) {
      window.electronAPI.openSettingsWindow();
    } else {
      // Web环境下仍然使用模态框
      setShowSettings(true);
    }
  };

  // 处理打开历史记录
  const handleOpenHistory = () => {
    if (window.electronAPI) {
      window.electronAPI.openHistoryWindow();
    }
  };

  // 监听全局热键触发事件
  useEffect(() => {
    if (window.electronAPI) {
      // 监听传统热键触发
      const unsubscribeHotkey = window.electronAPI.onHotkeyTriggered(() => {
        toggleRecording();
      });

      // 监听旧的toggle事件（保持兼容性）
      const unsubscribeToggle = window.electronAPI.onToggleDictation(() => {
        toggleRecording();
      });

      return () => {
        if (unsubscribeHotkey) unsubscribeHotkey();
        if (unsubscribeToggle) unsubscribeToggle();
      };
    }
  }, [toggleRecording, isRecording, isRecordingProcessing]);

  // 同步录音状态到热键管理器
  useEffect(() => {
    if (syncRecordingState) {
      syncRecordingState(isRecording);
    }
  }, [isRecording, syncRecordingState]);

  // 监听键盘事件
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, []);

  // 错误处理
  useEffect(() => {
    if (recordingError) {
      toast.error(recordingError);
    }
  }, [recordingError]);

  // 确定当前麦克风状态
  const getMicState = () => {
    if (isRecording) return "recording";
    if (isRecordingProcessing) return "processing";
    if (isOptimizing) return "optimizing";
    if (isHovered && !isRecording && !isRecordingProcessing && !isOptimizing)
      return "hover";
    return "idle";
  };

  const micState = getMicState();

  // 获取麦克风按钮属性
  const getMicButtonProps = () => {
    const baseClasses =
      "rounded-full w-16 h-16 flex items-center justify-center relative overflow-hidden border-2 border-white/80 transition-all duration-300 shadow-xl";

    // 统一的按钮样式，不再根据状态变色
    const buttonStyle = `${baseClasses} bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] hover:shadow-2xl transform hover:scale-105`;

    // 如果模型未就绪，显示禁用状态（统一的灰色）
    if (!modelStatus.isReady) {
      return {
        className: `${baseClasses} bg-[#e8e8ed] dark:bg-[#2c2c2e] cursor-not-allowed opacity-50`,
        tooltip:
          modelStatus.stage === "need_download"
            ? "请先下载AI模型文件"
            : modelStatus.stage === "downloading"
              ? `模型下载中... ${modelStatus.downloadProgress || 0}%`
              : modelStatus.stage === "loading"
                ? "模型加载中，请稍候..."
                : modelStatus.stage === "error"
                  ? `模型错误: ${modelStatus.error}`
                  : "模型未就绪，请稍候...",
        disabled: true,
      };
    }

    switch (micState) {
      case "idle":
        return {
          className: `${buttonStyle} cursor-pointer`,
          tooltip: `按 [${hotkey}] 开始录音`,
          disabled: false,
        };
      case "hover":
        return {
          className: `${buttonStyle} scale-105 shadow-2xl cursor-pointer`,
          tooltip: `按 [${hotkey}] 开始录音`,
          disabled: false,
        };
      case "recording":
        return {
          className: `${baseClasses} bg-[#0071e3] hover:bg-[#0077ed] recording-pulse cursor-pointer hover:shadow-2xl transform hover:scale-105`,
          tooltip: "正在录音...",
          disabled: false,
        };
      case "processing":
        return {
          className: `${buttonStyle} cursor-not-allowed opacity-70`,
          tooltip: "正在识别语音...",
          disabled: true,
        };
      case "optimizing":
        return {
          className: `${buttonStyle} cursor-not-allowed opacity-70`,
          tooltip: "AI正在优化文本...",
          disabled: true,
        };
      default:
        return {
          className: `${buttonStyle} cursor-pointer`,
          tooltip: "点击开始录音",
          disabled: false,
        };
    }
  };

  const micProps = getMicButtonProps();

  if (page === "settings") {
    return (
      <React.Suspense
        fallback={
          <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#1c1c1e] flex items-center justify-center">
            <div className="flex items-center space-x-3">
              <LoadingDots />
              <span className="text-content text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80">
                加载设置页面...
              </span>
            </div>
          </div>
        }
      >
        <SettingsPage />
      </React.Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#1c1c1e] p-4 pb-4">
      {/* 主界面 */}
      <div className="max-w-2xl mx-auto min-h-screen flex flex-col">
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between mb-6 px-2 py-3 -mx-2 rounded-xl glass-effect draggable"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <h1 className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-heading">
            Murmur
          </h1>
          <div className="flex items-center space-x-2 non-draggable">
            <Tooltip content="最小化" position="bottom">
              <button
                onClick={handleMinimize}
                aria-label="最小化"
                className="p-2 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
              >
                <Minus
                  className="w-4 h-4 text-[#1d1d1f]/60 dark:text-[#f5f5f7]/60"
                  aria-hidden="true"
                />
              </button>
            </Tooltip>
            <Tooltip
              content={isMaximized ? "还原" : "最大化"}
              position="bottom"
            >
              <button
                onClick={handleMaximize}
                aria-label={isMaximized ? "还原" : "最大化"}
                className="p-2 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] rounded-lg transition-colors"
              >
                {isMaximized ? (
                  <Square
                    className="w-3.5 h-3.5 text-[#1d1d1f]/60 dark:text-[#f5f5f7]/60"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                ) : (
                  <Maximize2
                    className="w-4 h-4 text-[#1d1d1f]/60 dark:text-[#f5f5f7]/60"
                    aria-hidden="true"
                  />
                )}
              </button>
            </Tooltip>
            <Tooltip content="关闭" position="bottom">
              <button
                onClick={handleClose}
                aria-label="关闭"
                className="p-2 hover:bg-[#ff5f57] rounded-lg transition-colors group"
              >
                <X
                  className="w-4 h-4 text-[#1d1d1f]/60 dark:text-[#f5f5f7]/60 group-hover:text-white"
                  aria-hidden="true"
                />
              </button>
            </Tooltip>
            <div className="w-px h-5 bg-[#d2d2d7] dark:bg-[#48484a] mx-1" />
            <Tooltip content="历史记录" position="bottom">
              <button
                onClick={handleOpenHistory}
                className="p-3 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] rounded-xl transition-colors shadow-sm"
              >
                <History className="w-6 h-6 text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80" />
              </button>
            </Tooltip>
            <Tooltip content="设置" position="bottom">
              <button
                onClick={handleOpenSettings}
                className="p-3 hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] rounded-xl transition-colors shadow-sm"
              >
                <Settings className="w-6 h-6 text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* 模式切换标签 */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg p-1">
            <button
              onClick={() => {
                if (!isRecording && !isRecordingProcessing) {
                  setAppMode("recording");
                }
              }}
              aria-label="实时录音模式"
              role="button"
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                appMode === "recording"
                  ? "bg-white dark:bg-[#3a3a3c] text-gray-900 dark:text-gray-100 shadow-sm"
                  : isRecording || isRecordingProcessing
                    ? "text-gray-400 dark:text-gray-500 cursor-not-allowed"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
              disabled={isRecording || isRecordingProcessing}
            >
              实时录音
            </button>
            <button
              onClick={() => setAppMode("file-import")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                appMode === "file-import"
                  ? "bg-white dark:bg-[#3a3a3c] text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              文件导入
            </button>
          </div>
        </div>

        {/* 实时录音模式 */}
        {appMode === "recording" && (
          <>
            {/* 录音控制区域 */}
            <div className="text-center mb-8 flex-shrink-0">
              <Tooltip content={micProps.tooltip}>
                <button
                  onClick={(e) => {
                    if (handleClick(e) && !micProps.disabled) {
                      toggleRecording();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (
                      (e.key === "Enter" || e.key === " ") &&
                      !micProps.disabled
                    ) {
                      e.preventDefault();
                      toggleRecording();
                    }
                  }}
                  onMouseEnter={() => {
                    if (!micProps.disabled) {
                      setIsHovered(true);
                    }
                  }}
                  onMouseLeave={() => setIsHovered(false)}
                  aria-label={isRecording ? "停止录音" : "开始录音"}
                  tabIndex={0}
                  className={`${micProps.className} non-draggable shadow-lg`}
                  disabled={micProps.disabled}
                >
                  {/* 动态内容基于状态 */}
                  {modelStatus.stage === "downloading" ? (
                    <LoadingIndicator size={20} />
                  ) : modelStatus.stage === "loading" ||
                    !modelStatus.isReady ? (
                    <LoadingIndicator size={20} />
                  ) : micState === "idle" ? (
                    <SoundWaveIcon size={20} isActive={false} />
                  ) : micState === "hover" ? (
                    <SoundWaveIcon size={20} isActive={false} />
                  ) : micState === "recording" ? (
                    <SoundWaveIcon size={20} isActive={true} />
                  ) : micState === "processing" ? (
                    <VoiceWaveIndicator isListening={true} />
                  ) : micState === "optimizing" ? (
                    <LoadingIndicator size={20} />
                  ) : null}

                  {/* 移除所有状态指示环，保持简洁 */}
                </button>
              </Tooltip>

              <p className="mt-4 text-content text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80">
                {modelStatus.stage === "need_download"
                  ? "需要下载AI模型文件才能开始使用"
                  : modelStatus.stage === "downloading"
                    ? modelStatus.downloadProgress > 0
                      ? `正在下载模型文件... ${modelStatus.downloadProgress}%`
                      : "正在准备下载模型文件..."
                    : modelStatus.stage === "loading"
                      ? "模型加载中，请稍候..."
                      : modelStatus.stage === "error"
                        ? `模型错误: ${modelStatus.error}`
                        : !modelStatus.isReady
                          ? "模型未就绪，请稍候..."
                          : micState === "recording"
                            ? "正在录音，再次点击停止"
                            : micState === "processing"
                              ? "正在识别语音..."
                              : micState === "optimizing"
                                ? "AI正在优化文本，请稍候..."
                                : `点击麦克风或按 ${hotkey} 开始录音`}
              </p>
              {modelStatus.stage === "need_download" && (
                <div className="mt-3 text-xs text-[#86868b] dark:text-[#98989d] space-y-1">
                  <p>使用步骤：</p>
                  <p>① 下载语音识别模型（必需，约1GB）</p>
                  <p>② 授权麦克风权限</p>
                  <p>③ 在设置中配置 AI API Key（可选）</p>
                </div>
              )}
            </div>

            {/* 模型下载进度显示 */}
            {(modelStatus.stage === "need_download" ||
              modelStatus.stage === "downloading") && (
              <div className="mb-6">
                <ModelDownloadProgress
                  modelStatus={modelStatus}
                  onDownload={handleDownloadModels}
                />
              </div>
            )}

            {/* 文本显示区域 - 可滚动 */}
            <div className="flex-1 text-area-scroll">
              <TextDisplay
                originalText={originalText}
                processedText={processedText}
                isProcessing={isOptimizing}
                onCopy={handleCopyText}
                onExport={handleExportText}
                onPaste={safePaste}
              />
            </div>
          </>
        )}

        {/* 文件导入模式 */}
        {appMode === "file-import" && (
          <div className="flex-1">
            {/* 录音进行中提示 */}
            {(isRecording || isRecordingProcessing) && (
              <div className="mb-4 px-3 py-2 bg-[#fff8f0] dark:bg-[#3a2c1c] border border-[#ff9500]/40 rounded-lg flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#ff9500] animate-pulse" />
                <span className="text-xs text-[#c07800] dark:text-[#ff9500]">
                  录音进行中，录音完成后可切换回实时录音模式
                </span>
              </div>
            )}
            <FileImport />
          </div>
        )}
      </div>

      {/* 设置面板 */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
