// [20260726_Tier32_WindowManagerEvents] FINAL blocker for deleting
// tests/_tsresolve.setup.js. Converted from createRequire + Module.
// _resolveFilename monkey-patching (CJS injection of an "electron" stub +
// requireCJS load of windowManager.ts through the shim's .ts loader +
// sole-default-export unwrap) to a standard vitest ESM mock.
//
// Why the CJS machinery existed: vitest 4's vi.mock could not intercept
// native require("electron") in CJS. windowManager.ts has since been
// migrated to ESM `import { BrowserWindow, session, app } from "electron"`,
// so vi.mock("electron", ...) now intercepts it directly — no shim, no
// cache poisoning, no .ts loader. After this change the shim has zero
// consumers and can be deleted in a follow-up commit (along with its
// setupFiles entry in vitest.config.js).
//
// Pattern:
//   - vi.hoisted exposes a mutable `electronMock` shared between the mock
//     factory (which runs at hoist time, before any import) and test bodies.
//   - vi.mock("electron", () => electronMock) registers the ESM module
//     override. Because the factory returns the live object, re-assigning
//     electronMock.BrowserWindow in beforeEach takes effect for any module
//     imported AFTER the re-assignment.
//   - Each test does `vi.resetModules()` (in beforeEach) + dynamic
//     `import()` of WindowManager so its `BrowserWindow` binding resolves
//     to the freshly-configured MockBrowserWindow spy. This replaces the
//     old `delete requireCJS.cache[wmPath]` cache-bust.
//
// Template reference: preload-bridge-contract.test.ts (vi.hoisted pattern),
// updateManager-behavioral.test.ts (vi.mock("electron") shape).
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as C from "../../src/helpers/ipc-contracts";

// [20260726_Tier32_WindowManagerEvents] vi.mock factories are hoisted above
// all imports, so the shared state they close over must also be hoisted.
// `electronMock` is a mutable holder: beforeEach re-assigns .BrowserWindow
// to a fresh spy; the mock factory returns this object so the source's
// `import { BrowserWindow } from "electron"` always reads the current spy
// at import time.
//
// [20260726_Tier32_WindowManagerEvents] Type note: `BrowserWindow` is typed
// as ReturnType<typeof vi.fn> (the same shape `MockBrowserWindow` is
// declared with below) so beforeEach can assign a constructor-style vi.fn
// (vi.fn infers Mock<Procedure | Constructable> from a `function(this: ...)`
// body) into the slot. Without this explicit annotation, vi.hoisted infers
// Mock<Procedure> from the bare `vi.fn()` seed and the constructor-style
// reassignment fails TS2322.
type ViFn = ReturnType<typeof vi.fn>;
const electronMock = vi.hoisted(() => ({
  BrowserWindow: vi.fn() as ViFn,
  app: { getAppPath: vi.fn(() => "/fake/app/path") as ViFn },
  session: {
    defaultSession: {
      webRequest: { onHeadersReceived: vi.fn() as ViFn },
    },
  },
}));

vi.mock("electron", () => electronMock);

// [20260726_Tier32_WindowManagerEvents] The MockBrowserWindow vi.fn is
// invoked with `new`, so `this` inside its body is the instance. Typing
// `this` via an explicit interface avoids TS2683 (this implicitly has any).
// Only the fields the body assigns + the tests read are listed. Preserved
// verbatim from the pre-refactor file.
interface BrowserWindowInstance {
  webContents: { send: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  maximize: ReturnType<typeof vi.fn>;
  isMaximized: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
}

// [20260726_Tier32_WindowManagerEvents] event-name -> listener. The
// listeners are invoked directly by the suite (onHandlers.maximize()), so
// they are typed as (...args) => void. Preserved from pre-refactor file.
type EventListener = (...args: unknown[]) => void;

describe("windowManager — real module execution with mocked electron", () => {
  let sendSpy: ReturnType<typeof vi.fn>;
  let onHandlers: Record<string, EventListener>;
  // [20260726_Tier32_WindowManagerEvents] MockBrowserWindow is a vi.fn used
  // as a constructor + asserted on via toHaveBeenCalledWith. Re-assigning
  // electronMock.BrowserWindow here each test, then dynamically importing
  // WindowManager, ensures the source's `new BrowserWindow(...)` calls the
  // per-test spy. Replaces the old requireCJS.cache[wmPath] deletion.
  let MockBrowserWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // [20260726_Tier32_WindowManagerEvents] Clear the module registry so the
    // next dynamic import() of windowManager re-evaluates and re-binds its
    // `BrowserWindow` import to the freshly-configured electronMock below.
    // Equivalent to the old `delete requireCJS.cache[wmPath]` cache-bust.
    vi.resetModules();

    sendSpy = vi.fn();
    onHandlers = {};
    // [20260726_Tier32_WindowManagerEvents] vi.fn used as a constructor:
    // the typed `this` parameter routes the body's assignments through the
    // BrowserWindowInstance interface so no field access reads as `any`.
    // Body preserved verbatim from the pre-refactor file.
    MockBrowserWindow = vi.fn(function (this: BrowserWindowInstance) {
      this.webContents = { send: sendSpy };
      this.on = vi.fn((event: string, handler: EventListener) => {
        onHandlers[event] = handler;
      });
      this.loadURL = vi.fn(() => Promise.resolve());
      this.loadFile = vi.fn(() => Promise.resolve());
      this.focus = vi.fn();
      this.show = vi.fn();
      this.maximize = vi.fn();
      this.isMaximized = vi.fn(() => false);
      this.isDestroyed = vi.fn(() => false);
      return this;
    });

    // [20260726_Tier32_WindowManagerEvents] Re-bind the mocked electron's
    // BrowserWindow to the per-test spy. app/session stubs persist across
    // tests (their behavior is identical in every test); only BrowserWindow
    // needs a fresh spy. windowManager.ts reads `BrowserWindow` at call
    // time (inside createMainWindow/createHistoryWindow/createSettingsWindow),
    // so the import-time binding is what matters — handled by resetModules +
    // dynamic import in each test.
    electronMock.BrowserWindow = MockBrowserWindow;
    electronMock.app.getAppPath = vi.fn(() => "/fake/app/path");
    electronMock.session.defaultSession.webRequest.onHeadersReceived = vi.fn();
  });

  // [20260726_Tier32_WindowManagerEvents] Helper: dynamic import after
  // resetModules so the source's `BrowserWindow` import resolves to the
  // per-test MockBrowserWindow. The source uses `export default WindowManager`,
  // so the ESM namespace's `.default` is the class.
  async function loadWindowManager(): Promise<
    typeof import("../../src/helpers/windowManager").default
  > {
    const mod = await import("../../src/helpers/windowManager");
    return mod.default;
  }

  it("maximize/unmaximize listeners fire webContents.send with C.EVENTS.WINDOW_MAXIMIZE_CHANGE — no ReferenceError", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();

    expect(typeof onHandlers.maximize).toBe("function");
    expect(typeof onHandlers.unmaximize).toBe("function");

    // Invoking the listener must NOT throw ReferenceError: C is not defined
    expect(() => onHandlers.maximize!()).not.toThrow();
    expect(() => onHandlers.unmaximize!()).not.toThrow();

    expect(sendSpy).toHaveBeenNthCalledWith(
      1,
      C.EVENTS.WINDOW_MAXIMIZE_CHANGE,
      true,
    );
    expect(sendSpy).toHaveBeenNthCalledWith(
      2,
      C.EVENTS.WINDOW_MAXIMIZE_CHANGE,
      false,
    );
  });

  it("respects setDefaultAlwaysOnTop(false) in BrowserWindow options", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    wm.setDefaultAlwaysOnTop(false);
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();

    expect(MockBrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysOnTop: false }),
    );
  });

  it("defaults to alwaysOnTop: true when setDefaultAlwaysOnTop not called", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();

    expect(MockBrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysOnTop: true }),
    );
  });

  it("history window respects alwaysOnTop setting", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    wm.setDefaultAlwaysOnTop(false);
    process.env.NODE_ENV = "development";
    await wm.createHistoryWindow();

    expect(MockBrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ alwaysOnTop: false }),
    );
  });

  it("settings window respects alwaysOnTop setting", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    wm.setDefaultAlwaysOnTop(false);
    process.env.NODE_ENV = "development";
    await wm.createSettingsWindow();

    expect(MockBrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ alwaysOnTop: false }),
    );
  });

  it("showHistoryWindow uses current alwaysOnTop value", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    wm.setDefaultAlwaysOnTop(false);
    process.env.NODE_ENV = "development";
    await wm.createHistoryWindow();

    const setAlwaysOnTopSpy = vi.fn();
    // [20260726_Tier32_WindowManagerEvents] historyWindow is a public field
    // typed as Electron.BrowserWindow | null; non-null after
    // createHistoryWindow resolved. Assign the spy via a structural cast so
    // the source's readonly-ish surface accepts the override.
    (
      wm.historyWindow as unknown as {
        setAlwaysOnTop: typeof setAlwaysOnTopSpy;
      }
    ).setAlwaysOnTop = setAlwaysOnTopSpy;

    wm.showHistoryWindow();
    expect(setAlwaysOnTopSpy).toHaveBeenCalledWith(false);
  });

  it("showSettingsWindow uses current alwaysOnTop value", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    wm.setDefaultAlwaysOnTop(false);
    process.env.NODE_ENV = "development";
    await wm.createSettingsWindow();

    const setAlwaysOnTopSpy = vi.fn();
    (
      wm.settingsWindow as unknown as {
        setAlwaysOnTop: typeof setAlwaysOnTopSpy;
      }
    ).setAlwaysOnTop = setAlwaysOnTopSpy;

    wm.showSettingsWindow();
    expect(setAlwaysOnTopSpy).toHaveBeenCalledWith(false);
  });
});
