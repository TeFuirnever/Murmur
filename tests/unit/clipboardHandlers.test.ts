// [20260725_TDD_ClipboardHandlers] TDD tests for clipboardHandlers.ts
// Tests verify channel registration completeness + key handler behaviors.
//
// [20260726_TypeGate_ClipboardHandlers] Re-enabled in the tsconfig.test.json
// typecheck gate. Two strict-mode patterns surface here:
//  (A) TS18046 — handlers are typed (...args: unknown[]) => unknown, so each
//      `const result = await handler(...)` reads fields on `unknown`. Fix:
//      cast at the assignment site to HandlerResult (success/error).
//  (B) TS18048 — mockClipboardManager is Record<string, ReturnType<typeof vi.fn>>,
//      so indexed access is possibly-undefined. Methods are populated in
//      beforeEach, so mockImplementationOnce sites take a non-null assertion.
//      The happy-path toHaveBeenCalledWith assertions are already fine.
// Template reference: tests/unit/modelHandlers.test.ts (MockHandler + casts).
// [20260726_TypeGate_ClipboardHandlers] END
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron — dialog is referenced by sibling handlers but kept for parity
vi.mock("electron", () => ({
  dialog: {
    showMessageBox: vi.fn(),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
}));

// [20260726_TypeGate_ClipboardHandlers] Structural shape for handler return
// values read in assertions. Handlers are typed (...args: unknown[]) => unknown.
interface HandlerResult {
  success: boolean;
  error?: string;
}

describe("clipboardHandlers", () => {
  let registeredHandlers: Map<string, (...args: unknown[]) => unknown>;
  let mockIpcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => void;
  };
  let mockManagers: Record<string, unknown>;
  let mockClipboardManager: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers = new Map();
    mockIpcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    };

    mockClipboardManager = {
      // [20260815_Refactor_DeadIpc] Method names mirror
      // src/helpers/ipc/clipboardHandlers.ts: copyText, pasteText. The
      // readClipboard/writeClipboard channels were removed with their
      // zero-renderer-caller handlers.
      copyText: vi.fn(async (text: string) => ({ success: true, text })),
      pasteText: vi.fn(async (text: string) => ({ success: true, text })),
    };

    mockManagers = {
      clipboardManager: mockClipboardManager,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
  });

  async function setup() {
    const { register } =
      await import("../../src/helpers/ipc/clipboardHandlers");
    register(mockIpcMain as never, mockManagers as never);
    return await import("../../src/helpers/ipc-contracts");
  }

  describe("register() — channel registration completeness", () => {
    it("registers both clipboard channels with correct names from ipc-contracts", async () => {
      const C = await setup();

      const expectedChannels = [C.CLIPBOARD.COPY, C.CLIPBOARD.PASTE];

      for (const channel of expectedChannels) {
        expect(registeredHandlers.has(channel)).toBe(true);
      }
      expect(registeredHandlers.size).toBeGreaterThanOrEqual(2);
    });

    it("registers channels with the exact string names defined in ipc-contracts", async () => {
      const C = await setup();
      // Verify the literal channel names match the contract values — guards
      // against silent renames that would break the preload/main bridge.
      expect(C.CLIPBOARD.COPY).toBe("copy-text");
      expect(C.CLIPBOARD.PASTE).toBe("paste-text");

      expect(registeredHandlers.has("copy-text")).toBe(true);
      expect(registeredHandlers.has("paste-text")).toBe(true);
    });

    it("does not register duplicate channels", async () => {
      await setup();
      const channels = Array.from(registeredHandlers.keys());
      const unique = new Set(channels);
      expect(channels.length).toBe(unique.size);
    });
  });

  describe("CLIPBOARD.PASTE handler", () => {
    it("calls clipboardManager.pasteText with the provided text", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.PASTE)!;

      const result = await handler({}, "hello-paste");
      expect(mockClipboardManager.pasteText).toHaveBeenCalledWith(
        "hello-paste",
      );
      expect(result).toEqual({ success: true, text: "hello-paste" });
    });

    it("returns error result when pasteText throws", async () => {
      // [20260726_TypeGate_ClipboardHandlers] mockClipboardManager indexed
      // access is possibly-undefined; the method is populated in beforeEach.
      mockClipboardManager.pasteText!.mockImplementationOnce(() => {
        throw new Error("paste failed");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.PASTE)!;

      const result = (await handler({}, "boom")) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("paste failed");
    });
  });

  describe("CLIPBOARD.COPY handler", () => {
    it("calls clipboardManager.copyText with the provided text", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.COPY)!;

      const result = await handler({}, "hello-copy");
      // Source delegates COPY to clipboardManager.copyText (the manager's own
      // writeText-style method), NOT a writeText method.
      expect(mockClipboardManager.copyText).toHaveBeenCalledWith("hello-copy");
      expect(result).toEqual({ success: true, text: "hello-copy" });
    });

    it("returns error result when copyText throws", async () => {
      // [20260726_TypeGate_ClipboardHandlers] mockClipboardManager indexed
      // access is possibly-undefined; the method is populated in beforeEach.
      mockClipboardManager.copyText!.mockImplementationOnce(() => {
        throw new Error("copy failed");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.COPY)!;

      const result = (await handler({}, "boom")) as HandlerResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("copy failed");
    });
  });
});
