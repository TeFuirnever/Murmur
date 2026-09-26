// [20260926_Issue404] Issue #404: main-process login-item module
// (src/helpers/loginItem.ts) contract:
//   1. buildLoginItemOptions(enabled) — Electron Settings payload:
//      { openAtLogin } always; Windows adds args ["--hidden"] so the login
//      launch carries a hidden-start marker (openAsHidden is deprecated and
//      non-functional on macOS 13+; args is win32-only).
//   2. applyLoginItemSetting(enabled) — applies via app.setLoginItemSettings
//      and returns an OperationResult envelope for the IPC handler.
//   3. syncLoginItemAtStartup(db, logger) — SETTINGS-WIN alignment: the
//      persisted auto_start boolean is the source of truth; when the real
//      login item (app.getLoginItemSettings().openAtLogin) disagrees it is
//      forced back to the setting, a match is a no-op. Failures degrade to a
//      logged warning (no silent swallow) and never throw out — startup
//      must not break.
//   4. isLoginItemLaunch(logger) — a login launch: Windows argv marker
//      (--hidden), macOS wasOpenedAtLogin; any other platform false.
//   5. hideMainWindowOnLoginLaunch(windowManager, logger) — at login launch,
//      hide the content-loaded main window (menu-bar convention, no focus
//      steal); otherwise a no-op.
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as loginItem from "../../src/helpers/loginItem";

const appMock = vi.hoisted(() => ({
  getVersion: vi.fn(() => "0.0.0-test"),
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn<
    (options?: unknown) => Partial<Electron.LoginItemSettings>
  >(() => ({ openAtLogin: false, wasOpenedAtLogin: false })),
}));

vi.mock("electron", () => ({
  app: appMock,
}));

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const real = process.platform;
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", {
      value: real,
      configurable: true,
    });
  }
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDb(enabled: unknown) {
  return { getSetting: vi.fn(() => enabled) };
}

function makeWindowManager(
  mainWindow: unknown,
): Parameters<typeof loginItem.hideMainWindowOnLoginLaunch>[0] {
  return {
    mainWindow,
  } as Parameters<typeof loginItem.hideMainWindowOnLoginLaunch>[0];
}

describe("[20260926_Issue404] buildLoginItemOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("on macOS builds { openAtLogin } only (openAsHidden deprecated, dead on macOS 13+)", () => {
    withPlatform("darwin", () => {
      expect(loginItem.buildLoginItemOptions(true)).toEqual({
        openAtLogin: true,
      });
      expect(loginItem.buildLoginItemOptions(false)).toEqual({
        openAtLogin: false,
      });
    });
  });

  it("on Windows adds the --hidden launch marker via args", () => {
    withPlatform("win32", () => {
      expect(loginItem.buildLoginItemOptions(true)).toEqual({
        openAtLogin: true,
        args: ["--hidden"],
      });
      expect(loginItem.buildLoginItemOptions(false)).toEqual({
        openAtLogin: false,
        args: ["--hidden"],
      });
    });
  });

  it("on other platforms builds { openAtLogin } only", () => {
    withPlatform("linux", () => {
      expect(loginItem.buildLoginItemOptions(true)).toEqual({
        openAtLogin: true,
      });
    });
  });
});

describe("[20260926_Issue404] applyLoginItemSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies enabled via app.setLoginItemSettings and reports success", () => {
    withPlatform("darwin", () => {
      const result = loginItem.applyLoginItemSetting(true);
      expect(appMock.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: true,
      });
      expect(result).toEqual({ success: true });
    });
  });

  it("applies disabled via app.setLoginItemSettings and reports success", () => {
    withPlatform("win32", () => {
      const result = loginItem.applyLoginItemSetting(false);
      expect(appMock.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: false,
        args: ["--hidden"],
      });
      expect(result).toEqual({ success: true });
    });
  });
});

describe("[20260926_Issue404] syncLoginItemAtStartup (settings win)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when the real login item already matches the setting", () => {
    withPlatform("darwin", () => {
      appMock.getLoginItemSettings.mockReturnValue({ openAtLogin: true });
      loginItem.syncLoginItemAtStartup(makeDb(true), makeLogger());
      expect(appMock.setLoginItemSettings).not.toHaveBeenCalled();
    });
  });

  it("forces the real login item ON to match a persisted true", () => {
    withPlatform("darwin", () => {
      appMock.getLoginItemSettings.mockReturnValue({ openAtLogin: false });
      const logger = makeLogger();
      loginItem.syncLoginItemAtStartup(makeDb(true), logger);
      expect(appMock.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: true,
      });
      expect(logger.info).toHaveBeenCalled();
    });
  });

  it("forces the real login item OFF to match a persisted false", () => {
    withPlatform("win32", () => {
      appMock.getLoginItemSettings.mockReturnValue({ openAtLogin: true });
      loginItem.syncLoginItemAtStartup(makeDb(false), makeLogger());
      expect(appMock.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: false,
        args: ["--hidden"],
      });
    });
  });

  it("reads the setting with the strict false default", () => {
    withPlatform("darwin", () => {
      appMock.getLoginItemSettings.mockReturnValue({ openAtLogin: false });
      const db = makeDb(undefined);
      loginItem.syncLoginItemAtStartup(db, makeLogger());
      expect(db.getSetting).toHaveBeenCalledWith("auto_start", false);
      expect(appMock.setLoginItemSettings).not.toHaveBeenCalled();
    });
  });

  it("degrades to a logged warning when the db read throws, without propagating", () => {
    withPlatform("darwin", () => {
      const logger = makeLogger();
      const db = {
        getSetting: vi.fn(() => {
          throw new Error("db closed");
        }),
      };
      expect(() => loginItem.syncLoginItemAtStartup(db, logger)).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
      expect(appMock.setLoginItemSettings).not.toHaveBeenCalled();
    });
  });

  it("degrades to a logged warning when the electron app API throws", () => {
    withPlatform("darwin", () => {
      const logger = makeLogger();
      appMock.getLoginItemSettings.mockImplementation(() => {
        throw new Error("app API unavailable");
      });
      expect(() =>
        loginItem.syncLoginItemAtStartup(makeDb(true), logger),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});

describe("[20260926_Issue404] isLoginItemLaunch", () => {
  it("on Windows detects the --hidden argv marker", () => {
    withPlatform("win32", () => {
      const realArgv = process.argv;
      Object.defineProperty(process, "argv", {
        value: [...realArgv, "--hidden"],
        configurable: true,
      });
      try {
        expect(loginItem.isLoginItemLaunch(makeLogger())).toBe(true);
      } finally {
        Object.defineProperty(process, "argv", {
          value: realArgv,
          configurable: true,
        });
      }
    });
  });

  it("on Windows without the marker returns false", () => {
    withPlatform("win32", () => {
      expect(loginItem.isLoginItemLaunch(makeLogger())).toBe(false);
    });
  });

  it("on macOS detects a wasOpenedAtLogin login launch", () => {
    withPlatform("darwin", () => {
      appMock.getLoginItemSettings.mockReturnValue({
        openAtLogin: true,
        wasOpenedAtLogin: true,
      });
      expect(loginItem.isLoginItemLaunch(makeLogger())).toBe(true);
    });
  });

  it("on macOS returns false for a normal launch", () => {
    withPlatform("darwin", () => {
      appMock.getLoginItemSettings.mockReturnValue({
        openAtLogin: true,
        wasOpenedAtLogin: false,
      });
      expect(loginItem.isLoginItemLaunch(makeLogger())).toBe(false);
    });
  });

  it("on other platforms returns false", () => {
    withPlatform("linux", () => {
      expect(loginItem.isLoginItemLaunch(makeLogger())).toBe(false);
    });
  });

  it("degrades to false with a logged warning when the app query throws", () => {
    withPlatform("darwin", () => {
      const logger = makeLogger();
      appMock.getLoginItemSettings.mockImplementation(() => {
        throw new Error("app API unavailable");
      });
      expect(loginItem.isLoginItemLaunch(logger)).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});

describe("[20260926_Issue404] hideMainWindowOnLoginLaunch", () => {
  it("hides a live main window at login launch", () => {
    withPlatform("darwin", () => {
      appMock.getLoginItemSettings.mockReturnValue({
        openAtLogin: true,
        wasOpenedAtLogin: true,
      });
      const hide = vi.fn();
      const logger = makeLogger();
      loginItem.hideMainWindowOnLoginLaunch(
        makeWindowManager({ isDestroyed: () => false, hide }),
        logger,
      );
      expect(hide).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalled();
    });
  });

  it("is a no-op when not a login launch", () => {
    withPlatform("darwin", () => {
      appMock.getLoginItemSettings.mockReturnValue({
        openAtLogin: true,
        wasOpenedAtLogin: false,
      });
      const hide = vi.fn();
      loginItem.hideMainWindowOnLoginLaunch(
        makeWindowManager({ isDestroyed: () => false, hide }),
        makeLogger(),
      );
      expect(hide).not.toHaveBeenCalled();
    });
  });

  it("is a no-op when there is no main window", () => {
    withPlatform("darwin", () => {
      appMock.getLoginItemSettings.mockReturnValue({
        openAtLogin: true,
        wasOpenedAtLogin: true,
      });
      const logger = makeLogger();
      expect(() =>
        loginItem.hideMainWindowOnLoginLaunch(makeWindowManager(null), logger),
      ).not.toThrow();
    });
  });
});
