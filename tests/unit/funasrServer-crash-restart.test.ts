// [20260726_Tier3_FunasrServerCrashRestartMigrate] Migrated from .js to .ts
// as part of Tier 3 batch 5 (final electron-mock batch). Pattern: type the
// `let FunASRServer` binding with `typeof import(...).default` (TS7034) — the
// source uses `export default FunASRServer` with a _tsresolve setupFile that
// unwraps the ESM default to the class under CJS interop. The suite pokes
// private members (maxRestarts/_startupParams/_saveStartupParams/
// _handleServerCrash/_startFunASRServer/serverProcess) so a local
// FunASRServerSurface interface + cast helper exposes them without `any`.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

// [20260726_Tier3_FunasrServerCrashRestartMigrate] Default-exported class;
// the require returns the constructor under CJS interop (setupFile unwraps
// the ESM default namespace to the class itself).
type FunASRServerCtor = typeof import("../../src/helpers/funasrServer").default;

// [20260726_Tier32_FunasrServerCrashRestart] Convert require() +
// vi.resetModules() to a top-level ESM default import. vi.mock is hoisted.
// funasrServer.ts uses `export default FunASRServer`, so the ESM default
// import is the class constructor itself — same shape the setupFile unwrap
// produced via CJS interop.
import FunASRServer from "../../src/helpers/funasrServer";

// [20260726_Tier3_FunasrServerCrashRestartMigrate] StartupParams mirrors the
// source's private interface (pythonEnv/pythonCmd/serverPath/modelCachePath).
// Re-declared locally rather than imported because the source interface is
// not exported.
interface StartupParams {
  pythonEnv: NodeJS.ProcessEnv;
  pythonCmd: string;
  serverPath: string;
  modelCachePath: string;
}

// [20260726_Tier3_FunasrServerCrashRestartMigrate] The FunASRServer class
// declares maxRestarts/_startupParams/_saveStartupParams/_handleServerCrash/
// _startFunASRServer/serverProcess private. This suite pokes them directly to
// drive the crash-restart flow, so the surface exposes them as public.
interface FunASRServerSurface {
  restartCount: number;
  serverReady: boolean;
  serverProcess: unknown;
  maxRestarts: number;
  _startupParams: StartupParams | null;
  _saveStartupParams: (params: StartupParams) => void;
  _handleServerCrash: () => Promise<void>;
  _startFunASRServer: (...args: unknown[]) => Promise<unknown>;
  _startHealthMonitor: () => void;
  _stopHealthMonitor: () => void;
}

// [20260726_Tier3_FunasrServerCrashRestartMigrate] Local cast helper keeps
// private-field access sites short. Returning the structural surface avoids
// repeating `as unknown as FunASRServerSurface` at every poke.
function srv(instance: InstanceType<FunASRServerCtor>): FunASRServerSurface {
  return instance as unknown as FunASRServerSurface;
}

// [20260726_Tier3_FunasrServerCrashRestartMigrate] Logger stub shape — the
// FunASRServer constructor accepts Logger | null; the suite passes an object
// literal with info/warn/error/debug, so this interface describes that surface.
interface LoggerStub {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

describe("FunASR server auto-restart", () => {
  let logger: LoggerStub;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  it("saves startup params for restart", () => {
    const server = srv(new FunASRServer(logger));
    server._saveStartupParams({
      pythonEnv: "env" as unknown as NodeJS.ProcessEnv,
      pythonCmd: "python3",
      serverPath: "/path/server.py",
      modelCachePath: "/models",
    });
    expect(server._startupParams).toEqual({
      pythonEnv: "env",
      pythonCmd: "python3",
      serverPath: "/path/server.py",
      modelCachePath: "/models",
    });
  });

  it("does not restart when restart limit exceeded", async () => {
    const server = srv(new FunASRServer(logger));
    server.restartCount = 4;
    server.maxRestarts = 3;
    server._startupParams = {
      pythonEnv: {},
      pythonCmd: "python3",
      serverPath: "/path",
      modelCachePath: "/models",
    };
    server._startFunASRServer = vi.fn();

    await server._handleServerCrash();

    expect(server._startFunASRServer).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("restarts server with saved params within limit", async () => {
    const server = srv(new FunASRServer(logger));
    server.restartCount = 1;
    server.maxRestarts = 3;
    const params = {
      pythonEnv: {},
      pythonCmd: "python3",
      serverPath: "/path",
      modelCachePath: "/models",
    };
    server._startupParams = params;
    server._startFunASRServer = vi.fn(async () => ({}));
    server.serverProcess = null;
    server.serverReady = false;

    await server._handleServerCrash();

    expect(server._startFunASRServer).toHaveBeenCalledWith(
      params.pythonEnv,
      params.pythonCmd,
      params.serverPath,
      params.modelCachePath,
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it("increments restart count on each restart attempt", async () => {
    const server = srv(new FunASRServer(logger));
    server.restartCount = 0;
    server.maxRestarts = 3;
    server._startupParams = {
      pythonEnv: {},
      pythonCmd: "python3",
      serverPath: "/path",
      modelCachePath: "/models",
    };
    server._startFunASRServer = vi.fn(async () => ({}));

    await server._handleServerCrash();
    expect(server.restartCount).toBe(1);

    await server._handleServerCrash();
    expect(server.restartCount).toBe(2);
  });

  it("resets restart count on successful start", () => {
    const server = srv(new FunASRServer(logger));
    server.restartCount = 2;
    server._startHealthMonitor();
    expect(server.restartCount).toBe(0);
    server._stopHealthMonitor();
  });
});
