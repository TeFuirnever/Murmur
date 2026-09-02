// [20260820_Fix_211_KeychainBootOrder] Regression test for issue #211:
// safeStorage.isEncryptionAvailable() ran BEFORE window creation, so the
// macOS keychain authorization dialog (triggered on every upgrade because
// adhoc build identities change) popped over an app with NO visible
// window — users saw "clicked the icon, nothing happened" (and with the
// screen locked, an indefinite invisible hang; SIGTERM was not even
// processed).
//
// The contract under test, in main.ts whenReady → startApp:
//   1. windowManager.createMainWindow() runs FIRST (window visible)
//   2. databaseManager.setSafeStorage() runs AFTER the window exists —
//      this is the call whose keychain prompt may block indefinitely
//   3. windowManager.loadMainWindowContent() runs LAST, so the renderer
//      (and its encrypted-settings reads) never boots while crypto state
//      is still unresolved
// Plus: setSafeStorage must be invoked even when isEncryptionAvailable()
// is false, so downstream crypto state is always deterministically settled
// (the old code skipped the call entirely when unavailable).
//
// Harness: vi.hoisted shared state (pattern from windowManager-events and
// preload-bridge-contract tests). Every helper module main.ts imports is
// mocked down to a spy that records into `order`; electron's whenReady is
// a manually-resolved promise so the test controls the boot trigger.
// [20260820_Fix_211_KeychainBootOrder] END
import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeStorage as h_safeStorage } from "electron";

const h_isEncryptionAvailable = h_safeStorage.isEncryptionAvailable;

const h = vi.hoisted(() => {
  const order: string[] = [];
  let resolveReady: () => void = () => {};
  const whenReadyPromise = new Promise<void>((r) => {
    resolveReady = r;
  });
  // Code-review fixup: setSafeStorage must be able to THROW on demand so a
  // test can prove the renderer load is never skipped by a crypto failure.
  // Plain property — tests flip it directly (h.setSafeStorageThrows = true)
  // and the database mock reads it at call time.
  return { order, resolveReady, whenReadyPromise, setSafeStorageThrows: false };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/murmur-boot-order-test"),
    getVersion: vi.fn(() => "0.0.0-test"),
    whenReady: vi.fn(() => h.whenReadyPromise),
    on: vi.fn(),
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
      return [];
    }
    on() {
      return this;
    }
    loadURL() {
      return Promise.resolve();
    }
    loadFile() {
      return Promise.resolve();
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
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
    getSystemInfo = vi.fn(() => ({}));
  },
}));

vi.mock("../../src/helpers/environment", () => ({
  default: class {
    ensureDataDirectory = vi.fn(() => "/tmp/murmur-boot-order-test");
  },
}));

vi.mock("../../src/helpers/windowManager", () => ({
  default: class {
    mainWindow = { on: vi.fn() };
    _setupCSP = vi.fn(() => h.order.push("_setupCSP"));
    setDefaultAlwaysOnTop = vi.fn();
    createMainWindow = vi.fn(async () => {
      h.order.push("createMainWindow");
      return this.mainWindow;
    });
    loadMainWindowContent = vi.fn(async () => {
      h.order.push("loadMainWindowContent");
    });
    setWindows = vi.fn();
    createTray = vi.fn(async () => undefined);
  },
}));

vi.mock("../../src/helpers/database", () => ({
  default: class {
    initialize = vi.fn();
    setFileConfigPath = vi.fn();
    getSetting = vi.fn(() => undefined);
    setSafeStorage = vi.fn(() => {
      h.order.push("setSafeStorage");
      if (h.setSafeStorageThrows) {
        throw new Error("keychain failure");
      }
    });
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
    setWindows = vi.fn();
    createTray = vi.fn(async () => {
      h.order.push("createTray");
    });
  },
}));

vi.mock("../../src/helpers/hotkeyManager", () => ({
  default: class {},
}));

vi.mock("../../src/helpers/ipc", () => ({
  registerAll: vi.fn(),
}));

async function importMain(): Promise<void> {
  await import("../../main");
}

describe("[20260820_Fix_211_KeychainBootOrder] main.ts boot order", () => {
  beforeEach(() => {
    vi.resetModules();
    h.order.length = 0;
    h.setSafeStorageThrows = false;
    vi.mocked(h_isEncryptionAvailable).mockReturnValue(true);
  });

  it("window is created before setSafeStorage, renderer loads after crypto settles", async () => {
    await importMain();
    // Boot trigger: resolve app.whenReady() — startApp runs async.
    h.resolveReady();

    // Wait until startApp ran to completion (tray is its last step).
    await vi.waitFor(() => expect(h.order).toContain("createTray"));

    const createIdx = h.order.indexOf("createMainWindow");
    const cryptoIdx = h.order.indexOf("setSafeStorage");
    const loadIdx = h.order.indexOf("loadMainWindowContent");
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(cryptoIdx).toBeGreaterThan(createIdx);
    expect(loadIdx).toBeGreaterThan(cryptoIdx);
  });

  it("setSafeStorage is still invoked when encryption is unavailable", async () => {
    vi.mocked(h_isEncryptionAvailable).mockReturnValue(false);
    await importMain();
    h.resolveReady();
    await vi.waitFor(() => expect(h.order).toContain("createTray"));
    expect(h.order).toContain("setSafeStorage");
  });

  // Code-review fixup (MINOR): a THROW from setSafeStorage must never skip
  // the renderer load — otherwise the user is stranded on a blank window.
  it("renderer still loads when setSafeStorage throws", async () => {
    h.setSafeStorageThrows = true;
    await importMain();
    h.resolveReady();
    await vi.waitFor(() => expect(h.order).toContain("createTray"));
    const cryptoIdx = h.order.indexOf("setSafeStorage");
    const loadIdx = h.order.indexOf("loadMainWindowContent");
    expect(cryptoIdx).toBeGreaterThanOrEqual(0);
    expect(loadIdx).toBeGreaterThan(cryptoIdx);
  });
});
