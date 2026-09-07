// [20260726_Tier3_ModelManagerShapeMigrate] Migrated from .js to .ts as part
// of Tier 3 batch 3. Pattern: type the module-level `let ModelManager` via
// `typeof import("...").default` (the source default-exports the class); the
// _tsresolve.setup unwraps the ESM default to the class at runtime, so
// `ModelManager = require(...)` + `new ModelManager()` works unchanged. Type
// `let tmpDir` as string (assigned in beforeEach, TS7034). Once ModelManager
// is typed, `m.modelConfigs` is Record<string, ModelConfig>, so
// `Object.values(...)` yields ModelConfig[] and `config.cache_path` resolves.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
//
// [20260726_Tier32_ModelManagerShape] Tier 3.2: converted cargo-cult
// require() + vi.resetModules() to top-level ESM default import. No vi.mock()
// was used — the resetModules call was cargo-cult from .js era. The original
// comment claimed resetModules reset module-level caches (globalModelCheckCache),
// but the tests call `m.clearCache()` per-test on a fresh instance, so any
// module-level cache is irrelevant. beforeEach retains tmpDir setup.
// [20260726_Tier32_ModelManagerShape] END
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import ModelManager from "../../src/helpers/modelManager";

describe("modelManager.checkModelFiles contract", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns success:true when cache directory is missing", async () => {
    const m = new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    m.clearCache();
    m.getModelCachePath = () => path.join(tmpDir, "does-not-exist");
    const r = await m.checkModelFiles();
    expect(r.success).toBe(true);
    expect(r.models_downloaded).toBe(false);
  });

  it("returns success:true when cache exists but files are missing", async () => {
    const m = new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    m.clearCache();
    m.getModelCachePath = () => tmpDir;
    const r = await m.checkModelFiles();
    expect(r.success).toBe(true);
    expect(r.models_downloaded).toBe(false);
    expect(Array.isArray(r.missing_models)).toBe(true);
  });

  it("detects downloaded models in directory with model.pt", async () => {
    const m = new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    m.clearCache();
    for (const config of Object.values(m.modelConfigs)) {
      const modelDir = path.join(tmpDir, config.cache_path);
      fs.mkdirSync(modelDir, { recursive: true });
      fs.writeFileSync(path.join(modelDir, "model.pt"), "x".repeat(100));
    }
    m.getModelCachePath = () => tmpDir;
    const r = await m.checkModelFiles();
    expect(r.success).toBe(true);
    expect(r.models_downloaded).toBe(true);
    expect(r.missing_models).toEqual([]);
  });
});

// [20260906_Spec259_T2] Branch close-out for the instrumented helpers
// (Spec #259 T2, ticket #274): filesystem-driven matrix over findDamoRoot,
// getModelCachePath candidate resolution, the fallback-aware checkModelFiles
// arms, and _verifyModel marker/size/catch paths. No electron mock here —
// the lazy require("electron") fallbacks resolve to os.tmpdir()/process.cwd(),
// which those catch arms are exactly for.
describe("[20260906_Spec259_T2] modelManager branch close-out (fs)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-branch-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeManager(): ModelManager {
    return new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
  }

  describe("findDamoRoot", () => {
    it("returns null for a nonexistent start directory", () => {
      const m = makeManager();
      expect(m.findDamoRoot(path.join(tmpDir, "nope"))).toBeNull();
    });

    it("returns null immediately when depth exceeds maxDepth", () => {
      const m = makeManager();
      const root = path.join(tmpDir, "r");
      fs.mkdirSync(root, { recursive: true });
      expect(m.findDamoRoot(root, 6, 5)).toBeNull();
    });

    it("finds a damo root via the seaco generation", () => {
      const m = makeManager();
      const damo = path.join(tmpDir, "deep", "damo");
      fs.mkdirSync(path.join(damo, "speech_seaco_paraformer_large"), {
        recursive: true,
      });

      expect(m.findDamoRoot(tmpDir)).toBe(damo);
    });

    it("skips file entries via the isDirectory guard", () => {
      const m = makeManager();
      // A directory containing ONLY a file: the entry fails the
      // isDirectory guard, the loop ends, and no damo root is found.
      const fileOnly = path.join(tmpDir, "files");
      fs.mkdirSync(fileOnly, { recursive: true });
      fs.writeFileSync(path.join(fileOnly, "notes.txt"), "x");

      expect(m.findDamoRoot(fileOnly)).toBeNull();
    });

    it("accepts the paraformer rollback generation as a valid damo root", () => {
      const m = makeManager();
      const damo = path.join(tmpDir, "damo");
      fs.mkdirSync(path.join(damo, "speech_paraformer-large_asr"), {
        recursive: true,
      });

      expect(m.findDamoRoot(tmpDir)).toBe(damo);
    });

    it("keeps recursing past a damo directory without any expected model", () => {
      const m = makeManager();
      const emptyDamo = path.join(tmpDir, "aa", "damo");
      fs.mkdirSync(path.join(emptyDamo, "unrelated_model"), {
        recursive: true,
      });
      const realDamo = path.join(tmpDir, "zz", "damo");
      fs.mkdirSync(path.join(realDamo, "speech_seaco_paraformer_x"), {
        recursive: true,
      });

      // "aa/damo" lacks the expected generations (predicate false arms), so
      // the search continues into deeper directories and finds "zz/damo".
      expect(m.findDamoRoot(tmpDir)).toBe(realDamo);
    });
  });

  describe("checkModelFiles fallback-aware arms", () => {
    it("counts a ready fallback as minimum-ready while flagging the upgrade", async () => {
      const m = makeManager();
      m.clearCache();
      // asr: primary absent, recorded fallback present and valid.
      const fallbackDir = path.join(
        tmpDir,
        "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
      );
      fs.mkdirSync(fallbackDir, { recursive: true });
      fs.writeFileSync(path.join(fallbackDir, "model.pt"), "x");
      // vad: required, present but incomplete (no marker file).
      fs.mkdirSync(
        path.join(tmpDir, "speech_fsmn_vad_zh-cn-16k-common-pytorch"),
        {
          recursive: true,
        },
      );
      // punc: optional, absent entirely.

      m.getModelCachePath = () => tmpDir;
      const r = await m.checkModelFiles();

      expect(r.models_downloaded).toBe(false);
      // Fallback carries readiness for the required asr model, but vad is
      // required and not ready → minimum_ready false.
      expect(r.minimum_ready).toBe(false);
      expect(r.missing_models).toEqual(["asr", "vad", "punc"]);
      expect(r.model_details!.asr!.downloaded).toBe(true);
      expect(r.model_details!.vad!.downloaded).toBe(false);
    });

    it("keeps minimum_ready true when the only gaps are fallback-covered or optional", async () => {
      const m = makeManager();
      m.clearCache();
      const fallbackDir = path.join(
        tmpDir,
        "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
      );
      fs.mkdirSync(fallbackDir, { recursive: true });
      fs.writeFileSync(path.join(fallbackDir, "pytorch_model.bin"), "x");
      // vad ready via configuration.json marker.
      const vadDir = path.join(
        tmpDir,
        "speech_fsmn_vad_zh-cn-16k-common-pytorch",
      );
      fs.mkdirSync(vadDir, { recursive: true });
      fs.writeFileSync(path.join(vadDir, "configuration.json"), "{}");

      m.getModelCachePath = () => tmpDir;
      const r = await m.checkModelFiles();

      // Only punc (optional, absent) and asr's upgrade flag are missing →
      // startup stays unblocked (asr runs on its fallback generation).
      expect(r.minimum_ready).toBe(true);
      expect(r.missing_models).toEqual(["asr", "punc"]);
      expect(r.model_details!.asr!.downloaded).toBe(true);
      expect(r.model_details!.vad!.downloaded).toBe(true);
    });

    it("returns the cached result for repeated checks within the cache window", async () => {
      const m = makeManager();
      m.clearCache();
      // The module-level cache only populates after the full per-model loop,
      // which requires the cache directory itself to exist.
      fs.mkdirSync(path.join(tmpDir, "cache"), { recursive: true });
      m.getModelCachePath = () => path.join(tmpDir, "cache");

      const first = await m.checkModelFiles();
      const second = await m.checkModelFiles();
      expect(second).toBe(first); // same object identity → cache hit
    });

    it("skips the fallback probe when the primary model is complete", async () => {
      const m = makeManager();
      m.clearCache();
      const primaryDir = path.join(
        tmpDir,
        "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
      );
      fs.mkdirSync(primaryDir, { recursive: true });
      fs.writeFileSync(path.join(primaryDir, "config.yaml"), "y");

      m.getModelCachePath = () => tmpDir;
      const r = await m.checkModelFiles();
      expect(r.model_details!.asr!.downloaded).toBe(true);
      // vad/punc still missing, but asr did not need its fallback.
      expect(r.missing_models).toEqual(["vad", "punc"]);
    });
  });

  describe("_verifyModel", () => {
    it("accepts a directory carrying any known marker file", () => {
      const m = makeManager();
      const dir = path.join(tmpDir, "d1");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "pytorch_model.bin"), "x");
      expect(
        m._verifyModel(dir, {
          name: "n",
          cache_path: "c",
          expected_size: 100,
          required: true,
        }),
      ).toBe(true);

      const dir2 = path.join(tmpDir, "d2");
      fs.mkdirSync(dir2, { recursive: true });
      fs.writeFileSync(path.join(dir2, "config.yaml"), "y");
      expect(
        m._verifyModel(dir2, {
          name: "n",
          cache_path: "c",
          expected_size: 100,
          required: true,
        }),
      ).toBe(true);

      const dir3 = path.join(tmpDir, "d3");
      fs.mkdirSync(dir3, { recursive: true });
      expect(
        m._verifyModel(dir3, {
          name: "n",
          cache_path: "c",
          expected_size: 100,
          required: true,
        }),
      ).toBe(false); // no marker present
    });

    it("accepts a regular file at >= 90% of the expected size and rejects smaller files", () => {
      const m = makeManager();
      const file = path.join(tmpDir, "model.bin");
      fs.writeFileSync(file, "x".repeat(95));
      expect(
        m._verifyModel(file, {
          name: "n",
          cache_path: "c",
          expected_size: 100,
          required: true,
        }),
      ).toBe(true);
      expect(
        m._verifyModel(file, {
          name: "n",
          cache_path: "c",
          expected_size: 1000,
          required: true,
        }),
      ).toBe(false);
    });

    it("returns false for a path that cannot be stat'ed", () => {
      const m = makeManager();
      expect(
        m._verifyModel(path.join(tmpDir, "ghost"), {
          name: "n",
          cache_path: "c",
          expected_size: 100,
          required: true,
        }),
      ).toBe(false);
    });
  });
});
