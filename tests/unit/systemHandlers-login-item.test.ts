// [20260926_Issue404] Issue #404: the SYSTEM.SET_LOGIN_ITEM handler
// (systemHandlers.ts) applies the renderer's auto_start toggle to the OS
// login item through the loginItem module. Contract:
//   - Registered on the C.SYSTEM.SET_LOGIN_ITEM channel.
//   - Enabled=true → app.setLoginItemSettings({ openAtLogin: true, ... }).
//   - The boolean is coerced strictly (only literal true enables).
//   - A failure inside the apply path returns { success:false, error } and
//     is logged (no silent swallow).
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as C from "../../src/helpers/ipc-contracts";
import * as sysHandlers from "../../src/helpers/ipc/systemHandlers";

const systemPreferencesMock = vi.hoisted(() => ({
  getMediaAccessStatus: vi.fn<(mediaType: string) => string>(),
  isTrustedAccessibilityClient: vi.fn<(prompt: boolean) => boolean>(),
}));

const appMock = vi.hoisted(() => ({
  getVersion: vi.fn(() => "0.0.0-test"),
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
}));

vi.mock("electron", () => ({
  app: appMock,
  shell: { openExternal: vi.fn() },
  systemPreferences: systemPreferencesMock,
}));

type MockHandler = (...args: unknown[]) => unknown;

function setup(platform: NodeJS.Platform) {
  const handlers: Record<string, MockHandler | undefined> = {};
  const ipcMain = {
    handle: vi.fn((channel: string, fn: MockHandler) => {
      handlers[channel] = fn;
    }),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const realPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  sysHandlers.register(
    ipcMain as unknown as Parameters<typeof sysHandlers.register>[0],
    { logger } as unknown as Parameters<typeof sysHandlers.register>[1],
  );
  return {
    handlers,
    logger,
    restore: () => {
      Object.defineProperty(process, "platform", {
        value: realPlatform,
        configurable: true,
      });
    },
  };
}

describe("SYSTEM.SET_LOGIN_ITEM handler (#404)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is registered on the SYSTEM.SET_LOGIN_ITEM channel", () => {
    const { handlers, restore } = setup("darwin");
    try {
      expect(handlers[C.SYSTEM.SET_LOGIN_ITEM]).toBeTypeOf("function");
    } finally {
      restore();
    }
  });

  it("enables the login item with openAtLogin on macOS", () => {
    const { handlers, restore } = setup("darwin");
    try {
      const result = handlers[C.SYSTEM.SET_LOGIN_ITEM]!({}, true) as {
        success: boolean;
      };
      expect(appMock.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: true,
      });
      expect(result.success).toBe(true);
    } finally {
      restore();
    }
  });

  it("disables the login item on Windows with the launch marker payload", () => {
    const { handlers, restore } = setup("win32");
    try {
      const result = handlers[C.SYSTEM.SET_LOGIN_ITEM]!({}, false) as {
        success: boolean;
      };
      expect(appMock.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: false,
        args: ["--hidden"],
      });
      expect(result.success).toBe(true);
    } finally {
      restore();
    }
  });

  it("coerces non-literal-true values to disabled (strict boolean gate)", () => {
    const { handlers, restore } = setup("darwin");
    try {
      handlers[C.SYSTEM.SET_LOGIN_ITEM]!({}, "yes");
      expect(appMock.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: false,
      });
    } finally {
      restore();
    }
  });

  it("returns a failure envelope and warns when the apply throws", () => {
    const { handlers, logger, restore } = setup("darwin");
    try {
      appMock.setLoginItemSettings.mockImplementation(() => {
        throw new Error("login item API failed");
      });
      const result = handlers[C.SYSTEM.SET_LOGIN_ITEM]!({}, true) as {
        success: boolean;
        error?: string;
      };
      expect(result.success).toBe(false);
      expect(result.error).toBeTypeOf("string");
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
