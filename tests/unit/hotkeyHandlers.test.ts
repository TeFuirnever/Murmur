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

// Mock electron — hotkeyHandlers imports BrowserWindow for the F2 path
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

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
      registerF2DoubleClick: vi.fn(() => true),
      setRecordingState: vi.fn(),
      getRecordingState: vi.fn(() => false),
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
    it("registers all 7 hotkey channels", async () => {
      const C = await setup();

      const expectedChannels = [
        C.HOTKEY.REGISTER,
        C.HOTKEY.UNREGISTER,
        C.HOTKEY.GET_CURRENT,
        C.HOTKEY.REGISTER_F2,
        C.HOTKEY.UNREGISTER_F2,
        C.HOTKEY.SET_STATE,
        C.HOTKEY.GET_STATE,
      ];

      for (const channel of expectedChannels) {
        expect(registeredHandlers.has(channel)).toBe(true);
      }
      expect(registeredHandlers.size).toBeGreaterThanOrEqual(7);
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
      expect(registeredHandlers.has("register-f2-hotkey")).toBe(true);
      expect(registeredHandlers.has("unregister-f2-hotkey")).toBe(true);
      expect(registeredHandlers.has("set-recording-state")).toBe(true);
      expect(registeredHandlers.has("get-recording-state")).toBe(true);
      // Sanity: contract symbols match literal strings
      expect(C.HOTKEY.REGISTER).toBe("register-hotkey");
      expect(C.HOTKEY.GET_STATE).toBe("get-recording-state");
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

    it("filters out the F2 key and returns the main hotkey", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.GET_CURRENT)!;
      // [20260726_TypeGate_HotkeyHandlers] mockHotkeyManager indexed access is
      // possibly-undefined; the method is populated in beforeEach so assert.
      mockHotkeyManager.getRegisteredHotkeys!.mockReturnValueOnce([
        "F2",
        "CommandOrControl+Shift+Space",
      ]);

      const result = (await handler(mockEvent)) as string;
      expect(result).toBe("CommandOrControl+Shift+Space");
    });
  });

  describe("HOTKEY.REGISTER_F2 handler", () => {
    it("calls hotkeyManager.registerF2DoubleClick on first registration", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER_F2)!;

      const result = (await handler(mockEvent)) as HandlerResult;
      expect(result.success).toBe(true);
      expect(mockHotkeyManager.registerF2DoubleClick).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it("skips registerF2DoubleClick on a second sender (already registered)", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.REGISTER_F2)!;

      await handler(mockEvent);
      // [20260726_TypeGate_HotkeyHandlers] mockHotkeyManager indexed access is
      // possibly-undefined; the method is populated in beforeEach so assert.
      mockHotkeyManager.registerF2DoubleClick!.mockClear();

      // Second sender — different id
      const secondEvent = { sender: { id: 2, on: vi.fn() } };
      const result = (await handler(secondEvent)) as HandlerResult;
      expect(result.success).toBe(true);
      expect(mockHotkeyManager.registerF2DoubleClick).not.toHaveBeenCalled();
    });
  });

  describe("HOTKEY.UNREGISTER_F2 handler", () => {
    it("returns success when sender had previously registered F2", async () => {
      const C = await setup();
      const registerHandler = registeredHandlers.get(C.HOTKEY.REGISTER_F2)!;
      const unregisterHandler = registeredHandlers.get(C.HOTKEY.UNREGISTER_F2)!;

      await registerHandler(mockEvent);
      const result = (await unregisterHandler(mockEvent)) as HandlerResult;
      expect(result.success).toBe(true);
    });

    it("returns failure when sender had not registered F2", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.UNREGISTER_F2)!;

      const result = (await handler(mockEvent)) as HandlerResult;
      expect(result.success).toBe(false);
    });
  });

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

  describe("HOTKEY.GET_STATE handler", () => {
    it("returns the recording state from hotkeyManager.getRecordingState", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.HOTKEY.GET_STATE)!;
      // [20260726_TypeGate_HotkeyHandlers] mockHotkeyManager indexed access is
      // possibly-undefined; the method is populated in beforeEach so assert.
      mockHotkeyManager.getRecordingState!.mockReturnValueOnce(true);

      const result = (await handler(mockEvent)) as HandlerResult;
      expect(result.success).toBe(true);
      expect(result.isRecording).toBe(true);
      expect(mockHotkeyManager.getRecordingState).toHaveBeenCalled();
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
      const handler = registeredHandlers.get(C.HOTKEY.GET_STATE)!;

      const result = (await handler(mockEvent)) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("未初始化");
    });
  });
});
