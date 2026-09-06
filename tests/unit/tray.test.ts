// [20260906_Test_TrayBehavior] Spec #266 T06 (#282): behavior tests for the
// tray manager — previously zero coverage (research doc G5). Mocks electron
// at the module boundary and asserts only externally observable behavior:
// icon path resolution (dev/prod, darwin/win), menu template entries and
// their click effects (show window / about dialog / quit), click-toggle on
// the tray icon, status tooltips, and crash safety when creation fails.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

type MockWindow = {
  isVisible: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
};

const trayInstances: MockTrayInstance[] = [];

class MockTrayInstance {
  icon: unknown;
  tooltip = "";
  handlers: Record<string, () => void> = {};
  contextMenu: unknown = null;
  destroyed = false;
  setContextMenu = vi.fn((menu: unknown) => {
    this.contextMenu = menu;
  });
  setToolTip = vi.fn((tip: string) => {
    this.tooltip = tip;
  });
  on = vi.fn((event: string, handler: () => void) => {
    this.handlers[event] = handler;
  });
  popUpContextMenu = vi.fn();
  destroy = vi.fn(() => {
    this.destroyed = true;
  });

  constructor(icon: unknown) {
    this.icon = icon;
    trayInstances.push(this);
  }
}

vi.mock("electron", () => {
  return {
    Tray: class {
      constructor(icon: unknown) {
        return new MockTrayInstance(icon);
      }
    },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown) => ({ template })),
    },
    nativeImage: {
      createFromPath: vi.fn((p: string) => ({ fromPath: p })),
      createEmpty: vi.fn(() => ({ empty: true })),
    },
    dialog: { showMessageBox: vi.fn() },
    app: {
      getAppPath: vi.fn(() => "/test/app"),
      getVersion: vi.fn(() => "9.9.9-test"),
      quit: vi.fn(),
    },
  };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, default: { ...actual, existsSync: vi.fn(() => true) } };
});

import { Menu, nativeImage, dialog, app } from "electron";
import TrayManager from "../../src/helpers/tray";

const ORIG_PLATFORM = process.platform;
const ORIG_NODE_ENV = process.env.NODE_ENV;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
}

function setResourcesPath(value: string): void {
  Object.defineProperty(process, "resourcesPath", {
    value,
    configurable: true,
    writable: true,
  });
}

// [20260906_Test_TrayBehavior_ReviewFix] Single-point typed cast instead of
// repeating double-casts at every call site.
const asWindow = (win: MockWindow): Electron.BrowserWindow =>
  win as unknown as Electron.BrowserWindow;

const READY_TOOLTIP = "Murmur - 中文语音转文字";

function makeWindow(overrides: Partial<MockWindow> = {}): MockWindow {
  return {
    isVisible: vi.fn(() => true),
    isDestroyed: vi.fn(() => false),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  };
}

/** Extract a menu entry's click handler by its label from the template. */
function menuClick(menu: unknown, label: string): (() => void) | undefined {
  const template = (
    menu as { template: { label?: string; click?: () => void }[] }
  ).template;
  return template?.find((item) => item.label === label)?.click;
}

describe("[20260906_Test_TrayBehavior] TrayManager", () => {
  beforeEach(() => {
    trayInstances.length = 0;
    vi.clearAllMocks();
    setPlatform("darwin");
    process.env.NODE_ENV = "development";
    setResourcesPath("/test/resources");
  });

  afterEach(() => {
    setPlatform(ORIG_PLATFORM);
    process.env.NODE_ENV = ORIG_NODE_ENV;
    delete (process as { resourcesPath?: string }).resourcesPath;
    vi.restoreAllMocks();
  });

  describe("getTrayIconPath (platform × environment arms)", () => {
    it("darwin: dedicated 16px tray icon in dev, resources dir in prod", () => {
      const manager = new TrayManager();
      expect(manager.getTrayIconPath()).toBe(
        path.join("/test/app", "assets", "tray-icon-16.png"),
      );
      process.env.NODE_ENV = "production";
      expect(manager.getTrayIconPath()).toBe(
        path.join("/test/resources", "assets", "tray-icon-16.png"),
      );
    });

    it("win32: full icon.png in dev and prod", () => {
      setPlatform("win32");
      const manager = new TrayManager();
      expect(manager.getTrayIconPath()).toBe(
        path.join("/test/app", "assets", "icon.png"),
      );
      process.env.NODE_ENV = "production";
      expect(manager.getTrayIconPath()).toBe(
        path.join("/test/resources", "assets", "icon.png"),
      );
    });
  });

  describe("createTray", () => {
    it("creates the tray with the real icon and the ready tooltip", async () => {
      const manager = new TrayManager();
      await manager.createTray();

      expect(trayInstances).toHaveLength(1);
      expect(trayInstances[0]?.icon).toEqual({
        fromPath: path.join("/test/app", "assets", "tray-icon-16.png"),
      });
      expect(trayInstances[0]?.tooltip).toBe(READY_TOOLTIP);
    });

    it("falls back to an empty image when the icon file is missing", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const manager = new TrayManager();
      await manager.createTray();

      expect(nativeImage.createEmpty).toHaveBeenCalled();
      expect(trayInstances[0]?.icon).toEqual({ empty: true });
    });

    it("click toggles the main window: visible hides, hidden shows+focuses", async () => {
      const win = makeWindow();
      const manager = new TrayManager();
      manager.setWindows(asWindow(win));
      await manager.createTray();

      win.isVisible.mockReturnValue(true);
      trayInstances[0]?.handlers.click?.();
      expect(win.hide).toHaveBeenCalledTimes(1);
      expect(win.show).not.toHaveBeenCalled();

      win.isVisible.mockReturnValue(false);
      trayInstances[0]?.handlers.click?.();
      expect(win.show).toHaveBeenCalledTimes(1);
      expect(win.focus).toHaveBeenCalledTimes(1);
    });

    it("click is a no-op when the window is destroyed or unset", async () => {
      const win = makeWindow({ isDestroyed: vi.fn(() => true) });
      const manager = new TrayManager();
      manager.setWindows(asWindow(win));
      await manager.createTray();
      trayInstances[0]?.handlers.click?.();
      expect(win.hide).not.toHaveBeenCalled();
      expect(win.show).not.toHaveBeenCalled();

      const noWindow = new TrayManager();
      await noWindow.createTray();
      trayInstances[1]?.handlers.click?.();
      expect(trayInstances[1]?.handlers.click).toBeDefined();
    });

    it("swallows creation failures instead of crashing the app", async () => {
      // restoreAllMocks in afterEach wipes factory-set implementations, so
      // this test pins its own fs/icon state explicitly.
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(nativeImage.createFromPath).mockImplementationOnce(() => {
        throw new Error("tray unsupported");
      });
      const logger = { error: vi.fn() };
      const manager = new TrayManager(logger);
      await expect(manager.createTray()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        "创建托盘失败:",
        expect.any(Error),
      );
    });
  });

  describe("context menu", () => {
    it("registers show / about / quit entries with working click effects", async () => {
      const win = makeWindow();
      const manager = new TrayManager();
      manager.setWindows(asWindow(win));
      await manager.createTray();

      const menu = trayInstances[0]?.contextMenu;
      expect(menu).toBeDefined();

      menuClick(menu, "显示主窗口")?.();
      expect(win.show).toHaveBeenCalledTimes(1);
      expect(win.focus).toHaveBeenCalledTimes(1);

      menuClick(menu, "关于")?.();
      expect(dialog.showMessageBox).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "关于 Murmur",
          message: "Murmur v9.9.9-test",
        }),
      );

      menuClick(menu, "退出")?.();
      expect(app.quit).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when the tray was never created", () => {
      const manager = new TrayManager();
      expect(() => manager.updateContextMenu()).not.toThrow();
      expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
    });
  });

  describe("setStatus / destroy", () => {
    it("maps recording/processing/ready to their tooltips", async () => {
      const manager = new TrayManager();
      await manager.createTray();

      manager.setStatus("recording");
      expect(trayInstances[0]?.tooltip).toBe("Murmur - 正在录音...");
      manager.setStatus("processing");
      expect(trayInstances[0]?.tooltip).toBe("Murmur - 正在处理...");
      manager.setStatus("ready");
      expect(trayInstances[0]?.tooltip).toBe(READY_TOOLTIP);
      manager.setStatus("anything-else");
      expect(trayInstances[0]?.tooltip).toBe(READY_TOOLTIP);
    });

    it("setStatus without a tray is a safe no-op", () => {
      const manager = new TrayManager();
      expect(() => manager.setStatus("recording")).not.toThrow();
    });

    it("destroy tears down the tray and is idempotent", async () => {
      const manager = new TrayManager();
      await manager.createTray();
      manager.destroy();
      expect(trayInstances[0]?.destroyed).toBe(true);
      expect(() => manager.destroy()).not.toThrow();
      expect(trayInstances[0]?.destroy).toHaveBeenCalledTimes(1);
    });
  });
});
