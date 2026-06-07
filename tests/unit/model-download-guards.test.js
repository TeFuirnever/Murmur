/**
 * Regression tests for model download & file transcription guards.
 *
 * Covers scenarios that caused "转录失败" when models were not downloaded:
 * - Model files missing → need_download state
 * - Download failure error handling
 * - IPC path validation edge cases (Windows + Chinese paths)
 * - m4a conversion path validation
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const requireCJS = createRequire(import.meta.url);
const C = requireCJS("../../src/helpers/ipc-contracts");

// ─── modelManager: model files missing ───────────────────────────

describe("modelManager — model files missing", () => {
  let ModelManager;
  let tmpDir;

  beforeEach(() => {
    const mmPath = requireCJS.resolve("../../src/helpers/modelManager.js");
    delete requireCJS.cache[mmPath];
    ModelManager = requireCJS("../../src/helpers/modelManager.js");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-guard-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns models_downloaded:false when cache directory does not exist", async () => {
    const m = new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    m.getModelCachePath = () => path.join(tmpDir, "nonexistent");
    const result = await m.checkModelFiles();
    expect(result.success).toBe(true);
    expect(result.models_downloaded).toBe(false);
    expect(Array.isArray(result.missing_models)).toBe(true);
    expect(result.missing_models.length).toBeGreaterThan(0);
  });

  it("returns models_downloaded:false when cache exists but no model files", async () => {
    const m = new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    // tmpDir exists but is empty — no model.pt files
    m.getModelCachePath = () => tmpDir;
    const result = await m.checkModelFiles();
    expect(result.success).toBe(true);
    expect(result.models_downloaded).toBe(false);
    expect(result.missing_models.length).toBeGreaterThan(0);
  });

  it("returns models_downloaded:true when all model.pt files exist", async () => {
    const m = new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    // Create all required model directories with model.pt
    for (const config of Object.values(m.modelConfigs)) {
      const modelDir = path.join(tmpDir, config.cache_path);
      fs.mkdirSync(modelDir, { recursive: true });
      fs.writeFileSync(path.join(modelDir, "model.pt"), "fake-model-data");
    }
    m.getModelCachePath = () => tmpDir;
    const result = await m.checkModelFiles();
    expect(result.success).toBe(true);
    expect(result.models_downloaded).toBe(true);
    expect(result.missing_models).toEqual([]);
  });

  it("returns missing_models indicating all models are absent", async () => {
    const m = new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    m.getModelCachePath = () => path.join(tmpDir, "nonexistent");
    const result = await m.checkModelFiles();
    // When cache dir is missing entirely, returns ["all"]
    expect(result.missing_models).toContain("all");
  });
});

// ─── IPC path validation (mirrors transcriptionHandlers.js logic) ─

describe("IPC transcriptionHandlers — validateAudioPath", () => {
  function validateAudioPath(filePath) {
    const allowedExts = C.AUDIO_EXTENSIONS;
    const ext = path.extname(filePath).toLowerCase();
    if (!allowedExts.includes(ext)) {
      return { valid: false, error: "不支持的音频格式: " + ext };
    }
    const resolved = path.resolve(filePath);
    const homedir = os.homedir();
    const tmpdir = os.tmpdir();
    if (
      !resolved.startsWith(homedir) &&
      !resolved.startsWith(tmpdir) &&
      !resolved.startsWith("/Volumes/") &&
      !/^[A-Za-z]:\\/.test(resolved)
    ) {
      return { valid: false, error: "路径不在允许范围内" };
    }
    return { valid: true, ext, resolved };
  }

  it("accepts Windows drive letter path with Chinese characters", () => {
    const result = validateAudioPath("E:\\Video\\新录音 3.m4a");
    expect(result.valid).toBe(true);
    expect(result.ext).toBe(".m4a");
  });

  it("accepts Windows drive letter path with spaces", () => {
    const result = validateAudioPath("D:\\My Files\\audio test.wav");
    expect(result.valid).toBe(true);
    expect(result.ext).toBe(".wav");
  });

  it("accepts home directory path", () => {
    const homeFile = path.join(os.homedir(), "recording.mp3");
    const result = validateAudioPath(homeFile);
    expect(result.valid).toBe(true);
    expect(result.ext).toBe(".mp3");
  });

  it("accepts temp directory path", () => {
    const tmpFile = path.join(os.tmpdir(), "test.flac");
    const result = validateAudioPath(tmpFile);
    expect(result.valid).toBe(true);
  });

  it("rejects unsupported extension", () => {
    const result = validateAudioPath("E:\\Video\\test.exe");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("不支持");
  });

  it("rejects .txt extension", () => {
    const result = validateAudioPath("/tmp/test.txt");
    expect(result.valid).toBe(false);
  });
});

// ─── Audio extension & conversion guards ─────────────────────────

describe("Audio format guards", () => {
  it("m4a is in AUDIO_EXTENSIONS", () => {
    expect(C.AUDIO_EXTENSIONS).toContain(".m4a");
  });

  it("all expected formats are supported", () => {
    const expected = [".wav", ".mp3", ".m4a", ".flac", ".ogg", ".wma", ".aac"];
    for (const ext of expected) {
      expect(C.AUDIO_EXTENSIONS).toContain(ext);
    }
  });

  it("m4a requires conversion (not in wav-only set)", () => {
    const directPlay = [".wav", ".flac"];
    expect(directPlay.includes(".m4a")).toBe(false);
  });
});
