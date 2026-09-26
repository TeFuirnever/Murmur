// [20260926_Issue405] Issue #405: windowManager wiring for minimize-to-tray.
// The interception logic itself is covered by minimizeToTray.test.ts; this
// suite pins the windowManager WIRING contract:
//   1. With a reader wired (main.ts injects it), createMainWindow attaches
//      the interception to the freshly created window.
//   2. Without a reader, nothing attaches (the interception never engages
//      on an unwired manager — unit stubs, tests).
// Same harness as windowManager-events.test.ts: vi.hoisted electronMock,
// per-test BrowserWindow constructor spy, resetModules + dynamic import.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Type note (same as windowManager-events.test.ts): annotating the slot as
// ReturnType<typeof vi.fn> lets beforeEach assign a constructor-style
// constructor-style vi.fn without TS2322 (Mock<Procedure | Constructable>
// into a bare Mock<Procedure> seed).
type ViFn = ReturnType<typeof vi.fn>;
const electronMock = vi.hoisted(() => ({
  BrowserWindow: vi.fn() as ViFn,
  // [20260926_Fix_BloubHiddenPause] app-level hide/show hooks (the
  // visibility truth backstop) bind app.on at createMainWindow time.
  app: {
    getAppPath: vi.fn(() => "/fake/app/path") as ViFn,
    on: vi.fn() as ViFn,
  },
  session: {
    defaultSession: {
      webRequest: { onHeadersReceived: vi.fn() as ViFn },
    },
  },
}));

vi.mock("electron", () => electronMock);

// The interception module is MOCKED here — wiring-only assertions. Its
// internal contract (platform gate, preventDefault+hide, live reader) is
// covered by tests/unit/minimizeToTray module tests.
const minimizeMock = vi.hoisted(() => ({
  interceptMinimizeToTray: vi.fn(),
}));

vi.mock("../../src/helpers/minimizeToTray", () => minimizeMock);

interface BrowserWindowInstance {
  // [20260926_Fix_BloubHiddenPause] the visibility truth-push hooks
  // webContents.on("did-finish-load") during createMainWindow — the mock
  // needs the listener registration, not just send.
  webContents: {
    send: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  maximize: ReturnType<typeof vi.fn>;
  isMaximized: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
}

type EventListener = (...args: unknown[]) => void;

describe("[20260926_Issue405] windowManager minimize-to-tray wiring", () => {
  let onHandlers: Record<string, EventListener>;
  let MockBrowserWindow: ReturnType<typeof vi.fn>;

  function installBrowserWindow(): void {
    MockBrowserWindow = vi.fn(function (this: BrowserWindowInstance) {
      this.webContents = { send: vi.fn(), on: vi.fn() };
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
    minimizeMock.interceptMinimizeToTray.mockClear();
    electronMock.app.getAppPath = vi.fn(() => "/fake/app/path");
    electronMock.session.defaultSession.webRequest.onHeadersReceived = vi.fn();
    installBrowserWindow();
  });

  it("attaches the interception when a reader is wired", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    const reader = () => false;
    wm.setMinimizeToTrayReader(reader);
    await wm.createMainWindow();

    expect(minimizeMock.interceptMinimizeToTray).toHaveBeenCalledTimes(1);
    expect(minimizeMock.interceptMinimizeToTray).toHaveBeenCalledWith(
      wm.mainWindow,
      reader,
    );
  });

  it("does not attach when no reader is wired", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    await wm.createMainWindow();

    expect(minimizeMock.interceptMinimizeToTray).not.toHaveBeenCalled();
  });

  it("attaches exactly one interception per window (recreate path stays covered, no double-attach)", async () => {
    process.env.NODE_ENV = "development";
    const WindowManager = await loadWindowManager();
    const wm = new WindowManager();
    wm.setMinimizeToTrayReader(() => false);
    await wm.createMainWindow();
    // Simulate the window being destroyed and recreated (Dock-click path in
    // main.ts showOrCreateMainWindow) — each creation attaches once.
    onHandlers["closed"]!();
    await wm.createMainWindow();
    expect(minimizeMock.interceptMinimizeToTray).toHaveBeenCalledTimes(2);
  });
});
