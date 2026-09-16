// [20260726_Tier3_PreloadLoadableMigrate] Migrated from .js to .ts as part of
// Tier 3 batch 3. Pattern: type the `let exposed`/`let ipcMock` bindings with
// explicit shapes (TS7034) and `let origResolve` via a local ResolveFn type —
// Node's Module._resolveFilename is an undocumented internal with no
// @types/node entry, so `Module._resolveFilename` reads as `any`; the local
// type captures the `(request, ...rest) => string` contract this test
// exercises. The require cache write (`requireCJS.cache[id] = {...}`) is cast
// through `unknown` because the stub object omits most NodeJS.Module fields
// (children/parent/path/...) — the preload bundle only reads `exports`.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);
const Module = requireCJS("module");

// [20260726_Tier3_PreloadLoadableMigrate] Internal resolver signature. Node's
// _resolveFilename is undocumented; this captures what the override + the
// .call(this, request, ...rest) forward need.
type ResolveFn = (this: unknown, request: string, ...rest: unknown[]) => string;

describe("preload bundle loadability", () => {
  let exposed: Record<string, unknown>;
  let ipcMock: {
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void;
    };
    ipcRenderer: {
      invoke: (...args: unknown[]) => unknown;
      on: (...args: unknown[]) => unknown;
      removeListener: (...args: unknown[]) => unknown;
    };
  };
  let origResolve: ResolveFn;

  beforeEach(() => {
    exposed = {};
    ipcMock = {
      contextBridge: {
        exposeInMainWorld: vi.fn((key: string, value: unknown) => {
          exposed[key] = value;
        }),
      },
      ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    origResolve = Module._resolveFilename as ResolveFn;
    Module._resolveFilename = function (request: string, ...rest: unknown[]) {
      if (request === "electron") return "electron-stub";
      return origResolve.call(this, request, ...rest);
    } as ResolveFn;
    requireCJS.cache["electron-stub"] = {
      id: "electron-stub",
      filename: "electron-stub",
      loaded: true,
      exports: ipcMock,
    } as unknown as NodeModule;
  });

  afterEach(() => {
    Module._resolveFilename =
      origResolve as unknown as typeof Module._resolveFilename;
    delete requireCJS.cache["electron-stub"];
  });

  it("loads dist-preload bundle without throwing", () => {
    const bundlePath = path.join(process.cwd(), "dist-preload", "preload.js");
    delete requireCJS.cache[requireCJS.resolve(bundlePath)];
    expect(() => requireCJS(bundlePath)).not.toThrow();
  });

  it("exposes electronAPI with sufficient surface area", () => {
    const bundlePath = path.join(process.cwd(), "dist-preload", "preload.js");
    delete requireCJS.cache[requireCJS.resolve(bundlePath)];
    requireCJS(bundlePath);

    expect(ipcMock.contextBridge.exposeInMainWorld).toHaveBeenCalled();
    expect(exposed.electronAPI).toBeDefined();
    // [20260726_Tier3_PreloadLoadableMigrate] electronAPI is unknown; cast to
    // a record-of-functions shape to read Object.keys + length. No `any`.
    const api = exposed.electronAPI as Record<string, unknown>;
    expect(Object.keys(api).length).toBeGreaterThanOrEqual(50);
  });
});
