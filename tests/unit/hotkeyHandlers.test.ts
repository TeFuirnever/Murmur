// [20260725_TDD_HotkeyHandlers] TDD tests for hotkeyHandlers.ts
// Tests verify channel registration completeness + key handler behaviors.
//
// [20260726_TypeGate_HotkeyHandlers] Re-enabled in the tsconfig.test.json
// typecheck gate. Two strict-mode patterns surface here:
//  (A) TS18046 — handlers are typed (...args: unknown[]) => unknown, so each
//      `const result = await handler(...)` reads fields on `unknown`. Fix:
//      cast at the assignment site to HandlerResult (success/error/isRecording)
//      or to string for the GET_CURRENT getter.
//  (B) TS18048 — mockHotkeyManager is Record<string, ReturnType<typeof vi.fn>>,
//      so indexed access is possibly-undefined. Methods are populated in
//      beforeEach, so assertion/mockClear/mockReturnValueOnce sites take a
//      non-null assertion. No `any`.
// Template reference: tests/unit/modelHandlers.test.ts (MockHandler + casts).
// [20260726_TypeGate_HotkeyHandlers] END
import { describe, it, expect, vi, beforeEach } from "vitest";

// [20260816_Refactor_DeadChannels] electron mock removed — hotkeyHandlers
// no longer imports electron after the F2 broadcast path was deleted.

// [20260726_TypeGate_HotkeyHandlers] Structural shape for handler return
// values read in assertions. Handlers are typed (...args: unknown[]) => unknown.
interface HandlerResult {
  success: boolean;
  error?: string;
  isRecording?: boolean;
}

describe("hotkeyHandlers", () => {
  let registeredHandlers: Map<string, (...args: unknown[]) => unknown>;
  let mockIpcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => void;
  };
  let mockHotkeyManager: Record<string, ReturnType<typeof vi.fn>>;
  let mockMainWindow: {
    isDestroyed: ReturnType<typeof vi.fn>;
    webContents: { send: ReturnType<typeof vi.fn> };
  };
  let mockSender: {
    id: number;
    on: ReturnType<typeof vi.fn>;
  };
  let mockEvent: { sender: typeof mockSender };

  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers = new Map();
    mockIpcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    };

    mockHotkeyManager = {
      registerHotkey: vi.fn(() => true),
      unregisterHotkey: vi.fn(() => true),
      getRegisteredHotkeys: vi.fn(() => ["CommandOrControl+Shift+Space"]),
      setRecordingState: vi.fn(),
    };

    mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() },
    };

    mockSender = {
      id: 1,
      on: vi.fn(),
    };

    mockEvent = { sender: mockSender };
  });

  async function setup() {
    const { register } = await import("../../src/helpers/ipc/hotkeyHandlers");
    register(
      mockIpcMain as never,
      {
        hotkeyManager: mockHotkeyManager,
        windowManager: { mainWindow: mockMainWindow },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
    );
    return await import("../../src/helpers/ipc-contracts");
  }

  describe("register() — channel registration completeness", () => {
    // [20260906_Refactor_DeadChannelCleanup] Ticket #250 removed the
    // HOTKEY.GET_STATE channel — 4 hotkey channels remain.
    it("registers all 4 hotkey channels", async () => {
      const C = await setup();

      const expectedChannels = [
        C.HOTKEY.REGISTER,
        C.HOTKEY.UNREGISTER,
        C.HOTKEY.GET_CURRENT,
        C.HOTKEY.SET_STATE,
      ];

      for (const channel of expectedChannels) {
        expect(registeredHandlers.has(channel)).toBe(true);
      }
      expect(registeredHandlers.size).toBeGreaterThanOrEqual(4);
    });

    it("does not register duplicate channels", async () => {
      await setup();
      const channels = Array.from(registeredHandlers.keys());
      const unique = new Set(channels);
      expect(channels.length).toBe(unique.size);
    });

    it("registers channels with the names defined in ipc-contracts", async () => {
      const C = await setup();
      expect(registeredHandlers.has("register-hotkey")).toBe(true);
      expect(registeredHandlers.has("unregister-hotkey")).toBe(true);
      expect(registeredHandlers.has("get-current-hotkey")).toBe(true);
      expect(registeredHandlers.has("set-recording-state")).toBe(true);
      // Sanity: contract symbols match literal strings
      expect(C.HOTKEY.REGISTER).toBe("register-hotkey");
    });
  });

  describe("HOTKEY.REGISTER handler", () => {
    it("calls hotkeyManager.registerHotkey with the hotkey string", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;

      // [20260726_TypeGate_HotkeyHandlers] handler returns unknown; cast to
      // HandlerResult to read success.
      const result = (await handler(
        mockEvent,
        "CommandOrControl+Shift+Space",
      )) as HandlerResult;
      expect(result.success).toBe(true);
      expect(mockHotkeyManager.registerHotkey).toHaveBeenCalledWith(
        "CommandOrControl+Shift+Space",
        expect.any(Function),
      );
    });

    it("registers a destroyed listener on the sender", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;

      await handler(mockEvent, "CommandOrControl+Shift+Space");
      expect(mockSender.on).toHaveBeenCalledWith(
        "destroyed",
        expect.any(Function),
      );
    });

    it("skips duplicate registration from the same sender", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;

      await handler(mockEvent, "CommandOrControl+Shift+Space");
      // [20260726_TypeGate_HotkeyHandlers] mockHotkeyManager indexed access is
      // possibly-undefined; the method is populated in beforeEach so assert.
      mockHotkeyManager.registerHotkey!.mockClear();
      const second = (await handler(
        mockEvent,
        "CommandOrControl+Shift+Space",
      )) as HandlerResult;

      expect(second.success).toBe(true);
      expect(mockHotkeyManager.registerHotkey).not.toHaveBeenCalled();
    });

    it("replaces the hotkey when the same sender registers a different combo", async () => {
      // [20260905_Fix_246_HotkeySettingsUi] The old sender-dedup (a bare
      // per-sender Set) early-returned success on ANY second registration,
      // so a runtime hotkey change silently kept the old combo alive.
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;

      await handler(mockEvent, "CommandOrControl+Shift+Space");
      mockHotkeyManager.registerHotkey!.mockClear();
      mockHotkeyManager.unregisterHotkey!.mockClear();

      const changed = (await handler(
        mockEvent,
        "CommandOrControl+Shift+K",
      )) as HandlerResult;

      expect(changed.success).toBe(true);
      expect(mockHotkeyManager.unregisterHotkey).toHaveBeenCalledWith(
        "CommandOrControl+Shift+Space",
      );
      expect(mockHotkeyManager.registerHotkey).toHaveBeenCalledWith(
        "CommandOrControl+Shift+K",
        expect.any(Function),
      );
    });

    it("leaves the old combo live when a changed registration fails (atomic replace)", async () => {
      // [20260905_Fix_246_HotkeyReplaceAtomic] The replace must be atomic:
      // the new combo is attempted FIRST and the old one is released only
      // after success. The previous two-layer replace (renderer pre-unregister
      // + handler unregister-before-register) could leave NO combo live after
      // a failed registration while both layers believed the old one was —
      // reverting then hit the dedup early-return and never re-registered:
      // a permanently dead hotkey reported as success.
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;

      await handler(mockEvent, "CommandOrControl+Shift+Space");
      mockHotkeyManager.registerHotkey!.mockReturnValueOnce(false);
      mockHotkeyManager.unregisterHotkey!.mockClear();

      const changed = (await handler(
        mockEvent,
        "CommandOrControl+Shift+K",
      )) as HandlerResult;

      // Failure: nothing was released — the old combo is genuinely live.
      expect(changed.success).toBe(false);
      expect(mockHotkeyManager.unregisterHotkey).not.toHaveBeenCalled();
      // Reverting to the old combo dedups against the intact mapping.
      mockHotkeyManager.registerHotkey!.mockClear();
      const reverted = (await handler(
        mockEvent,
        "CommandOrControl+Shift+Space",
      )) as HandlerResult;
      expect(reverted.success).toBe(true);
      expect(mockHotkeyManager.registerHotkey).not.toHaveBeenCalled();
    });

    it("releases the old combo only after the replacement succeeds", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;

      await handler(mockEvent, "CommandOrControl+Shift+Space");
      mockHotkeyManager.registerHotkey!.mockClear();
      mockHotkeyManager.unregisterHotkey!.mockClear();

      // Enforce the ordering: register(new) must be attempted BEFORE
      // unregister(previous) — a failure between them must be impossible.
      const callOrder: string[] = [];
      mockHotkeyManager.registerHotkey!.mockImplementation(() => {
        callOrder.push("register");
        return true;
      });
      mockHotkeyManager.unregisterHotkey!.mockImplementation(() => {
        callOrder.push("unregister");
        return true;
      });

      const changed = (await handler(
        mockEvent,
        "CommandOrControl+Shift+K",
      )) as HandlerResult;

      expect(changed.success).toBe(true);
      expect(callOrder).toEqual(["register", "unregister"]);
      expect(mockHotkeyManager.unregisterHotkey).toHaveBeenCalledWith(
        "CommandOrControl+Shift+Space",
      );
    });

    it("returns failure when hotkeyManager is null", async () => {
      const { register } = await import("../../src/helpers/ipc/hotkeyHandlers");
      registeredHandlers.clear();
      register(
        mockIpcMain as never,
        {
          hotkeyManager: null,
          windowManager: { mainWindow: mockMainWindow },
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as never,
      );
      const C = await import("../../src/helpers/ipc-contracts");
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;

      const result = (await handler(
        mockEvent,
        "CommandOrControl+Shift+Space",
      )) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("未初始化");
    });
  });

  describe("HOTKEY.UNREGISTER handler", () => {
    it("calls hotkeyManager.unregisterHotkey with the hotkey", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.UNREGISTER)!;

      const result = (await handler(
        mockEvent,
        "CommandOrControl+Shift+Space",
      )) as HandlerResult;
      expect(result.success).toBe(true);
      expect(mockHotkeyManager.unregisterHotkey).toHaveBeenCalledWith(
        "CommandOrControl+Shift+Space",
      );
    });
  });

  describe("HOTKEY.GET_CURRENT handler", () => {
    it("returns the main hotkey from getRegisteredHotkeys", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.GET_CURRENT)!;

      // [20260726_TypeGate_HotkeyHandlers] GET_CURRENT returns the hotkey
      // string (not an object); cast unknown to string.
      const result = (await handler(mockEvent)) as string;
      expect(mockHotkeyManager.getRegisteredHotkeys).toHaveBeenCalled();
      expect(result).toBe("CommandOrControl+Shift+Space");
    });

    // [20260816_Refactor_DeadChannels] F2-filter case removed — F2 can no
    // longer be registered, so GET_CURRENT returns the first hotkey as-is.

    // [20260816_Refactor_DeadChannels] REGISTER_F2/UNREGISTER_F2 handler
    // describes removed with the zero-renderer-caller F2 chain.
  });
  // (Closer restored: the scripted F2 deletion had consumed GET_CURRENT's
  // closing brace and mis-nested the describes below.)

  describe("HOTKEY.SET_STATE handler", () => {
    it("calls hotkeyManager.setRecordingState with the boolean", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.SET_STATE)!;

      const result = (await handler(mockEvent, true)) as HandlerResult;
      expect(result.success).toBe(true);
      expect(mockHotkeyManager.setRecordingState).toHaveBeenCalledWith(true);
    });

    it("returns failure when hotkeyManager is null", async () => {
      const { register } = await import("../../src/helpers/ipc/hotkeyHandlers");
      registeredHandlers.clear();
      register(
        mockIpcMain as never,
        {
          hotkeyManager: null,
          windowManager: { mainWindow: mockMainWindow },
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as never,
      );
      const C = await import("../../src/helpers/ipc-contracts");
      const handler = registeredHandlers.get(C.HOTKEY.SET_STATE)!;

      const result = (await handler(mockEvent, true)) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("未初始化");
    });
  });

  // [20260906_Refactor_DeadChannelCleanup] Ticket #250: the HOTKEY.GET_STATE
  // handler describe block was removed with the handler (zero renderer
  // callers); its success/failure arms pinned a deleted channel.

  // ======================================================================
  // [20260906_Spec259_T3] Trigger-callback, sender-cleanup and error-path
  // arms (Spec #259 T3, #275).
  // ======================================================================

  describe("HOTKEY.REGISTER — trigger callback", () => {
    it("sends HOTKEY_TRIGGERED to a live main window when the hotkey fires", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;
      await handler(mockEvent, "CommandOrControl+Shift+Space");

      const trigger = mockHotkeyManager.registerHotkey!.mock
        .calls[0]![1] as () => void;
      trigger();

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        C.EVENTS.HOTKEY_TRIGGERED,
        { hotkey: "CommandOrControl+Shift+Space" },
      );
    });

    it("is a no-op when the main window is gone", async () => {
      const { register } = await import("../../src/helpers/ipc/hotkeyHandlers");
      registeredHandlers.clear();
      register(
        mockIpcMain as never,
        {
          hotkeyManager: mockHotkeyManager,
          windowManager: { mainWindow: null },
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as never,
      );
      const C = await import("../../src/helpers/ipc-contracts");
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;
      await handler(mockEvent, "CommandOrControl+Shift+Space");

      const trigger = mockHotkeyManager.registerHotkey!.mock
        .calls[0]![1] as () => void;
      expect(() => trigger()).not.toThrow();
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
    });

    it("does not send to a destroyed main window", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;
      mockMainWindow.isDestroyed = vi.fn(() => true);
      await handler(mockEvent, "CommandOrControl+Shift+Space");

      const trigger = mockHotkeyManager.registerHotkey!.mock
        .calls[0]![1] as () => void;
      trigger();
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe("HOTKEY.REGISTER — sender destroyed cleanup", () => {
    it("drops the sender mapping on destroyed so re-registration rebinds", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;
      await handler(mockEvent, "CommandOrControl+Shift+Space");

      const destroyed = mockSender.on.mock.calls[0]![1] as () => void;
      destroyed();

      // With the mapping gone, the same combo must be REGISTERED again
      // (not deduped) and a fresh destroyed listener attached.
      mockHotkeyManager.registerHotkey!.mockClear();
      await handler(mockEvent, "CommandOrControl+Shift+Space");
      expect(mockHotkeyManager.registerHotkey).toHaveBeenCalledTimes(1);
      expect(mockSender.on).toHaveBeenCalledTimes(2);
    });
  });

  describe("error paths (Spec #259 T3)", () => {
    it("REGISTER returns a failure shape when registerHotkey throws", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER)!;
      mockHotkeyManager.registerHotkey!.mockImplementation(() => {
        throw new Error("accelerator rejected");
      });
      const result = (await handler(
        mockEvent,
        "CommandOrControl+Shift+Space",
      )) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toBe("accelerator rejected");
    });

    it("UNREGISTER returns a failure shape when hotkeyManager is null", async () => {
      const { register } = await import("../../src/helpers/ipc/hotkeyHandlers");
      registeredHandlers.clear();
      register(
        mockIpcMain as never,
        {
          hotkeyManager: null,
          windowManager: { mainWindow: mockMainWindow },
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as never,
      );
      const C = await import("../../src/helpers/ipc-contracts");
      const handler = registeredHandlers.get(C.HOTKEY.UNREGISTER)!;
      const result = (await handler(
        mockEvent,
        "CommandOrControl+Shift+Space",
      )) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("未初始化");
    });

    it("UNREGISTER returns a failure shape when unregisterHotkey throws", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.UNREGISTER)!;
      mockHotkeyManager.unregisterHotkey!.mockImplementation(() => {
        throw new Error("unregister blew up");
      });
      const result = (await handler(
        mockEvent,
        "CommandOrControl+Shift+Space",
      )) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toBe("unregister blew up");
    });

    it("GET_CURRENT falls back to the default when hotkeyManager is null", async () => {
      const { register } = await import("../../src/helpers/ipc/hotkeyHandlers");
      registeredHandlers.clear();
      register(
        mockIpcMain as never,
        {
          hotkeyManager: null,
          windowManager: { mainWindow: mockMainWindow },
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as never,
      );
      const C = await import("../../src/helpers/ipc-contracts");
      const handler = registeredHandlers.get(C.HOTKEY.GET_CURRENT)!;
      const result = (await handler(mockEvent)) as string;
      expect(result).toBe("CommandOrControl+Shift+Space");
    });

    it("GET_CURRENT falls back to the default when nothing is registered", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.GET_CURRENT)!;
      mockHotkeyManager.getRegisteredHotkeys!.mockReturnValueOnce([]);
      const result = (await handler(mockEvent)) as string;
      expect(result).toBe("CommandOrControl+Shift+Space");
    });

    it("GET_CURRENT falls back to the default when the lookup throws", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.GET_CURRENT)!;
      mockHotkeyManager.getRegisteredHotkeys!.mockImplementation(() => {
        throw new Error("lookup failed");
      });
      const result = (await handler(mockEvent)) as string;
      expect(result).toBe("CommandOrControl+Shift+Space");
    });

    it("SET_STATE returns a failure shape when setRecordingState throws", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.SET_STATE)!;
      mockHotkeyManager.setRecordingState!.mockImplementation(() => {
        throw new Error("state blew up");
      });
      const result = (await handler(mockEvent, true)) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toBe("state blew up");
    });
  });
});
