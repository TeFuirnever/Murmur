// [20260926_Issue405] Issue #405 (minimize_to_tray): main-process
// minimize-interception module (src/helpers/minimizeToTray.ts) contract:
//   1. readMinimizeToTraySetting(db, logger) — the persisted value with the
//      STRICT `=== true` gate and the historical default FALSE (mirror image
//      of the `!== false` gates whose defaults are on; same shape as
//      auto_start in #404). A thrown db read degrades to "off" (normal
//      minimize) WITH a logged warning — no silent swallow (AGENTS.md rule).
//   2. isMinimizeToTraySupportedPlatform() — win32 only. macOS minimizes
//      into the Dock by system convention and is already tray-resident via
//      close_behavior "hide"; minimize→tray is non-idiomatic there (issue
//      #405 macOS decision, downgrade documented in the ticket).
//   3. interceptMinimizeToTray(win, readEnabled, logger?) — attaches the
//      `minimize` listener ONLY on a supported platform (attach-time gate:
//      on macOS no listener ever exists, so the yellow-button minimize
//      keeps the stock system path). When enabled, a minimize is converted
//      to preventDefault + hide() — silent by design: TrayManager has no
//      notification channel, and the ticket's "仅首次提示" balloon was
//      downgraded to hide-only (surgical priority).
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as minimizeToTray from "../../src/helpers/minimizeToTray";

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

interface FakeWindow {
  on: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
}

function makeWindow(): FakeWindow & Electron.BrowserWindow {
  return {
    on: vi.fn(),
    hide: vi.fn(),
  } as unknown as FakeWindow & Electron.BrowserWindow;
}

type MinimizeHandler = (event: {
  preventDefault: ReturnType<typeof vi.fn>;
}) => void;

/** Install `interceptMinimizeToTray` on the fake window, return the handler. */
function attachAndCapture(win: FakeWindow): MinimizeHandler {
  minimizeToTray.interceptMinimizeToTray(
    win as unknown as Electron.BrowserWindow,
    () => true,
  );
  expect(win.on).toHaveBeenCalledWith("minimize", expect.any(Function));
  return win.on.mock.calls.find(
    (c) => c[0] === "minimize",
  )![1] as MinimizeHandler;
}

describe("[20260926_Issue405] readMinimizeToTraySetting", () => {
  it("reads true only for a persisted boolean true (strict === true)", () => {
    const db = { getSetting: vi.fn(() => true) };
    expect(minimizeToTray.readMinimizeToTraySetting(db, makeLogger())).toBe(
      true,
    );
    expect(db.getSetting).toHaveBeenCalledWith("minimize_to_tray", false);
  });

  it("reads every non-true stored value as off (strict default-false gate)", () => {
    for (const stored of [false, undefined, "true", 1]) {
      const db = { getSetting: vi.fn(() => stored) };
      expect(minimizeToTray.readMinimizeToTraySetting(db, makeLogger())).toBe(
        false,
      );
    }
  });

  it("degrades to off WITH a logged warning when the db read throws", () => {
    const logger = makeLogger();
    const db = {
      getSetting: vi.fn(() => {
        throw new Error("db closed");
      }),
    };
    expect(minimizeToTray.readMinimizeToTraySetting(db, logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("[20260926_Issue405] isMinimizeToTraySupportedPlatform", () => {
  it("is true on Windows (the only supported platform)", () => {
    withPlatform("win32", () => {
      expect(minimizeToTray.isMinimizeToTraySupportedPlatform()).toBe(true);
    });
  });

  it("is false on macOS (yellow-button minimize keeps the system convention)", () => {
    withPlatform("darwin", () => {
      expect(minimizeToTray.isMinimizeToTraySupportedPlatform()).toBe(false);
    });
  });

  it("is false on other platforms", () =>
    withPlatform("linux", () => {
      expect(minimizeToTray.isMinimizeToTraySupportedPlatform()).toBe(false);
    }));
});

describe("[20260926_Issue405] interceptMinimizeToTray", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("on win32 + enabled: preventDefault + hide, and never close/destroy", () => {
    withPlatform("win32", () => {
      const win = makeWindow();
      const handler = attachAndCapture(win);
      const event = { preventDefault: vi.fn() };

      handler(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(win.hide).toHaveBeenCalledTimes(1);
      expect(win.on).toHaveBeenCalledTimes(1); // only the minimize listener
    });
  });

  it("on win32 + disabled: the default minimize proceeds untouched", () => {
    withPlatform("win32", () => {
      const win = makeWindow();
      minimizeToTray.interceptMinimizeToTray(
        win as unknown as Electron.BrowserWindow,
        () => false,
      );
      const handler = win.on.mock.calls.find(
        (c) => c[0] === "minimize",
      )![1] as MinimizeHandler;
      const event = { preventDefault: vi.fn() };

      handler(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(win.hide).not.toHaveBeenCalled();
    });
  });

  it("reads the setting live at minimize time (flip after attach)", () => {
    withPlatform("win32", () => {
      const win = makeWindow();
      let enabled = false;
      minimizeToTray.interceptMinimizeToTray(
        win as unknown as Electron.BrowserWindow,
        () => enabled,
      );
      const handler = win.on.mock.calls.find(
        (c) => c[0] === "minimize",
      )![1] as MinimizeHandler;

      enabled = false;
      handler({ preventDefault: vi.fn() });
      expect(win.hide).not.toHaveBeenCalled();

      enabled = true;
      handler({ preventDefault: vi.fn() });
      expect(win.hide).toHaveBeenCalledTimes(1);
    });
  });

  it("on macOS attaches NO listener at all (attach-time gate; stock minimize untouched)", () => {
    withPlatform("darwin", () => {
      const win = makeWindow();
      minimizeToTray.interceptMinimizeToTray(
        win as unknown as Electron.BrowserWindow,
        () => true,
      );
      expect(win.on).not.toHaveBeenCalled();
    });
  });

  it("on other platforms attaches no listener either", () => {
    withPlatform("linux", () => {
      const win = makeWindow();
      minimizeToTray.interceptMinimizeToTray(
        win as unknown as Electron.BrowserWindow,
        () => true,
      );
      expect(win.on).not.toHaveBeenCalled();
    });
  });

  it("hides silently (no notification channel exists — issue #405 downgrade)", () => {
    withPlatform("win32", () => {
      const logger = makeLogger();
      const win = makeWindow();
      minimizeToTray.interceptMinimizeToTray(
        win as unknown as Electron.BrowserWindow,
        () => true,
        logger,
      );
      const handler = win.on.mock.calls.find(
        (c) => c[0] === "minimize",
      )![1] as MinimizeHandler;
      handler({ preventDefault: vi.fn() });
      // The only observable is the log line — no Notification is constructed.
      expect(logger.info).toHaveBeenCalled();
    });
  });
});
