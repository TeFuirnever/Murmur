import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

describe("FunASR server auto-restart", () => {
  let FunASRServer;
  let logger;

  beforeEach(() => {
    vi.resetModules();
    FunASRServer = require("../../src/helpers/funasrServer");
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  it("saves startup params for restart", () => {
    const server = new FunASRServer(logger);
    server._saveStartupParams({ pythonEnv: "env", pythonCmd: "python3", serverPath: "/path/server.py", modelCachePath: "/models" });
    expect(server._startupParams).toEqual({
      pythonEnv: "env",
      pythonCmd: "python3",
      serverPath: "/path/server.py",
      modelCachePath: "/models",
    });
  });

  it("does not restart when restart limit exceeded", async () => {
    const server = new FunASRServer(logger);
    server.restartCount = 4;
    server.maxRestarts = 3;
    server._startupParams = { pythonEnv: {}, pythonCmd: "python3", serverPath: "/path", modelCachePath: "/models" };
    server._startFunASRServer = vi.fn();

    await server._handleServerCrash();

    expect(server._startFunASRServer).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("restarts server with saved params within limit", async () => {
    const server = new FunASRServer(logger);
    server.restartCount = 1;
    server.maxRestarts = 3;
    const params = { pythonEnv: {}, pythonCmd: "python3", serverPath: "/path", modelCachePath: "/models" };
    server._startupParams = params;
    server._startFunASRServer = vi.fn(async () => {});
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
    const server = new FunASRServer(logger);
    server.restartCount = 0;
    server.maxRestarts = 3;
    server._startupParams = { pythonEnv: {}, pythonCmd: "python3", serverPath: "/path", modelCachePath: "/models" };
    server._startFunASRServer = vi.fn(async () => {});

    await server._handleServerCrash();
    expect(server.restartCount).toBe(1);

    await server._handleServerCrash();
    expect(server.restartCount).toBe(2);
  });

  it("resets restart count on successful start", () => {
    const server = new FunASRServer(logger);
    server.restartCount = 2;
    server._startHealthMonitor();
    expect(server.restartCount).toBe(0);
    server._stopHealthMonitor();
  });
});
