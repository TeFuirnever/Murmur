// @vitest-environment jsdom
// [20260729_Test_SettingsPanel_EffectsLayer] React component integration tests
// for SettingsPanel. Exercises user-visible behavior via RTL (Testing Trophy):
// rendering of sections, the close-button callback wiring, and the AI-mode
// select persistence via window.electronAPI. No implementation details are
// asserted. Mocks follow the established pattern in panels.test.tsx:
//   - react-i18next -> t echoes the fallback string (unused here but harmless)
//   - sonner -> toast no-op
//   - usePermissions -> stubbed so we don't exercise navigator.mediaDevices
//   - window.electronAPI -> per-test stub (getSetting/saveSetting)
import "../setup/react";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ElectronAPI } from "../../src/electronAPI";

// Mock sonner: SettingsPanel toasts via the showAlert callback. No-op to keep
// the DOM clean and avoid real toast UI.
vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

// Mock usePermissions: SettingsPanel delegates permission state to this hook.
// Stub it so we control granted state and spy on the request callbacks without
// touching navigator.mediaDevices or window.electronAPI.pasteText.
const mockUsePermissions = {
  micPermissionGranted: false,
  accessibilityPermissionGranted: false,
  requestMicPermission: vi.fn(),
  testAccessibilityPermission: vi.fn(),
};
vi.mock("../../src/hooks/usePermissions", () => ({
  usePermissions: () => mockUsePermissions,
}));

import SettingsPanel from "../../src/components/SettingsPanel";

// Window shape this test manipulates: the production type makes electronAPI
// required, but the test deliberately deletes it, so we Omit the required prop
// and re-add it as optional. Cast through unknown — never `any`, no @ts-ignore.
type TestWindow = Omit<Window, "electronAPI"> & {
  electronAPI?: Partial<ElectronAPI>;
};

function setElectronAPI(api: Partial<ElectronAPI> | undefined): void {
  (globalThis.window as TestWindow).electronAPI = api;
}

describe("[20260729_Test_SettingsPanel_EffectsLayer] SettingsPanel", () => {
  let originalAPI: TestWindow["electronAPI"];

  beforeEach(() => {
    originalAPI = (globalThis.window as TestWindow).electronAPI;
    vi.clearAllMocks();
    // Reset the mocked hook state to defaults before each test.
    mockUsePermissions.micPermissionGranted = false;
    mockUsePermissions.accessibilityPermissionGranted = false;
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) {
      delete win.electronAPI;
    } else {
      win.electronAPI = originalAPI;
    }
  });

  it("renders the panel with its heading and the three section headings", () => {
    render(<SettingsPanel onClose={() => {}} />);

    // Title bar heading.
    expect(screen.getByText("设置")).toBeInTheDocument();
    // Permissions section.
    expect(screen.getByText("权限管理")).toBeInTheDocument();
    // AI processing section.
    expect(screen.getByText("AI 处理")).toBeInTheDocument();
    // About section.
    expect(screen.getByText("关于 Murmur")).toBeInTheDocument();
  });

  it("renders both permission cards (microphone + accessibility)", () => {
    render(<SettingsPanel onClose={() => {}} />);

    expect(screen.getByText("麦克风权限")).toBeInTheDocument();
    expect(screen.getByText("辅助功能权限")).toBeInTheDocument();
  });

  it("renders the AI-mode select with all four mode options, disabled until loaded", () => {
    render(<SettingsPanel onClose={() => {}} />);

    const select = screen.getByLabelText("默认处理模式") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    // The four mode options from the JSX.
    const optionTexts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(optionTexts).toContain("自动（根据文本长度智能选择）");
    expect(optionTexts).toContain("智能润色");
    expect(optionTexts).toContain("长文本整理");
    expect(optionTexts).toContain("关闭自动处理");
  });

  it("disables the AI-mode select until settings have been loaded", () => {
    // Provide a getSetting that never resolves so aiModeLoaded stays false.
    const getSetting = vi.fn().mockReturnValue(new Promise(() => {}));
    setElectronAPI({ getSetting });

    render(<SettingsPanel onClose={() => {}} />);

    const select = screen.getByLabelText("默认处理模式") as HTMLSelectElement;
    expect(select).toBeDisabled();
  });

  it("enables the AI-mode select after reading the saved default_mode", async () => {
    const getSetting = vi.fn().mockResolvedValue("optimize_long");
    const saveSetting = vi.fn().mockResolvedValue(undefined);
    setElectronAPI({ getSetting, saveSetting });

    render(<SettingsPanel onClose={() => {}} />);

    const select = screen.getByLabelText("默认处理模式") as HTMLSelectElement;
    await waitFor(() => expect(select).not.toBeDisabled());
    // The saved mode becomes the selected value.
    expect(select.value).toBe("optimize_long");
  });

  it("falls back to enable_ai_optimization when default_mode is not saved", async () => {
    const getSetting = vi.fn().mockImplementation((key: string) => {
      if (key === "default_mode") return Promise.resolve(null);
      // enable_ai_optimization -> false => aiMode "off"
      return Promise.resolve(false);
    });
    setElectronAPI({ getSetting });

    render(<SettingsPanel onClose={() => {}} />);

    const select = screen.getByLabelText("默认处理模式") as HTMLSelectElement;
    await waitFor(() => expect(select).not.toBeDisabled());
    expect(select.value).toBe("off");
  });

  it("defaults to auto and disables select when electronAPI is absent", async () => {
    delete (globalThis.window as TestWindow).electronAPI;

    render(<SettingsPanel onClose={() => {}} />);

    const select = screen.getByLabelText("默认处理模式") as HTMLSelectElement;
    // Without electronAPI.getSetting, the effect short-circuits and marks
    // loaded synchronously after the first effect tick.
    await waitFor(() => expect(select).not.toBeDisabled());
    expect(select.value).toBe("auto");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);

    // The close button is the only button containing the "×" span.
    fireEvent.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls requestMicPermission when the microphone test button is clicked", () => {
    render(<SettingsPanel onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "测试麦克风" }));
    expect(mockUsePermissions.requestMicPermission).toHaveBeenCalledTimes(1);
  });

  it("calls testAccessibilityPermission when the accessibility test button is clicked", () => {
    render(<SettingsPanel onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "测试权限" }));
    expect(
      mockUsePermissions.testAccessibilityPermission,
    ).toHaveBeenCalledTimes(1);
  });

  it("persists the selected AI mode via saveSetting when the select changes", async () => {
    const getSetting = vi.fn().mockResolvedValue("auto");
    const saveSetting = vi.fn().mockResolvedValue(undefined);
    setElectronAPI({ getSetting, saveSetting });

    render(<SettingsPanel onClose={() => {}} />);

    const select = screen.getByLabelText("默认处理模式") as HTMLSelectElement;
    await waitFor(() => expect(select).not.toBeDisabled());

    fireEvent.change(select, { target: { value: "optimize" } });

    await waitFor(() =>
      expect(saveSetting).toHaveBeenCalledWith("default_mode", "optimize"),
    );
  });

  it("renders the granted state instead of a button when a permission is granted", () => {
    mockUsePermissions.micPermissionGranted = true;
    render(<SettingsPanel onClose={() => {}} />);

    expect(screen.getByText("已授予")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "测试麦克风" }),
    ).not.toBeInTheDocument();
  });
});
