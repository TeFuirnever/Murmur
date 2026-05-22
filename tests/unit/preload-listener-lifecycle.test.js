import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);
const Module = requireCJS("module");

describe("preload listener lifecycle", () => {
  let listeners;
  let exposed;
  let origResolve;

  beforeEach(() => {
    listeners = new Map();
    exposed = {};
    const ipcMock = {
      contextBridge: {
        exposeInMainWorld: vi.fn((key, value) => {
          exposed[key] = value;
        }),
      },
      ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn((channel, handler) => {
          if (!listeners.has(channel)) listeners.set(channel, []);
          listeners.get(channel).push(handler);
        }),
        removeListener: vi.fn((channel, handler) => {
          const arr = listeners.get(channel) || [];
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }),
        listenerCount: (channel) => (listeners.get(channel) || []).length,
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

    const bundlePath = path.join(process.cwd(), "dist-preload", "preload.js");
    delete requireCJS.cache[requireCJS.resolve(bundlePath)];
    requireCJS(bundlePath);
  });

  afterEach(() => {
    Module._resolveFilename = origResolve;
    delete requireCJS.cache["electron-stub"];
  });

  it("onFileTranscriptionProgress unsubscribe actually removes the listener", () => {
    const cb = vi.fn();
    const channel = "file-transcription-progress";

    const unsub = exposed.electronAPI.onFileTranscriptionProgress(cb);
    expect(listeners.get(channel).length).toBe(1);

    unsub();
    expect(listeners.get(channel).length).toBe(0);
  });

  it("does not accumulate listeners across 12 subscribe/unsub cycles", () => {
    const channel = "file-transcription-progress";
    for (let i = 0; i < 12; i++) {
      const unsub = exposed.electronAPI.onFileTranscriptionProgress(() => {});
      unsub();
    }
    expect(listeners.get(channel).length).toBe(0);
  });
});
