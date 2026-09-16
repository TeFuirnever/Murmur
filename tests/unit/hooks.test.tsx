// @vitest-environment jsdom
// [20260729_Test_Hooks] Integration tests for useWindowDrag and usePermissions
// hooks. Uses renderHook from RTL. Tests user-visible behavior of the hooks.
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWindowDrag } from "../../src/hooks/useWindowDrag";
import { usePermissions } from "../../src/hooks/usePermissions";

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

  beforeEach(() => {
    originalAlert = window.alert;
    (window as unknown as { alert: typeof window.alert }).alert = vi.fn();
    // Stub mediaDevices for mic permission tests
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(),
      },
      configurable: true,
    });
    // Stub electronAPI
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      pasteText: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
    };
  });

  afterEach(() => {
    (window as unknown as { alert: typeof window.alert }).alert = originalAlert;
    vi.clearAllMocks();
  });

  it("initializes with both permissions false", () => {
    const { result } = renderHook(() => usePermissions());
    expect(result.current.micPermissionGranted).toBe(false);
    expect(result.current.accessibilityPermissionGranted).toBe(false);
  });

  it("grants mic permission when getUserMedia succeeds", async () => {
    (
      navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({});

    const { result } = renderHook(() => usePermissions());

    await act(async () => {
      await result.current.requestMicPermission();
    });

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

  it("grants accessibility permission when pasteText succeeds", async () => {
    const { result } = renderHook(() => usePermissions());

    await act(async () => {
      await result.current.testAccessibilityPermission();
    });

    expect(result.current.accessibilityPermissionGranted).toBe(true);
  });

  it("denies accessibility when electronAPI.pasteText is unavailable", async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {};
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
