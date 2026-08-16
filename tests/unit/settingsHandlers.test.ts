// [20260726_Tier3_SettingsHandlersMigrate] Migrated from .js to .ts as part
// of Tier 3 batch 3. Pattern: same as modelHandlers.test.ts — type the
// createMockIpcMain helper's `handlers` map (TS7053) and return shape, type
// the `let ipcMain`/`let managers`/`let register` bindings (TS7034), and cast
// the mock args to register()'s source signature at the call site. The
// handler return type is Record<string, unknown> so result.ai_api_key etc.
// read without `any`. Template reference: phase4-i18n.test.ts (commit d52f2e0).
//
// [20260726_Tier32_SettingsHandlers] Tier 3.2: converted cargo-cult require()
// + vi.resetModules() to top-level ESM import. No vi.mock() was used; shim
// existed only to load the .ts source. beforeEach retains mock ipcMain /
// managers setup and register() call.
// [20260726_Tier32_SettingsHandlers] END
import { describe, it, expect, vi, beforeEach } from "vitest";
import { register } from "../../src/helpers/ipc/settingsHandlers";

// [20260726_Tier3_SettingsHandlersMigrate] Handler shape: ipcMain.handle
// registers `(event, ...args) => result` callbacks. Tests invoke them with
// varied args and read result properties, so the return is
// Record<string, unknown> and args are unknown[].
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

// [20260726_Tier3_SettingsHandlersMigrate] Stubbed managers surface: only the
// databaseManager methods + logger the registered handlers exercise.
interface MockManagers {
  databaseManager: {
    getSetting: (key: string, defaultValue?: unknown) => unknown;
    setSetting: (key: string, value: unknown) => boolean;
    getAllSettings: () => Record<string, unknown>;
    resetSettings: () => boolean;
    syncToFileConfig: () => void;
  };
  logger: { error: (...args: unknown[]) => void };
}

describe("settingsHandlers", () => {
  let ipcMain: MockIpcMain;
  let managers: MockManagers;

  beforeEach(() => {
    ipcMain = createMockIpcMain();

    managers = {
      databaseManager: {
        getSetting: vi.fn(
          (key: string, defaultValue?: unknown) =>
            (defaultValue ?? false) || "value-" + key,
        ),
        setSetting: vi.fn(() => true),
        getAllSettings: vi.fn(() => ({
          ai_api_key: "sk-test-12345678",
          ai_base_url: "https://api.openai.com/v1",
          ai_model: "gpt-3.5-turbo",
        })),
        resetSettings: vi.fn(() => true),
        syncToFileConfig: vi.fn(),
      },
      logger: { error: vi.fn() },
    };

    // [20260726_Tier3_SettingsHandlersMigrate] Cast the mock ipcMain/managers
    // to the source register() signature: structurally compatible with the
    // subset of Electron.IpcMain / Managers the handler uses. `unknown` bridge.
    register(
      ipcMain as unknown as Parameters<typeof register>[0],
      managers as unknown as Parameters<typeof register>[1],
    );
  });

  it("registers all settings handlers", () => {
    expect(ipcMain._handlers["get-setting"]).toBeDefined();
    expect(ipcMain._handlers["set-setting"]).toBeDefined();
    expect(ipcMain._handlers["get-all-settings"]).toBeDefined();
    expect(ipcMain._handlers["save-setting"]).toBeDefined();
    expect(ipcMain._handlers["reset-settings"]).toBeDefined();
  });

  it("get-setting delegates to databaseManager", () => {
    // [20260726_Tier3_SettingsHandlersMigrate] Non-null handler after the
    // prior toBeDefined() assertions above (suite convention).
    ipcMain._handlers["get-setting"]!({}, "test-key", "default");
    expect(managers.databaseManager.getSetting).toHaveBeenCalledWith(
      "test-key",
      "default",
    );
  });

  it("set-setting delegates to databaseManager", () => {
    ipcMain._handlers["set-setting"]!({}, "theme", "dark");
    expect(managers.databaseManager.setSetting).toHaveBeenCalledWith(
      "theme",
      "dark",
    );
  });

  it("get-all-settings masks API key", () => {
    const result = ipcMain._handlers["get-all-settings"]!();
    expect(result.ai_api_key).toBe("****5678");
    expect(result.ai_base_url).toBe("https://api.openai.com/v1");
  });

  // [20260816_Refactor_DeadChannels] legacy get-settings masking test removed.

  it("save-setting delegates to databaseManager.setSetting", () => {
    ipcMain._handlers["save-setting"]!({}, "auto_paste", "clipboard_only");
    expect(managers.databaseManager.setSetting).toHaveBeenCalledWith(
      "auto_paste",
      "clipboard_only",
    );
  });

  it("reset-settings delegates to databaseManager", () => {
    ipcMain._handlers["reset-settings"]!();
    expect(managers.databaseManager.resetSettings).toHaveBeenCalled();
  });
});
