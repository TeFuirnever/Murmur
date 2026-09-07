// [20260906_Test_HotkeyManagerBehavior] Spec #266 T07 (#284): behavior tests
// for the global hotkey manager — previously zero coverage (research doc G5).
// Mocks electron.globalShortcut and asserts external behavior: registration
// success/duplicate/failure logging and state, the 200ms double-trigger
// debounce (per-hotkey independence), unregistration (single + all), and the
// recording-state mirror.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted keeps the mock usable inside the hoisted vi.mock factory.
const mockGlobalShortcut = vi.hoisted(() => ({
  register: vi.fn<(hotkey: string, callback: () => void) => boolean>(
    () => true,
  ),
  unregister: vi.fn<(hotkey: string) => void>(),
  unregisterAll: vi.fn<() => void>(),
}));

vi.mock("electron", () => ({
  globalShortcut: mockGlobalShortcut,
}));

import HotkeyManager from "../../src/helpers/hotkeyManager";

describe("[20260906_Test_HotkeyManagerBehavior] HotkeyManager", () => {
  let logger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let manager: HotkeyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGlobalShortcut.register.mockReturnValue(true);
    logger = { info: vi.fn(), error: vi.fn() };
    manager = new HotkeyManager(
      logger as unknown as ConstructorParameters<typeof HotkeyManager>[0],
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("registerHotkey", () => {
    it("registers a new hotkey, logs success, and tracks it", () => {
      const ok = manager.registerHotkey("F2", () => {});

      expect(ok).toBe(true);
      expect(mockGlobalShortcut.register).toHaveBeenCalledWith(
        "F2",
        expect.any(Function),
      );
      expect(manager.isHotkeyRegistered("F2")).toBe(true);
      expect(manager.getRegisteredHotkeys()).toContain("F2");
      expect(logger.info).toHaveBeenCalledWith("热键 F2 注册成功");
    });

    it("returns false and logs an error when global registration fails", () => {
      mockGlobalShortcut.register.mockReturnValueOnce(false);
      const ok = manager.registerHotkey("Cmd+Shift+Space", () => {});

      expect(ok).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "热键 Cmd+Shift+Space 注册失败",
      );
      expect(manager.isHotkeyRegistered("Cmd+Shift+Space")).toBe(false);
    });

    it("skips duplicate registration but still reports success", () => {
      manager.registerHotkey("F2", () => {});
      const callsBefore = mockGlobalShortcut.register.mock.calls.length;

      const ok = manager.registerHotkey("F2", () => {});

      expect(ok).toBe(true);
      expect(mockGlobalShortcut.register.mock.calls.length).toBe(callsBefore);
      expect(logger.info).toHaveBeenCalledWith("热键 F2 已注册，跳过重复注册");
    });
  });

  describe("debounce", () => {
    it("suppresses a second trigger within the debounce window", () => {
      const callback = vi.fn();
      manager.registerHotkey("F2", callback);
      const registered = mockGlobalShortcut.register.mock.calls[0]?.[1];

      registered?.();
      vi.advanceTimersByTime(100);
      registered?.();
      expect(callback).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(300);
      registered?.();
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it("debounces per hotkey: a different hotkey fires immediately", () => {
      const first = vi.fn();
      const second = vi.fn();
      manager.registerHotkey("F2", first);
      manager.registerHotkey("F3", second);
      const f2 = mockGlobalShortcut.register.mock.calls[0]?.[1];
      const f3 = mockGlobalShortcut.register.mock.calls[1]?.[1];

      f2?.();
      f3?.();
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe("unregistration", () => {
    it("unregisters a known hotkey and reports it", () => {
      manager.registerHotkey("F2", () => {});

      const ok = manager.unregisterHotkey("F2");

      expect(ok).toBe(true);
      expect(mockGlobalShortcut.unregister).toHaveBeenCalledWith("F2");
      expect(manager.isHotkeyRegistered("F2")).toBe(false);
      expect(logger.info).toHaveBeenCalledWith("热键 F2 已注销");
    });

    it("returns false for an unknown hotkey without touching global state", () => {
      const ok = manager.unregisterHotkey("F9");

      expect(ok).toBe(false);
      expect(mockGlobalShortcut.unregister).not.toHaveBeenCalled();
    });

    it("unregisterAllHotkeys clears global shortcuts and local tracking", () => {
      manager.registerHotkey("F2", () => {});
      manager.registerHotkey("F3", () => {});

      manager.unregisterAllHotkeys();

      expect(mockGlobalShortcut.unregisterAll).toHaveBeenCalledTimes(1);
      expect(manager.getRegisteredHotkeys()).toEqual([]);
      expect(manager.isHotkeyRegistered("F2")).toBe(false);
      expect(logger.info).toHaveBeenCalledWith("所有热键已注销");
    });
  });

  describe("recording state mirror", () => {
    it("stores and reports the recording state", () => {
      expect(manager.getRecordingState()).toBe(false);
      manager.setRecordingState(true);
      expect(manager.getRecordingState()).toBe(true);
      manager.setRecordingState(false);
      expect(manager.getRecordingState()).toBe(false);
    });
  });
});
