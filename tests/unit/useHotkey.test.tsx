// [20260729_Test_Hooks] Unit tests for the useHotkey React hook. Runs under
// jsdom because the hook uses React state/effects and `navigator.userAgent`.
// We render the hook via @testing-library/react's renderHook and exercise the
// IPC-facing surface (register/unregister/sync) and the returned shape.
// @vitest-environment jsdom
import "../setup/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useHotkey } from "../../src/hooks/useHotkey";
import type { ElectronAPI } from "../../src/electronAPI";

// [20260729_Test_Hooks] The production declaration makes `electronAPI`
// required on window, but this test installs/tears down its own stub.
// Omit the required prop and re-add as optional. Cast through unknown only.
type TestWindow = Omit<Window, "electronAPI"> & { electronAPI?: ElectronAPI };

// [20260729_Test_Hooks] Builder for a minimal ElectronAPI stub covering only
// the methods useHotkey touches. Methods are vi.fn() so call sites and return
// values can be asserted. `log` is optional in the hook (guarded by
// `window.electronAPI.log` truthiness), but we provide it so error paths can
// be exercised.
function makeElectronAPIStub(
  overrides: Partial<ElectronAPI> = {},
): ElectronAPI {
  return {
    getCurrentHotkey: vi.fn().mockResolvedValue("CommandOrControl+Shift+Space"),
    registerHotkey: vi.fn().mockResolvedValue({ success: true }),
    unregisterHotkey: vi.fn().mockResolvedValue({ success: true }),
    setRecordingState: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ElectronAPI;
}

// [20260905_Test_BranchRecovery] No-bridge arms: every IPC call in the hook
// guards `window.electronAPI` and every catch guards an optional `log` —
// exercise both sides so the guards are pinned, not just painted green by
// the full stub.
describe("useHotkey without a bridge", () => {
  const asWin = () => globalThis.window as TestWindow;

  afterEach(() => {
    delete asWin().electronAPI;
  });

  it("survives mount, register, unregister and sync with no electronAPI", async () => {
    delete asWin().electronAPI;
    const { result } = renderHook(() => useHotkey());
    await act(async () => {
      await result.current.registerHotkey("CmdOrCtrl+K");
      await result.current.unregisterHotkey();
      await result.current.syncRecordingState(true);
    });
    expect(result.current.hotkey).toBeTruthy();
  });

  it("logs nothing when the bridge exists but log() does not", async () => {
    const stub = makeElectronAPIStub({
      registerHotkey: vi.fn().mockRejectedValue(new Error("boom")),
      unregisterHotkey: vi.fn().mockRejectedValue(new Error("boom")),
      getCurrentHotkey: vi.fn().mockRejectedValue(new Error("boom")),
    });
    delete (stub as Partial<ElectronAPI>).log;
    asWin().electronAPI = stub;
    const { result } = renderHook(() => useHotkey());
    await act(async () => {
      await result.current.registerHotkey("CmdOrCtrl+K");
      await result.current.unregisterHotkey();
      await result.current.syncRecordingState(false);
    });
    expect(result.current.hotkey).toBeTruthy();
  });

  it("swallows failure results (success: false) without state changes", async () => {
    asWin().electronAPI = makeElectronAPIStub({
      registerHotkey: vi.fn().mockResolvedValue({ success: false }),
      unregisterHotkey: vi.fn().mockResolvedValue({ success: false }),
    });
    const { result } = renderHook(() => useHotkey());
    await act(async () => {
      await result.current.registerHotkey("CmdOrCtrl+K");
      await result.current.unregisterHotkey();
    });
    expect(result.current.isRegistered).toBe(false);
  });
});

describe("useHotkey hook", () => {
  let originalAPI: ElectronAPI | undefined;

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow).electronAPI;
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) {
      delete win.electronAPI;
    } else {
      win.electronAPI = originalAPI;
    }
    vi.restoreAllMocks();
  });

  it("exposes the expected return shape", () => {
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub();
    const { result } = renderHook(() => useHotkey());

    expect(typeof result.current.hotkey).toBe("string");
    expect(typeof result.current.rawHotkey).toBe("string");
    expect(typeof result.current.isRegistered).toBe("boolean");
    expect(typeof result.current.registerHotkey).toBe("function");
    expect(typeof result.current.unregisterHotkey).toBe("function");
    expect(typeof result.current.syncRecordingState).toBe("function");
  });

  it("reports the raw default hotkey and a formatted display string on mount", () => {
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub();
    const { result } = renderHook(() => useHotkey());

    // rawHotkey is the unformatted accelerator; hotkey is the display string.
    expect(result.current.rawHotkey).toBe("CommandOrControl+Shift+Space");
    // formatHotkey replaces Shift→⇧, Space→空格, and joins with " + ". The
    // CommandOrControl→⌘/Ctrl branch is platform-dependent, so assert only on
    // the stable symbols to keep the test deterministic across jsdom variants.
    expect(result.current.hotkey).toContain("⇧");
    expect(result.current.hotkey).toContain("空格");
    expect(result.current.hotkey).toContain(" + ");
    expect(result.current.hotkey).not.toContain("Shift");
    expect(result.current.hotkey).not.toContain("Space");
  });

  it("loads the persisted hotkey from getCurrentHotkey on mount", async () => {
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub({
      getCurrentHotkey: vi.fn().mockResolvedValue("CommandOrControl+Alt+F2"),
    });

    const { result } = renderHook(() => useHotkey());

    await waitFor(() => {
      expect(result.current.rawHotkey).toBe("CommandOrControl+Alt+F2");
    });

    const api = (globalThis.window as TestWindow).electronAPI!;
    expect(api.getCurrentHotkey).toHaveBeenCalledTimes(1);
    // Alt→⌥ is a stable replacement; assert on it plus the raw value already
    // checked above.
    expect(result.current.hotkey).toContain("⌥");
  });

  it("starts with isRegistered=false before any registration", () => {
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub();
    const { result } = renderHook(() => useHotkey());
    expect(result.current.isRegistered).toBe(false);
  });

  it("calls registerHotkey IPC and flips isRegistered on success", async () => {
    const stub = makeElectronAPIStub({
      registerHotkey: vi.fn().mockResolvedValue({ success: true }),
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderHook(() => useHotkey());

    let ok = false;
    await act(async () => {
      ok = await result.current.registerHotkey("CommandOrControl+Shift+R");
    });

    expect(ok).toBe(true);
    expect(stub.registerHotkey).toHaveBeenCalledWith(
      "CommandOrControl+Shift+R",
    );
    expect(result.current.isRegistered).toBe(true);
    expect(result.current.rawHotkey).toBe("CommandOrControl+Shift+R");
  });

  it("returns false and leaves isRegistered false when registration fails", async () => {
    const stub = makeElectronAPIStub({
      registerHotkey: vi.fn().mockResolvedValue({ success: false }),
    });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderHook(() => useHotkey());

    let ok = true;
    await act(async () => {
      ok = await result.current.registerHotkey("CommandOrControl+Shift+R");
    });

    expect(ok).toBe(false);
    expect(result.current.isRegistered).toBe(false);
  });

  it("skips the IPC call when re-registering the already-registered hotkey", async () => {
    const registerHotkey = vi.fn().mockResolvedValue({ success: true });
    const stub = makeElectronAPIStub({ registerHotkey });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderHook(() => useHotkey());

    // First registration hits the IPC.
    await act(async () => {
      await result.current.registerHotkey("CommandOrControl+Shift+R");
    });
    expect(registerHotkey).toHaveBeenCalledTimes(1);

    // Re-registering the same accelerator is a no-op (dedup) -> still 1 call.
    let ok = false;
    await act(async () => {
      ok = await result.current.registerHotkey("CommandOrControl+Shift+R");
    });
    expect(ok).toBe(true);
    expect(registerHotkey).toHaveBeenCalledTimes(1);
  });

  it("logs and returns false when registerHotkey throws", async () => {
    const registerHotkey = vi.fn().mockRejectedValue(new Error("boom"));
    const log = vi.fn().mockResolvedValue(undefined);
    const stub = makeElectronAPIStub({ registerHotkey, log });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderHook(() => useHotkey());

    let ok = true;
    await act(async () => {
      ok = await result.current.registerHotkey("CommandOrControl+Shift+R");
    });

    expect(ok).toBe(false);
    expect(result.current.isRegistered).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "error",
      "注册热键失败:",
      expect.any(Error),
    );
  });

  it("clears isRegistered on successful unregisterHotkey", async () => {
    const registerHotkey = vi.fn().mockResolvedValue({ success: true });
    const unregisterHotkey = vi.fn().mockResolvedValue({ success: true });
    const stub = makeElectronAPIStub({ registerHotkey, unregisterHotkey });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderHook(() => useHotkey());

    await act(async () => {
      await result.current.registerHotkey("CommandOrControl+Shift+R");
    });
    expect(result.current.isRegistered).toBe(true);

    await act(async () => {
      await result.current.unregisterHotkey();
    });

    // unregisterHotkey falls back to the current hotkey when no arg is passed.
    expect(unregisterHotkey).toHaveBeenCalledWith("CommandOrControl+Shift+R");
    expect(result.current.isRegistered).toBe(false);
  });

  it("passes an explicit accelerator to unregisterHotkey", async () => {
    const unregisterHotkey = vi.fn().mockResolvedValue({ success: true });
    const stub = makeElectronAPIStub({ unregisterHotkey });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderHook(() => useHotkey());

    await act(async () => {
      await result.current.unregisterHotkey("CommandOrControl+Shift+F2");
    });

    expect(unregisterHotkey).toHaveBeenCalledWith("CommandOrControl+Shift+F2");
  });

  it("syncRecordingState forwards the boolean to setRecordingState", async () => {
    const setRecordingState = vi.fn().mockResolvedValue(undefined);
    const stub = makeElectronAPIStub({ setRecordingState });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderHook(() => useHotkey());

    await act(async () => {
      await result.current.syncRecordingState(true);
    });
    expect(setRecordingState).toHaveBeenCalledWith(true);

    await act(async () => {
      await result.current.syncRecordingState(false);
    });
    expect(setRecordingState).toHaveBeenCalledWith(false);
  });

  it("logs when syncRecordingState catches an error", async () => {
    const setRecordingState = vi.fn().mockRejectedValue(new Error("nope"));
    const log = vi.fn().mockResolvedValue(undefined);
    const stub = makeElectronAPIStub({ setRecordingState, log });
    (globalThis.window as TestWindow).electronAPI = stub;

    const { result } = renderHook(() => useHotkey());

    await act(async () => {
      await result.current.syncRecordingState(true);
    });

    expect(log).toHaveBeenCalledWith(
      "error",
      "同步录音状态失败:",
      expect.any(Error),
    );
  });

  it("does not throw when window.electronAPI is absent on mount", () => {
    // No stub installed -> electronAPI is undefined. The mount effect and all
    // methods guard on `window.electronAPI`, so nothing should throw.
    const { result } = renderHook(() => useHotkey());

    expect(result.current.rawHotkey).toBe("CommandOrControl+Shift+Space");
    expect(result.current.isRegistered).toBe(false);
  });
});
