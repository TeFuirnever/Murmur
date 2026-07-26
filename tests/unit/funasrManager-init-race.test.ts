// [20260726_Tier3_FunasrManagerInitRaceMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 4. Pattern: typed `let FunASRManager` via
// `typeof import("...").default` (TS7034/TS7005). The test stubs the
// manager's instance methods and reaches into the private `server` field —
// both are mediated via a `FunASRManagerTestSurface` structural type cast so
// no `any` is needed and the real source methods are still type-checked at
// the construction site. Template reference: phase4-i18n.test.ts (commit
// d52f2e0).
import { describe, it, expect, vi, beforeEach } from "vitest";

// [20260724_TS_BigBang_TestFix] Replace createRequire with vite-intercepted
// require + vi.resetModules() for .ts compatibility.
describe("funasrManager preInitializeModels race", () => {
  // [20260726_Tier3_FunasrManagerInitRaceMigrate] Default-export class; the
  // require returns the constructor under CJS interop.
  let FunASRManager: typeof import("../../src/helpers/funasrManager").default;

  // [20260726_Tier3_FunasrManagerInitRaceMigrate] Test-only surface: the
  // suite reassigns these instance methods and pokes the private `server`
  // field. Return types are widened to `Promise<unknown>` / `unknown` so
  // vi.fn() mocks (whose inferred return is `Promise<unknown>`) assign
  // without complaint, while still keeping the call-site args type-checked.
  interface FunASRManagerTestSurface {
    checkFunASRInstallation: (...args: never[]) => Promise<unknown>;
    findPythonExecutable: (...args: never[]) => Promise<unknown>;
    getFunASRServerPath: () => string;
    setupIsolatedEnvironment: () => void;
    buildPythonEnvironment: () => NodeJS.ProcessEnv;
    getModelCachePath: () => string;
    preInitializeModels: () => Promise<unknown>;
    server: { _startFunASRServer: (...args: never[]) => Promise<unknown> };
  }

  beforeEach(() => {
    vi.resetModules();
    FunASRManager = require("../../src/helpers/funasrManager");
  });
  // [20260724_TS_BigBang_TestFix] END

  // [20260726_Tier3_FunasrManagerInitRaceMigrate] Cast helper: the manager
  // class declares `server` private and the methods are non-readonly; the
  // suite needs to override them per-test. Bridge via `unknown` to the
  // structural test surface — no `any`.
  function asSurface(
    m: InstanceType<typeof FunASRManager>,
  ): FunASRManagerTestSurface {
    return m as unknown as FunASRManagerTestSurface;
  }

  it("concurrent calls only start the server once", async () => {
    const m = asSurface(
      new FunASRManager({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    );

    // Replace each async dependency with a microtask-yielding stub so
    // the race window is real. If any of these returns synchronously,
    // the bug would be hidden by event-loop collapse.
    m.checkFunASRInstallation = vi.fn(
      () => new Promise((r) => setImmediate(() => r({ installed: true }))),
    );
    m.findPythonExecutable = vi.fn(
      () => new Promise((r) => setImmediate(() => r("python3"))),
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
    const m = asSurface(
      new FunASRManager({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    );
    m.checkFunASRInstallation = vi.fn(() =>
      Promise.resolve({ installed: false }),
    );
    const startSpy = vi.fn();
    m.server._startFunASRServer = startSpy;

    await Promise.all([m.preInitializeModels(), m.preInitializeModels()]);

    expect(startSpy).not.toHaveBeenCalled();
  });
});
