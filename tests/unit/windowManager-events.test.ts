// [20260726_Tier3_WindowManagerEventsMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 5 (final electron-mock batch). Pattern: same as
// preload-loadable.test.ts — type the `let` bindings (TS7034) assigned in
// beforeEach, type the Module._resolveFilename override via a local ResolveFn
// (Node's internal is undocumented in @types/node), and type the require
// cache write through `unknown` because the stub NodeJS.Module omits most
// fields. The MockBrowserWindow vi.fn uses `this` as a constructor, so its
// `this` is typed via a local BrowserWindowStub interface. The onHandlers map
// carries (event, ...args) => void listeners the suite invokes directly.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
//
// [20260724_TS_BigBang_TestFix] This test uses createRequire + Module.
// _resolveFilename monkey-patch to inject an electron stub into CJS
// require("electron"). vi.mock cannot intercept CJS require(), so this
// approach is necessary while windowManager uses require("electron").
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);
const Module = requireCJS("module");

// [20260726_Tier3_WindowManagerEventsMigrate] Internal resolver signature.
// Node's _resolveFilename is undocumented; this captures what the override +
// the .call(this, request, ...rest) forward need (matches preload-loadable).
type ResolveFn = (this: unknown, request: string, ...rest: unknown[]) => string;

// [20260726_Tier3_WindowManagerEventsMigrate] The MockBrowserWindow vi.fn is
// invoked with `new`, so `this` inside its body is the instance. Typing `this`
// via an explicit interface avoids TS2683 (this implicitly has any). Only the
// fields the body assigns + the tests read are listed.
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

// [20260726_Tier3_WindowManagerEventsMigrate] event-name -> listener. The
// listeners are invoked directly by the suite (onHandlers.maximize()), so
// they are typed as (...args) => void.
type EventListener = (...args: unknown[]) => void;

describe("windowManager — real module execution with mocked electron", () => {
  let origResolve: ResolveFn;
  let sendSpy: ReturnType<typeof vi.fn>;
  let onHandlers: Record<string, EventListener>;
  // [20260726_Tier3_WindowManagerEventsMigrate] MockBrowserWindow is a vi.fn
  // used as a constructor + asserted on via toHaveBeenCalledWith. ReturnType
  // of vi.fn carries the .mock.calls array the assertions read.
  let MockBrowserWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    onHandlers = {};
    // [20260726_Tier3_WindowManagerEventsMigrate] vi.fn used as a constructor:
    // the typed `this` parameter routes the body's assignments through the
    // BrowserWindowInstance interface so no field access reads as `any`.
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

    const electronStub = {
      BrowserWindow: MockBrowserWindow,
      // [20260724_TS_BigBang_DirnameFix] windowManager now uses app.getAppPath()
      // for preload/renderer paths. Provide a stub so tests don't crash.
      app: { getAppPath: vi.fn(() => "/fake/app/path") },
      // [20260724_TS_BigBang_DirnameFix] END
      session: {
        defaultSession: {
          webRequest: { onHeadersReceived: vi.fn() },
        },
      },
    };

    origResolve = Module._resolveFilename as ResolveFn;
    Module._resolveFilename = function (
      request: string,
      ...rest: unknown[]
    ): string {
      if (request === "electron") return "electron-stub";
      return origResolve.call(this, request, ...rest);
    } as ResolveFn;
    // [20260726_Tier3_WindowManagerEventsMigrate] Cache entry cast through
    // unknown: the stub object omits most NodeJS.Module fields (children/
    // parent/path/...) — windowManager only reads `exports`.
    requireCJS.cache["electron-stub"] = {
      id: "electron-stub",
      filename: "electron-stub",
      loaded: true,
      exports: electronStub,
    } as unknown as NodeModule;

    // [20260724_TS_BigBang_TestFix] Extensionless path resolves to .ts after
    // migration (the tsresolve.setup registers a .ts extension handler +
    // .ts resolution in Module._resolveFilename).
    const wmPath = requireCJS.resolve("../../src/helpers/windowManager");
    delete requireCJS.cache[wmPath];
    // [20260724_TS_BigBang_TestFix] END
  });

  afterEach(() => {
    Module._resolveFilename =
      origResolve as unknown as typeof Module._resolveFilename;
    delete requireCJS.cache["electron-stub"];
  });

  it("maximize/unmaximize listeners fire webContents.send with C.EVENTS.WINDOW_MAXIMIZE_CHANGE — no ReferenceError", async () => {
    const C = requireCJS("../../src/helpers/ipc-contracts");
    // [20260726_Tier3_WindowManagerEventsMigrate] require returns the class
    // directly (setupFile PART 3 unwraps sole-default-export modules).
    const WindowManager = requireCJS("../../src/helpers/windowManager");
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
    const WindowManager = requireCJS("../../src/helpers/windowManager");
    const wm = new WindowManager();
    wm.setDefaultAlwaysOnTop(false);
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();

    expect(MockBrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysOnTop: false }),
    );
  });

  it("defaults to alwaysOnTop: true when setDefaultAlwaysOnTop not called", async () => {
    const WindowManager = requireCJS("../../src/helpers/windowManager");
    const wm = new WindowManager();
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();

    expect(MockBrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysOnTop: true }),
    );
  });

  it("history window respects alwaysOnTop setting", async () => {
    const WindowManager = requireCJS("../../src/helpers/windowManager");
    const wm = new WindowManager();
    wm.setDefaultAlwaysOnTop(false);
    process.env.NODE_ENV = "development";
    await wm.createHistoryWindow();

    expect(MockBrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ alwaysOnTop: false }),
    );
  });

  it("settings window respects alwaysOnTop setting", async () => {
    const WindowManager = requireCJS("../../src/helpers/windowManager");
    const wm = new WindowManager();
    wm.setDefaultAlwaysOnTop(false);
    process.env.NODE_ENV = "development";
    await wm.createSettingsWindow();

    expect(MockBrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ alwaysOnTop: false }),
    );
  });

  it("showHistoryWindow uses current alwaysOnTop value", async () => {
    const WindowManager = requireCJS("../../src/helpers/windowManager");
    const wm = new WindowManager();
    wm.setDefaultAlwaysOnTop(false);
    process.env.NODE_ENV = "development";
    await wm.createHistoryWindow();

    const setAlwaysOnTopSpy = vi.fn();
    // [20260726_Tier3_WindowManagerEventsMigrate] historyWindow is a public
    // field typed as Electron.BrowserWindow | null; non-null after
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
    const WindowManager = requireCJS("../../src/helpers/windowManager");
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
