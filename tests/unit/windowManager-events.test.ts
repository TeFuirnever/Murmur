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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as C from "../../src/helpers/ipc-contracts";
// [20260906_Spec259_T2] path join keeps packaged-HTML load assertions
// separator-correct on both CI platforms (mirrors deferred-load suite).
import path from "path";

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
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  // [20260906_Spec259_T2] close/hide are exercised by the branch close-out
  // describe below (hide/close window guards).
  close: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
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
      this.setAlwaysOnTop = vi.fn();
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

  // [ADR-015] showSettingsWindow now disables main window alwaysOnTop
  // temporarily so settings is not covered by the floating panel.
  it("showSettingsWindow disables main window alwaysOnTop", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();
    await wm.createSettingsWindow();

    wm.showSettingsWindow();
    expect(wm.mainWindow!.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  // [ADR-015] showHistoryWindow also disables main window alwaysOnTop.
  it("showHistoryWindow disables main window alwaysOnTop", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();
    await wm.createHistoryWindow();

    wm.showHistoryWindow();
    expect(wm.mainWindow!.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  // [ADR-015] backgroundThrottling must be false so renderer timers are not
  // throttled when the main window is hidden — otherwise AI optimization
  // setTimeout(100ms) stalls to ~1s and transcription results can be lost.
  it("main window has backgroundThrottling: false in webPreferences", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();

    expect(MockBrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          backgroundThrottling: false,
        }),
      }),
    );
  });

  // [ADR-015] Closing the settings window must restore focus to the main
  // window so the app doesn't appear to "disappear".
  it("settings window closed handler restores main window focus", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();
    await wm.createSettingsWindow();

    // Simulate settings window close
    expect(typeof onHandlers.closed).toBe("function");
    onHandlers.closed!();

    expect(wm.settingsWindow).toBeNull();
    expect(wm.mainWindow!.show).toHaveBeenCalled();
    expect(wm.mainWindow!.focus).toHaveBeenCalled();
    // [CodeReview] restoreMainWindow must also restore alwaysOnTop
    expect(wm.mainWindow!.setAlwaysOnTop).toHaveBeenCalled();
  });

  // [ADR-015] Same for history window.
  it("history window closed handler restores main window focus", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();
    await wm.createHistoryWindow();

    expect(typeof onHandlers.closed).toBe("function");
    onHandlers.closed!();

    expect(wm.historyWindow).toBeNull();
    expect(wm.mainWindow!.show).toHaveBeenCalled();
    expect(wm.mainWindow!.focus).toHaveBeenCalled();
    // [CodeReview] restoreMainWindow must also restore alwaysOnTop
    expect(wm.mainWindow!.setAlwaysOnTop).toHaveBeenCalled();
  });
});

// [20260906_Spec259_T2] Branch close-out for the instrumented helpers
// (Spec #259 T2, ticket #274): drive the remaining windowManager branch
// arms through public behavior only — CSP header registration, child-window
// reuse vs creation, show/hide/close guards, closeAllWindows, and the
// in-flight createMainWindow guard. Same harness pattern as the describe
// above: vi.hoisted electronMock + per-test BrowserWindow constructor spy +
// resetModules/dynamic import.
describe("[20260906_Spec259_T2] windowManager branch close-out", () => {
  const ORIG_NODE_ENV = process.env.NODE_ENV;

  let onHandlers: Record<string, EventListener>;
  let MockBrowserWindow: ViFn;

  // Constructor-style vi.fn shared with the hoisted electronMock; each test
  // rebinds electronMock.BrowserWindow to a fresh spy (same as above).
  function installBrowserWindow(loadURLImpl?: () => Promise<void>): void {
    MockBrowserWindow = vi.fn(function (this: BrowserWindowInstance) {
      this.webContents = { send: vi.fn() };
      this.on = vi.fn((event: string, handler: EventListener) => {
        onHandlers[event] = handler;
      });
      this.loadURL = loadURLImpl
        ? vi.fn(loadURLImpl)
        : vi.fn(() => Promise.resolve());
      this.loadFile = vi.fn(() => Promise.resolve());
      this.focus = vi.fn();
      this.show = vi.fn();
      this.setAlwaysOnTop = vi.fn();
      this.maximize = vi.fn();
      this.isMaximized = vi.fn(() => false);
      this.isDestroyed = vi.fn(() => false);
      this.close = vi.fn();
      this.hide = vi.fn();
      return this;
    });
    electronMock.BrowserWindow = MockBrowserWindow;
  }

  async function loadWindowManager(): Promise<
    typeof import("../../src/helpers/windowManager").default
  > {
    const mod = await import("../../src/helpers/windowManager");
    return mod.default;
  }

  beforeEach(() => {
    vi.resetModules();
    onHandlers = {};
    electronMock.app.getAppPath = vi.fn(() => "/fake/app/path");
    electronMock.session.defaultSession.webRequest.onHeadersReceived = vi.fn();
    installBrowserWindow();
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIG_NODE_ENV;
  });

  it("CSP header handler registers once and rewrites headers with the strict production policy", async () => {
    process.env.NODE_ENV = "production";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();

    wm._setupCSP();
    wm._setupCSP(); // second call must be a no-op (idempotent guard)

    const register = electronMock.session.defaultSession.webRequest
      .onHeadersReceived as ViFn;
    expect(register).toHaveBeenCalledTimes(1);

    const handler = register.mock.calls[0]![0] as (
      details: { responseHeaders?: Record<string, string[]> },
      callback: (response: {
        responseHeaders: Record<string, string[]>;
      }) => void,
    ) => void;
    const callback = vi.fn();
    handler({ responseHeaders: { "x-existing": ["1"] } }, callback);

    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        "x-existing": ["1"],
        // Production policy: no unsafe-eval / no localhost connect-src.
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:",
        ],
      },
    });
  });

  it("CSP header handler allows dev-only sources in development", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    wm._setupCSP();

    const register = electronMock.session.defaultSession.webRequest
      .onHeadersReceived as ViFn;
    const handler = register.mock.calls[0]![0] as (
      details: object,
      callback: (response: {
        responseHeaders: Record<string, string[]>;
      }) => void,
    ) => void;
    const callback = vi.fn();
    handler({}, callback);

    const headers = callback.mock.calls[0]![0].responseHeaders;
    expect(headers["Content-Security-Policy"]![0]).toContain("unsafe-eval");
    expect(headers["Content-Security-Policy"]![0]).toContain(
      "ws://localhost:*",
    );
  });

  it("createMainWindow returns null while another creation is still in flight", async () => {
    process.env.NODE_ENV = "development";
    // Hold loadURL open so the first createMainWindow stays in-flight and
    // the _creatingMainWindow guard is observable from the outside.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installBrowserWindow(() => gate);

    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const first = wm.createMainWindow();
    // The window exists but the load is still pending; closing it nulls
    // mainWindow while _creatingMainWindow is still true — the exact state
    // in which a concurrent createMainWindow must bail out with null.
    onHandlers["closed"]!();
    const second = await wm.createMainWindow();
    expect(second).toBeNull();

    release();
    const win = await first;
    expect(win).toBeDefined();
  });

  it("createHistoryWindow focuses and returns the existing window on a second call", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const first = await wm.createHistoryWindow();
    const second = await wm.createHistoryWindow();

    expect(second).toBe(first);
    expect(first.focus).toHaveBeenCalled();
    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
  });

  it("createHistoryWindow loads the packaged history.html outside development", async () => {
    process.env.NODE_ENV = "production";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const win = await wm.createHistoryWindow();

    expect(win.loadFile).toHaveBeenCalledWith(
      path.join("/fake/app/path", "src", "dist", "history.html"),
    );
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it("createSettingsWindow focuses and returns the existing window on a second call", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const first = await wm.createSettingsWindow();
    const second = await wm.createSettingsWindow();

    expect(second).toBe(first);
    expect(first.focus).toHaveBeenCalled();
    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
  });

  it("createSettingsWindow loads the packaged settings.html outside development", async () => {
    process.env.NODE_ENV = "production";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const win = await wm.createSettingsWindow();

    expect(win.loadFile).toHaveBeenCalledWith(
      path.join("/fake/app/path", "src", "dist", "settings.html"),
    );
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it("showHistoryWindow shows an existing history window without touching a missing main window", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const history = await wm.createHistoryWindow();

    wm.showHistoryWindow();

    expect(history.show).toHaveBeenCalled();
    expect(history.focus).toHaveBeenCalled();
  });

  it("showHistoryWindow skips alwaysOnTop juggling when the main window is destroyed", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const main = (await wm.createMainWindow())!;
    const history = await wm.createHistoryWindow();
    main.isDestroyed = vi.fn(() => true);

    wm.showHistoryWindow();

    expect(main.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(history.show).toHaveBeenCalled();
  });

  it("showHistoryWindow creates and then shows the history window when absent", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const main = (await wm.createMainWindow())!;

    wm.showHistoryWindow();
    // show() runs in createHistoryWindow().then(...) — wait on the visible
    // effect, not on the window reference (assigned before the load awaits).
    await vi.waitFor(() => expect(wm.historyWindow).not.toBeNull());
    await vi.waitFor(() => expect(wm.historyWindow!.show).toHaveBeenCalled());

    expect(main.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(wm.historyWindow!.focus).toHaveBeenCalled();
  });

  it("hideHistoryWindow and closeHistoryWindow are safe no-ops when absent", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();

    expect(() => wm.hideHistoryWindow()).not.toThrow();
    expect(() => wm.closeHistoryWindow()).not.toThrow();
  });

  it("hideHistoryWindow and closeHistoryWindow act on an open history window", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const history = await wm.createHistoryWindow();

    wm.hideHistoryWindow();
    expect(history.hide).toHaveBeenCalledTimes(1);

    wm.closeHistoryWindow();
    expect(history.close).toHaveBeenCalledTimes(1);
  });

  it("showSettingsWindow shows an existing settings window without a main window present", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const settings = await wm.createSettingsWindow();

    wm.showSettingsWindow();

    expect(settings.show).toHaveBeenCalled();
    expect(settings.focus).toHaveBeenCalled();
  });

  it("showSettingsWindow skips alwaysOnTop juggling when the main window is destroyed", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const main = (await wm.createMainWindow())!;
    const settings = await wm.createSettingsWindow();
    main.isDestroyed = vi.fn(() => true);

    wm.showSettingsWindow();

    expect(main.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(settings.show).toHaveBeenCalled();
  });

  it("showSettingsWindow creates and then shows the settings window when absent", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const main = (await wm.createMainWindow())!;

    wm.showSettingsWindow();
    await vi.waitFor(() => expect(wm.settingsWindow).not.toBeNull());
    await vi.waitFor(() => expect(wm.settingsWindow!.show).toHaveBeenCalled());

    expect(main.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(wm.settingsWindow!.focus).toHaveBeenCalled();
  });

  it("hideSettingsWindow and closeSettingsWindow are safe no-ops when absent, and act when open", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();

    expect(() => wm.hideSettingsWindow()).not.toThrow();
    expect(() => wm.closeSettingsWindow()).not.toThrow();

    const settings = await wm.createSettingsWindow();
    wm.hideSettingsWindow();
    expect(settings.hide).toHaveBeenCalledTimes(1);
    wm.closeSettingsWindow();
    expect(settings.close).toHaveBeenCalledTimes(1);
  });

  it("restoreMainWindow ignores a destroyed main window", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const main = (await wm.createMainWindow())!;
    main.isDestroyed = vi.fn(() => true);

    wm.restoreMainWindow();

    expect(main.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(main.show).not.toHaveBeenCalled();
    expect(main.focus).not.toHaveBeenCalled();
  });

  // [20260911_Fix_339_DockActivate] Issue #339: after the close button hides
  // the main window (tray-resident design), a macOS Dock click fires
  // app.on("activate"), which must re-show the existing hidden window.
  it("showMainWindow shows and focuses the existing hidden main window", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const main = (await wm.createMainWindow())!;

    wm.showMainWindow();

    expect(main.show).toHaveBeenCalledTimes(1);
    expect(main.focus).toHaveBeenCalledTimes(1);
  });

  it("showMainWindow is a safe no-op when the main window is missing or destroyed", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();

    expect(() => wm.showMainWindow()).not.toThrow();

    const main = (await wm.createMainWindow())!;
    main.isDestroyed = vi.fn(() => true);
    wm.showMainWindow();
    expect(main.show).not.toHaveBeenCalled();
    expect(main.focus).not.toHaveBeenCalled();
  });
  // [20260911_Fix_339_DockActivate] END

  it("closeAllWindows closes every open window and is a safe no-op on a fresh manager", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const main = await wm.createMainWindow({ deferLoad: true });
    const history = await wm.createHistoryWindow();
    const settings = await wm.createSettingsWindow();

    wm.closeAllWindows();

    expect(main!.close).toHaveBeenCalledTimes(1);
    expect(history.close).toHaveBeenCalledTimes(1);
    expect(settings.close).toHaveBeenCalledTimes(1);

    const fresh = new WindowManager();
    expect(() => fresh.closeAllWindows()).not.toThrow();
  });
});
