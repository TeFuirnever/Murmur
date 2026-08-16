// [20260726_Tier3_PreloadListenerLifecycleMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 3. Pattern: type the `let listeners` Map and `let
// exposed` record explicitly (TS7034); type `let origResolve` via a local
// ResolveFn — Node's Module._resolveFilename is an undocumented internal with
// no @types/node entry. The require cache write is cast through `unknown` to
// NodeModule (the stub omits most fields; the bundle only reads `exports`).
// exposed.electronAPI is `unknown` from the bundle, so accesses are cast to a
// local ElectronApiStub record-of-(cb=>unsub) shape. No `any`. Template
// reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);
const Module = requireCJS("module");

// [20260726_Tier3_PreloadListenerLifecycleMigrate] Listener callback shape:
// the ipcRenderer.on mock stores whatever handler the bundle registers; the
// tests only count/compare handlers, never invoke them, so a generic function
// type is the narrowest correct description.
type Listener = (...args: unknown[]) => unknown;

// [20260726_Tier3_PreloadListenerLifecycleMigrate] Internal resolver type —
// same as preload-loadable.test.ts. Node's _resolveFilename is undocumented.
type ResolveFn = (this: unknown, request: string, ...rest: unknown[]) => string;

// [20260726_Tier3_PreloadListenerLifecycleMigrate] The bundle's exposed
// electronAPI surface: every `on*` method takes a callback and returns an
// unsubscribe. Modeled as a record so dynamic `api[method](cb)` lookup works.
type ElectronApiStub = Record<string, (cb: Listener) => () => void>;

describe("preload listener lifecycle", () => {
  let listeners: Map<string, Listener[]>;
  let exposed: Record<string, unknown>;
  let origResolve: ResolveFn;

  beforeEach(() => {
    listeners = new Map();
    exposed = {};
    const ipcMock = {
      contextBridge: {
        exposeInMainWorld: vi.fn((key: string, value: unknown) => {
          exposed[key] = value;
        }),
      },
      ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn((channel: string, handler: Listener) => {
          if (!listeners.has(channel)) listeners.set(channel, []);
          listeners.get(channel)!.push(handler);
        }),
        removeListener: vi.fn((channel: string, handler: Listener) => {
          const arr = listeners.get(channel) || [];
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }),
        listenerCount: (channel: string): number =>
          (listeners.get(channel) || []).length,
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

    const bundlePath = path.join(process.cwd(), "dist-preload", "preload.js");
    delete requireCJS.cache[requireCJS.resolve(bundlePath)];
    requireCJS(bundlePath);
  });

  afterEach(() => {
    Module._resolveFilename =
      origResolve as unknown as typeof Module._resolveFilename;
    delete requireCJS.cache["electron-stub"];
  });

  // [20260726_Tier3_PreloadListenerLifecycleMigrate] Helper: the bundle
  // exposes electronAPI as `unknown`; cast once to the stub shape the tests
  // exercise (every method is cb => unsub).
  const api = (): ElectronApiStub =>
    exposed.electronAPI as unknown as ElectronApiStub;

  it("onFileTranscriptionProgress unsubscribe actually removes the listener", () => {
    const cb = vi.fn();
    const channel = "file-transcription-progress";

    // [20260726_Tier3_PreloadListenerLifecycleMigrate] Non-null method access:
    // the bundle defines every on* method; noUncheckedIndexedAccess widens
    // Record index access to T | undefined even for known keys.
    const unsub = api().onFileTranscriptionProgress!(cb);
    // [20260726_Tier3_PreloadListenerLifecycleMigrate] Non-null: the prior
    // subscribe just set the channel entry. Suite convention.
    expect(listeners.get(channel)!.length).toBe(1);

    unsub();
    expect(listeners.get(channel)!.length).toBe(0);
  });

  it("does not accumulate listeners across 12 subscribe/unsub cycles", () => {
    const channel = "file-transcription-progress";
    for (let i = 0; i < 12; i++) {
      const unsub = api().onFileTranscriptionProgress!(() => {});
      unsub();
    }
    expect(listeners.get(channel)!.length).toBe(0);
  });

  // [20260725_CodeReview_ListenerHelper] Characterization tests covering
  // multiple `on*` listener registrations. These lock the behavior the
  // makeListener helper extraction must preserve: each on* registers exactly
  // one handler on its channel, returns an unsubscribe that removes exactly
  // that handler, and does not touch other channels.
  const SINGLE_PAYLOAD_LISTENERS = [
    { method: "onWindowMaximizeChange", channel: "window-maximize-change" },
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
      // [20260726_Tier3_PreloadListenerLifecycleMigrate] Non-null: every
      // method in SINGLE_PAYLOAD_LISTENERS is defined by the bundle.
      const unsub = api()[method]!(cb);
      expect(listeners.get(channel)?.length ?? 0).toBe(1);
      unsub();
      expect(listeners.get(channel)?.length ?? 0).toBe(0);
    });
  }

  it("subscribing to one channel does not register handlers on another", () => {
    api().onHotkeyTriggered!(() => {});
    api().onSettingsUpdate!(() => {});
    expect(listeners.get("hotkey-triggered")?.length ?? 0).toBe(1);
    expect(listeners.get("settings-update")?.length ?? 0).toBe(1);
    expect(listeners.get("error")?.length ?? 0).toBe(0);
  });
  // [20260725_CodeReview_ListenerHelper] END
});
