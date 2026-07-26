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
