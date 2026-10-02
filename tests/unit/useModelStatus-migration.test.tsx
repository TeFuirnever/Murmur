// [20261002_T9_MigrationUx] Ticket #420: the ModelStatusProvider's migration
// surface — startup ONNX migration state, session-scoped defer (dismiss),
// the downloadOnnxModels entry that keeps the failure LOCAL to the migration
// state (the app keeps working on the torch fallback, so the global stage
// must NOT flip to error), and the v2 model-name → legacy UI-key mapping.
// Pattern: useModelStatus.test.tsx (jsdom, makeElectronAPIStub, TestWindow).
// @vitest-environment jsdom
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  ModelStatusProvider,
  useModelStatus,
  resolveModelProgressKey,
} from "../../src/hooks/useModelStatus";
import type { ElectronAPI } from "../../src/electronAPI";
import type { ModelCheckResult, FunASRStatusResult } from "../../src/types/ipc";

type TestWindow = Omit<Window, "electronAPI"> & { electronAPI?: ElectronAPI };

const NOOP_UNSUB = () => {};

const MODEL_FILES_READY: ModelCheckResult = {
  success: true,
  models_downloaded: true,
  minimum_ready: true,
  missing_models: [],
};

const SERVER_READY: FunASRStatusResult = {
  success: true,
  installed: true,
  models_downloaded: true,
  initializing: false,
  models_initialized: true,
};

const MIGRATION_NEEDED = {
  needed: true,
  onnx_ready: false,
  torch_fallback_available: true,
  total_bytes: 704_000_000,
  remaining_bytes: 704_000_000,
};

function makeElectronAPIStub(
  overrides: Partial<ElectronAPI> = {},
): ElectronAPI {
  return {
    checkModelFiles: vi.fn().mockResolvedValue(MODEL_FILES_READY),
    checkFunASRStatus: vi.fn().mockResolvedValue(SERVER_READY),
    downloadModels: vi.fn().mockResolvedValue({ success: true }),
    onModelDownloadProgress: vi.fn().mockReturnValue(NOOP_UNSUB),
    onSettingsUpdate: vi.fn().mockReturnValue(NOOP_UNSUB),
    log: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ElectronAPI;
}

function renderProviderHook() {
  return renderHook(() => useModelStatus(), {
    wrapper: ({ children }) => (
      <ModelStatusProvider>{children}</ModelStatusProvider>
    ),
  });
}

describe("[20261002_T9_MigrationUx] useModelStatus migration surface (#420)", () => {
  let originalAPI: ElectronAPI | undefined;

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow | undefined)?.electronAPI;
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI !== undefined) {
      win.electronAPI = originalAPI;
    }
    vi.useRealTimers();
  });

  it("checks the ONNX migration state on mount and exposes it", async () => {
    const checkOnnxMigration = vi.fn().mockResolvedValue(MIGRATION_NEEDED);
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub({
      checkOnnxMigration,
    });

    const { result } = renderProviderHook();

    await waitFor(() => {
      expect(result.current.migration.checked).toBe(true);
    });
    expect(checkOnnxMigration).toHaveBeenCalledTimes(1);
    expect(result.current.migration.needed).toBe(true);
    expect(result.current.migration.torchFallbackAvailable).toBe(true);
    expect(result.current.migration.totalBytes).toBe(704_000_000);
    expect(result.current.migration.dismissed).toBe(false);
    // The app keeps working on the fallback — the global stage is NOT the
    // migration's business.
    expect(result.current.stage).toBe("ready");
  });

  it("dismissMigration scopes the defer to the session (next launch re-asks)", async () => {
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub({
      checkOnnxMigration: vi.fn().mockResolvedValue(MIGRATION_NEEDED),
    });

    const { result } = renderProviderHook();
    await waitFor(() => {
      expect(result.current.migration.checked).toBe(true);
    });

    act(() => {
      result.current.dismissMigration();
    });
    expect(result.current.migration.dismissed).toBe(true);
    expect(result.current.migration.needed).toBe(true);
  });

  it("downloadOnnxModels succeeds: loading stage, no local error, migration re-checked after the settle window", async () => {
    vi.useFakeTimers();
    const checkOnnxMigration = vi
      .fn()
      .mockResolvedValueOnce(MIGRATION_NEEDED)
      .mockResolvedValue({
        needed: false,
        onnx_ready: true,
        torch_fallback_available: true,
        total_bytes: 704_000_000,
        remaining_bytes: 0,
      });
    const downloadOnnxModels = vi
      .fn()
      .mockResolvedValue({ success: true, verified: ["vad-fsmn"] });
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub({
      checkOnnxMigration,
      downloadOnnxModels,
    });

    const { result } = renderProviderHook();
    // Flush the mount effects (checking → ready) without real timers.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.stage).toBe("ready");
    expect(result.current.migration.needed).toBe(true);

    await act(async () => {
      await result.current.downloadOnnxModels();
    });
    expect(downloadOnnxModels).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe("loading");
    expect(result.current.isDownloading).toBe(false);
    expect(result.current.migration.error).toBeNull();

    // The settle window re-check picks up the now-ready ONNX set.
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(checkOnnxMigration).toHaveBeenCalledTimes(2);
    expect(result.current.migration.needed).toBe(false);
  });

  it("downloadOnnxModels failure stays LOCAL to the migration state (fallback keeps serving)", async () => {
    const downloadOnnxModels = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "模型下载失败：所有下载源均不可用。请检查网络连接或代理设置后重试",
        ),
      );
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub({
      checkOnnxMigration: vi.fn().mockResolvedValue(MIGRATION_NEEDED),
      downloadOnnxModels,
    });

    const { result } = renderProviderHook();
    await waitFor(() => {
      expect(result.current.stage).toBe("ready");
    });

    let res: { success: boolean; error?: string } = { success: true };
    await act(async () => {
      res = await result.current.downloadOnnxModels();
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("所有下载源均不可用");
    expect(result.current.isDownloading).toBe(false);
    // The torch fallback still serves: the global stage is restored by the
    // status re-check (never left at "downloading"), and the failure is
    // migration-scoped for the dialog to render.
    await waitFor(() => {
      expect(result.current.stage).toBe("ready");
    });
    expect(result.current.migration.error).toContain("所有下载源均不可用");
  });

  it("maps v2 pin model names onto the legacy progress keys", async () => {
    expect(resolveModelProgressKey("asr-seaco-paraformer")).toBe("asr");
    expect(resolveModelProgressKey("vad-fsmn")).toBe("vad");
    expect(resolveModelProgressKey("punc-ct-transformer-272727")).toBe("punc");
    expect(resolveModelProgressKey("asr")).toBe("asr");
    expect(resolveModelProgressKey("speaker-campplus")).toBeNull();
    expect(resolveModelProgressKey("unknown")).toBeNull();
    expect(resolveModelProgressKey(undefined)).toBeNull();
  });

  it("forwards v2 progress events into the legacy per-model bars", async () => {
    let progressCb: ((...args: unknown[]) => void) | undefined;
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub({
      onModelDownloadProgress: vi.fn((cb) => {
        progressCb = cb;
        return NOOP_UNSUB;
      }),
    });
    const { result } = renderProviderHook();
    await waitFor(() => expect(result.current.stage).toBe("ready"));

    act(() => {
      progressCb?.(undefined, {
        model: "asr-seaco-paraformer",
        stage: "downloading",
        progress: 40,
        overall_progress: 33,
      });
    });
    expect(result.current.modelProgress.asr?.progress).toBe(40);
    expect(result.current.downloadProgress).toBe(33);

    act(() => {
      progressCb?.(undefined, {
        model: "punc-ct-transformer-272727",
        stage: "completed",
        progress: 100,
        overall_progress: 99,
      });
    });
    expect(result.current.modelProgress.punc?.status).toBe("completed");
  });
});
