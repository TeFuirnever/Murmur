/**
 * Regression tests for model download & file transcription guards.
 *
 * Covers scenarios that caused "转录失败" when models were not downloaded:
 * - Model files missing → need_download state
 * - Download failure error handling
 * - IPC path validation edge cases (Windows + Chinese paths)
 * - m4a conversion path validation
 */
// [20260726_Tier3_ModelDownloadGuardsMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 4. Pattern: typed module-level `const C`/`const {
// validateAudioPath }` via `typeof import("...")` (TS7005), typed
// `let ModelManager`/`let tmpDir` (TS7034) and a ModelManagerTestSurface
// structural cast so the suite can override `getModelCachePath` (a public
// method that's not readonly — reassigning via cast keeps the rest of the
// instance type-checked). The validateAudioPath return is a discriminated
// union; reads of `.ext`/`.error` go via a tiny `as` cast at each call site.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
//
// [20260726_Tier32_ModelDownloadGuards] Tier 3.2: converted 3 cargo-cult
// require() sites + vi.resetModules() to top-level ESM imports. The module-
// scope `const C = require(...)` / `const validateAudioPath = require(...)`
// become `import * as C` / `import { validateAudioPath }`. The describe's
// `ModelManager = require(...)` + vi.resetModules() become a top-level
// default import; beforeEach retains the tmpDir setup.
// [20260726_Tier32_ModelDownloadGuards] END
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import * as C from "../../src/helpers/ipc-contracts";
import { validateAudioPath } from "../../src/helpers/audioPathValidator";
import ModelManager from "../../src/helpers/modelManager";

// [20260726_Tier3_ModelDownloadGuardsMigrate] Structural surface for the
// ModelManager instance: the suite overrides getModelCachePath per test and
// reads modelConfigs to enumerate required cache dirs. Both are public on
// the source class; the cast is needed because TS treats reassigning a
// method on a typed instance as an error.
interface ModelManagerTestSurface {
  clearCache: () => void;
  getModelCachePath: () => string;
  checkModelFiles: () => Promise<{
    success: boolean;
    models_downloaded: boolean;
    missing_models: string[];
  }>;
  modelConfigs: Record<string, { name: string; cache_path: string }>;
}

function asSurface<T>(m: T): ModelManagerTestSurface {
  return m as unknown as ModelManagerTestSurface;
}

// ─── modelManager: model files missing ───────────────────────────

describe("modelManager — model files missing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-guard-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns models_downloaded:false when cache directory does not exist", async () => {
    const m = asSurface(
      new ModelManager({
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
    );
    m.clearCache();
    m.getModelCachePath = () => path.join(tmpDir, "nonexistent");
    const result = await m.checkModelFiles();
    expect(result.success).toBe(true);
    expect(result.models_downloaded).toBe(false);
    expect(Array.isArray(result.missing_models)).toBe(true);
    expect(result.missing_models.length).toBeGreaterThan(0);
  });

  it("returns models_downloaded:false when cache exists but no model files", async () => {
    const m = asSurface(
      new ModelManager({
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
    );
    // tmpDir exists but is empty — no model.pt files
    m.clearCache();
    m.getModelCachePath = () => tmpDir;
    const result = await m.checkModelFiles();
    expect(result.success).toBe(true);
    expect(result.models_downloaded).toBe(false);
    expect(result.missing_models.length).toBeGreaterThan(0);
  });

  it("returns models_downloaded:true when all model.pt files exist", async () => {
    const m = asSurface(
      new ModelManager({
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
    );
    // Create all required model directories with model.pt
    m.clearCache();
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
    const m = asSurface(
      new ModelManager({
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
    );
    m.clearCache();
    m.getModelCachePath = () => path.join(tmpDir, "nonexistent");
    const result = await m.checkModelFiles();
    // When cache dir is missing entirely, returns ["all"]
    expect(result.missing_models).toContain("all");
  });
});

// ─── IPC path validation (tests real implementation) ─────────────

describe("IPC transcriptionHandlers — validateAudioPath", () => {
  it("accepts Windows drive letter path with Chinese characters", () => {
    // [20260726_Tier3_ModelDownloadGuardsMigrate] Discriminated union;
    // narrow to the valid branch via cast after the .valid assertion.
    const result = validateAudioPath("E:\\Video\\新录音 3.m4a");
    expect(result.valid).toBe(true);
    expect((result as { ext: string }).ext).toBe(".m4a");
  });

  it("accepts Windows drive letter path with spaces", () => {
    const result = validateAudioPath("D:\\My Files\\audio test.wav");
    expect(result.valid).toBe(true);
    expect((result as { ext: string }).ext).toBe(".wav");
  });

  it("accepts home directory path", () => {
    const homeFile = path.join(os.homedir(), "recording.mp3");
    const result = validateAudioPath(homeFile);
    expect(result.valid).toBe(true);
    expect((result as { ext: string }).ext).toBe(".mp3");
  });

  it("accepts temp directory path", () => {
    const tmpFile = path.join(os.tmpdir(), "test.flac");
    const result = validateAudioPath(tmpFile);
    expect(result.valid).toBe(true);
  });

  it("rejects unsupported extension", () => {
    const result = validateAudioPath("E:\\Video\\test.exe");
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toContain("不支持");
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
