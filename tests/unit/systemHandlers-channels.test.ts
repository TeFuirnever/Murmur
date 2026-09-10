// [20260726_Tier3_SystemHandlersChannelsMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 4. Pattern: typed `createIpcMain` helper with an
// explicit `Record<string, MockHandler>` index signature (TS7053) and typed
// `const C`/`const sysHandlers` via `typeof import("...")` (TS7005). The
// mock ipcMain/managers are cast to the source register() argument types via
// `as unknown as Parameters<...>`. Template reference: phase4-i18n.test.ts
// (commit d52f2e0).
import { describe, it, expect, vi, beforeEach } from "vitest";
// [20260726_Tier32_SystemHandlersChannels] Convert two CJS require() → ESM
// namespace imports.
import * as C from "../../src/helpers/ipc-contracts";
import * as sysHandlers from "../../src/helpers/ipc/systemHandlers";

// [20260906_Spec259_T3] Electron module mock so the behavioral section below
// can assert shell.openExternal calls and a stubbed app.getVersion without
// booting Electron.
vi.mock("electron", () => ({
  app: { getVersion: vi.fn(() => "9.9.9-test") },
  shell: { openExternal: vi.fn() },
}));

// [20260726_Tier3_SystemHandlersChannelsMigrate] Handler shape: ipcMain.handle
// registers `(event, ...args) => result` callbacks. The suite only asserts
// handler presence, so the return is `unknown`.
type MockHandler = (...args: unknown[]) => unknown;

function createIpcMain() {
  const handlers: Record<string, MockHandler | undefined> = {};
  return {
    handle: vi.fn((channel: string, fn: MockHandler) => {
      if (handlers[channel]) {
        throw new Error(`Duplicate handler registration for ${channel}`);
      }
      handlers[channel] = fn;
    }),
    _handlers: handlers,
  };
}

describe("systemHandlers channel registration", () => {
  it("registers LOG exactly once and does not register removed orphan channels", () => {
    const ipcMain = createIpcMain();
    const managers = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        getRecentLogs: vi.fn(),
        getFunASRLogs: vi.fn(),
        getLogFilePath: vi.fn(() => "/tmp/app.log"),
        getFunASRLogFilePath: vi.fn(() => "/tmp/funasr.log"),
        getSystemInfo: vi.fn(),
      },
      funasrManager: {
        isInitialized: false,
        modelsInitialized: false,
        serverReady: false,
        pythonCmd: "python3",
      },
      clipboardManager: {
        checkAccessibilityPermissions: vi.fn(() => Promise.resolve(true)),
        openSystemSettings: vi.fn(),
        pasteText: vi.fn(),
      },
    };

    // [20260726_Tier3_SystemHandlersChannelsMigrate] Cast the mock ipcMain
    // and stubbed managers to the source register() arg types via the
    // unknown bridge — structurally compatible with the exercised subset.
    sysHandlers.register(
      ipcMain as unknown as Parameters<typeof sysHandlers.register>[0],
      managers as unknown as Parameters<typeof sysHandlers.register>[1],
    );

    const channels = Object.keys(ipcMain._handlers);
    const logHits = channels.filter((c) => c === C.SYSTEM.LOG);
    expect(logHits.length).toBe(1);
    // The removed orphan channels must not appear as live handlers
    expect(channels).not.toContain("log-message");
    expect(channels).not.toContain("get-debug-info");
    expect(channels).not.toContain("report-error");
  });
});

// ======================================================================
// [20260906_Spec259_T3] Behavioral section: the three surviving handlers
// (OPEN_EXTERNAL / VERSION / LOG) invoked through the captured handlers —
// Spec #259 T3 (#275). External behavior only: return shapes plus
// shell/app/logger boundary calls.
// ======================================================================
describe("systemHandlers behavior", () => {
  type MockHandler = (...args: unknown[]) => unknown;

  // The electron mock module (and its shell.openExternal call record) is
  // shared file-wide — clear call history before each behavioral test.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupBehavior() {
    const handlers: Record<string, MockHandler | undefined> = {};
    const ipcMain = {
      handle: vi.fn((channel: string, fn: MockHandler) => {
        handlers[channel] = fn;
      }),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    sysHandlers.register(
      ipcMain as unknown as Parameters<typeof sysHandlers.register>[0],
      { logger } as unknown as Parameters<typeof sysHandlers.register>[1],
    );
    return { handlers, logger };
  }

  describe("SYSTEM.OPEN_EXTERNAL", () => {
    it("opens an https URL via shell.openExternal", async () => {
      const { shell } = await import("electron");
      const { handlers } = setupBehavior();
      const result = (await handlers[C.SYSTEM.OPEN_EXTERNAL]!(
        {},
        "https://example.com/page",
      )) as Record<string, unknown>;
      expect(result).toEqual({ success: true });
      expect(vi.mocked(shell.openExternal)).toHaveBeenCalledWith(
        "https://example.com/page",
      );
    });

    it.each([[""], [123], ["http://example.com"], ["ftp://example.com"]])(
      "blocks %s with a warning and no shell call",
      async (url) => {
        const { shell } = await import("electron");
        const { handlers, logger } = setupBehavior();
        const result = (await handlers[C.SYSTEM.OPEN_EXTERNAL]!(
          {},
          url,
        )) as Record<string, unknown>;
        expect(result).toEqual({
          success: false,
          error: "只允许打开HTTPS链接",
        });
        expect(logger.warn).toHaveBeenCalledWith("阻止打开非HTTPS链接:", url);
        expect(vi.mocked(shell.openExternal)).not.toHaveBeenCalled();
      },
    );
  });

  describe("SYSTEM.VERSION", () => {
    it("returns app.getVersion()", async () => {
      const { handlers } = setupBehavior();
      const result = await handlers[C.SYSTEM.VERSION]!();
      expect(result).toBe("9.9.9-test");
    });
  });

  describe("SYSTEM.LOG", () => {
    it("dispatches to the requested logger level with a renderer prefix", async () => {
      const { handlers, logger } = setupBehavior();
      const payload = { stack: "…" };
      const result = await handlers[C.SYSTEM.LOG]!(
        {},
        "warn",
        "渲染进程崩溃",
        payload,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "[渲染进程] 渲染进程崩溃",
        payload,
      );
      expect(result).toBe(true);
    });

    it("passes empty data as an empty string", async () => {
      const { handlers, logger } = setupBehavior();
      await handlers[C.SYSTEM.LOG]!({}, "info", "无附言", null);
      expect(logger.info).toHaveBeenCalledWith("[渲染进程] 无附言", "");
    });

    it("is a no-op for an unknown log level and still returns true", async () => {
      const { handlers } = setupBehavior();
      const result = await handlers[C.SYSTEM.LOG]!(
        {},
        "verbose",
        "没有这个级别",
        { a: 1 },
      );
      expect(result).toBe(true);
    });

    // [20260910_Fix_LogHandlerThisBinding] Regression: the handler used to
    // invoke the looked-up method detached (`fn?.(...)`), so any logger
    // whose methods rely on `this` (the real LogManager) threw
    // "Cannot read properties of undefined (reading 'log')" — and the
    // renderer's unhandledrejection logger turned that into an infinite
    // IPC flood. vi.fn() mocks above can't see `this`; a stateful class
    // can.
    it("invokes the logger method bound to the logger instance", async () => {
      class StatefulLogger {
        calls: string[] = [];
        info(message: string) {
          this.calls.push(`info:${message}`);
        }
        warn(message: string) {
          this.calls.push(`warn:${message}`);
        }
        error(message: string) {
          this.calls.push(`error:${message}`);
        }
      }
      const handlers: Record<string, MockHandler | undefined> = {};
      const ipcMain = {
        handle: vi.fn((channel: string, fn: MockHandler) => {
          handlers[channel] = fn;
        }),
      };
      const statefulLogger = new StatefulLogger();
      sysHandlers.register(
        ipcMain as unknown as Parameters<typeof sysHandlers.register>[0],
        { logger: statefulLogger } as unknown as Parameters<
          typeof sysHandlers.register
        >[1],
      );
      const result = await handlers[C.SYSTEM.LOG]!({}, "error", "崩了", null);
      expect(result).toBe(true);
      expect(statefulLogger.calls).toEqual(["error:[渲染进程] 崩了"]);
    });
    // [20260910_Fix_LogHandlerThisBinding] END
  });
});
