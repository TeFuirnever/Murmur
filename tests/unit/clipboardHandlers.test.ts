// [20260725_TDD_ClipboardHandlers] TDD tests for clipboardHandlers.ts
// Tests verify channel registration completeness + key handler behaviors.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron — dialog is referenced by sibling handlers but kept for parity
vi.mock("electron", () => ({
  dialog: {
    showMessageBox: vi.fn(),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
}));

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
      // Method names mirror src/helpers/ipc/clipboardHandlers.ts:
      // copyText, pasteText, readClipboard, writeClipboard.
      copyText: vi.fn(async (text: string) => ({ success: true, text })),
      pasteText: vi.fn(async (text: string) => ({ success: true, text })),
      readClipboard: vi.fn(async () => "clip-content"),
      writeClipboard: vi.fn(async (text: string) => ({ success: true, text })),
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
    it("registers all 4 clipboard channels with correct names from ipc-contracts", async () => {
      const C = await setup();

      const expectedChannels = [
        C.CLIPBOARD.COPY,
        C.CLIPBOARD.PASTE,
        C.CLIPBOARD.READ,
        C.CLIPBOARD.WRITE,
      ];

      for (const channel of expectedChannels) {
        expect(registeredHandlers.has(channel)).toBe(true);
      }
      expect(registeredHandlers.size).toBeGreaterThanOrEqual(4);
    });

    it("registers channels with the exact string names defined in ipc-contracts", async () => {
      const C = await setup();
      // Verify the literal channel names match the contract values — guards
      // against silent renames that would break the preload/main bridge.
      expect(C.CLIPBOARD.COPY).toBe("copy-text");
      expect(C.CLIPBOARD.PASTE).toBe("paste-text");
      expect(C.CLIPBOARD.READ).toBe("read-clipboard");
      expect(C.CLIPBOARD.WRITE).toBe("write-clipboard");

      expect(registeredHandlers.has("copy-text")).toBe(true);
      expect(registeredHandlers.has("paste-text")).toBe(true);
      expect(registeredHandlers.has("read-clipboard")).toBe(true);
      expect(registeredHandlers.has("write-clipboard")).toBe(true);
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
      mockClipboardManager.pasteText.mockImplementationOnce(() => {
        throw new Error("paste failed");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.PASTE)!;

      const result = await handler({}, "boom");
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
      mockClipboardManager.copyText.mockImplementationOnce(() => {
        throw new Error("copy failed");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.COPY)!;

      const result = await handler({}, "boom");
      expect(result.success).toBe(false);
      expect(result.error).toContain("copy failed");
    });
  });

  describe("CLIPBOARD.READ handler", () => {
    it("calls clipboardManager.readClipboard and wraps result in { success, text }", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.READ)!;

      const result = await handler({});
      expect(mockClipboardManager.readClipboard).toHaveBeenCalled();
      expect(result).toEqual({ success: true, text: "clip-content" });
    });

    it("returns error result when readClipboard throws", async () => {
      mockClipboardManager.readClipboard.mockImplementationOnce(() => {
        throw new Error("read failed");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.READ)!;

      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toContain("read failed");
    });
  });

  describe("CLIPBOARD.WRITE handler", () => {
    it("calls clipboardManager.writeClipboard with the provided text", async () => {
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.WRITE)!;

      const result = await handler({}, "hello-write");
      expect(mockClipboardManager.writeClipboard).toHaveBeenCalledWith(
        "hello-write",
      );
      expect(result).toEqual({ success: true, text: "hello-write" });
    });

    it("returns error result when writeClipboard throws", async () => {
      mockClipboardManager.writeClipboard.mockImplementationOnce(() => {
        throw new Error("write failed");
      });
      const C = await setup();
      const handler = registeredHandlers.get(C.CLIPBOARD.WRITE)!;

      const result = await handler({}, "boom");
      expect(result.success).toBe(false);
      expect(result.error).toContain("write failed");
    });
  });
});
