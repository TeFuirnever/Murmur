import * as React from "react";

interface ModelProgressEntry {
  progress: number;
  status: "waiting" | "downloading" | "completed" | "error";
}

interface ModelStatus {
  isLoading: boolean;
  isReady: boolean;
  isDownloading: boolean;
  modelsDownloaded: boolean;
  error: string | null;
  progress: number;
  downloadProgress: number;
  missingModels: string[];
  stage: string;
  modelProgress: Record<string, ModelProgressEntry>;
}

interface ModelStatusContextValue extends ModelStatus {
  checkModelStatus: () => Promise<void>;
  downloadModels: () => Promise<{ success: boolean; error?: string }>;
  getDownloadProgress: () => Promise<
    import("../types/ipc").DownloadProgress | { success: boolean }
  >;
  checkModelFiles: () => Promise<import("../types/ipc").ModelCheckResult>;
}

const ModelStatusContext = React.createContext<ModelStatusContextValue | null>(
  null,
);

const isSettingsPage = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("page") === "settings";
};

export function ModelStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [modelStatus, setModelStatus] = React.useState<ModelStatus>({
    isLoading: true,
    isReady: false,
    isDownloading: false,
    modelsDownloaded: false,
    error: null,
    progress: 0,
    downloadProgress: 0,
    missingModels: [],
    stage: "checking",
    modelProgress: {},
  });

  const checkModelFiles = React.useCallback(async (): Promise<
    import("../types/ipc").ModelCheckResult
  > => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.checkModelFiles();
        return result;
      }
      return { success: false, models_downloaded: false, missing_models: [] };
    } catch (error) {
      console.error("检查模型文件失败:", error);
      return { success: false, models_downloaded: false, missing_models: [] };
    }
  }, []);

  const checkServerStatus = React.useCallback(async (): Promise<
    import("../types/ipc").FunASRStatusResult
  > => {
    try {
      if (window.electronAPI) {
        const status = await window.electronAPI.checkFunASRStatus();
        return status;
      }
      return {
        success: false,
        installed: false,
        models_downloaded: false,
        initializing: false,
      };
    } catch (error) {
      console.error("检查服务器状态失败:", error);
      return {
        success: false,
        installed: false,
        models_downloaded: false,
        initializing: false,
      };
    }
  }, []);

  const checkModelStatus = React.useCallback(async () => {
    try {
      if (!window.electronAPI) {
        setModelStatus((prev) => ({
          ...prev,
          isLoading: false,
          error: "Electron API 不可用",
          stage: "error",
        }));
        return;
      }

      const modelFiles = await checkModelFiles();
      const serverStatus = await checkServerStatus();

      if (!modelFiles.success) {
        setModelStatus((prev) => ({
          ...prev,
          isLoading: false,
          error: "检查模型文件失败",
          stage: "error",
        }));
        return;
      }

      const modelsDownloaded = modelFiles.models_downloaded;
      const missingModels = modelFiles.missing_models || [];

      if (!modelsDownloaded) {
        setModelStatus((prev) => ({
          ...prev,
          isLoading: false,
          isReady: false,
          modelsDownloaded: false,
          missingModels,
          error: null,
          progress: 0,
          stage: "need_download",
        }));
      } else if (serverStatus.success && serverStatus.models_initialized) {
        setModelStatus((prev) => ({
          ...prev,
          isLoading: false,
          isReady: true,
          modelsDownloaded: true,
          missingModels: [],
          error: null,
          progress: 100,
          stage: "ready",
        }));
      } else if (serverStatus.initializing) {
        setModelStatus((prev) => ({
          ...prev,
          isLoading: true,
          isReady: false,
          modelsDownloaded: true,
          missingModels: [],
          error: null,
          progress: 50,
          stage: "loading",
        }));
      } else {
        setModelStatus((prev) => ({
          ...prev,
          isLoading: false,
          isReady: false,
          modelsDownloaded: true,
          missingModels: [],
          error: serverStatus.error || "服务器未就绪",
          progress: 0,
          stage: "error",
        }));
      }
    } catch (error) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log("error", "检查模型状态失败:", error);
      }
      setModelStatus((prev) => ({
        ...prev,
        isLoading: false,
        isReady: false,
        error: (error as Error).message || "模型状态检查失败",
        progress: 0,
        stage: "error",
      }));
    }
  }, [checkModelFiles, checkServerStatus]);

  const downloadModels = React.useCallback(async () => {
    try {
      if (!window.electronAPI) {
        throw new Error("Electron API 不可用");
      }

      setModelStatus((prev) => ({
        ...prev,
        isDownloading: true,
        downloadProgress: 0,
        error: null,
        stage: "downloading",
        isLoading: false,
      }));

      const result = await window.electronAPI.downloadModels();

      if (result.success) {
        setModelStatus((prev) => ({
          ...prev,
          isDownloading: false,
          modelsDownloaded: true,
          downloadProgress: 100,
          stage: "loading",
          isLoading: true,
        }));

        try {
          console.log("模型下载完成，重启FunASR服务器...");
          await window.electronAPI.restartFunasrServer();
          console.log("FunASR服务器重启完成");

          setTimeout(() => {
            checkModelStatus();
          }, 3000);
        } catch (restartError) {
          console.error("重启FunASR服务器失败:", restartError);
          setModelStatus((prev) => ({
            ...prev,
            isLoading: false,
            error: "重启服务器失败: " + (restartError as Error).message,
            stage: "error",
          }));
        }

        return { success: true };
      } else {
        throw new Error(result.error || "下载失败");
      }
    } catch (error) {
      console.error("下载模型失败:", error);
      setModelStatus((prev) => ({
        ...prev,
        isDownloading: false,
        isLoading: false,
        error: (error as Error).message || "下载模型失败",
        stage: "error",
      }));
      return { success: false, error: (error as Error).message };
    }
  }, [checkModelStatus]);

  const getDownloadProgress = React.useCallback(async () => {
    try {
      if (window.electronAPI) {
        const progress = await window.electronAPI.getDownloadProgress();
        return progress;
      }
      return { success: false };
    } catch (error) {
      console.error("获取下载进度失败:", error);
      return { success: false };
    }
  }, []);

  React.useEffect(() => {
    if (isSettingsPage()) {
      console.log("设置页面，跳过模型状态检查");
      return;
    }
    checkModelStatus();
  }, [checkModelStatus]);

  React.useEffect(() => {
    if (isSettingsPage() || modelStatus.isReady || modelStatus.isDownloading) {
      return;
    }

    const interval = setInterval(() => {
      if (!modelStatus.isReady && !modelStatus.isDownloading) {
        checkModelStatus();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [modelStatus.isReady, modelStatus.isDownloading, checkModelStatus]);

  React.useEffect(() => {
    if (window.electronAPI && window.electronAPI.onModelDownloadProgress) {
      const unsubscribe = window.electronAPI.onModelDownloadProgress(
        (event, progress) => {
          const p = progress ?? event;
          const modelKey = p.model || p.stage;
          setModelStatus((prev) => {
            const mp = { ...prev.modelProgress };
            if (modelKey && ["asr", "vad", "punc"].includes(modelKey)) {
              mp[modelKey] = {
                progress: p.progress || 0,
                status:
                  p.stage === "completed"
                    ? "completed"
                    : p.stage === "error"
                      ? "error"
                      : "downloading",
              };
            }
            return {
              ...prev,
              downloadProgress:
                p.overall_progress || p.progress || 0,
              modelProgress: mp,
              stage: "downloading",
            };
          });
        },
      );
      return unsubscribe;
    }
  }, []);

  React.useEffect(() => {
    if (window.electronAPI && window.electronAPI.onProcessingUpdate) {
      const unsubscribe = window.electronAPI.onProcessingUpdate(
        (event, data) => {
          const d = data ?? event;
          if (d.type === "model_initialization") {
            setModelStatus((prev) => ({
              ...prev,
              isLoading: d.isLoading,
              isReady: d.isReady,
              progress: d.progress || prev.progress,
              stage: d.isReady ? "ready" : "loading",
            }));
          }
        },
      );
      return unsubscribe;
    }
  }, []);

  React.useEffect(() => {
    if (isSettingsPage()) return;
    if (!window.electronAPI?.onSettingsUpdate) return;
    const unsubscribe = window.electronAPI.onSettingsUpdate(() => {
      checkModelStatus();
    });
    return unsubscribe;
  }, [checkModelStatus]);

  const value = {
    ...modelStatus,
    checkModelStatus,
    downloadModels,
    getDownloadProgress,
    checkModelFiles,
  };

  return (
    <ModelStatusContext.Provider value={value}>
      {children}
    </ModelStatusContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useModelStatus = () => {
  const context = React.useContext(ModelStatusContext);
  if (!context) {
    throw new Error("useModelStatus must be used within a ModelStatusProvider");
  }
  return context;
};
