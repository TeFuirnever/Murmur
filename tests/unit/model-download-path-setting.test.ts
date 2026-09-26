// [20260926_Issue406] Issue #406: model_download_path wiring. The FunASR
// model directory is injected through the MODELSCOPE_CACHE environment
// variable — the one knob the WHOLE model-path chain already honors:
//
//   - download_models.py snapshot_download() (modelscope reads
//     MODELSCOPE_CACHE for its cache root)
//   - funasr_server.py _default_damo_root() / _hub_models_roots()
//     (funasr_server.py:354/:456) and the Node-side cache probe
//     (modelManager.ts getModelCachePath, modelManager.ts:189)
//
// So the config-reading side is ONE env-var application at main-process
// boot, BEFORE funasrManager.initializeAtStartup() spawns the Python
// server / download subprocess (both inherit process.env; the server env
// copy in buildPythonEnvironment snapshots it too). FunASR subprocess
// lifecycle code is untouched (AGENTS.md high-risk area).
//
// Semantics chosen for the boot-time contract: a non-empty setting SETS
// process.env.MODELSCOPE_CACHE (trimmed); an empty setting leaves the
// environment untouched so a developer-shell MODELSCOPE_CACHE keeps its
// pre-existing (system-default) behavior.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  applyModelDownloadPathSetting,
  MODEL_DOWNLOAD_PATH_ENV,
} from "../../src/helpers/funasrManager";

describe("[20260926_Issue406] applyModelDownloadPathSetting (config side)", () => {
  const ORIGINAL = process.env.MODELSCOPE_CACHE;

  beforeEach(() => {
    delete process.env.MODELSCOPE_CACHE;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.MODELSCOPE_CACHE;
    } else {
      process.env.MODELSCOPE_CACHE = ORIGINAL;
    }
  });

  it("exports the env-var name it drives (single point of truth for the knob)", () => {
    expect(MODEL_DOWNLOAD_PATH_ENV).toBe("MODELSCOPE_CACHE");
  });

  it("sets MODELSCOPE_CACHE from a non-empty setting value", () => {
    applyModelDownloadPathSetting("/data/murmur-models");
    expect(process.env.MODELSCOPE_CACHE).toBe("/data/murmur-models");
  });

  it("trims surrounding whitespace from the configured directory", () => {
    applyModelDownloadPathSetting("  /data/murmur-models  ");
    expect(process.env.MODELSCOPE_CACHE).toBe("/data/murmur-models");
  });

  it("leaves the environment untouched for an empty setting (system default)", () => {
    applyModelDownloadPathSetting("");
    expect(process.env.MODELSCOPE_CACHE).toBeUndefined();
  });

  it("leaves the environment untouched for null/undefined/non-string values", () => {
    applyModelDownloadPathSetting(null);
    applyModelDownloadPathSetting(undefined);
    applyModelDownloadPathSetting(42 as unknown as string);
    expect(process.env.MODELSCOPE_CACHE).toBeUndefined();
  });

  it("a later empty apply does not clear a value set by an earlier apply", () => {
    applyModelDownloadPathSetting("/data/murmur-models");
    applyModelDownloadPathSetting("");
    // Boot-time contract: the helper is applied once per launch; an empty
    // value must not silently revert a previously-applied directory inside
    // the same process (the UI notes that changes need an app restart).
    expect(process.env.MODELSCOPE_CACHE).toBe("/data/murmur-models");
  });
});
