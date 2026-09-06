// @vitest-environment jsdom
// [20260905_Fix_246_HotkeySettingsUi] Regression tests for issue #246.
//
// The settings window's failure toast pointed at a hotkey entry that did not
// exist: App.tsx hardcoded "CommandOrControl+Shift+Space" at startup, the
// persisted "hotkey" setting had no read side in the main window and no UI in
// the settings window. Contract set closed here:
//
// 1. buildAccelerator — pure keydown→Electron-accelerator mapping used by the
//    settings recorder (modifier+key required, Escape cancels, F-keys allowed
//    bare).
// 2. useHotkey — registering a DIFFERENT combo unregisters the previously
//    registered one first (otherwise the second registration adds instead of
//    replaces).
// 3. Settings contract — DEFAULT_SETTINGS carries the hotkey default.
// 4. GeneralSection — the hotkey recorder UI writes through onInputChange.
import "../setup/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: "zh-CN", changeLanguage: vi.fn() },
  }),
}));

import {
  buildAccelerator,
  formatAccelerator,
} from "../../src/settings/hotkeyRecorder";
import { useHotkey } from "../../src/hooks/useHotkey";
import { DEFAULT_SETTINGS } from "../../src/settings/useSettings";
import { GeneralSection } from "../../src/settings/sections/GeneralSection";
import type { SettingsState } from "../../src/settings/useSettings";
import type { ElectronAPI } from "../../src/electronAPI";

describe("[20260905_Fix_246_HotkeySettingsUi] buildAccelerator", () => {
  function keyEvent(init: KeyboardEventInit): KeyboardEvent {
    return new KeyboardEvent("keydown", init);
  }

  it("maps ctrl+shift+letter to a CommandOrControl accelerator", () => {
    expect(
      buildAccelerator(
        keyEvent({ key: "k", ctrlKey: true, shiftKey: true, code: "KeyK" }),
      ),
    ).toBe("CommandOrControl+Shift+K");
  });

  it("maps meta (Cmd) the same as ctrl", () => {
    expect(
      buildAccelerator(keyEvent({ key: "j", metaKey: true, code: "KeyJ" })),
    ).toBe("CommandOrControl+J");
  });

  it("maps alt and space", () => {
    expect(
      buildAccelerator(keyEvent({ key: " ", altKey: true, code: "Space" })),
    ).toBe("Alt+Space");
  });

  it("maps digits and arrows", () => {
    expect(
      buildAccelerator(keyEvent({ key: "1", ctrlKey: true, code: "Digit1" })),
    ).toBe("CommandOrControl+1");
    expect(
      buildAccelerator(
        keyEvent({ key: "ArrowUp", ctrlKey: true, code: "ArrowUp" }),
      ),
    ).toBe("CommandOrControl+Up");
  });

  it("allows bare F-keys (valid single-part accelerators)", () => {
    expect(buildAccelerator(keyEvent({ key: "F5", code: "F5" }))).toBe("F5");
  });

  it("rejects combos without a modifier (except F-keys)", () => {
    expect(buildAccelerator(keyEvent({ key: "k", code: "KeyK" }))).toBeNull();
  });

  // [20260905_Fix_249_CoveragePush] arrow-map and space main-key arms.
  it("maps arrows with a modifier via the arrow code map", () => {
    expect(
      buildAccelerator(
        keyEvent({ key: "ArrowDown", code: "ArrowDown", ctrlKey: true }),
      ),
    ).toBe("CommandOrControl+Down");
  });

  it("maps the space key to the Space token", () => {
    expect(
      buildAccelerator(keyEvent({ key: " ", code: "Space", shiftKey: true })),
    ).toBe("Shift+Space");
  });

  it("rejects modifier-only presses", () => {
    expect(buildAccelerator(keyEvent({ key: "Shift", shiftKey: true }))).toBe(
      null,
    );
  });

  it("returns null for Escape so the recorder can cancel", () => {
    expect(buildAccelerator(keyEvent({ key: "Escape" }))).toBeNull();
  });
});

type TestWindow = Omit<Window, "electronAPI"> & { electronAPI?: ElectronAPI };

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

describe("[20260905_Fix_246_HotkeySettingsUi] useHotkey hotkey change", () => {
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

  it("registers a different combo without renderer-side unregister", async () => {
    // [20260905_Fix_246_HotkeyReplaceAtomic] Replace semantics moved wholly
    // to the main process (atomic: new combo first, old released after
    // success — see hotkeyHandlers.test.ts). The renderer only issues
    // REGISTER; a pre-unregister here previously left no live combo after a
    // failed registration while both layers believed the old one was.
    const registerHotkeyIpc = vi.fn().mockResolvedValue({ success: true });
    const unregisterHotkeyIpc = vi.fn().mockResolvedValue({ success: true });
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub({
      registerHotkey: registerHotkeyIpc,
      unregisterHotkey: unregisterHotkeyIpc,
    });

    const { result } = renderHook(() => useHotkey());

    await act(async () => {
      await result.current.registerHotkey("CommandOrControl+Shift+Space");
    });

    await act(async () => {
      await result.current.registerHotkey("CommandOrControl+Shift+K");
    });

    expect(unregisterHotkeyIpc).not.toHaveBeenCalled();
    expect(registerHotkeyIpc).toHaveBeenLastCalledWith(
      "CommandOrControl+Shift+K",
    );
    expect(result.current.rawHotkey).toBe("CommandOrControl+Shift+K");
  });

  it("dedups a repeated registration of the same combo", async () => {
    // [20260905_Fix_249_CoveragePush] The ref-based dedup: the second
    // registerHotkey with the identical combo must not hit the IPC bridge.
    const registerHotkeyIpc = vi.fn().mockResolvedValue({ success: true });
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub({
      registerHotkey: registerHotkeyIpc,
    });

    const { result } = renderHook(() => useHotkey());

    await act(async () => {
      await result.current.registerHotkey("CommandOrControl+Shift+Space");
    });
    await act(async () => {
      await result.current.registerHotkey("CommandOrControl+Shift+Space");
    });

    expect(registerHotkeyIpc).toHaveBeenCalledTimes(1);
  });

  it("survives a rejected unregister IPC", async () => {
    // [20260905_Fix_249_CoveragePush] The catch arm: unregister failures are
    // logged, never thrown to the caller.
    const unregisterHotkeyIpc = vi.fn().mockRejectedValue(new Error("bridge"));
    const logIpc = vi.fn().mockResolvedValue(undefined);
    (globalThis.window as TestWindow).electronAPI = makeElectronAPIStub({
      unregisterHotkey: unregisterHotkeyIpc,
      log: logIpc,
    });

    const { result } = renderHook(() => useHotkey());

    await expect(
      act(async () => {
        await result.current.unregisterHotkey("CommandOrControl+Shift+Space");
      }),
    ).resolves.toBeUndefined();
    expect(logIpc).toHaveBeenCalledWith(
      "error",
      "注销热键失败:",
      expect.any(Error),
    );
  });
});

// [20260905_Fix_249_CoveragePush] Pure display formatter arms: the default
// Space label and separator rendering for non-space accelerators.
describe("[20260905_Fix_249_CoveragePush] formatAccelerator", () => {
  it("defaults the Space label to the word Space", () => {
    expect(formatAccelerator("CommandOrControl+Shift+Space")).toContain(
      "Space",
    );
  });

  it("renders a non-space accelerator with separators", () => {
    expect(formatAccelerator("CommandOrControl+Shift+K")).toMatch(
      /(⌘|Ctrl) \+ ⇧ \+ K/,
    );
  });
});

describe("[20260905_Fix_246_HotkeySettingsUi] settings contract", () => {
  it("defaults the hotkey setting to the historical combo", () => {
    expect(DEFAULT_SETTINGS.hotkey).toBe("CommandOrControl+Shift+Space");
  });
});

describe("[20260905_Fix_246_HotkeySettingsUi] GeneralSection hotkey recorder", () => {
  const BASE: SettingsState = {
    ...DEFAULT_SETTINGS,
    ai_api_key: "",
  };

  function setup(overrides: Partial<SettingsState> = {}) {
    const onInputChange = vi.fn();
    render(
      <GeneralSection
        settings={{ ...BASE, ...overrides }}
        onInputChange={onInputChange}
      />,
    );
    return { onInputChange };
  }

  it("renders the current hotkey setting", () => {
    setup({ hotkey: "CommandOrControl+Shift+Space" });
    // formatAccelerator renders the human-facing form (Space → 空格).
    expect(screen.getByTestId("hotkey-current").textContent).toContain("空格");
  });

  it("captures a new combo and writes it through onInputChange", () => {
    const { onInputChange } = setup({ hotkey: "CommandOrControl+Shift+Space" });

    fireEvent.click(screen.getByTestId("hotkey-record"));
    const zone = screen.getByTestId("hotkey-capture");
    fireEvent.keyDown(zone, {
      key: "k",
      ctrlKey: true,
      shiftKey: true,
      code: "KeyK",
    });

    expect(onInputChange).toHaveBeenCalledWith(
      "hotkey",
      "CommandOrControl+Shift+K",
    );
  });

  it("Escape cancels recording without writing", () => {
    const { onInputChange } = setup();

    fireEvent.click(screen.getByTestId("hotkey-record"));
    fireEvent.keyDown(screen.getByTestId("hotkey-capture"), {
      key: "Escape",
    });

    expect(onInputChange).not.toHaveBeenCalled();
  });

  it("ignores modifier-only presses while recording", () => {
    const { onInputChange } = setup();

    fireEvent.click(screen.getByTestId("hotkey-record"));
    fireEvent.keyDown(screen.getByTestId("hotkey-capture"), {
      key: "Shift",
      shiftKey: true,
    });

    expect(onInputChange).not.toHaveBeenCalled();
  });
});
