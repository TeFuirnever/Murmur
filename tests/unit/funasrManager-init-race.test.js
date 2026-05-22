import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);

describe("funasrManager preInitializeModels race", () => {
  let FunASRManager;

  beforeEach(() => {
    const wmPath = requireCJS.resolve("../../src/helpers/funasrManager.js");
    delete requireCJS.cache[wmPath];
    FunASRManager = requireCJS("../../src/helpers/funasrManager.js");
  });

  it("concurrent calls only start the server once", async () => {
    const m = new FunASRManager({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

    // Replace each async dependency with a microtask-yielding stub so
    // the race window is real. If any of these returns synchronously,
    // the bug would be hidden by event-loop collapse.
    m.checkFunASRInstallation = vi.fn(() =>
      new Promise((r) => setImmediate(() => r({ installed: true }))),
    );
    m.findPythonExecutable = vi.fn(() =>
      new Promise((r) => setImmediate(() => r("python3"))),
    );
    m.getFunASRServerPath = vi.fn(() => "/srv");
    m.setupIsolatedEnvironment = vi.fn();
    m.buildPythonEnvironment = vi.fn(() => ({}));
    m.getModelCachePath = vi.fn(() => "/cache");

    const startSpy = vi.fn(() => new Promise((r) => setImmediate(r)));
    m.server._startFunASRServer = startSpy;

    await Promise.all([
      m.preInitializeModels(),
      m.preInitializeModels(),
      m.preInitializeModels(),
    ]);

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("does not start the server when funasr is not installed", async () => {
    const m = new FunASRManager({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    m.checkFunASRInstallation = vi.fn(() => Promise.resolve({ installed: false }));
    const startSpy = vi.fn();
    m.server._startFunASRServer = startSpy;

    await Promise.all([m.preInitializeModels(), m.preInitializeModels()]);

    expect(startSpy).not.toHaveBeenCalled();
  });
});
