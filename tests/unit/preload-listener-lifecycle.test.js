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

  // [20260725_CodeReview_ListenerHelper] Characterization tests covering
  // multiple `on*` listener registrations. These lock the behavior the
  // makeListener helper extraction must preserve: each on* registers exactly
  // one handler on its channel, returns an unsubscribe that removes exactly
  // that handler, and does not touch other channels.
  const SINGLE_PAYLOAD_LISTENERS = [
    { method: "onWindowMaximizeChange", channel: "window-maximize-change" },
    { method: "onToggleDictation", channel: "toggle-dictation" },
    { method: "onHotkeyTriggered", channel: "hotkey-triggered" },
    { method: "onTranscriptionUpdate", channel: "transcription-update" },
    { method: "onError", channel: "error" },
    { method: "onSettingsUpdate", channel: "settings-update" },
    { method: "onUpdateDownloadProgress", channel: "update-download-progress" },
    { method: "onUpdateDownloadComplete", channel: "update-download-complete" },
    { method: "onUpdateDownloadError", channel: "update-download-error" },
  ];

  for (const { method, channel } of SINGLE_PAYLOAD_LISTENERS) {
    it(`${method} registers exactly one listener on ${channel} and unsub removes it`, () => {
      const cb = vi.fn();
      const unsub = exposed.electronAPI[method](cb);
      expect(listeners.get(channel)?.length ?? 0).toBe(1);
      unsub();
      expect(listeners.get(channel)?.length ?? 0).toBe(0);
    });
  }

  it("subscribing to one channel does not register handlers on another", () => {
    exposed.electronAPI.onHotkeyTriggered(() => {});
    exposed.electronAPI.onSettingsUpdate(() => {});
    expect(listeners.get("hotkey-triggered")?.length ?? 0).toBe(1);
    expect(listeners.get("settings-update")?.length ?? 0).toBe(1);
    expect(listeners.get("error")?.length ?? 0).toBe(0);
  });
  // [20260725_CodeReview_ListenerHelper] END
});
