// [20260724_TS_BigBang_TestFix] This test uses createRequire + Module.
// _resolveFilename monkey-patch to inject an electron stub into CJS
// require("electron"). vi.mock cannot intercept CJS require(), so this
// approach is necessary while windowManager uses require("electron").
// After windowManager migrates to .ts with import, this can switch to
// vi.mock. For now, extensionless paths + app stub in electron mock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);
const Module = requireCJS("module");

describe("windowManager — real module execution with mocked electron", () => {
  let origResolve;
  let sendSpy;
  let onHandlers;
  let MockBrowserWindow;

  beforeEach(() => {
    sendSpy = vi.fn();
    onHandlers = {};
    MockBrowserWindow = vi.fn(function () {
      this.webContents = { send: sendSpy };
      this.on = vi.fn((event, handler) => {
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

    origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === "electron") return "electron-stub";
      return origResolve.call(this, request, ...rest);
    };
    requireCJS.cache["electron-stub"] = {
      id: "electron-stub",
      filename: "electron-stub",
      loaded: true,
      exports: electronStub,
    };

    // [20260724_TS_BigBang_TestFix] Extensionless path resolves to .js now,
    // .ts after migration (Node's CJS resolver tries .js by default; after
    // migration this test must switch to vi.mock when windowManager is .ts)
    const wmPath = requireCJS.resolve("../../src/helpers/windowManager");
    delete requireCJS.cache[wmPath];
    // [20260724_TS_BigBang_TestFix] END
  });

  afterEach(() => {
    Module._resolveFilename = origResolve;
    delete requireCJS.cache["electron-stub"];
  });

  it("maximize/unmaximize listeners fire webContents.send with C.EVENTS.WINDOW_MAXIMIZE_CHANGE — no ReferenceError", async () => {
    const C = requireCJS("../../src/helpers/ipc-contracts");
    const WindowManager = requireCJS("../../src/helpers/windowManager");
    const wm = new WindowManager();
    process.env.NODE_ENV = "development";
    await wm.createMainWindow();

    expect(typeof onHandlers.maximize).toBe("function");
    expect(typeof onHandlers.unmaximize).toBe("function");

    // Invoking the listener must NOT throw ReferenceError: C is not defined
    expect(() => onHandlers.maximize()).not.toThrow();
    expect(() => onHandlers.unmaximize()).not.toThrow();

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
    wm.historyWindow.setAlwaysOnTop = setAlwaysOnTopSpy;

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
    wm.settingsWindow.setAlwaysOnTop = setAlwaysOnTopSpy;

    wm.showSettingsWindow();
    expect(setAlwaysOnTopSpy).toHaveBeenCalledWith(false);
  });
});
