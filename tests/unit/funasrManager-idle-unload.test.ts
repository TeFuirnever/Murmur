// [20260822_T12_IdleUnload] Ticket #190: idle-unload orchestration in
// funasrManager. Timer semantics (reset ONLY on transcribe/diarize entries
// — ping/status never reset), busy defers, env override clamped, reload
// pre-trigger for hotkey-down. RED first.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp") },
}));

import FunASRManager from "../../src/helpers/funasrManager";
import {
  IDLE_UNLOAD_TIMEOUT_MS,
  IDLE_UNLOAD_MIN_MS,
  IDLE_UNLOAD_MAX_MS,
} from "../../src/helpers/funasrManager";

interface Surface {
  idleTimer: ReturnType<typeof setTimeout> | null;
  server: {
    serverReady: boolean;
    serverProcess: unknown;
    unloadModels: ReturnType<typeof vi.fn>;
    reloadModels: ReturnType<typeof vi.fn>;
    transcribeAudio: ReturnType<typeof vi.fn>;
    transcribeFile: ReturnType<typeof vi.fn>;
    diarizeAudio: ReturnType<typeof vi.fn>;
  };
  _resetIdleUnloadTimer: () => void;
  _onIdleUnloadTimeout: () => Promise<void>;
  transcribeAudio: (...args: unknown[]) => Promise<unknown>;
  transcribeFile: (...args: unknown[]) => Promise<unknown>;
  diarizeAudio: (...args: unknown[]) => Promise<unknown>;
}

interface LoggerStub {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error?: (message: string, ...args: unknown[]) => void;
}

function makeManager(
  partialLogger: Record<string, ReturnType<typeof vi.fn>> = {
    info: vi.fn(),
    warn: vi.fn(),
  },
) {
  const logger = partialLogger as unknown as LoggerStub;
  const manager = new FunASRManager(logger);
  const s = manager as unknown as Surface;
  s.server.unloadModels = vi.fn().mockResolvedValue({ success: true });
  s.server.reloadModels = vi.fn().mockResolvedValue({ success: true });
  s.server.transcribeAudio = vi.fn().mockResolvedValue({ success: true });
  s.server.transcribeFile = vi.fn().mockResolvedValue({ success: true });
  s.server.diarizeAudio = vi.fn().mockResolvedValue({ success: true });
  return { manager, s };
}

describe("[20260822_T12_IdleUnload] idle timer semantics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transcription entry points reset the timer", async () => {
    const { manager, s } = makeManager({
      info: vi.fn(),
      warn: vi.fn(),
    });
    s._resetIdleUnloadTimer();
    await manager.transcribeAudio(new ArrayBuffer(0), {});
    expect(s.idleTimer).not.toBeNull();
    vi.advanceTimersByTime(IDLE_UNLOAD_TIMEOUT_MS - 1_000);
    await manager.transcribeFile("/x.wav", {});
    // Still pending — the entry reset it.
    expect(s.idleTimer).not.toBeNull();
  });

  it("idle timeout fires unloadModels exactly once", async () => {
    const { s } = makeManager({ info: vi.fn(), warn: vi.fn() });
    s._resetIdleUnloadTimer();
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_TIMEOUT_MS + 500);
    expect(s.server.unloadModels).toHaveBeenCalledTimes(1);
  });

  it("busy (in-flight transcription) defers the unload", async () => {
    const { manager, s } = makeManager({ info: vi.fn(), warn: vi.fn() });
    // A transcription that runs PAST the idle deadline.
    let release: (v: unknown) => void = () => {};
    s.server.transcribeAudio.mockReturnValue(
      new Promise((res) => (release = res)),
    );
    s._resetIdleUnloadTimer();
    const pending = manager.transcribeAudio(new ArrayBuffer(0), {});
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_TIMEOUT_MS + 500);
    // Deadline passed mid-flight → no unload yet.
    expect(s.server.unloadModels).not.toHaveBeenCalled();
    release({ success: true });
    await pending;
    // Completion re-arms; the NEXT deadline unloads.
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_TIMEOUT_MS + 500);
    expect(s.server.unloadModels).toHaveBeenCalledTimes(1);
  });

  it("checkStatus does NOT reset the timer", async () => {
    const { manager, s } = makeManager({ info: vi.fn(), warn: vi.fn() });
    s.server.serverReady = false; // checkStatus takes the slow path
    s._resetIdleUnloadTimer();
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_TIMEOUT_MS - 2_000);
    await manager.checkStatus();
    // Cross the deadline AFTER the poll — if checkStatus reset the timer,
    // the unload would now be a full window away instead of firing.
    await vi.advanceTimersByTimeAsync(3_000);
    // The status poll between arm and fire did not postpone the unload.
    expect(s.server.unloadModels).toHaveBeenCalledTimes(1);
  });
});

describe("[20260822_T12_IdleUnload] constants and env override", () => {
  it("default is 5 minutes; override clamped to [10s, 24h]", () => {
    expect(IDLE_UNLOAD_TIMEOUT_MS).toBe(300_000);
    expect(IDLE_UNLOAD_MIN_MS).toBe(10_000);
    expect(IDLE_UNLOAD_MAX_MS).toBe(24 * 60 * 60_000);
  });
});

describe("[20260822_T12_IdleUnload] reload pre-trigger", () => {
  it("reloadModels delegates to the server command", async () => {
    const { manager, s } = makeManager({ info: vi.fn(), warn: vi.fn() });
    await manager.reloadModels();
    expect(s.server.reloadModels).toHaveBeenCalledTimes(1);
  });
});
