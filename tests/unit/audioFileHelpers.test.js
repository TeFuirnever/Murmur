import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const {
  createTempAudioFile,
  cleanupTempFile,
  getFFmpegPath,
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
});

describe("audioFileHelpers", () => {
  describe("getFFmpegPath", () => {
    it("returns ffmpeg", () => {
      expect(getFFmpegPath()).toBe("ffmpeg");
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
    it("returns input path for .wav files", async () => {
      const result = await convertAudioFile(mockLogger, "/some/file.wav");
      expect(result).toBe("/some/file.wav");
    });

    it("returns input path for .flac files", async () => {
      const result = await convertAudioFile(mockLogger, "/some/file.flac");
      expect(result).toBe("/some/file.flac");
    });

    it("rejects when ffmpeg is not available", async () => {
      // ffmpeg likely not available in test env
      await expect(
        convertAudioFile(mockLogger, "/some/file.mp3"),
      ).rejects.toThrow();
    });
  });
});
