// [20260726_Tier3_RegressionSessionFixesMigrate] Migrated from .js to .ts as
// the FINAL Tier 3 migration (54/54). Pattern: same as batch 5 (vi.mock +
// typeof import + Surface interfaces for private access). Template reference:
// phase4-i18n.test.ts (commit d52f2e0).
//
// [20260726_Tier3_RegressionSessionFixesMigrate] Migration strategy: this file
// reuses every pattern the earlier batches established —
//   - `vi.mock("electron", () => ({ app: { getPath: vi.fn(...) } }))` inline
//     factory (ipcRateLimitIntegration / aiHandlers).
//   - `createIpcMain()` helper returns a `MockIpcMain` whose `_handlers` map is
//     `Record<string, MockHandler | undefined>` so the index write inside
//     handle() and the index reads at invocation sites both type-check
//     (TS7053) — same as modelHandlers / ipcRateLimitIntegration.
//   - `MockHandler` returns `Record<string, unknown>` so `result.success` /
//     `result.error` / `result.id` reads work without per-site casts; `await`
//     on the (runtime-async, type-sync) return unwraps the Promise safely
//     (modelHandlers convention).
//   - Each `require()` binding is typed via `typeof import("...")` so the
//     imported names infer their source signatures (TS7005/TS7034).
//   - `register(ipcMain as unknown as Parameters<typeof register>[0], managers
//     as unknown as Parameters<typeof register>[1])` bridges the mock stubs to
//     the source signature without `any` (modelHandlers convention).
//   - `FunASRSurface` interface + `fsurf()` cast helper expose the private
//     `pythonEnv` / `modelManager` fields the downloadModels regression pokes
//     directly, mirroring the `dbp()` helper in database-coverage.
//   - `! ` non-null after `toBeDefined()` / `toHaveBeenCalled()` guards.
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

// [20260726_Tier32_RegressionSessionFixes] Convert 30 require() sites +
// 7 vi.resetModules() calls to top-level ESM imports. The single vi.mock
// above is hoisted by vitest and applies to every import of every source
// module across all 10 describe blocks; no describe changes a mock factory
// between tests, so per-test module isolation was never needed. The require
// shim (_tsresolve.setup) was only needed to load .ts source.
//
// Conversion approach (minimal diff to test bodies):
//   - namespace-import each source module at top level
//   - for direct-use sites (C, envHandlers, FunASRManager, os): delete the
//     local require line; the namespace import already provides the name
//   - for destructure sites ({ register }, { buildPrompt }, { processTextWithAI }):
//     replace the require() RHS with the namespace variable and drop the
//     `typeof import(...)` annotation (TS now infers from the typed namespace)
import * as C from "../../src/helpers/ipc-contracts";
import * as envHandlers from "../../src/helpers/ipc/environmentHandlers";
import * as transcriptionHandlers from "../../src/helpers/ipc/transcriptionHandlers";
import * as settingsHandlers from "../../src/helpers/ipc/settingsHandlers";
import * as aiPrompts from "../../src/helpers/aiPrompts";
import * as aiHandlers from "../../src/helpers/ipc/aiHandlers";
import FunASRManager from "../../src/helpers/funasrManager";
import os from "os";

// ---------------------------------------------------------------------------
// Regression tests for fixes from the 2026-05-22/23 session.
// Each test guards against a specific bug that was fixed.
// ---------------------------------------------------------------------------

// [20260726_Tier3_RegressionSessionFixesMigrate] Handler shape: ipcMain.handle
// registers `(event, ...args) => result` callbacks. Tests invoke them with
// varied args and read result properties (success/error/id/models_initialized/
// status_message/lastInsertRowid), so the return is Record<string, unknown>
// and args are unknown[] — the narrowest types that accept every call site
// without `any`. `await` on the (runtime-async) return unwraps safely.
type MockHandler = (...args: unknown[]) => Record<string, unknown>;

interface MockIpcMain {
  handle: (channel: string, handler: MockHandler) => void;
  _handlers: Record<string, MockHandler | undefined>;
}

// [20260726_Tier3_RegressionSessionFixesMigrate] handlers map typed as
// Record<string, MockHandler | undefined> so the `handlers[channel] = fn`
// index write (TS7053) and the `_handlers[channel]` index reads both
// type-check. Mirrors modelHandlers / ipcRateLimitIntegration.
function createIpcMain(): MockIpcMain {
  const handlers: Record<string, MockHandler | undefined> = {};
  return {
    handle: vi.fn((channel: string, fn: MockHandler) => {
      handlers[channel] = fn;
    }),
    _handlers: handlers,
  };
}

// [20260726_Tier3_RegressionSessionFixesMigrate] FunASRManager declares
// pythonEnv/modelManager private; the downloadModels regression overrides
// them directly to avoid real filesystem/electron calls. Surface interface +
// cast helper mirror the `dbp()` pattern in database-coverage.
type FunASRManagerInstance = InstanceType<
  typeof import("../../src/helpers/funasrManager").default
>;

interface FunASRSurface {
  pythonEnv: {
    findPythonExecutable: ReturnType<typeof vi.fn<() => Promise<string>>>;
    pythonCmd: string | null;
  };
  modelManager: {
    downloadModels: ReturnType<
      typeof vi.fn<
        (
          cb: ((progress: Record<string, unknown>) => void) | null,
          pythonCmd: string,
        ) => Promise<{ success: boolean }>
      >
    >;
  };
}

function fsurf(m: FunASRManagerInstance): FunASRSurface {
  return m as unknown as FunASRSurface;
}

// 1. FUNASR.STATUS spread order — success field computed AFTER spread
describe("FUNASR.STATUS spread order regression", () => {
  it("defaults to success:true when checkStatus returns no success field", async () => {
    const ipcMain = createIpcMain();

    const managers = {
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
        findPythonExecutable: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };

    envHandlers.register(
      ipcMain as unknown as Parameters<typeof envHandlers.register>[0],
      managers as unknown as Parameters<typeof envHandlers.register>[1],
    );
    const result = await ipcMain._handlers[C.FUNASR.STATUS]!();

    // Without the spread fix, this would be undefined (spread overrode it)
    expect(result.success).toBe(true);
    expect(result.models_initialized).toBe(false);
  });

  it("propagates success:false when checkStatus explicitly fails", async () => {
    const ipcMain = createIpcMain();

    const managers = {
      environmentManager: {
        exportConfig: vi.fn(),
        validateEnvironment: vi.fn(),
      },
      funasrManager: {
        checkPythonInstallation: vi.fn(),
        installPython: vi.fn(),
        checkFunASRInstallation: vi.fn(),
        checkStatus: vi.fn(async () => ({
          success: false,
          error: "something broke",
        })),
        modelsInitialized: false,
        serverReady: false,
        initializationPromise: null,
        installFunASR: vi.fn(),
        restartServer: vi.fn(),
        findPythonExecutable: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };

    envHandlers.register(
      ipcMain as unknown as Parameters<typeof envHandlers.register>[0],
      managers as unknown as Parameters<typeof envHandlers.register>[1],
    );
    const result = await ipcMain._handlers[C.FUNASR.STATUS]!();

    expect(result.success).toBe(false);
  });

  it("preserves success:true from checkStatus", async () => {
    const ipcMain = createIpcMain();

    const managers = {
      environmentManager: {
        exportConfig: vi.fn(),
        validateEnvironment: vi.fn(),
      },
      funasrManager: {
        checkPythonInstallation: vi.fn(),
        installPython: vi.fn(),
        checkFunASRInstallation: vi.fn(),
        checkStatus: vi.fn(async () => ({
          success: true,
          server_running: true,
        })),
        modelsInitialized: true,
        serverReady: true,
        initializationPromise: null,
        installFunASR: vi.fn(),
        restartServer: vi.fn(),
        findPythonExecutable: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };

    envHandlers.register(
      ipcMain as unknown as Parameters<typeof envHandlers.register>[0],
      managers as unknown as Parameters<typeof envHandlers.register>[1],
    );
    const result = await ipcMain._handlers[C.FUNASR.STATUS]!();

    expect(result.success).toBe(true);
    expect(result.models_initialized).toBe(true);
    expect(result.server_ready).toBe(true);
  });
});

// 7. FUNASR.STATUS includes user-friendly status_message
describe("FUNASR.STATUS status_message", () => {
  function createEnvManagers(overrides: Record<string, unknown> = {}) {
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
        findPythonExecutable: vi.fn(),
        ...overrides,
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };
  }

  it("includes status_message when server is ready", async () => {
    const ipcMain = createIpcMain();
    const managers = createEnvManagers({
      modelsInitialized: true,
      serverReady: true,
    });

    envHandlers.register(
      ipcMain as unknown as Parameters<typeof envHandlers.register>[0],
      managers as unknown as Parameters<typeof envHandlers.register>[1],
    );
    const result = await ipcMain._handlers[C.FUNASR.STATUS]!();

    expect(result.status_message).toBeDefined();
    expect(typeof result.status_message).toBe("string");
  });

  it("includes status_message when initializing", async () => {
    const ipcMain = createIpcMain();
    const managers = createEnvManagers({
      initializationPromise: Promise.resolve(),
    });

    envHandlers.register(
      ipcMain as unknown as Parameters<typeof envHandlers.register>[0],
      managers as unknown as Parameters<typeof envHandlers.register>[1],
    );
    const result = await ipcMain._handlers[C.FUNASR.STATUS]!();

    expect(result.status_message).toBeDefined();
    expect(result.is_initializing).toBe(true);
  });

  it("includes status_message when not ready", async () => {
    const ipcMain = createIpcMain();
    const managers = createEnvManagers();

    envHandlers.register(
      ipcMain as unknown as Parameters<typeof envHandlers.register>[0],
      managers as unknown as Parameters<typeof envHandlers.register>[1],
    );
    const result = await ipcMain._handlers[C.FUNASR.STATUS]!();

    expect(result.status_message).toBeDefined();
  });
});

// 2. TRANSCRIPTION.SAVE canonical return shape
describe("TRANSCRIPTION.SAVE return shape regression", () => {
  // [20260726_Tier32_RegressionSessionFixes] vi.resetModules() removed — the
  // hoisted vi.mock("electron") at the top of this file applies to every
  // import in every describe block, and no test in this describe changes a
  // mock factory between tests.

  it("returns {success:true} on successful save", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();

    const managers = {
      databaseManager: {
        saveTranscription: vi.fn(() => ({ lastInsertRowid: 42, changes: 1 })),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      processTextWithAI: vi.fn(),
    };

    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );
    const result = await ipcMain._handlers[C.TRANSCRIPTION.SAVE]!(
      {},
      { text: "hello", raw_text: "hello" },
    );

    expect(result.success).toBe(true);
    expect(result.lastInsertRowid).toBe(42);
  });

  it("returns {success:false, error} on failure", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();

    const managers = {
      databaseManager: {
        saveTranscription: vi.fn(() => {
          throw new Error("DB locked");
        }),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      processTextWithAI: vi.fn(),
    };

    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );
    const result = await ipcMain._handlers[C.TRANSCRIPTION.SAVE]!(
      {},
      { text: "hello", raw_text: "hello" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("DB locked");
  });
});

// 3. SETTINGS_UPDATE broadcast on save
describe("SETTINGS_UPDATE broadcast regression", () => {
  // [20260726_Tier32_RegressionSessionFixes] vi.resetModules() removed — the
  // hoisted vi.mock("electron") at the top of this file applies to every
  // import in every describe block, and no test in this describe changes a
  // mock factory between tests.

  function createManagers() {
    const sendSpy = vi.fn();
    return {
      managers: {
        databaseManager: {
          getSetting: vi.fn(() => "val"),
          setSetting: vi.fn(() => true),
          getAllSettings: vi.fn(() => ({})),
          resetSettings: vi.fn(() => true),
          syncToFileConfig: vi.fn(),
        },
        logger: { error: vi.fn() },
        windowManager: {
          mainWindow: {
            isDestroyed: vi.fn(() => false),
            webContents: { send: sendSpy },
          },
        },
      },
      sendSpy,
    };
  }

  it("sends SETTINGS_UPDATE event on save-setting", async () => {
    const { register } = settingsHandlers;
    const ipcMain = createIpcMain();
    const { managers, sendSpy } = createManagers();

    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );
    await ipcMain._handlers[C.SETTINGS.SAVE]!({}, "theme", "dark");

    expect(sendSpy).toHaveBeenCalledWith(
      C.EVENTS.SETTINGS_UPDATE,
      expect.objectContaining({ key: "theme" }),
    );
  });

  it("sends SETTINGS_UPDATE event on set-setting", async () => {
    const { register } = settingsHandlers;
    const ipcMain = createIpcMain();
    const { managers, sendSpy } = createManagers();

    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );
    await ipcMain._handlers[C.SETTINGS.SET]!({}, "theme", "dark");

    expect(sendSpy).toHaveBeenCalledWith(
      C.EVENTS.SETTINGS_UPDATE,
      expect.objectContaining({ key: "theme" }),
    );
  });

  it("sends SETTINGS_UPDATE event on reset-settings", async () => {
    const { register } = settingsHandlers;
    const ipcMain = createIpcMain();
    const { managers, sendSpy } = createManagers();

    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );
    await ipcMain._handlers[C.SETTINGS.RESET]!();

    expect(sendSpy).toHaveBeenCalledWith(
      C.EVENTS.SETTINGS_UPDATE,
      expect.objectContaining({ key: null }),
    );
  });
});

// 4. aiPrompts returns {system, user} structure
describe("aiPrompts system/user structure regression", () => {
  it("buildPrompt returns {system, user} for optimize mode", () => {
    const { buildPrompt } = aiPrompts;
    const result = buildPrompt("optimize", "测试文本");

    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
    expect(result.user).toContain("<transcript>");
    expect(result.user).toContain("测试文本");
  });

  it("buildPrompt returns {system, user} for optimize_long mode", () => {
    const { buildPrompt } = aiPrompts;
    const result = buildPrompt("optimize_long", "长文本测试");

    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
    expect(result.user).toContain("<transcript>");
  });

  it("buildPrompt falls back to optimize for unknown mode", () => {
    const { buildPrompt } = aiPrompts;
    const result = buildPrompt("unknown_mode", "文本");

    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
  });

  it("system prompt contains core rules", () => {
    const { buildPrompt } = aiPrompts;
    const { system } = buildPrompt("optimize", "文本");

    expect(system).toContain("绝对禁止");
    expect(system).toContain("输出要求");
  });
});

// 5. SSRF validation in processTextWithAI (not just checkAIStatus)
describe("processTextWithAI SSRF regression", () => {
  // [20260726_Tier32_RegressionSessionFixes] vi.resetModules() removed — the
  // hoisted vi.mock("electron") at the top of this file applies to every
  // import in every describe block, and no test in this describe changes a
  // mock factory between tests.

  it("rejects internal base URL in process flow", async () => {
    const { processTextWithAI } = aiHandlers;

    const db = {
      getSetting: vi.fn(async (key: string) => {
        if (key === "ai_api_key") return "sk-test";
        if (key === "ai_base_url") return "https://192.168.1.1/v1";
        if (key === "ai_model") return "gpt-3.5-turbo";
        return null;
      }),
    };
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const result = await processTextWithAI(
      "test",
      "optimize",
      db as unknown as Parameters<typeof processTextWithAI>[2],
      logger as unknown as Parameters<typeof processTextWithAI>[3],
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("https");
  });

  it("rejects http base URL in process flow", async () => {
    const { processTextWithAI } = aiHandlers;

    const db = {
      getSetting: vi.fn(async (key: string) => {
        if (key === "ai_api_key") return "sk-test";
        if (key === "ai_base_url") return "http://api.openai.com/v1";
        if (key === "ai_model") return "gpt-3.5-turbo";
        return null;
      }),
    };
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const result = await processTextWithAI(
      "test",
      "optimize",
      db as unknown as Parameters<typeof processTextWithAI>[2],
      logger as unknown as Parameters<typeof processTextWithAI>[3],
    );
    expect(result.success).toBe(false);
  });
});

// 6. downloadModels must call findPythonExecutable — not use stale pythonCmd
describe("downloadModels python path regression", () => {
  // [20260726_Tier32_RegressionSessionFixes] vi.resetModules() removed — the
  // hoisted vi.mock("electron") at the top of this file applies to every
  // import in every describe block, and no test in this describe changes a
  // mock factory between tests.

  function createManager(): FunASRManagerInstance {
    // [20260726_Tier32_RegressionSessionFixes] FunASRManager is now the
    // top-level default import; no per-test require needed.
    const mgr = new FunASRManager();
    // [20260726_Tier3_RegressionSessionFixesMigrate] Override internal methods
    // to avoid real filesystem/electron calls. pythonEnv/modelManager are
    // private in source; reach them via the FunASRSurface cast helper (mirrors
    // the dbp() pattern in database-coverage).
    const surf = fsurf(mgr);
    surf.pythonEnv.findPythonExecutable = vi.fn(
      async () => "/resolved/python3",
    );
    surf.modelManager.downloadModels = vi.fn(async () => ({ success: true }));
    return mgr;
  }

  it("calls findPythonExecutable before passing path to modelManager", async () => {
    const mgr = createManager();
    const surf = fsurf(mgr);
    // [20260726_Tier3_RegressionSessionFixesMigrate] Source downloadModels
    // requires a cb arg typed as `((progress) => void) | null`; passing null
    // is the canonical "no progress callback" value (the original .js called
    // with no args, which forwards undefined — functionally identical here
    // since modelManager.downloadModels defaults the cb to null internally).
    await mgr.downloadModels(null);

    expect(surf.pythonEnv.findPythonExecutable).toHaveBeenCalled();
    expect(surf.modelManager.downloadModels).toHaveBeenCalledWith(
      null,
      "/resolved/python3",
    );
  });

  it("does not fall back to hardcoded python3 when pythonCmd is null", async () => {
    const mgr = createManager();
    const surf = fsurf(mgr);
    surf.pythonEnv.pythonCmd = null;
    await mgr.downloadModels(null);

    // [20260726_Tier3_RegressionSessionFixesMigrate] mock.calls[0] is
    // [cb, pythonCmd]; non-null index after the call above. [1] is the
    // pythonCmd string passed through from findPythonExecutable.
    const passedCmd = surf.modelManager.downloadModels.mock.calls[0]![1];
    expect(passedCmd).not.toBe("python3");
    expect(passedCmd).toBe("/resolved/python3");
  });
});

// ---------------------------------------------------------------------------
// Regression tests for 2026-05-24 session bugs.
// BUG 0: request_id not passed to transcribe_file_audio → progress dropped
// BUG 1: allowedExts missing .ogg/.wma/.aac → file dialog allows but handler rejects
// BUG 3: path validation rejects /Volumes/ → external storage files blocked
// ---------------------------------------------------------------------------

describe("TRANSCRIBE_FILE allowed extensions regression", () => {
  // [20260726_Tier32_RegressionSessionFixes] vi.resetModules() removed — the
  // hoisted vi.mock("electron") at the top of this file applies to every
  // import in every describe block, and no test in this describe changes a
  // mock factory between tests.

  const mockManagers = () => ({
    funasrManager: {
      transcribeFile: vi.fn(async () => ({
        success: true,
        text: "test",
        segments: [],
        duration: 1,
      })),
    },
    databaseManager: {
      saveTranscription: vi.fn(() => ({ id: 1 })),
    },
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    processTextWithAI: vi.fn(),
  });

  const createEvent = () => ({
    sender: { send: vi.fn() },
  });

  it("accepts .ogg files (was rejected before BUG 1 fix)", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();
    const managers = mockManagers();
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );

    const result = await ipcMain._handlers[C.TRANSCRIPTION.TRANSCRIBE_FILE]!(
      createEvent(),
      `${os.homedir()}/test.ogg`,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts .wma files (was rejected before BUG 1 fix)", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();
    const managers = mockManagers();
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );

    const result = await ipcMain._handlers[C.TRANSCRIPTION.TRANSCRIBE_FILE]!(
      createEvent(),
      `${os.homedir()}/test.wma`,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts .aac files (was rejected before BUG 1 fix)", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();
    const managers = mockManagers();
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );

    const result = await ipcMain._handlers[C.TRANSCRIPTION.TRANSCRIBE_FILE]!(
      createEvent(),
      `${os.homedir()}/test.aac`,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("still rejects unsupported formats like .txt", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();
    const managers = mockManagers();
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );

    const result = await ipcMain._handlers[C.TRANSCRIPTION.TRANSCRIBE_FILE]!(
      createEvent(),
      "/Users/test/file.txt",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("不支持的音频格式");
  });
});

describe("TRANSCRIBE_FILE /Volumes/ path validation regression", () => {
  // [20260726_Tier32_RegressionSessionFixes] vi.resetModules() removed — the
  // hoisted vi.mock("electron") at the top of this file applies to every
  // import in every describe block, and no test in this describe changes a
  // mock factory between tests.

  it("accepts files from /Volumes/ (was rejected before BUG 3 fix)", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();
    const managers = {
      funasrManager: {
        transcribeFile: vi.fn(async () => ({
          success: true,
          text: "test",
          segments: [],
          duration: 1,
        })),
      },
      databaseManager: {
        saveTranscription: vi.fn(() => ({ id: 1 })),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      processTextWithAI: vi.fn(),
    };
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );

    const createEvent = () => ({ sender: { send: vi.fn() } });
    const result = await ipcMain._handlers[C.TRANSCRIPTION.TRANSCRIBE_FILE]!(
      createEvent(),
      "/Volumes/ExternalDisk/recordings/meeting.wav",
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("allows Windows drive paths like E:\\", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();
    const managers = {
      funasrManager: {
        transcribeFile: vi.fn(async () => ({ success: true, text: "x" })),
      },
      databaseManager: { saveTranscription: vi.fn() },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      processTextWithAI: vi.fn(),
    };
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );

    const createEvent = () => ({ sender: { send: vi.fn() } });
    const result = await ipcMain._handlers[C.TRANSCRIPTION.TRANSCRIBE_FILE]!(
      createEvent(),
      "E:\\Video\\Murmur\\audio\\test.wav",
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("still rejects paths outside homedir, tmpdir, and /Volumes/", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();
    const managers = {
      funasrManager: {
        transcribeFile: vi.fn(async () => ({ success: true, text: "x" })),
      },
      databaseManager: { saveTranscription: vi.fn() },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      processTextWithAI: vi.fn(),
    };
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );

    const createEvent = () => ({ sender: { send: vi.fn() } });
    const badPath =
      process.platform === "win32"
        ? "\\\\unc-server\\share\\file.wav"
        : "/opt/secret/file.wav";

    const result = await ipcMain._handlers[C.TRANSCRIPTION.TRANSCRIBE_FILE]!(
      createEvent(),
      badPath,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("路径不在允许范围内");
  });
});

// 6. TRANSCRIBE_FILE sets result.id from lastInsertRowid (not dbResult.id)
describe("TRANSCRIBE_FILE result.id regression", () => {
  // [20260726_Tier32_RegressionSessionFixes] vi.resetModules() removed — the
  // hoisted vi.mock("electron") at the top of this file applies to every
  // import in every describe block, and no test in this describe changes a
  // mock factory between tests.

  function createEvent() {
    return {
      sender: { send: vi.fn() },
    };
  }

  // [20260726_Tier3_RegressionSessionFixesMigrate] Return type widened with
  // an optional `funasrManager` so the test can attach a transcribeFile mock
  // after construction (the original .js mutated the object post-creation).
  // The whole object is later cast through `unknown` to register()'s
  // Managers signature, so the extra optional field is harmless.
  function createManagers(): {
    databaseManager: {
      saveTranscription: (...args: unknown[]) => {
        lastInsertRowid: number;
        changes: number;
      };
    };
    logger: { info: unknown; error: unknown; warn: unknown };
    processTextWithAI: (...args: unknown[]) => unknown;
    funasrManager?: {
      transcribeFile: (...args: unknown[]) => Promise<unknown>;
    };
  } {
    return {
      databaseManager: {
        saveTranscription: vi.fn(() => ({ lastInsertRowid: 99, changes: 1 })),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      processTextWithAI: vi.fn(),
    };
  }

  it("sets result.id from lastInsertRowid after successful transcription", async () => {
    const { register } = transcriptionHandlers;
    const ipcMain = createIpcMain();

    const managers = createManagers();
    managers.funasrManager = {
      transcribeFile: vi.fn(async () => ({
        success: true,
        text: "hello world",
        segments: [],
        duration: 5,
      })),
    };

    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );
    const result = await ipcMain._handlers[C.TRANSCRIPTION.TRANSCRIBE_FILE]!(
      createEvent(),
      "/Volumes/test.wav",
      {},
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe(99);
  });
});
