// [20260911_Fix_339_DockActivate] Regression tests for issue #339: on macOS
// the custom close button hides the main window (close_behavior defaults to
// "hide" — tray-resident design), but the app.on("activate") handler only
// recreated the window when getAllWindows() was empty. A HIDDEN window still
// counts, so Dock clicks did nothing and the app looked force-quit-only dead.
//
// The contract under test, in main.ts app lifecycle handlers:
//   1. activate with an existing (hidden) main window → showMainWindow()
//      is called so the window reappears.
//   2. activate with zero windows → createMainWindow() recreates the window
//      AND trayManager.setWindows() is refreshed with the new window (the
//      tray captured the original window reference once at startup; without
//      the re-sync every tray show/click no-ops on the destroyed reference).
//   3. activate, window-all-closed and will-quit all log through the shared
//      LogManager so the lifecycle is observable in app.log (issue #339
//      notes the path was previously invisible).
//
// Harness mirrors main-boot-order.test.ts: every helper module main.ts
// imports is mocked to spies; electron's app.on registrations are captured
// into a handler map the tests invoke directly. whenReady is left pending —
// the lifecycle handlers under test are registered at module top level, no
// boot needed.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  type AppEventHandler = (...args: unknown[]) => unknown;
  const appOnHandlers: Record<string, AppEventHandler> = {};
  const hiddenWindow = {
    on: vi.fn(),
    isDestroyed: vi.fn(() => false),
    show: vi.fn(),
    focus: vi.fn(),
  };
  return {
    appOnHandlers,
    hiddenWindow,
    allWindows: [] as unknown[],
    loggerInfo: vi.fn(),
    // [20260912_Feat_260_SingleInstance] Ticket #260 (Spec #258): lock
    // acquisition knob + handles for the init calls a second instance must
    // NEVER reach (SQLite open, IPC handler registration).
    hasSingleInstanceLock: true,
    dbInitialize: vi.fn(),
    registerIPCHandlers: vi.fn(),
    windowManager: {
      mainWindow: null as unknown,
      _setupCSP: vi.fn(),
      setDefaultAlwaysOnTop: vi.fn(),
      createMainWindow: vi.fn(),
      loadMainWindowContent: vi.fn(async () => undefined),
      showMainWindow: vi.fn(),
    },
    trayManager: {
      setWindows: vi.fn(),
      createTray: vi.fn(async () => undefined),
    },
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/murmur-lifecycle-test"),
    getVersion: vi.fn(() => "0.0.0-test"),
    // Pending forever: startApp never runs; the tests only need the
    // top-level app.on(...) registrations.
    whenReady: vi.fn(() => new Promise<void>(() => {})),
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      h.appOnHandlers[event] = handler;
    }),
    // [20260912_Feat_260_SingleInstance] Lock acquisition is knob-driven so
    // tests can play both the first and the second instance.
    requestSingleInstanceLock: vi.fn(() => h.hasSingleInstanceLock),
    quit: vi.fn(),
    exit: vi.fn(),
    disableHardwareAcceleration: vi.fn(),
    dock: { show: vi.fn(async () => {}) },
  },
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false),
  },
  BrowserWindow: class {
    static getAllWindows() {
      return h.allWindows;
    }
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    handleOnce: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

vi.mock("../../src/helpers/logManager", () => ({
  default: class {
    info = h.loggerInfo;
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
    getSystemInfo = vi.fn(() => ({}));
  },
}));

vi.mock("../../src/helpers/environment", () => ({
  default: class {
    ensureDataDirectory = vi.fn(() => "/tmp/murmur-lifecycle-test");
  },
}));

vi.mock("../../src/helpers/windowManager", () => ({
  default: class {
    mainWindow = h.windowManager.mainWindow;
    _setupCSP = h.windowManager._setupCSP;
    setDefaultAlwaysOnTop = h.windowManager.setDefaultAlwaysOnTop;
    createMainWindow = h.windowManager.createMainWindow;
    loadMainWindowContent = h.windowManager.loadMainWindowContent;
    showMainWindow = h.windowManager.showMainWindow;
  },
}));

vi.mock("../../src/helpers/database", () => ({
  default: class {
    initialize = h.dbInitialize;
    setFileConfigPath = vi.fn();
    getSetting = vi.fn(() => undefined);
    setSafeStorage = vi.fn();
    close = vi.fn();
  },
}));

vi.mock("../../src/helpers/clipboard", () => ({
  default: class {},
}));

vi.mock("../../src/helpers/funasrManager", () => ({
  default: class {
    initializeAtStartup = vi.fn(async () => undefined);
    gracefulShutdown = vi.fn(async () => undefined);
  },
}));

vi.mock("../../src/helpers/tray", () => ({
  default: class {
    setWindows = h.trayManager.setWindows;
    createTray = h.trayManager.createTray;
  },
}));

vi.mock("../../src/helpers/hotkeyManager", () => ({
  default: class {},
}));

vi.mock("../../src/helpers/ipc", () => ({
  registerAll: h.registerIPCHandlers,
}));

async function importMain(): Promise<void> {
  await import("../../main");
}

describe("[20260911_Fix_339_DockActivate] main.ts lifecycle handlers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of Object.keys(h.appOnHandlers)) {
      delete h.appOnHandlers[key];
    }
    h.allWindows = [];
    h.windowManager.mainWindow = null;
  });

  it("activate with an existing hidden main window shows it instead of recreating", async () => {
    h.allWindows = [h.hiddenWindow];
    h.windowManager.mainWindow = h.hiddenWindow;
    h.windowManager.createMainWindow.mockResolvedValue(h.hiddenWindow);

    await importMain();
    h.appOnHandlers["activate"]!();

    expect(h.windowManager.showMainWindow).toHaveBeenCalledTimes(1);
    expect(h.windowManager.createMainWindow).not.toHaveBeenCalled();
  });

  it("activate with zero windows recreates the main window and re-syncs the tray reference", async () => {
    h.allWindows = [];
    h.windowManager.createMainWindow.mockResolvedValue(h.hiddenWindow);

    await importMain();
    h.appOnHandlers["activate"]!();
    // createMainWindow is async; the tray re-sync happens after it resolves.
    await vi.waitFor(() =>
      expect(h.trayManager.setWindows).toHaveBeenCalledWith(h.hiddenWindow),
    );

    expect(h.windowManager.createMainWindow).toHaveBeenCalledTimes(1);
    expect(h.windowManager.showMainWindow).not.toHaveBeenCalled();
  });

  it("activate logs through the shared logger so the Dock path is observable", async () => {
    h.allWindows = [h.hiddenWindow];
    h.windowManager.mainWindow = h.hiddenWindow;

    await importMain();
    h.appOnHandlers["activate"]!();

    expect(h.loggerInfo).toHaveBeenCalled();
  });

  it("window-all-closed is wired and logged; on macOS it does not quit (tray-resident)", async () => {
    await importMain();
    const handler = h.appOnHandlers["window-all-closed"];
    expect(typeof handler).toBe("function");

    const electron = await import("electron");
    handler!();

    expect(h.loggerInfo).toHaveBeenCalled();
    if (process.platform === "darwin") {
      expect(electron.app.quit).not.toHaveBeenCalled();
    } else {
      expect(electron.app.quit).toHaveBeenCalled();
    }
  });
});

// ── [20260912_Feat_260_SingleInstance] Ticket #260 (Spec #258 Phase 0) ────
// Contracts:
//   1. A second instance (requestSingleInstanceLock === false) hard-exits
//      with a NON-ZERO code BEFORE any manager/database/IPC init — the
//      whole defect is double-open contention on the FunASR subprocess and
//      SQLite, so module top-level init must never run in that process.
//   2. The first instance registers a second-instance handler whose ONLY
//      job is window awakening: existing window → showMainWindow(); zero
//      windows → createMainWindow() + tray re-sync (same contract as the
//      Dock activate path).
//   3. Normal single-instance startup is untouched (the preceding suite
//      stays green with the lock acquired).
describe("[20260912_Feat_260_SingleInstance] main.ts single-instance lock", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of Object.keys(h.appOnHandlers)) {
      delete h.appOnHandlers[key];
    }
    h.allWindows = [];
    h.windowManager.mainWindow = null;
    h.hasSingleInstanceLock = true;
  });

  it("requests the single-instance lock exactly once at the application entry", async () => {
    const electron = await import("electron");
    await importMain();

    expect(electron.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
  });

  it("second instance hard-exits non-zero BEFORE opening the database or registering IPC", async () => {
    h.hasSingleInstanceLock = false;
    // process.exit must actually stop the module: simulate it with a throw
    // so the top-level init below the lock check is proven unreachable.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`PROCESS_EXIT:${code}`);
    }) as never);
    // Restore even on assertion failure — a leaked throwing process.exit
    // would cascade confusingly into the following tests.
    try {
      await expect(importMain()).rejects.toThrow("PROCESS_EXIT:1");
      expect(exitSpy).toHaveBeenCalledWith(1);
      // The contention this ticket removes: a second instance must not open
      // SQLite, register IPC handlers, or start the FunASR subprocess chain.
      expect(h.dbInitialize).not.toHaveBeenCalled();
      expect(h.registerIPCHandlers).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  // [20260912_Feat_260_SingleInstance] The one-directional contract made
  // explicit: Electron delivers (event, argv, workingDirectory) on
  // second-instance; the handler must IGNORE them (no CLI routing, no quit)
  // and only awaken the window.
  it("second-instance event with an existing window shows it instead of recreating", async () => {
    h.allWindows = [h.hiddenWindow];
    h.windowManager.mainWindow = h.hiddenWindow;
    const electron = await import("electron");

    await importMain();
    const handler = h.appOnHandlers["second-instance"];
    expect(typeof handler).toBe("function");
    handler!(
      {} as unknown,
      ["/fake/argv/second-launch"] as unknown as string[],
    );

    expect(h.windowManager.showMainWindow).toHaveBeenCalledTimes(1);
    expect(h.windowManager.createMainWindow).not.toHaveBeenCalled();
    expect(electron.app.quit).not.toHaveBeenCalled();
  });

  it("second-instance event with zero windows recreates the window and re-syncs the tray", async () => {
    h.allWindows = [];
    h.windowManager.createMainWindow.mockResolvedValue(h.hiddenWindow);

    await importMain();
    h.appOnHandlers["second-instance"]!();
    await vi.waitFor(() =>
      expect(h.trayManager.setWindows).toHaveBeenCalledWith(h.hiddenWindow),
    );

    expect(h.windowManager.createMainWindow).toHaveBeenCalledTimes(1);
    expect(h.windowManager.showMainWindow).not.toHaveBeenCalled();
  });
});
