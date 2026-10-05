import * as React from "react";
// [20260725_CodeReview_OperationResult] Replaces inline `{ success; error? }`
// on the ModelStatusContextValue.downloadModels field.
import type {
  OperationResult,
  OnnxMigrationStatus,
  OnnxDownloadResult,
} from "../types/ipc";

interface ModelProgressEntry {
  progress: number;
  status: "waiting" | "downloading" | "completed" | "error";
}

interface ModelStatus {
  isLoading: boolean;
  isReady: boolean;
  // [T12 review BLOCKER] True when the server PROCESS is alive but its
  // models are freed (idle-unload) — a recordable state; the hotkey
  // pre-trigger covers the reload window.
  isUnloaded: boolean;
  isDownloading: boolean;
  modelsDownloaded: boolean;
  error: string | null;
  progress: number;
  downloadProgress: number;
  missingModels: string[];
  stage: string;
  modelProgress: Record<string, ModelProgressEntry>;
}

// [20261002_T9_MigrationUx] Ticket #420: renderer-side view of the ONNX
// migration state (main computes it; see src/helpers/onnxMigration.ts).
// `dismissed` is deliberately NOT persisted — "defer" defers to the NEXT
// launch, which re-prompts because the check runs on every mount.
interface MigrationState {
  checked: boolean;
  needed: boolean;
  torchFallbackAvailable: boolean;
  totalBytes: number;
  remainingBytes: number;
  dismissed: boolean;
  // Download failure stays LOCAL here: while the migration is deferred or
  // failing, the torch fallback keeps serving, so the GLOBAL stage must not
  // flip to error (the dialog renders this message with actionable guidance).
  error: string | null;
}

// [20261002_T9_MigrationUx] The v2 downloader reports pin model names
// ("asr-seaco-paraformer"); the legacy per-model progress UI keys off
// asr/vad/punc. Map the generation names onto the legacy keys; everything
// else (speaker, unknowns) has no UI slot and is ignored. Exported for the
// #420 hook tests.
// eslint-disable-next-line react-refresh/only-export-components
export function resolveModelProgressKey(
  model: string | undefined,
): string | null {
  if (!model) return null;
  if (model.startsWith("asr-") || model === "asr") return "asr";
  if (model.startsWith("vad-") || model === "vad") return "vad";
  if (model.startsWith("punc-") || model === "punc") return "punc";
  return null;
}

// [20260815_Refactor_DeadIpc] Context surface trimmed to what consumers
// actually use: the derived status fields plus downloadModels. The old
// getDownloadProgress (dead pull chain — progress arrives via the
// MODEL_DOWNLOAD_PROGRESS push event) and the provider-internal
// checkModelStatus/checkModelFiles were removed from the exposed value.
// [20261002_T9_MigrationUx] The migration surface joins the context:
// MigrationDialog consumes it; no other consumer is affected.
interface ModelStatusContextValue extends ModelStatus {
  downloadModels: () => Promise<OperationResult>;
  migration: MigrationState;
  dismissMigration: () => void;
  downloadOnnxModels: () => Promise<OperationResult>;
}

const ModelStatusContext = React.createContext<ModelStatusContextValue | null>(
  null,
);

const isSettingsPage = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("page") === "settings";
};

// [20261002_T9_MigrationUx] Delay before re-checking status + migration
// after a successful download (mirrors downloadModels' settle window — the
// main process restarts the server fire-and-forget and the poll observes it).
const MIGRATION_RECHECK_DELAY_MS = 3000;

const INITIAL_MIGRATION_STATE: MigrationState = {
  checked: false,
  needed: false,
  torchFallbackAvailable: false,
  totalBytes: 0,
  remainingBytes: 0,
  dismissed: false,
  error: null,
};

export function ModelStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [modelStatus, setModelStatus] = React.useState<ModelStatus>({
    isLoading: true,
    isReady: false,
    isUnloaded: false,
    isDownloading: false,
    modelsDownloaded: false,
    error: null,
    progress: 0,
    downloadProgress: 0,
    missingModels: [],
    stage: "checking",
    modelProgress: {},
  });

  // [20261002_T9_MigrationUx] Migration prompt state (startup check + defer).
  const [migration, setMigration] = React.useState<MigrationState>(
    INITIAL_MIGRATION_STATE,
  );

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
      const minimumReady = modelFiles.minimum_ready || modelsDownloaded;
      const missingModels = modelFiles.missing_models || [];

      if (!minimumReady) {
        setModelStatus((prev) => ({
          ...prev,
          isLoading: false,
          isReady: false,
          isUnloaded: false,
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
          isUnloaded: false,
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
          isUnloaded: false,
          modelsDownloaded: true,
          missingModels: [],
          error: null,
          progress: 50,
          stage: "loading",
        }));
      } else if (serverStatus.server_ready === true) {
        // [T12 review BLOCKER] Process alive + models freed = idle-unloaded:
        // recordable, hotkey pre-trigger covers the reload. Not an error.
        setModelStatus((prev) => ({
          ...prev,
          isLoading: false,
          isReady: false,
          isUnloaded: true,
          modelsDownloaded: true,
          missingModels: [],
          error: null,
          progress: 0,
          stage: "unloaded",
        }));
      } else {
        setModelStatus((prev) => ({
          ...prev,
          isLoading: false,
          isReady: false,
          isUnloaded: false,
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

        // [20260905_Fix_216_DownloadRecovery] The server restart after a
        // successful download is now owned by the MAIN process
        // (funasrManager.downloadModels fires restartServer itself). The
        // renderer-side restart here raced it into a double full-model
        // load (review MAJOR); the status poll below picks up the server
        // state once the main-process restart settles.
        setTimeout(() => {
          checkModelStatus();
        }, 3000);

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

  // [20261002_T9_MigrationUx] Ticket #420: the old-user migration surface.
  // Startup check + session-scoped defer + the v2 download entry. Failure is
  // migration-local (torch fallback keeps serving); success re-checks after
  // the settle window so the prompt clears once the new engine is live.
  const checkMigration = React.useCallback(async () => {
    try {
      if (!window.electronAPI?.checkOnnxMigration) {
        return;
      }
      const status =
        (await window.electronAPI.checkOnnxMigration()) as OnnxMigrationStatus;
      setMigration((prev) => ({
        ...prev,
        checked: true,
        needed: status.needed,
        torchFallbackAvailable: status.torch_fallback_available,
        totalBytes: status.total_bytes,
        remainingBytes: status.remaining_bytes,
        // A fresh status invalidates the previous attempt's error.
        error: null,
      }));
    } catch {
      // The migration check is advisory; failure must not disturb the app
      // (the prompt simply stays unchecked this launch). Logged for diagnosis.
      if (window.electronAPI?.log) {
        void window.electronAPI.log(
          "warn",
          "检查 ONNX 迁移状态失败（本次启动不提示迁移）",
        );
      }
      setMigration((prev) => ({ ...prev, checked: true }));
    }
  }, []);

  const dismissMigration = React.useCallback(() => {
    // Session-scoped on purpose: no persistence — the next launch re-asks
    // (ticket #420 AC: after deferring, the app is asked again on the next launch).
    setMigration((prev) => ({ ...prev, dismissed: true }));
  }, []);

  const downloadOnnxModels =
    React.useCallback(async (): Promise<OperationResult> => {
      try {
        if (!window.electronAPI?.downloadOnnxModels) {
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
        setMigration((prev) => ({ ...prev, error: null }));

        const result =
          (await window.electronAPI.downloadOnnxModels()) as OnnxDownloadResult;
        if (!result.success) {
          throw new Error(result.error || "下载失败");
        }

        setModelStatus((prev) => ({
          ...prev,
          isDownloading: false,
          modelsDownloaded: true,
          downloadProgress: 100,
          stage: "loading",
          isLoading: true,
        }));
        setTimeout(() => {
          void checkModelStatus();
          void checkMigration();
        }, MIGRATION_RECHECK_DELAY_MS);
        return { success: true };
      } catch (error) {
        // Deliberate difference from downloadModels: the migration failing
        // must NOT put the app into the global error stage — the torch
        // fallback still transcribes. The dialog renders the actionable
        // message (network/proxy guidance + retry); the status check below
        // restores the true global stage ("downloading" was only in-flight).
        setModelStatus((prev) => ({ ...prev, isDownloading: false }));
        setMigration((prev) => ({
          ...prev,
          error: (error as Error).message || "下载模型失败",
        }));
        void checkModelStatus();
        return { success: false, error: (error as Error).message };
      }
    }, [checkModelStatus, checkMigration]);
  // [20261002_T9_MigrationUx] END

  React.useEffect(() => {
    if (isSettingsPage()) {
      console.log("设置页面，跳过模型状态检查");
      return;
    }
    checkModelStatus();
    // [20261002_T9_MigrationUx] The migration prompt evaluates once per
    // launch — the AC's "ask again on the next launch" is exactly this
    // mount-time check.
    // [20261005_T9_CiBisect2] Diagnostic bisect: skip the mount-time
    // migration IPC ONLY inside the e2e app-under-test (marked by the
    // MURMUR_DB_PATH=:memory: launch env, electron-launch.ts). NODE_ENV is
    // NOT usable as the marker — vitest workers also run with NODE_ENV=test.
    // Unit tests (marker unset) keep the call → suites stay green, so the
    // e2e result carries causal weight (unlike the invalid ae76e33 attempt
    // whose unit-test fallout aborted CI before e2e ever ran).
    if (process.env.MURMUR_DB_PATH === ":memory:") {
      console.log("[t9-bisect] skip mount-time checkMigration (e2e app)");
    } else {
      void checkMigration();
    }
  }, [checkModelStatus, checkMigration]);

  React.useEffect(() => {
    if (modelStatus.isReady || modelStatus.isDownloading) {
      return;
    }

    // [20260815_Refactor_DeadIpc] The interval callback used to re-check the
    // same isReady/isDownloading conditions already guarded by this effect's
    // dependency array — the deps re-create the interval on change, so the
    // inner re-check was unreachable-in-practice redundancy.
    const interval = setInterval(() => {
      checkModelStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, [modelStatus.isReady, modelStatus.isDownloading, checkModelStatus]);

  React.useEffect(() => {
    if (window.electronAPI && window.electronAPI.onModelDownloadProgress) {
      const unsubscribe = window.electronAPI.onModelDownloadProgress(
        // [20260725_CodeReview_S1] `event` is the IPC IpcRendererEvent (typed
        // unknown because the .d.ts no longer leaks `any`); only `progress`
        // is the payload. We keep the `?? event` fallback because pre-T2.3
        // the handler sometimes received the payload as the first arg
        // (legacy sender). Narrow once via an inline type that matches what
        // the runtime sender actually emits (richer than the d.ts
        // DownloadProgress — which Tier 2.3 finalize should reconcile).
        (event, progress) => {
          const p = (progress ?? event) as {
            progress?: number;
            overall_progress?: number;
            status?: string;
            model?: string;
            stage?: string;
          };
          // [20261002_T9_MigrationUx] The v2 downloader reports pin model
          // names ("asr-seaco-paraformer"); map them onto the legacy UI keys
          // so the established per-model bars light up during a migration
          // download too.
          const modelKey = resolveModelProgressKey(p.model) ?? p.stage;
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
              downloadProgress: p.overall_progress || p.progress || 0,
              modelProgress: mp,
              stage: "downloading",
            };
          });
        },
      );
      return unsubscribe;
    }
  }, []);

  // [20260906_Refactor_DeadChannelCleanup] Ticket #250: the processing-update
  // push-event subscription was removed with the channel — the
  // model_initialization push had no live producer.

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
    downloadModels,
    // [20261002_T9_MigrationUx] Migration prompt surface (#420).
    migration,
    dismissMigration,
    downloadOnnxModels,
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
