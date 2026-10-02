// [20261002_T9_MigrationUx] Ticket #420: the migration IPC handlers.
// MODELS.MIGRATION_STATUS answers the startup check; MODELS.DOWNLOAD_ONNX
// runs the v2 pipeline and pushes progress over the SAME
// MODEL_DOWNLOAD_PROGRESS event the renderer already consumes. Contract
// assertions use the ipc-contracts constants — zero hardcoded channel
// strings (AGENTS.md rule). Pattern: modelHandlers.test.ts (mock ipcMain).
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as C from "../../src/helpers/ipc-contracts";
import { register } from "../../src/helpers/ipc/modelHandlers";

type MockHandler = (...args: unknown[]) => unknown;

interface MockIpcMain {
  handle: (channel: string, handler: MockHandler) => void;
  _handlers: Record<string, MockHandler | undefined>;
}

function createMockIpcMain(): MockIpcMain {
  const handlers: Record<string, MockHandler | undefined> = {};
  return {
    handle: vi.fn((channel: string, handler: MockHandler) => {
      handlers[channel] = handler;
    }),
    _handlers: handlers,
  };
}

interface MockManagers {
  funasrManager: {
    checkModelFiles: () => Promise<{ models_downloaded: boolean }>;
    downloadModels: (
      cb: (progress: Record<string, unknown>) => void,
    ) => Promise<unknown>;
    checkOnnxMigration: () => Record<string, unknown>;
    downloadOnnxModels: (
      cb: (progress: Record<string, unknown>) => void,
    ) => Promise<unknown>;
  };
}

describe("[20261002_T9_MigrationUx] onnx migration handlers (#420)", () => {
  let ipcMain: MockIpcMain;
  let managers: MockManagers;

  beforeEach(() => {
    ipcMain = createMockIpcMain();
    managers = {
      funasrManager: {
        checkModelFiles: vi.fn(async () => ({ models_downloaded: true })),
        downloadModels: vi.fn(async () => ({ success: true })),
        checkOnnxMigration: vi.fn(() => ({
          needed: true,
          onnx_ready: false,
          torch_fallback_available: true,
          total_bytes: 691_000_000,
          remaining_bytes: 691_000_000,
        })),
        downloadOnnxModels: vi.fn(async (cb) => {
          cb?.({ stage: "downloading", overall_progress: 10 });
          return { success: true, verified: ["vad-fsmn"] };
        }),
      },
    };
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );
  });

  it("registers the migration channels via the contract constants", () => {
    expect(ipcMain._handlers[C.MODELS.MIGRATION_STATUS]).toBeDefined();
    expect(ipcMain._handlers[C.MODELS.DOWNLOAD_ONNX]).toBeDefined();
  });

  it("MIGRATION_STATUS delegates to funasrManager.checkOnnxMigration", async () => {
    const result = await ipcMain._handlers[C.MODELS.MIGRATION_STATUS]!();
    expect(managers.funasrManager.checkOnnxMigration).toHaveBeenCalled();
    expect(result).toMatchObject({ needed: true, total_bytes: 691_000_000 });
  });

  it("DOWNLOAD_ONNX delegates with a progress callback that pushes MODEL_DOWNLOAD_PROGRESS", async () => {
    const send = vi.fn();
    const event = { sender: { send } };
    const result = await ipcMain._handlers[C.MODELS.DOWNLOAD_ONNX]!(event);
    expect(managers.funasrManager.downloadOnnxModels).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, verified: ["vad-fsmn"] });
    // Progress rides the EXISTING push event (no new event channel).
    expect(send).toHaveBeenCalledWith(C.EVENTS.MODEL_DOWNLOAD_PROGRESS, {
      stage: "downloading",
      overall_progress: 10,
    });
  });

  it("DOWNLOAD_ONNX propagates download failure to the renderer rejection", async () => {
    managers.funasrManager.downloadOnnxModels = vi
      .fn()
      .mockRejectedValue(new Error("所有下载源均不可用"));
    await expect(
      ipcMain._handlers[C.MODELS.DOWNLOAD_ONNX]!({ sender: { send: vi.fn() } }),
    ).rejects.toThrow(/所有下载源均不可用/);
  });
});
