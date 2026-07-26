// [20260726_Tier3_ModelHandlersMigrate] Migrated from .js to .ts as part of
// Tier 3 batch 3. Pattern: type the `createMockIpcMain` helper's `handlers`
// map (TS7053 — `{}` has no index signature) and its return shape so the
// `let ipcMain`/`let managers`/`let register` bindings assigned in
// beforeEach infer concrete types (TS7034). `register` is typed via the
// source's named export. The mock ipcMain/managers are NOT the real
// Electron.IpcMain / source Managers — the test stubs them — so local
// Mock* types describe the surface the tests exercise. No `any`.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
//
// [20260726_Tier32_ModelHandlers] Tier 3.2: converted cargo-cult require() +
// vi.resetModules() to top-level ESM import. No vi.mock() was used, so the
// shim existed only to load the .ts source. The `let register: typeof import`
// declaration collapses to the import. beforeEach retains the mock ipcMain /
// managers setup and the register() call.
// [20260726_Tier32_ModelHandlers] END
import { describe, it, expect, vi, beforeEach } from "vitest";
import { register } from "../../src/helpers/ipc/modelHandlers";

// [20260726_Tier3_ModelHandlersMigrate] Handler shape: ipcMain.handle
// registers `(event, ...args) => result` callbacks. Tests invoke them with
// varied args and read result properties (models/model/status/success/error),
// so the return is Record<string, unknown> and args are unknown[] — the
// narrowest types that accept every call site without `any`.
type MockHandler = (...args: unknown[]) => Record<string, unknown>;

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

// [20260726_Tier3_ModelHandlersMigrate] Stubbed managers surface: only the
// funasrManager methods exercised by the registered handlers. Each returns a
// vi.fn so call assertions work; the resolved shapes match what the test
// expects the handler to forward.
interface MockManagers {
  funasrManager: {
    checkModelFiles: (...args: never[]) => Promise<{ downloaded: boolean }>;
    getDownloadProgress: (...args: never[]) => Promise<{ progress: number }>;
    downloadModels: (...args: never[]) => Promise<{ success: boolean }>;
    checkStatus: (...args: never[]) => Promise<{ models_downloaded: boolean }>;
  };
}

describe("modelHandlers", () => {
  let ipcMain: MockIpcMain;
  let managers: MockManagers;

  beforeEach(() => {
    ipcMain = createMockIpcMain();

    managers = {
      funasrManager: {
        checkModelFiles: vi.fn(async () => ({ downloaded: true })),
        getDownloadProgress: vi.fn(async () => ({ progress: 0 })),
        downloadModels: vi.fn(async () => ({ success: true })),
        checkStatus: vi.fn(async () => ({ models_downloaded: true })),
      },
    };

    // [20260726_Tier3_ModelHandlersMigrate] Cast the mock ipcMain/managers to
    // the source register() signature: the stubs are structurally compatible
    // with the subset of Electron.IpcMain / Managers the handler uses, but
    // not assignable to the full production types. `unknown` bridge — no any.
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );
  });

  it("registers all model handlers", () => {
    expect(ipcMain._handlers["check-model-files"]).toBeDefined();
    expect(ipcMain._handlers["get-download-progress"]).toBeDefined();
    expect(ipcMain._handlers["download-models"]).toBeDefined();
    expect(ipcMain._handlers["download-model"]).toBeDefined();
    expect(ipcMain._handlers["get-available-models"]).toBeDefined();
    expect(ipcMain._handlers["get-current-model"]).toBeDefined();
    expect(ipcMain._handlers["switch-model"]).toBeDefined();
  });

  it("check-model-files delegates to funasrManager", async () => {
    // [20260726_Tier3_ModelHandlersMigrate] Non-null after the prior
    // toBeDefined() assertion in the "registers all" test; the handler is
    // always registered before these run.
    const result = await ipcMain._handlers["check-model-files"]!();
    expect(managers.funasrManager.checkModelFiles).toHaveBeenCalled();
    expect(result).toEqual({ downloaded: true });
  });

  it("get-download-progress delegates to funasrManager", async () => {
    const result = await ipcMain._handlers["get-download-progress"]!();
    expect(managers.funasrManager.getDownloadProgress).toHaveBeenCalled();
    expect(result).toEqual({ progress: 0 });
  });

  it("download-models delegates to funasrManager with progress callback", async () => {
    const mockSender = { send: vi.fn() };
    const mockEvent = { sender: mockSender };
    const result = await ipcMain._handlers["download-models"]!(mockEvent);
    expect(managers.funasrManager.downloadModels).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("get-available-models returns model list", () => {
    const result = ipcMain._handlers["get-available-models"]!();
    // [20260726_Tier3_ModelHandlersMigrate] models is Record<string,unknown>;
    // cast to the known array shape the handler returns. Non-null index
    // access after the length assertion (suite convention).
    const models = result.models as unknown as Array<{ name: string }>;
    expect(models).toHaveLength(3);
    expect(models[0]!.name).toBe("paraformer-large");
    expect(models[1]!.name).toBe("fsmn-vad");
    expect(models[2]!.name).toBe("ct-transformer-punc");
  });

  it("get-current-model returns model status", async () => {
    const result = await ipcMain._handlers["get-current-model"]!();
    expect(result.model).toBe("paraformer-large");
    expect(result.status).toBe("ready");
  });

  it("switch-model returns failure (not supported)", () => {
    const result = ipcMain._handlers["switch-model"]!({}, "some-model");
    expect(result.success).toBe(false);
    expect(result.error).toContain("暂不支持切换");
  });
});
