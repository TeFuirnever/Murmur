// @vitest-environment happy-dom
// [20260725_PreloadBridgeContract] Contract test for the preload contextBridge
// surface. Loads the SOURCE preload.ts (transformed by vitest + the
// _tsresolve.setup.js monkey-patch) rather than the dist-preload bundle so
// type/structure regressions are caught before the build runs.
//
// We mock "electron" so contextBridge.exposeInMainWorld captures the exposed
// API object without needing a real Electron runtime, then assert:
//   1. exposeInMainWorld was called with the key "electronAPI"
//   2. the exposed object has >= 50 methods (regression guard for surface area)
//   3. specific critical methods exist with typeof === "function"
//
// [20260726_TypeGate_PreloadBridgeContract] Re-enabled in the tsconfig.test.json
// typecheck gate. The smoke-call test invokes critical methods on the exposed
// electronAPI, which is cast to Record<string, (...args) => unknown>. With
// noUncheckedIndexedAccess each indexed access is possibly-undefined (TS2722),
// so each invocation takes a non-null assertion — the prior test already
// asserts typeof api[name] === "function" for every critical name. No `any`.
// [20260726_TypeGate_PreloadBridgeContract] END
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above all other code, so any variable they
// close over must also be hoisted. vi.hoisted runs its callback before any
// import/mock resolution, giving us a shared bag that both the (hoisted)
// mock factory and the test body can reference. Without hoisting, the mock
// would run before `mockState` is initialized and throw a ReferenceError.
const mockState = vi.hoisted(() => {
  const state: {
    exposed: Record<string, unknown>;
    contextBridge: {
      exposeInMainWorld: ReturnType<typeof vi.fn>;
    };
    ipcRenderer: {
      invoke: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
      removeAllListeners: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    };
  } = {
    exposed: {},
    contextBridge: {
      // Capture every key passed to exposeInMainWorld so tests can introspect
      // the shape of the exposed API without needing a real Electron runtime.
      exposeInMainWorld: vi.fn((key: string, value: unknown) => {
        state.exposed[key] = value;
      }),
    },
    ipcRenderer: {
      invoke: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn(),
      send: vi.fn(),
    },
  };
  return state;
});

vi.mock("electron", () => ({
  contextBridge: mockState.contextBridge,
  ipcRenderer: mockState.ipcRenderer,
}));

import { contextBridge, ipcRenderer } from "electron";

describe("preload bridge contract", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore the resolved-value default that clearAllMocks wipes off.
    (ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    // Drop previously captured API keys so each test starts clean.
    for (const k of Object.keys(mockState.exposed)) delete mockState.exposed[k];
    // Force preload.ts to re-evaluate against the freshly reset mocks.
    vi.resetModules();
    // Re-mock electron after resetModules (the previous vi.mock survives
    // resetModules, but resetting can clear call records we just rebuilt
    // above — re-import to exercise the preload's top-level side effect).
    await import("../../preload");
  });

  it('calls contextBridge.exposeInMainWorld with "electronAPI"', () => {
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalled();
    const calls = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls;
    const electronApiCall = calls.find((c) => c[0] === "electronAPI");
    expect(electronApiCall).toBeDefined();
    expect(mockState.exposed.electronAPI).toBeDefined();
  });

  it("exposes an object with at least 50 methods", () => {
    const api = mockState.exposed.electronAPI as Record<string, unknown>;
    expect(api).toBeDefined();
    const methodCount = Object.keys(api).length;
    expect(methodCount).toBeGreaterThanOrEqual(50);
  });

  it("exposes all critical methods as functions", () => {
    const api = mockState.exposed.electronAPI as Record<string, unknown>;
    const critical = [
      "processText",
      "checkModelFiles",
      "saveTranscription",
      "getTranscriptions",
      "setSetting",
      "getSetting",
      "minimizeWindow",
      "registerHotkey",
      "pasteText",
      "checkForUpdates",
    ];
    for (const name of critical) {
      expect(api[name]).toBeDefined();
      expect(typeof api[name]).toBe("function");
    }
  });

  it("critical methods are wired to ipcRenderer.invoke (smoke call)", () => {
    const api = mockState.exposed.electronAPI as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const invokeMock = ipcRenderer.invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    // [20260726_TypeGate_PreloadBridgeContract] Record<string, ...> indexed
    // access is possibly-undefined under noUncheckedIndexedAccess; the prior
    // test asserts every name below is typeof === "function", so non-null.
    api.processText!("hello", "optimize");
    api.checkModelFiles!();
    api.saveTranscription!({ text: "x" });
    api.getTranscriptions!(10, 0);
    api.setSetting!("foo", "bar");
    api.getSetting!("foo");
    api.minimizeWindow!();
    api.registerHotkey!("CmdOrCtrl+Shift+Space");
    api.pasteText!("hi");
    api.checkForUpdates!();

    expect(invokeMock).toHaveBeenCalledTimes(10);
  });
});
