// [20260726_Tier3_EnvironmentHandlersMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 4. Pattern: typed `createIpcMain` helper (handlers map
// needs an explicit Record<string, ...> index signature — TS7053), typed
// `const C: typeof import(...)` and `const envHandlers: typeof import(...)`
// for module-level requires (TS7005), and the installFunASR callback param
// `cb` gets an explicit structural type so `cb({ stage, percentage })` type-
// checks. The mock ipcMain/managers are cast to the source register() arg
// types via `as unknown as Parameters<...>`. Template reference:
// phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, vi } from "vitest";
// [20260726_Tier32_EnvironmentHandlers] Convert two CJS require() → ESM
// namespace imports. The `C.EVENTS.X` and `envHandlers.register(...)` call
// sites below unchanged.
import * as C from "../../src/helpers/ipc-contracts";
import * as envHandlers from "../../src/helpers/ipc/environmentHandlers";

// [20260726_Tier3_EnvironmentHandlersMigrate] Handler shape: ipcMain.handle
// registers `(event, ...args) => result` callbacks; tests invoke them with a
// mock event and read nothing from the return. Record<string, MockHandler>
// satisfies the TS7053 index-signature requirement.
type MockHandler = (...args: unknown[]) => unknown;

function createIpcMain() {
  const handlers: Record<string, MockHandler | undefined> = {};
  return {
    handle: vi.fn((channel: string, fn: MockHandler) => {
      handlers[channel] = fn;
    }),
    _handlers: handlers,
  };
}

// [20260726_Tier3_EnvironmentHandlersMigrate] installFunASR invokes the
// passed callback with a { stage, percentage } progress object; declare the
// shape here so the inline vi.fn mock stays type-safe.
interface InstallProgress {
  stage: string;
  percentage: number;
}

describe("environmentHandlers funasr-install-progress event", () => {
  it("forwards progress through C.EVENTS.FUNASR_INSTALL_PROGRESS constant", async () => {
    const ipcMain = createIpcMain();
    const sendSpy = vi.fn();
    const event = { sender: { send: sendSpy } };

    const managers = {
      environmentManager: {
        exportConfig: vi.fn(),
        validateEnvironment: vi.fn(),
      },
      funasrManager: {
        checkPythonInstallation: vi.fn(),
        installPython: vi.fn(),
        checkFunASRInstallation: vi.fn(),
        checkStatus: vi.fn(() => Promise.resolve({})),
        modelsInitialized: false,
        serverReady: false,
        initializationPromise: null,
        installFunASR: vi.fn(async (cb: (p: InstallProgress) => void) => {
          cb({ stage: "downloading", percentage: 42 });
          return { success: true };
        }),
        restartServer: vi.fn(),
        findPythonExecutable: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };

    // [20260726_Tier3_EnvironmentHandlersMigrate] Cast the mock ipcMain and
    // stubbed managers to the source register() argument types — structurally
    // compatible with the subset the handler exercises. `unknown` bridge.
    envHandlers.register(
      ipcMain as unknown as Parameters<typeof envHandlers.register>[0],
      managers as unknown as Parameters<typeof envHandlers.register>[1],
    );
    await ipcMain._handlers[C.FUNASR.INSTALL]!(event);

    expect(sendSpy).toHaveBeenCalledWith(
      C.EVENTS.FUNASR_INSTALL_PROGRESS,
      expect.objectContaining({ stage: "downloading", percentage: 42 }),
    );
  });

  it("source uses constant, not string literal", async () => {
    const fs = await import("fs");
    // [20260724_TS_BigBang_TestFix] Read .ts source (post-migration).
    const source = fs.readFileSync(
      new URL("../../src/helpers/ipc/environmentHandlers.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("C.EVENTS.FUNASR_INSTALL_PROGRESS");
    const sendLines = source
      .split("\n")
      .filter((l) => l.includes("event.sender.send"));
    for (const line of sendLines) {
      expect(line).not.toContain('"funasr-install-progress"');
    }
  });
});
