// [20260725_Tier3_UsePermissionsMigrate] Migrated from .js to .ts as part
// of Tier 3 batch 2. Pattern: type the `let usePermissions` binding via
// `typeof import("../../src/hooks/usePermissions").usePermissions` (the
// source exports a named hook whose signature already constrains the
// `showAlertDialog` callback param); type the `let originalAPI` snapshot
// as `ElectronAPI | undefined` since the source augments Window with a
// required `electronAPI` but this test deliberately deletes/restores it;
// annotate the `useState`/`useCallback` mock params (TS7006) with the
// narrow types the test exercises. The mock's `window` writes are cast
// through `unknown` to a local Window-with-optional-electronAPI view —
// never `any`, no `@ts-ignore`. Template reference: phase4-i18n.test.ts
// (commit d52f2e0).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ElectronAPI } from "../../src/electronAPI";

// [20260725_Tier3_UsePermissionsMigrate] Mocked react hooks: type the
// parameters (TS7006). `useState(initial)` echoes the initial value, so
// `unknown` is the narrowest correct type. `useCallback(fn)` returns the
// fn unchanged, so a generic function type fits.
vi.mock("react", () => ({
  useState: (initial: unknown) => [initial, vi.fn()],
  useCallback: (fn: (...args: never[]) => unknown) => fn,
}));

// [20260725_Tier3_UsePermissionsMigrate] Typed via the source's named export
// so `usePermissions(showAlertDialog)` reuses the source's hook signature
// (TS7034 — `let` bound by destructured dynamic import cannot infer type).
let usePermissions: typeof import("../../src/hooks/usePermissions").usePermissions;

// [20260725_Tier3_UsePermissionsMigrate] Window shape this test manipulates:
// the production type makes `electronAPI` required, but the test deliberately
// deletes it, so we Omit the required prop and re-add it as optional. The
// `Omit` is required because intersecting `Window & { electronAPI?: ... }`
// would leave the prop required (required + optional = required). No `any`.
type TestWindow = Omit<Window, "electronAPI"> & { electronAPI?: ElectronAPI };

describe("usePermissions.testAccessibilityPermission", () => {
  // [20260725_Tier3_UsePermissionsMigrate] Snapshot of the pre-test window
  // state for restore: `electronAPI` is `ElectronAPI | undefined` (it may
  // not have been set when the test starts).
  let originalAPI: ElectronAPI | undefined;

  beforeEach(async () => {
    originalAPI = (globalThis.window as TestWindow | undefined)?.electronAPI;
    if (!globalThis.window) {
      // [20260725_Tier3_UsePermissionsMigrate] Stub an empty window: cast
      // through `unknown` to the lib's `Window & typeof globalThis` type
      // (the declared type of `globalThis.window`). No `any`.
      globalThis.window = {} as unknown as Window & typeof globalThis;
    }
    ({ usePermissions } = await import("../../src/hooks/usePermissions.js"));
  });

  afterEach(() => {
    const win = globalThis.window as TestWindow;
    if (originalAPI === undefined) {
      delete win.electronAPI;
    } else {
      win.electronAPI = originalAPI;
    }
  });

  it("shows 'Electron API 不可用' when electronAPI is missing (not OS-permission copy)", async () => {
    delete (globalThis.window as TestWindow).electronAPI;
    const showAlertDialog = vi.fn();
    const hook = usePermissions(showAlertDialog);

    await hook.testAccessibilityPermission();

    expect(showAlertDialog).toHaveBeenCalledTimes(1);
    const arg = showAlertDialog.mock.calls[0]![0];
    expect(arg.title).toContain("Electron API 不可用");
    expect(arg.description).not.toContain("辅助功能");
  });

  it("shows OS-permission copy when electronAPI.pasteText rejects", async () => {
    // [20260725_Tier3_UsePermissionsMigrate] Partial ElectronAPI stub: the
    // hook only exercises `pasteText` and `log`, so the cast narrows the
    // mock to the production type rather than introducing `any`.
    (globalThis.window as TestWindow).electronAPI = {
      pasteText: vi.fn(() => Promise.reject(new Error("denied"))),
      log: vi.fn(),
    } as unknown as ElectronAPI;
    const showAlertDialog = vi.fn();
    const hook = usePermissions(showAlertDialog);

    await hook.testAccessibilityPermission();

    expect(showAlertDialog).toHaveBeenCalledTimes(1);
    const arg = showAlertDialog.mock.calls[0]![0];
    expect(arg.title).toContain("需要辅助功能权限");
  });
});
