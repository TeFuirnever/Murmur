// @vitest-environment jsdom
// [20260926_Fix_401_PermissionI18n] Issue #401: every user-visible string in
// usePermissions (dialog title/description, alert fallback, pasted test-text
// marker) must resolve through i18n so an English UI never shows Chinese
// feedback. Each branch is driven in English mode and asserted against the
// en locale resources directly — a hardcoded Chinese string cannot equal the
// en value, so this fails red until the hook is key-ized.
import "../setup/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePermissions } from "../../src/hooks/usePermissions";
import i18n from "../../src/i18n";
import en from "../../src/i18n/locales/en.json";
import zhCN from "../../src/i18n/locales/zh-CN.json";

const enP = en.settings.permissions;
const zhP = zhCN.settings.permissions;

// ElectronAPI partial stub: the hook only touches pasteText, log and
// getPermissionStatus (same narrowing rationale as hooks.test.tsx).
function stubElectronAPI(overrides: Record<string, unknown> = {}): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    pasteText: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    getPermissionStatus: vi.fn().mockResolvedValue({
      microphone: "not-determined",
      accessibility: "not-determined",
    }),
    ...overrides,
  };
}

describe("[20260926_Fix_401_PermissionI18n] usePermissions i18n copy", () => {
  let originalAlert: typeof window.alert;
  let alertMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalAlert = window.alert;
    alertMock = vi.fn();
    // Cast through unknown: window.alert's signature is narrower than the
    // generic Mock type, and the assertion target stays the mock itself.
    (window as unknown as { alert: typeof window.alert }).alert =
      alertMock as unknown as typeof window.alert;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });
    stubElectronAPI();
  });

  afterEach(async () => {
    (window as unknown as { alert: typeof window.alert }).alert = originalAlert;
    await i18n.changeLanguage("zh-CN");
    vi.clearAllMocks();
  });

  it("mic success dialog copy resolves through i18n in English", async () => {
    await i18n.changeLanguage("en");
    (
      navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({});
    const showDialog = vi.fn();
    const { result } = renderHook(() => usePermissions(showDialog));

    await act(async () => {
      await result.current.requestMicPermission();
    });

    expect(showDialog).toHaveBeenCalledWith({
      title: enP.micTestSuccessTitle,
      description: enP.micTestSuccessDesc,
    });
  });

  it("mic failure dialog copy resolves through i18n in English", async () => {
    await i18n.changeLanguage("en");
    (
      navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("denied"));
    const showDialog = vi.fn();
    const { result } = renderHook(() => usePermissions(showDialog));

    await act(async () => {
      await result.current.requestMicPermission();
    });

    expect(showDialog).toHaveBeenCalledWith({
      title: enP.micTestFailedTitle,
      description: enP.micTestFailedDesc,
    });
  });

  it("mic failure alert fallback copy resolves through i18n in English", async () => {
    await i18n.changeLanguage("en");
    (
      navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("denied"));
    // No dialog callback → the alert() fallback path.
    const { result } = renderHook(() => usePermissions());

    await act(async () => {
      await result.current.requestMicPermission();
    });

    expect(alertMock).toHaveBeenCalledWith(enP.micTestFailedAlert);
  });

  it("accessibility success dialog and pasted marker resolve through i18n in English", async () => {
    await i18n.changeLanguage("en");
    const showDialog = vi.fn();
    const { result } = renderHook(() => usePermissions(showDialog));

    await act(async () => {
      await result.current.testAccessibilityPermission();
    });

    expect(showDialog).toHaveBeenCalledWith({
      title: enP.accessibilityTestSuccessTitle,
      description: enP.accessibilityTestSuccessDesc,
    });
    const electronAPI = (
      window as unknown as {
        electronAPI: { pasteText: ReturnType<typeof vi.fn> };
      }
    ).electronAPI;
    expect(electronAPI.pasteText).toHaveBeenCalledWith(
      enP.accessibilityPasteText,
    );
  });

  it("accessibility failure dialog and alert fallback resolve through i18n in English", async () => {
    await i18n.changeLanguage("en");
    stubElectronAPI({
      pasteText: vi.fn(() => Promise.reject(new Error("denied"))),
    });
    const showDialog = vi.fn();
    const { result } = renderHook(() => usePermissions(showDialog));

    await act(async () => {
      await result.current.testAccessibilityPermission();
    });

    expect(showDialog).toHaveBeenCalledWith({
      title: enP.accessibilityTestFailedTitle,
      description: enP.accessibilityTestFailedDesc,
    });

    // Same branch without the dialog callback → alert fallback copy.
    const { result: result2 } = renderHook(() => usePermissions());
    await act(async () => {
      await result2.current.testAccessibilityPermission();
    });
    expect(alertMock).toHaveBeenCalledWith(enP.accessibilityTestFailedAlert);
  });

  it("accessibility unavailable branch (missing pasteText) resolves through i18n in English", async () => {
    await i18n.changeLanguage("en");
    stubElectronAPI({ pasteText: undefined });
    const showDialog = vi.fn();
    const { result } = renderHook(() => usePermissions(showDialog));

    await act(async () => {
      await result.current.testAccessibilityPermission();
    });

    expect(showDialog).toHaveBeenCalledWith({
      title: enP.apiUnavailableTitle,
      description: enP.apiUnavailableDesc,
    });
  });

  it("keeps zh-CN copy identical to the zh locale resources", async () => {
    await i18n.changeLanguage("zh-CN");
    (
      navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("denied"));
    const showDialog = vi.fn();
    const { result } = renderHook(() => usePermissions(showDialog));

    await act(async () => {
      await result.current.requestMicPermission();
    });

    expect(showDialog).toHaveBeenCalledWith({
      title: zhP.micTestFailedTitle,
      description: zhP.micTestFailedDesc,
    });
  });
});
