// [20260729_Test_Hooks] Integration tests for the ModelStatusProvider +
// useModelStatus React context hook. Runs under jsdom because the hook uses
// React state/effects, setInterval, and window.electronAPI. We wrap the
// consumer in the provider via a small wrapper passed to renderHook, and
// assert the model lifecycle stages (checking -> need_download -> downloading
// -> loading -> ready / error) plus the IPC surface.
// @vitest-environment jsdom
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  ModelStatusProvider,
  useModelStatus,
} from "../../src/hooks/useModelStatus";
import type { ElectronAPI } from "../../src/electronAPI";
import type { ModelCheckResult, FunASRStatusResult } from "../../src/types/ipc";

// [20260729_Test_Hooks] See useSettings-hook test for the rationale: the
// production declaration makes electronAPI required, but the test owns its
// lifecycle. Omit + re-add as optional, cast through unknown only.
type TestWindow = Omit<Window, "electronAPI"> & { electronAPI?: ElectronAPI };

// [20260729_Test_Hooks] Event-listener methods (onModelDownloadProgress,
// onProcessingUpdate, onSettingsUpdate) return an unsubscribe fn. We give them
// no-op unsubscribers so the provider's cleanup effects don't throw. The
// callback is captured by the provider but we don't drive it here.
const NOOP_UNSUB = () => {};

// [20260729_Test_Hooks] Canonical fixtures for the two IPC calls checkModelStatus
// depends on. Helper below composes a stub from per-test overrides.
const MODEL_FILES_READY: ModelCheckResult = {
  success: true,
  models_downloaded: true,
  minimum_ready: true,
  missing_models: [],
};

const MODEL_FILES_MISSING: ModelCheckResult = {
  success: true,
  models_downloaded: false,
  minimum_ready: false,
  missing_models: ["asr", "vad"],
};

const SERVER_READY: FunASRStatusResult = {
  success: true,
  installed: true,
  models_downloaded: true,
  initializing: false,
  models_initialized: true,
};

const SERVER_INITIALIZING: FunASRStatusResult = {
  success: true,
  installed: true,
  models_downloaded: true,
  initializing: true,
  models_initialized: false,
};

function makeElectronAPIStub(
  overrides: Partial<ElectronAPI> = {},
): ElectronAPI {
  return {
    checkModelFiles: vi.fn().mockResolvedValue(MODEL_FILES_READY),
    checkFunASRStatus: vi.fn().mockResolvedValue(SERVER_READY),
    downloadModels: vi.fn().mockResolvedValue({ success: true }),
    restartFunasrServer: vi.fn().mockResolvedValue({ success: true }),
    getDownloadProgress: vi
      .fn()
      .mockResolvedValue({ progress: 0, status: "idle" }),
    onModelDownloadProgress: vi.fn().mockReturnValue(NOOP_UNSUB),
    onProcessingUpdate: vi.fn().mockReturnValue(NOOP_UNSUB),
    onSettingsUpdate: vi.fn().mockReturnValue(NOOP_UNSUB),
    log: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ElectronAPI;
}

// [20260729_Test_Hooks] renderHook wrapper that mounts the consumer inside
// the provider. The consumer forwards the context value via a ref so tests
// can read result.current synchronously after state updates.
function renderProviderHook() {
  return renderHook(() => useModelStatus(), {
    wrapper: ({ children }) => (
      <ModelStatusProvider>{children}</ModelStatusProvider>
    ),
  });
}

describe("useModelStatus hook", () => {
  let originalAPI: ElectronAPI | undefined;

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow).electronAPI;
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) {
      delete win.electronAPI;
    } else {
      win.electronAPI = originalAPI;
    }
    vi.restoreAllMocks();
  });

  it("throws when used outside the provider", () => {
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub();
    // Suppress the expected console.error from React for the thrown render.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useModelStatus())).toThrow(
      "useModelStatus must be used within a ModelStatusProvider",
    );
    spy.mockRestore();
  });

  it("starts in the checking stage and transitions to ready when models are present", async () => {
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub();
    const { result } = renderProviderHook();

    // Initial render before the mount effect resolves.
    expect(result.current.stage).toBe("checking");
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.stage).toBe("ready");
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.modelsDownloaded).toBe(true);
    expect(result.current.progress).toBe(100);
    expect(result.current.isLoading).toBe(false);
  });

  it("enters the need_download stage when minimum_ready is false", async () => {
    const stub = makeElectronAPIStub({
      checkModelFiles: vi.fn().mockResolvedValue(MODEL_FILES_MISSING),
      checkFunASRStatus: vi.fn().mockResolvedValue(SERVER_READY),
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderProviderHook();

    await waitFor(() => {
      expect(result.current.stage).toBe("need_download");
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.modelsDownloaded).toBe(false);
    expect(result.current.missingModels).toEqual(["asr", "vad"]);
    expect(result.current.progress).toBe(0);
  });

  it("enters the loading stage (50%) when the server is initializing but models are present", async () => {
    const stub = makeElectronAPIStub({
      checkModelFiles: vi.fn().mockResolvedValue(MODEL_FILES_READY),
      checkFunASRStatus: vi.fn().mockResolvedValue(SERVER_INITIALIZING),
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderProviderHook();

    await waitFor(() => {
      expect(result.current.stage).toBe("loading");
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isReady).toBe(false);
    expect(result.current.modelsDownloaded).toBe(true);
    expect(result.current.progress).toBe(50);
  });

  it("enters the error stage when the server is not initializing and not initialized", async () => {
    const notReady: FunASRStatusResult = {
      success: true,
      installed: true,
      models_downloaded: true,
      initializing: false,
      models_initialized: false,
      error: "服务器未就绪",
    };
    const stub = makeElectronAPIStub({
      checkModelFiles: vi.fn().mockResolvedValue(MODEL_FILES_READY),
      checkFunASRStatus: vi.fn().mockResolvedValue(notReady),
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderProviderHook();

    await waitFor(() => {
      expect(result.current.stage).toBe("error");
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBe("服务器未就绪");
  });

  it("reports an error stage when electronAPI is absent", async () => {
    // No stub -> checkModelStatus short-circuits with an Electron API error.
    const { result } = renderProviderHook();

    await waitFor(() => {
      expect(result.current.stage).toBe("error");
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe("Electron API 不可用");
  });

  it("reports an error stage when checkModelFiles returns success:false", async () => {
    const stub = makeElectronAPIStub({
      checkModelFiles: vi.fn().mockResolvedValue({
        success: false,
        models_downloaded: false,
        missing_models: [],
      }),
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderProviderHook();

    await waitFor(() => {
      expect(result.current.stage).toBe("error");
    });
    expect(result.current.error).toBe("检查模型文件失败");
  });

  it("downloadModels calls downloadModels IPC, restarts the server, and moves to the loading stage", async () => {
    const downloadModels = vi.fn().mockResolvedValue({ success: true });
    const restartFunasrServer = vi.fn().mockResolvedValue({ success: true });
    // Start from need_download so downloadModels is a meaningful transition.
    const stub = makeElectronAPIStub({
      checkModelFiles: vi.fn().mockResolvedValue(MODEL_FILES_MISSING),
      checkFunASRStatus: vi.fn().mockResolvedValue(SERVER_READY),
      downloadModels,
      restartFunasrServer,
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderProviderHook();
    await waitFor(() => {
      expect(result.current.stage).toBe("need_download");
    });

    let res: { success: boolean } = { success: false };
    await act(async () => {
      res = await result.current.downloadModels();
    });

    expect(res.success).toBe(true);
    expect(downloadModels).toHaveBeenCalledTimes(1);
    // After a successful download the hook restarts FunASR and enters loading.
    expect(restartFunasrServer).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.stage).toBe("loading");
    });
    expect(result.current.modelsDownloaded).toBe(true);
    expect(result.current.downloadProgress).toBe(100);
    expect(result.current.isDownloading).toBe(false);
  });

  it("downloadModels surfaces a failure result and enters the error stage", async () => {
    const downloadModels = vi
      .fn()
      .mockResolvedValue({ success: false, error: "网络错误" });
    const restartFunasrServer = vi.fn();
    const stub = makeElectronAPIStub({
      checkModelFiles: vi.fn().mockResolvedValue(MODEL_FILES_MISSING),
      checkFunASRStatus: vi.fn().mockResolvedValue(SERVER_READY),
      downloadModels,
      restartFunasrServer,
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderProviderHook();
    await waitFor(() => {
      expect(result.current.stage).toBe("need_download");
    });

    let res: { success: boolean; error?: string } = { success: true };
    await act(async () => {
      res = await result.current.downloadModels();
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("网络错误");
    // Restart must not run when the download itself failed.
    expect(restartFunasrServer).not.toHaveBeenCalled();
    expect(result.current.isDownloading).toBe(false);
    expect(result.current.stage).toBe("error");
  });

  it("getDownloadProgress forwards to the IPC method", async () => {
    const getDownloadProgress = vi
      .fn()
      .mockResolvedValue({ progress: 42, status: "downloading" });
    const stub = makeElectronAPIStub({
      checkModelFiles: vi.fn().mockResolvedValue(MODEL_FILES_READY),
      checkFunASRStatus: vi.fn().mockResolvedValue(SERVER_READY),
      getDownloadProgress,
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderProviderHook();
    await waitFor(() => {
      expect(result.current.stage).toBe("ready");
    });

    let progress: Record<string, unknown> = {};
    await act(async () => {
      progress = (await result.current.getDownloadProgress?.()) as Record<
        string,
        unknown
      >;
    });

    expect(getDownloadProgress).toHaveBeenCalledTimes(1);
    expect(progress.progress).toBe(42);
    expect(progress.status).toBe("downloading");
  });

  it("checkModelFiles context method proxies the IPC result", async () => {
    const checkModelFiles = vi.fn().mockResolvedValue(MODEL_FILES_MISSING);
    const stub = makeElectronAPIStub({
      checkModelFiles,
      checkFunASRStatus: vi.fn().mockResolvedValue(SERVER_READY),
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderProviderHook();
    await waitFor(() => {
      expect(result.current.stage).toBe("need_download");
    });

    let files: ModelCheckResult = MODEL_FILES_READY;
    await act(async () => {
      files = await result.current.checkModelFiles();
    });

    expect(checkModelFiles).toHaveBeenCalled();
    expect(files.models_downloaded).toBe(false);
    expect(files.missing_models).toEqual(["asr", "vad"]);
  });

  it("checkModelStatus re-runs both IPC checks when invoked again", async () => {
    const checkModelFiles = vi.fn().mockResolvedValue(MODEL_FILES_READY);
    const checkFunASRStatus = vi.fn().mockResolvedValue(SERVER_READY);
    const stub = makeElectronAPIStub({ checkModelFiles, checkFunASRStatus });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderProviderHook();
    await waitFor(() => {
      expect(result.current.stage).toBe("ready");
    });

    const filesBefore = checkModelFiles.mock.calls.length;
    const serverBefore = checkFunASRStatus.mock.calls.length;

    await act(async () => {
      await result.current.checkModelStatus();
    });

    expect(checkModelFiles.mock.calls.length).toBe(filesBefore + 1);
    expect(checkFunASRStatus.mock.calls.length).toBe(serverBefore + 1);
  });

  it("registers the model-download, processing-update and settings-update listeners on mount", async () => {
    const onModelDownloadProgress = vi.fn().mockReturnValue(NOOP_UNSUB);
    const onProcessingUpdate = vi.fn().mockReturnValue(NOOP_UNSUB);
    const onSettingsUpdate = vi.fn().mockReturnValue(NOOP_UNSUB);
    const stub = makeElectronAPIStub({
      onModelDownloadProgress,
      onProcessingUpdate,
      onSettingsUpdate,
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    renderProviderHook();

    await waitFor(() => {
      expect(onModelDownloadProgress).toHaveBeenCalledTimes(1);
    });
    expect(onProcessingUpdate).toHaveBeenCalledTimes(1);
    // onSettingsUpdate may be undefined in some electronAPI stubs.
    if (onSettingsUpdate) {
      expect(onSettingsUpdate).toHaveBeenCalledTimes(1);
    }
    // Each listener registration returns an unsubscribe that the provider
    // returns from the effect for cleanup.
    expect(onModelDownloadProgress.mock.results[0]?.value).toBeTypeOf(
      "function",
    );
  });
});
