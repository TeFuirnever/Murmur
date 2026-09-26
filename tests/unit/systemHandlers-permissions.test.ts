// [20260926_Fix_396_PermissionStatus] Issue #396: the settings permission
// badges must reflect the REAL OS permission state, not a session flag. The
// main process answers over a new SYSTEM.PERMISSION_STATUS channel:
//   - macOS: systemPreferences.getMediaAccessStatus("microphone") for the
//     mic, and systemPreferences.isTrustedAccessibilityClient(false) (a pure
//     AXIsProcessTrusted query — no prompt) for accessibility.
//   - Windows: getMediaAccessStatus is real for the mic (global privacy
//     setting), but Windows has no accessibility permission model — the
//     handler reports "unsupported" instead of pretending.
//   - Any systemPreferences failure degrades to "unknown" WITH a logger.warn
//     (repo rule: no silent error swallowing) so the UI shows no fake badge.
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as C from "../../src/helpers/ipc-contracts";
import * as sysHandlers from "../../src/helpers/ipc/systemHandlers";
import type { PermissionStatusResult } from "../../src/types/ipc";

const systemPreferencesMock = vi.hoisted(() => ({
  getMediaAccessStatus: vi.fn<(mediaType: string) => string>(),
  isTrustedAccessibilityClient: vi.fn<(prompt: boolean) => boolean>(),
}));

vi.mock("electron", () => ({
  app: { getVersion: vi.fn(() => "9.9.9-test") },
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

describe("SYSTEM.PERMISSION_STATUS handler (#396)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is registered on the SYSTEM.PERMISSION_STATUS channel", () => {
    const { handlers, restore } = setup("darwin");
    try {
      expect(handlers[C.SYSTEM.PERMISSION_STATUS]).toBeTypeOf("function");
    } finally {
      restore();
    }
  });

  it("reports real macOS mic + accessibility status without prompting", async () => {
    systemPreferencesMock.getMediaAccessStatus.mockReturnValue("granted");
    systemPreferencesMock.isTrustedAccessibilityClient.mockReturnValue(true);
    const { handlers, restore } = setup("darwin");
    try {
      const result = (await handlers[C.SYSTEM.PERMISSION_STATUS]!(
        {},
      )) as PermissionStatusResult;
      expect(result).toEqual({
        microphone: "granted",
        accessibility: "granted",
      });
      expect(systemPreferencesMock.getMediaAccessStatus).toHaveBeenCalledWith(
        "microphone",
      );
      // prompt=false: a pure status query, never the system prompt.
      expect(
        systemPreferencesMock.isTrustedAccessibilityClient,
      ).toHaveBeenCalledWith(false);
    } finally {
      restore();
    }
  });

  it("maps an untrusted accessibility client to denied on macOS", async () => {
    systemPreferencesMock.getMediaAccessStatus.mockReturnValue("granted");
    systemPreferencesMock.isTrustedAccessibilityClient.mockReturnValue(false);
    const { handlers, restore } = setup("darwin");
    try {
      const result = (await handlers[C.SYSTEM.PERMISSION_STATUS]!(
        {},
      )) as PermissionStatusResult;
      expect(result.accessibility).toBe("denied");
    } finally {
      restore();
    }
  });

  it("passes non-granted macOS mic statuses through untouched", async () => {
    systemPreferencesMock.getMediaAccessStatus.mockReturnValue(
      "not-determined",
    );
    systemPreferencesMock.isTrustedAccessibilityClient.mockReturnValue(true);
    const { handlers, restore } = setup("darwin");
    try {
      const result = (await handlers[C.SYSTEM.PERMISSION_STATUS]!(
        {},
      )) as PermissionStatusResult;
      expect(result.microphone).toBe("not-determined");
    } finally {
      restore();
    }
  });

  it("on Windows reports the real mic status but marks accessibility unsupported", async () => {
    systemPreferencesMock.getMediaAccessStatus.mockReturnValue("granted");
    const { handlers, restore } = setup("win32");
    try {
      const result = (await handlers[C.SYSTEM.PERMISSION_STATUS]!(
        {},
      )) as PermissionStatusResult;
      expect(result.microphone).toBe("granted");
      expect(result.accessibility).toBe("unsupported");
      expect(
        systemPreferencesMock.isTrustedAccessibilityClient,
      ).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("degrades to unknown with a logged warning when systemPreferences throws", async () => {
    systemPreferencesMock.getMediaAccessStatus.mockImplementation(() => {
      throw new Error("systemPreferences unavailable");
    });
    const { handlers, logger, restore } = setup("darwin");
    try {
      const result = (await handlers[C.SYSTEM.PERMISSION_STATUS]!(
        {},
      )) as PermissionStatusResult;
      expect(result).toEqual({
        microphone: "unknown",
        accessibility: "unknown",
      });
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
