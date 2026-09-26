// @vitest-environment jsdom
// [20260729_Test_Hooks] Integration tests for useWindowDrag and usePermissions
// hooks. Uses renderHook from RTL. Tests user-visible behavior of the hooks.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWindowDrag } from "../../src/hooks/useWindowDrag";
import { usePermissions } from "../../src/hooks/usePermissions";
import i18n from "../../src/i18n";

describe("useWindowDrag", () => {
  it("returns drag handlers and initial isDragging=false", () => {
    const { result } = renderHook(() => useWindowDrag());
    expect(result.current.isDragging).toBe(false);
    expect(typeof result.current.handleMouseDown).toBe("function");
    expect(typeof result.current.handleMouseMove).toBe("function");
    expect(typeof result.current.handleMouseUp).toBe("function");
    expect(typeof result.current.handleClick).toBe("function");
  });

  it("sets isDragging=true on mouseDown", () => {
    const { result } = renderHook(() => useWindowDrag());
    act(() => {
      result.current.handleMouseDown({
        clientX: 0,
        clientY: 0,
      } as React.MouseEvent);
    });
    expect(result.current.isDragging).toBe(true);
  });

  it("sets isDragging=false on mouseUp", () => {
    const { result } = renderHook(() => useWindowDrag());
    act(() => {
      result.current.handleMouseDown({
        clientX: 0,
        clientY: 0,
      } as React.MouseEvent);
    });
    expect(result.current.isDragging).toBe(true);
    act(() => {
      result.current.handleMouseUp({} as React.MouseEvent);
    });
    expect(result.current.isDragging).toBe(false);
  });

  it("click returns true when no drag happened", () => {
    const { result } = renderHook(() => useWindowDrag());
    let clickResult = false;
    act(() => {
      clickResult = result.current.handleClick({
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.MouseEvent) as unknown as boolean;
    });
    expect(clickResult).toBe(true);
  });

  it("click returns false after a drag movement >5px", () => {
    const { result } = renderHook(() => useWindowDrag());
    // Start drag
    act(() => {
      result.current.handleMouseDown({
        clientX: 0,
        clientY: 0,
      } as React.MouseEvent);
    });
    // Move >5px to trigger drag detection
    act(() => {
      result.current.handleMouseMove({
        clientX: 10,
        clientY: 0,
      } as React.MouseEvent);
    });
    // Click should be suppressed
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    let clickResult = true;
    act(() => {
      clickResult = result.current.handleClick({
        preventDefault,
        stopPropagation,
      } as unknown as React.MouseEvent) as unknown as boolean;
    });
    expect(clickResult).toBe(false);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });
});

describe("usePermissions", () => {
  let originalAlert: typeof window.alert;

  beforeEach(async () => {
    // [20260926_Fix_401_PermissionI18n] Hook copy resolves through i18n now
    // (#401): pin zh-CN so branch assertions stay language-independent of
    // jsdom's navigator.language (en-US would flip the copy to English).
    await i18n.changeLanguage("zh-CN");
    originalAlert = window.alert;
    (window as unknown as { alert: typeof window.alert }).alert = vi.fn();
    // Stub mediaDevices for mic permission tests
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(),
      },
      configurable: true,
    });
    // Stub electronAPI. getPermissionStatus is the #396 real-status IPC —
    // default to "not-determined" so badges stay false unless a test opts in.
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      pasteText: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
      getPermissionStatus: vi.fn().mockResolvedValue({
        microphone: "not-determined",
        accessibility: "not-determined",
      }),
    };
  });

  afterEach(() => {
    (window as unknown as { alert: typeof window.alert }).alert = originalAlert;
    vi.clearAllMocks();
  });

  it("initializes with both permissions false when IPC reports not-determined", async () => {
    const { result } = renderHook(() => usePermissions());
    await act(async () => {});
    expect(result.current.micPermissionGranted).toBe(false);
    expect(result.current.accessibilityPermissionGranted).toBe(false);
  });

  it("initializes both badges from the real system status via IPC (#396)", async () => {
    (
      window as unknown as {
        electronAPI: { getPermissionStatus: ReturnType<typeof vi.fn> };
      }
    ).electronAPI.getPermissionStatus.mockResolvedValue({
      microphone: "granted",
      accessibility: "granted",
    });

    const { result } = renderHook(() => usePermissions());
    await act(async () => {});

    expect(result.current.micPermissionGranted).toBe(true);
    expect(result.current.accessibilityPermissionGranted).toBe(true);
  });

  it("keeps the mic badge on the real status after a successful test probe (#396)", async () => {
    // IPC says not granted; a successful getUserMedia probe is session
    // feedback (toast) and must NOT fake the granted badge.
    const { result } = renderHook(() => usePermissions());
    (
      navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({});

    await act(async () => {
      await result.current.requestMicPermission();
    });

    expect(result.current.micPermissionGranted).toBe(false);
  });

  it("refreshes the mic badge to granted when the system really granted it", async () => {
    const getPermissionStatus = (
      window as unknown as {
        electronAPI: { getPermissionStatus: ReturnType<typeof vi.fn> };
      }
    ).electronAPI.getPermissionStatus;
    getPermissionStatus.mockResolvedValue({
      microphone: "granted",
      accessibility: "not-determined",
    });

    const { result } = renderHook(() => usePermissions());
    await act(async () => {});
    expect(result.current.micPermissionGranted).toBe(true);
  });

  it("denies mic permission when getUserMedia rejects", async () => {
    (
      navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("Permission denied"));

    const { result } = renderHook(() => usePermissions());

    await act(async () => {
      await result.current.requestMicPermission();
    });

    expect(result.current.micPermissionGranted).toBe(false);
  });

  it("keeps the accessibility badge on the real status after a successful paste probe (#396)", async () => {
    // pasteText succeeding is a session probe — the badge still follows the
    // IPC-reported system status, not the probe result.
    const { result } = renderHook(() => usePermissions());

    await act(async () => {
      await result.current.testAccessibilityPermission();
    });

    expect(result.current.accessibilityPermissionGranted).toBe(false);
  });

  it("denies accessibility when electronAPI.pasteText is unavailable", async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      log: vi.fn(),
      getPermissionStatus: vi.fn().mockResolvedValue({
        microphone: "not-determined",
        accessibility: "not-determined",
      }),
    };
    const showDialog = vi.fn();
    const { result } = renderHook(() => usePermissions(showDialog));

    await act(async () => {
      await result.current.testAccessibilityPermission();
    });

    expect(result.current.accessibilityPermissionGranted).toBe(false);
    expect(showDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("不可用") }),
    );
  });

  it("keeps the accessibility badge non-granted for the Windows unsupported status (#396)", async () => {
    // Windows has no accessibility permission model: the main process
    // reports "unsupported"; the badge must not show as granted.
    (
      window as unknown as {
        electronAPI: { getPermissionStatus: ReturnType<typeof vi.fn> };
      }
    ).electronAPI.getPermissionStatus.mockResolvedValue({
      microphone: "granted",
      accessibility: "unsupported",
    });

    const { result } = renderHook(() => usePermissions());
    await act(async () => {});

    expect(result.current.micPermissionGranted).toBe(true);
    expect(result.current.accessibilityPermissionGranted).toBe(false);
  });

  it("logs a warning and stays non-granted when getPermissionStatus rejects", async () => {
    const electronStub = (
      window as unknown as {
        electronAPI: {
          getPermissionStatus: ReturnType<typeof vi.fn>;
          log: ReturnType<typeof vi.fn>;
        };
      }
    ).electronAPI;
    electronStub.getPermissionStatus.mockRejectedValue(new Error("ipc down"));

    const { result } = renderHook(() => usePermissions());
    await act(async () => {});

    expect(result.current.micPermissionGranted).toBe(false);
    expect(electronStub.log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("权限状态"),
      expect.anything(),
    );
  });

  it("calls showAlertDialog callback for mic success", async () => {
    (
      navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({});
    const showDialog = vi.fn();
    const { result } = renderHook(() => usePermissions(showDialog));

    await act(async () => {
      await result.current.requestMicPermission();
    });

    expect(showDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("✅") }),
    );
  });
});
