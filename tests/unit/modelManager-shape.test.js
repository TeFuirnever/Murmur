import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const requireCJS = createRequire(import.meta.url);

describe("modelManager.checkModelFiles contract", () => {
  let ModelManager;
  let tmpDir;

  beforeEach(() => {
    const mmPath = requireCJS.resolve("../../src/helpers/modelManager.js");
    delete requireCJS.cache[mmPath];
    ModelManager = requireCJS("../../src/helpers/modelManager.js");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns success:true when cache directory is missing", async () => {
    const m = new ModelManager({ info: () => {}, warn: () => {}, error: () => {} });
    m.getModelCachePath = () => path.join(tmpDir, "does-not-exist");
    const r = await m.checkModelFiles();
    expect(r.success).toBe(true);
    expect(r.models_downloaded).toBe(false);
  });

  it("returns success:true when cache exists but files are missing", async () => {
    const m = new ModelManager({ info: () => {}, warn: () => {}, error: () => {} });
    m.getModelCachePath = () => tmpDir;
    const r = await m.checkModelFiles();
    expect(r.success).toBe(true);
    expect(r.models_downloaded).toBe(false);
    expect(Array.isArray(r.missing_models)).toBe(true);
  });

  it("detects downloaded models in directory with model.pt", async () => {
    const m = new ModelManager({ info: () => {}, warn: () => {}, error: () => {} });
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
