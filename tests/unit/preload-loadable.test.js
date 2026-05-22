import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);
const Module = requireCJS("module");

describe("preload bundle loadability", () => {
  let exposed;
  let ipcMock;
  let origResolve;

  beforeEach(() => {
    exposed = {};
    ipcMock = {
      contextBridge: {
        exposeInMainWorld: vi.fn((key, value) => {
          exposed[key] = value;
        }),
      },
      ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === "electron") return "electron-stub";
      return origResolve.call(this, request, ...rest);
    };
    requireCJS.cache["electron-stub"] = {
      id: "electron-stub",
      filename: "electron-stub",
      loaded: true,
      exports: ipcMock,
    };
  });

  afterEach(() => {
    Module._resolveFilename = origResolve;
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
    expect(Object.keys(exposed.electronAPI).length).toBeGreaterThanOrEqual(50);
  });
});
