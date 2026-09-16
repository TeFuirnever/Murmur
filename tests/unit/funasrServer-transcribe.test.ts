// [20260729_Test_FunasrServerTranscribe] Unit tests for FunASRServer's
// file-validation and transcription methods. These are the highest-ROI
// coverage wins: transcribeFile's 5 validation branches are pure logic
// testable with real fs + tmpdir — no spawn mock needed.
// Reuses the srv() surface-cast pattern from funasrServer-crash-restart.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test-user-data") },
}));

import FunASRServer from "../../src/helpers/funasrServer";

interface FunASRServerSurface {
  serverReady: boolean;
  initializationPromise: Promise<unknown> | null;
  messageRouter: {
    sendCommand: ReturnType<typeof vi.fn>;
  };
  _sendServerCommand: ReturnType<typeof vi.fn>;
}

function srv(instance: InstanceType<typeof FunASRServer>): FunASRServerSurface {
  return instance as unknown as FunASRServerSurface;
}

interface LoggerStub {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}

describe("FunASRServer transcribeFile validation", () => {
  let server: InstanceType<typeof FunASRServer>;
  let logger: LoggerStub;
  let tmpDir: string;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    server = new FunASRServer(logger);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "funasr-transcribe-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects empty/invalid path (INVALID_PATH)", async () => {
    const result = await server.transcribeFile("");
    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_PATH");
  });

  it("rejects non-string path (INVALID_PATH)", async () => {
    const result = await server.transcribeFile(null as unknown as string);
    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_PATH");
  });

  it("rejects unsupported format (FORMAT_NOT_SUPPORTED)", async () => {
    const filePath = path.join(tmpDir, "audio.txt");
    fs.writeFileSync(filePath, "fake");
    const result = await server.transcribeFile(filePath);
    expect(result.success).toBe(false);
    expect(result.code).toBe("FORMAT_NOT_SUPPORTED");
  });

  it("rejects non-existent file (FILE_NOT_FOUND)", async () => {
    const result = await server.transcribeFile(
      path.join(tmpDir, "nonexistent.wav"),
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("FILE_NOT_FOUND");
  });

  it("rejects oversized file (FILE_TOO_LARGE)", async () => {
    // Create a fake .wav and stub statSync to report huge size.
    const filePath = path.join(tmpDir, "huge.wav");
    fs.writeFileSync(filePath, "fake");
    const realStatSync = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((p: fs.PathLike) => {
      if (p === filePath) {
        return { size: 600 * 1024 * 1024 } as fs.Stats;
      }
      return realStatSync(p);
    });
    const result = await server.transcribeFile(filePath);
    expect(result.success).toBe(false);
    expect(result.code).toBe("FILE_TOO_LARGE");
  });

  it("returns SERVER_NOT_READY when server is not ready", async () => {
    const filePath = path.join(tmpDir, "test.wav");
    fs.writeFileSync(filePath, "fake audio data");
    const s = srv(server);
    s.serverReady = false;
    s.initializationPromise = null;
    const result = await server.transcribeFile(filePath);
    expect(result.success).toBe(false);
    expect(result.code).toBe("SERVER_NOT_READY");
  });

  it("sends transcription command when server is ready", async () => {
    const filePath = path.join(tmpDir, "ready.wav");
    fs.writeFileSync(filePath, "fake audio data");
    const s = srv(server);
    s.serverReady = true;
    s.messageRouter.sendCommand = vi.fn().mockResolvedValue({
      success: true,
      text: "transcribed text",
      raw_text: "raw",
      confidence: 0.95,
    });
    const result = await server.transcribeFile(filePath);
    expect(result.success).toBe(true);
    expect(result.text).toBe("transcribed text");
    expect(s.messageRouter.sendCommand).toHaveBeenCalledWith(
      "transcribe_file",
      expect.objectContaining({ audio_path: filePath }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("returns TRANSCRIPTION_FAILED on sendCommand error", async () => {
    const filePath = path.join(tmpDir, "fail.wav");
    fs.writeFileSync(filePath, "fake audio data");
    const s = srv(server);
    s.serverReady = true;
    s.messageRouter.sendCommand = vi
      .fn()
      .mockRejectedValue(new Error("timeout"));
    const result = await server.transcribeFile(filePath);
    expect(result.success).toBe(false);
    expect(result.code).toBe("TRANSCRIPTION_FAILED");
    expect(result.error).toContain("timeout");
  });
});

describe("FunASRServer diarizeAudio", () => {
  let server: InstanceType<typeof FunASRServer>;
  let logger: LoggerStub;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    server = new FunASRServer(logger);
  });

  it("returns error when server not ready", async () => {
    srv(server).serverReady = false;
    const result = await server.diarizeAudio("/fake.wav", []);
    expect(result.success).toBe(false);
    expect(result.error).toContain("未就绪");
  });

  it("sends diarize command when ready", async () => {
    const s = srv(server);
    s.serverReady = true;
    s.messageRouter.sendCommand = vi.fn().mockResolvedValue({
      success: true,
      segments: [],
    });
    const result = await server.diarizeAudio("/fake.wav", []);
    expect(result.success).toBe(true);
    expect(s.messageRouter.sendCommand).toHaveBeenCalledWith(
      "diarize",
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("returns error on command failure", async () => {
    const s = srv(server);
    s.serverReady = true;
    s.messageRouter.sendCommand = vi
      .fn()
      .mockRejectedValue(new Error("diarize failed"));
    const result = await server.diarizeAudio("/fake.wav", []);
    expect(result.success).toBe(false);
    expect(result.error).toContain("diarize failed");
  });
});

describe("FunASRServer cancelTranscription", () => {
  let server: InstanceType<typeof FunASRServer>;
  let logger: LoggerStub;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    server = new FunASRServer(logger);
  });

  it("returns error when server not ready", async () => {
    srv(server).serverReady = false;
    const result = await server.cancelTranscription();
    expect(result.success).toBe(false);
    expect(result.error).toContain("未就绪");
  });

  it("sends cancel command when ready", async () => {
    const s = srv(server);
    s.serverReady = true;
    s.messageRouter.sendCommand = vi.fn().mockResolvedValue({
      success: true,
    });
    const result = await server.cancelTranscription();
    expect(result.success).toBe(true);
  });

  it("returns error on command failure", async () => {
    const s = srv(server);
    s.serverReady = true;
    s.messageRouter.sendCommand = vi
      .fn()
      .mockRejectedValue(new Error("cancel failed"));
    const result = await server.cancelTranscription();
    expect(result.success).toBe(false);
    expect(result.error).toContain("cancel failed");
  });
});

describe("FunASRServer transcribeAudio (server-ready check)", () => {
  let server: InstanceType<typeof FunASRServer>;
  let logger: LoggerStub;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    server = new FunASRServer(logger);
  });

  it("throws when server is not ready after waiting for init", async () => {
    const s = srv(server);
    s.serverReady = false;
    s.initializationPromise = Promise.resolve();
    // createTempAudioFile is called before the ready check; mock it to
    // avoid needing a real audio blob. We spy on the surface's _sendServerCommand
    // to short-circuit, but the ready-check throw happens before that.
    // The method calls createTempAudioFile first — mock via vi.mock at top
    // would be cleaner, but for coverage we just need the throw path.
    // Actually the throw happens AFTER createTempAudioFile. So we need the
    // mock. Let's just assert it rejects.
    await expect(server.transcribeAudio(new ArrayBuffer(8))).rejects.toThrow(
      "未就绪",
    );
  });
});
