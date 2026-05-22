import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("react", () => ({
  useState: (initial) => [initial, vi.fn()],
  useCallback: (fn) => fn,
}));

let usePermissions;

describe("usePermissions.testAccessibilityPermission", () => {
  let originalAPI;

  beforeEach(async () => {
    originalAPI = globalThis.window?.electronAPI;
    if (!globalThis.window) globalThis.window = {};
    ({ usePermissions } = await import("../../src/hooks/usePermissions.js"));
  });

  afterEach(() => {
    if (originalAPI === undefined) {
      delete globalThis.window.electronAPI;
    } else {
      globalThis.window.electronAPI = originalAPI;
    }
  });

  it("shows 'Electron API 不可用' when electronAPI is missing (not OS-permission copy)", async () => {
    delete globalThis.window.electronAPI;
    const showAlertDialog = vi.fn();
    const hook = usePermissions(showAlertDialog);

    await hook.testAccessibilityPermission();

    expect(showAlertDialog).toHaveBeenCalledTimes(1);
    const arg = showAlertDialog.mock.calls[0][0];
    expect(arg.title).toContain("Electron API 不可用");
    expect(arg.description).not.toContain("辅助功能");
  });

  it("shows OS-permission copy when electronAPI.pasteText rejects", async () => {
    globalThis.window.electronAPI = {
      pasteText: vi.fn(() => Promise.reject(new Error("denied"))),
      log: vi.fn(),
    };
    const showAlertDialog = vi.fn();
    const hook = usePermissions(showAlertDialog);

    await hook.testAccessibilityPermission();

    expect(showAlertDialog).toHaveBeenCalledTimes(1);
    const arg = showAlertDialog.mock.calls[0][0];
    expect(arg.title).toContain("需要辅助功能权限");
  });
});
