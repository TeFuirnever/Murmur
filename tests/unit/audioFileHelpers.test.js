import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const {
  createTempAudioFile,
  cleanupTempFile,
  getFFmpegPath,
  _resetFFmpegCache,
  _setFFmpegDetector,
  convertAudioFile,
} = require("../../src/helpers/audioFileHelpers");

const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
};

const createdFiles = [];

afterEach(async () => {
  for (const f of createdFiles) {
    try {
      await fs.promises.unlink(f);
    } catch {}
  }
  createdFiles.length = 0;
  _resetFFmpegCache();
});

describe("audioFileHelpers", () => {
  describe("getFFmpegPath", () => {
    it("returns null when ffmpeg is not installed", () => {
      _setFFmpegDetector(() => null);
      expect(getFFmpegPath()).toBeNull();
    });

    it("returns resolved path when ffmpeg is installed", () => {
      _setFFmpegDetector(() => "/usr/local/bin/ffmpeg");
      expect(getFFmpegPath()).toBe("/usr/local/bin/ffmpeg");
    });

    it("trims whitespace from detected path", () => {
      _setFFmpegDetector(() => "/usr/local/bin/ffmpeg\n");
      expect(getFFmpegPath()).toBe("/usr/local/bin/ffmpeg");
    });

    it("caches result across calls", () => {
      let callCount = 0;
      _setFFmpegDetector(() => {
        callCount++;
        return "/opt/homebrew/bin/ffmpeg";
      });
      getFFmpegPath();
      getFFmpegPath();
      expect(callCount).toBe(1);
    });
  });

  describe("createTempAudioFile", () => {
    it("creates file from Uint8Array", async () => {
      const data = new Uint8Array([82, 73, 70, 70]); // "RIFF"
      const result = await createTempAudioFile(mockLogger, data);
      createdFiles.push(result);
      expect(result).toMatch(/funasr_audio_.*\.wav$/);
      const stats = await fs.promises.stat(result);
      expect(stats.size).toBe(4);
    });

    it("creates file from ArrayBuffer", async () => {
      const data = new ArrayBuffer(8);
      new Uint8Array(data).set([1, 2, 3, 4, 5, 6, 7, 8]);
      const result = await createTempAudioFile(mockLogger, data);
      createdFiles.push(result);
      const stats = await fs.promises.stat(result);
      expect(stats.size).toBe(8);
    });

    it("creates file from base64 string", async () => {
      const result = await createTempAudioFile(mockLogger, "SGVsbG8=");
      createdFiles.push(result);
      const content = await fs.promises.readFile(result);
      expect(content.toString()).toBe("Hello");
    });

    it("creates file from Buffer-like object with .buffer", async () => {
      const buf = Buffer.from("test data");
      const result = await createTempAudioFile(
        mockLogger,
        new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      );
      createdFiles.push(result);
      const content = await fs.promises.readFile(result);
      expect(content.toString()).toBe("test data");
    });

    it("throws for unsupported type", async () => {
      await expect(createTempAudioFile(mockLogger, 42)).rejects.toThrow(
        "不支持的音频数据类型",
      );
    });

    it("throws for empty buffer", async () => {
      await expect(
        createTempAudioFile(mockLogger, new Uint8Array(0)),
      ).rejects.toThrow("音频文件为空");
    });
  });

  describe("cleanupTempFile", () => {
    it("deletes a file", async () => {
      const tempPath = path.join(os.tmpdir(), `test_cleanup_${Date.now()}`);
      await fs.promises.writeFile(tempPath, "test");
      await cleanupTempFile(tempPath);
      expect(fs.existsSync(tempPath)).toBe(false);
    });

    it("does not throw for non-existent file", async () => {
      await expect(
        cleanupTempFile("/non/existent/path"),
      ).resolves.toBeUndefined();
    });
  });

  describe("convertAudioFile", () => {
    it("returns input path for .wav files (no ffmpeg needed)", async () => {
      _setFFmpegDetector(() => null);
      const result = await convertAudioFile(
        { info: vi.fn() },
        "/some/file.wav",
      );
      expect(result).toBe("/some/file.wav");
    });

    it("returns input path for .flac files", async () => {
      const result = await convertAudioFile(
        { info: vi.fn() },
        "/some/file.flac",
      );
      expect(result).toBe("/some/file.flac");
    });

    it("throws friendly error when ffmpeg not found for mp3", async () => {
      _setFFmpegDetector(() => null);
      await expect(
        convertAudioFile({ info: vi.fn(), warn: vi.fn() }, "/some/file.mp3"),
      ).rejects.toThrow("未找到 ffmpeg");
    });

    it("error message includes brew install hint", async () => {
      _setFFmpegDetector(() => null);
      await expect(
        convertAudioFile({ info: vi.fn(), warn: vi.fn() }, "/some/file.m4a"),
      ).rejects.toThrow("brew install");
    });

    it("error message includes apt install hint", async () => {
      _setFFmpegDetector(() => null);
      await expect(
        convertAudioFile({ info: vi.fn(), warn: vi.fn() }, "/some/file.aac"),
      ).rejects.toThrow("apt install");
    });
  });
});
