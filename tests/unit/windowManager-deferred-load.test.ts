// [20260820_Fix_211_KeychainBootOrder] Tests the REAL windowManager split
// that issue #211's fix introduces (the main-boot-order test drives a
// mocked windowManager and can't exercise the actual load mechanics):
//
//   - createMainWindow({deferLoad:true}) creates the BrowserWindow and
//     registers lifecycle handlers WITHOUT loading the renderer — this is
//     the state the keychain authorization dialog pops over
//   - loadMainWindowContent() then performs the renderer load (dev URL /
//     prod file, same targets as the inline path)
//   - createMainWindow() with no options keeps loading inline — zero
//     behavior change for every other caller (activate handler, IPC)
//   - loadMainWindowContent() is a no-op when the window was closed while
//     still empty (user dismisses the blank window during the prompt)
//
// Harness mirrors windowManager-events.test.ts (vi.hoisted electronMock +
// per-test MockBrowserWindow spy + resetModules/dynamic import).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type ViFn = ReturnType<typeof vi.fn>;
interface BrowserWindowInstance {
  webContents: { send: ViFn };
  on: ViFn;
  loadURL: ViFn;
  loadFile: ViFn;
  focus: ViFn;
  show: ViFn;
  setAlwaysOnTop: ViFn;
  maximize: ViFn;
  isMaximized: ViFn;
  isDestroyed: ViFn;
}
type EventListener = (...args: unknown[]) => void;

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

describe("windowManager deferred main-window load (issue #211)", () => {
  let onHandlers: Record<string, EventListener>;
  let instance: BrowserWindowInstance;
  let MockBrowserWindow: ViFn;
  let originalResourcesPath: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    // vitest runs with NODE_ENV=test (non-dev), so the icon resolver takes
    // the production branch reading process.resourcesPath — undefined in
    // plain Node. Stub it and restore afterwards (the property is typed
    // read-only for delete, so restore by assignment).
    originalResourcesPath = process.resourcesPath;
    Object.assign(process, { resourcesPath: "/fake/resources" });
    onHandlers = {};
    instance = {
      webContents: { send: vi.fn() },
      on: vi.fn((event: string, handler: EventListener) => {
        onHandlers[event] = handler;
      }),
      loadURL: vi.fn(() => Promise.resolve()),
      loadFile: vi.fn(() => Promise.resolve()),
      focus: vi.fn(),
      show: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      maximize: vi.fn(),
      isMaximized: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
    };
    MockBrowserWindow = vi.fn(function (this: BrowserWindowInstance) {
      Object.assign(this, instance);
      return this;
    });
    electronMock.BrowserWindow = MockBrowserWindow;
  });

  afterEach(() => {
    Object.assign(process, { resourcesPath: originalResourcesPath });
  });

  async function loadWindowManager(): Promise<
    typeof import("../../src/helpers/windowManager").default
  > {
    const mod = await import("../../src/helpers/windowManager");
    return mod.default;
  }

  it("deferLoad creates the window without loading the renderer", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const win = await wm.createMainWindow({ deferLoad: true });

    expect(win).toBeDefined();
    expect(instance.loadURL).not.toHaveBeenCalled();
    expect(instance.loadFile).not.toHaveBeenCalled();
    // Lifecycle handlers are already armed on the deferred path — closing
    // the empty window must null out mainWindow exactly like the inline
    // path.
    expect(onHandlers["closed"]).toBeTypeOf("function");
    onHandlers["closed"]!();
    expect(wm.mainWindow).toBeNull();
  });

  it("loadMainWindowContent performs the renderer load afterwards", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    await wm.createMainWindow({ deferLoad: true });
    await wm.loadMainWindowContent();

    // NODE_ENV is "test" in vitest → non-dev branch loads the packaged
    // index.html under the fake app path.
    expect(instance.loadFile).toHaveBeenCalledWith(
      "/fake/app/path/src/dist/index.html",
    );
    expect(instance.loadURL).not.toHaveBeenCalled();
  });

  it("default createMainWindow (no options) still loads inline", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const win = await wm.createMainWindow();

    expect(win).toBeDefined();
    expect(instance.loadFile).toHaveBeenCalledTimes(1);
  });

  it("loadMainWindowContent is a no-op when the empty window was closed", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    await wm.createMainWindow({ deferLoad: true });
    onHandlers["closed"]!();
    expect(wm.mainWindow).toBeNull();

    await expect(wm.loadMainWindowContent()).resolves.toBeUndefined();
    expect(instance.loadFile).not.toHaveBeenCalled();
    expect(instance.loadURL).not.toHaveBeenCalled();
  });

  it("a second createMainWindow while one exists focuses and does not reload", async () => {
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    await wm.createMainWindow({ deferLoad: true });
    await wm.loadMainWindowContent();
    instance.loadFile!.mockClear();

    const again = await wm.createMainWindow();
    expect(again).toBeDefined();
    expect(instance.focus).toHaveBeenCalled();
    expect(instance.loadFile).not.toHaveBeenCalled();
  });
});
