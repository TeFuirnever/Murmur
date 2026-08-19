// [20260822_T12_IdleUnload] Ticket #190 (spec #177 T12): TS-side idle
// unload orchestration. Stage 1 — funasrServer: health-monitor suppression
// during an intentional reload (else the 30s ping × 5s timeout kills a
// cold Windows reload via crash-restart) + the two T11 protocol commands
// with their timeout envelopes. RED first.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

vi.mock("../../src/helpers/audioFileHelpers", () => ({
  createTempAudioFile: vi.fn().mockResolvedValue("/tmp/fake.wav"),
  cleanupTempFile: vi.fn().mockResolvedValue(undefined),
}));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid = 4242;
  killed = false;
  kill() {
    this.killed = true;
  }
}

let mockSpawnChild: FakeChildProcess;

vi.mock("child_process", () => ({
  spawn: vi.fn(() => mockSpawnChild),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

import FunASRServer from "../../src/helpers/funasrServer";

interface Surface {
  serverReady: boolean;
  serverProcess: unknown;
  restartCount: number;
  _reloadInFlight: boolean;
  messageRouter: {
    sendRaw: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
  };
  _handleServerCrash: () => Promise<void>;
  _startHealthMonitor: () => void;
  _stopHealthMonitor: () => void;
  unloadModels: () => Promise<unknown>;
  reloadModels: () => Promise<unknown>;
}

function srv(instance: InstanceType<typeof FunASRServer>): Surface {
  return instance as unknown as Surface;
}

describe("[20260822_T12_IdleUnload] health-monitor suppression", () => {
  let server: InstanceType<typeof FunASRServer>;
  let logger: {
    info: (m: string, ...a: unknown[]) => void;
    warn: (m: string, ...a: unknown[]) => void;
    error?: (m: string, ...a: unknown[]) => void;
    debug?: (m: string, ...a: unknown[]) => void;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    server = new FunASRServer(logger);
    mockSpawnChild = new FakeChildProcess();
    srv(server).serverReady = true;
    srv(server).serverProcess = mockSpawnChild;
  });

  it("ping while suppressed does NOT trigger crash handling", async () => {
    const s = srv(server);
    s.messageRouter.sendRaw = vi
      .fn()
      .mockRejectedValue(new Error("ping timeout"));
    const crashSpy = vi
      .spyOn(s, "_handleServerCrash")
      .mockResolvedValue(undefined);
    s._reloadInFlight = true;
    s._startHealthMonitor();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(crashSpy).not.toHaveBeenCalled();
    s._stopHealthMonitor();
  });

  it("ping while NOT suppressed DOES trigger crash handling", async () => {
    const s = srv(server);
    s.messageRouter.sendRaw = vi
      .fn()
      .mockRejectedValue(new Error("ping timeout"));
    const crashSpy = vi
      .spyOn(s, "_handleServerCrash")
      .mockResolvedValue(undefined);
    s._startHealthMonitor();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(crashSpy).toHaveBeenCalled();
    s._stopHealthMonitor();
  });

  it("intentional reload does not touch restartCount", () => {
    const s = srv(server);
    expect(s.restartCount).toBe(0);
    s._reloadInFlight = true;
    s._reloadInFlight = false;
    expect(s.restartCount).toBe(0);
  });
});

describe("[20260822_T12_IdleUnload] unload/reload commands", () => {
  let server: InstanceType<typeof FunASRServer>;
  let logger: {
    info: (m: string, ...a: unknown[]) => void;
    warn: (m: string, ...a: unknown[]) => void;
    error?: (m: string, ...a: unknown[]) => void;
    debug?: (m: string, ...a: unknown[]) => void;
  };

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    server = new FunASRServer(logger);
    mockSpawnChild = new FakeChildProcess();
    srv(server).serverReady = true;
    srv(server).serverProcess = mockSpawnChild;
  });

  it("unloadModels sends the unload_models action", async () => {
    const s = srv(server);
    s.messageRouter.sendCommand = vi.fn().mockResolvedValue({
      success: true,
    });
    const result = (await server.unloadModels()) as { success: boolean };
    expect(s.messageRouter.sendCommand).toHaveBeenCalledWith("unload_models");
    expect(result.success).toBe(true);
  });

  it("reloadModels uses a long timeout envelope (Windows cold loads)", async () => {
    const s = srv(server);
    s.messageRouter.sendCommand = vi.fn().mockResolvedValue({
      success: true,
      asr_model: "seaco",
    });
    await server.reloadModels();
    const call = s.messageRouter.sendCommand.mock.calls[0] as unknown[];
    const options = call[2] as { timeout?: number };
    // reloadModels must pass an explicit LONG timeout (cold Windows reload
    // can reach minutes; the 60s default would kill it).
    expect((options.timeout as number) >= 300_000).toBe(true);
  });

  it("reloadModels suppresses the monitor around the command", async () => {
    const s = srv(server);
    let release: (v: unknown) => void = () => {};
    s.messageRouter.sendCommand = vi.fn(
      () => new Promise((res) => (release = res)),
    );
    const p = server.reloadModels();
    expect(s._reloadInFlight).toBe(true);
    release({ success: true });
    await p;
    expect(s._reloadInFlight).toBe(false);
  });
});
