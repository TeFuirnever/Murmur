// [20260726_Tier3_IpcRateLimitIntegrationMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 5 (final electron-mock batch). Pattern: type the
// createIpcMain helper's `handlers` map (TS7053 — `{}` has no index
// signature) and return shape so `ipcMain._handlers[channel]` access and
// invocation type-check. The handler return is widened to `Promise<unknown>`
// because rate-limited handlers return success/error objects while others
// return bare objects — `unknown` lets `result.success`/`result.error` reads
// happen via a narrow per-call cast at the assertion sites. Template
// reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

// [20260726_Tier3_IpcRateLimitIntegrationMigrate] Handler shape: registerAll
// routes through a rate-limiting wrapper, so handlers may be the original
// fn OR a rate-limited wrapper. Both accept (event, ...args) and return
// either a bare object or a Promise of one. Widening to
// (...args) => unknown lets every call site work without `any`.
type IpcHandler = (...args: unknown[]) => unknown;

interface MockIpcMain {
  handle: (channel: string, handler: IpcHandler) => void;
  _handlers: Record<string, IpcHandler | undefined>;
}

describe("IPC rate limit integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // [20260726_Tier3_IpcRateLimitIntegrationMigrate] handlers map typed as
  // Record<string, IpcHandler | undefined> so the `handlers[channel] = fn`
  // index write (TS7053) and the `_handlers[channel]` index reads both
  // type-check.
  function createIpcMain(): MockIpcMain {
    const handlers: Record<string, IpcHandler | undefined> = {};
    return {
      handle: vi.fn((channel: string, fn: IpcHandler) => {
        handlers[channel] = fn;
      }),
      _handlers: handlers,
    };
  }

  // [20260726_Tier3_IpcRateLimitIntegrationMigrate] Managers bag: each
  // handler module narrows this to its own Managers interface via the source's
  // asManagers<T>() cast helper. Here we provide a broad stub matching the
  // surface the rate-limited channels (process-text / download-models /
  // check-funasr-status) actually touch. The return type is widened so vi.fn
  // mocks with varying resolved shapes assign without complaint.
  function createManagers() {
    return {
      environmentManager: {
        exportConfig: vi.fn(),
        validateEnvironment: vi.fn(),
      },
      funasrManager: {
        checkPythonInstallation: vi.fn(),
        installPython: vi.fn(),
        checkFunASRInstallation: vi.fn(),
        checkStatus: vi.fn(async () => ({ server_running: true })),
        modelsInitialized: false,
        serverReady: false,
        initializationPromise: null,
        installFunASR: vi.fn(),
        restartServer: vi.fn(),
        findPythonExecutable: vi.fn(async () => "python3"),
        downloadModels: vi.fn(async () => ({ success: true })),
        modelManager: {
          downloadModels: vi.fn(async () => ({ success: true })),
        },
      },
      databaseManager: {
        getSetting: vi.fn(async () => null),
        setSetting: vi.fn(() => true),
        getAllSettings: vi.fn(() => ({})),
        resetSettings: vi.fn(() => true),
        saveTranscription: vi.fn(() => ({ lastInsertRowid: 1 })),
        syncToFileConfig: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      windowManager: {
        mainWindow: {
          isDestroyed: vi.fn(() => false),
          webContents: { send: vi.fn() },
        },
      },
      templatesDir: "/tmp/test-templates",
    };
  }

  it("rate-limits process-text channel", async () => {
    const registerAll: typeof import("../../src/helpers/ipc/index").registerAll =
      require("../../src/helpers/ipc/index").registerAll;
    const ipcMain = createIpcMain();
    registerAll(
      ipcMain as unknown as Parameters<typeof registerAll>[0],
      createManagers() as unknown as Parameters<typeof registerAll>[1],
    );

    const handler = ipcMain._handlers["process-text"];
    expect(handler).toBeDefined();

    // [20260726_Tier3_IpcRateLimitIntegrationMigrate] handler is
    // IpcHandler | undefined; non-null after the toBeDefined() assertion
    // above. Cast the awaited result to a narrow { success, error? } shape
    // for the assertion — the rate-limited wrapper returns exactly that.
    let rateLimited = false;
    for (let i = 0; i < 25; i++) {
      const result = (await handler!({}, "test", "optimize")) as {
        success?: boolean;
        error?: string;
      };
      if (result.success === false && result.error?.match(/rate/i)) {
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });

  it("rate-limits download-models with strict limit", async () => {
    const registerAll: typeof import("../../src/helpers/ipc/index").registerAll =
      require("../../src/helpers/ipc/index").registerAll;
    const ipcMain = createIpcMain();
    registerAll(
      ipcMain as unknown as Parameters<typeof registerAll>[0],
      createManagers() as unknown as Parameters<typeof registerAll>[1],
    );

    const handler = ipcMain._handlers["download-models"];
    expect(handler).toBeDefined();

    // Should be limited to 3 calls per 5 minutes
    await handler!({}, vi.fn());
    await handler!({}, vi.fn());
    await handler!({}, vi.fn());
    const result = (await handler!({}, vi.fn())) as {
      success: boolean;
      error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate/i);
  });

  it("does not rate-limit unrestricted channels", async () => {
    const registerAll: typeof import("../../src/helpers/ipc/index").registerAll =
      require("../../src/helpers/ipc/index").registerAll;
    const ipcMain = createIpcMain();
    registerAll(
      ipcMain as unknown as Parameters<typeof registerAll>[0],
      createManagers() as unknown as Parameters<typeof registerAll>[1],
    );

    const handler = ipcMain._handlers["check-funasr-status"];
    expect(handler).toBeDefined();

    // Call many times — should never be rate limited
    for (let i = 0; i < 50; i++) {
      const result = (await handler!()) as { success: boolean };
      expect(result.success).toBe(true);
    }
  });
});
