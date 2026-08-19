// [20260820_T15_SeacoSwap] Ticket #192 review MAJOR: checkModelFiles must
// honor the old-model fallback — an old-only layout (upgrading user whose
// SeACo download hasn't run/failed) must report minimum_ready=true so the
// server is allowed to start, while models_downloaded stays false so the
// upgrade entry point remains visible. RED first.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp") },
}));

import ModelManager from "../../src/helpers/modelManager";

interface Surface {
  clearCache(): void;
  getModelCachePath(): string;
  modelConfigs: Record<string, { cache_path: string; fallback_name?: string }>;
  checkModelFiles(): Promise<{
    models_downloaded: boolean;
    minimum_ready: boolean;
    missing_models: string[];
    model_details: Record<string, { downloaded: boolean }>;
  }>;
}

function asSurface(m: ModelManager): Surface {
  return m as unknown as Surface;
}

const SEACO_DIR =
  "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch";
const OLD_DIR =
  "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch";
const VAD_DIR = "speech_fsmn_vad_zh-cn-16k-common-pytorch";

function seedRepo(cache: string, dir: string) {
  fs.mkdirSync(path.join(cache, dir), { recursive: true });
  fs.writeFileSync(path.join(cache, dir, "model.pt"), "x");
}

describe("[20260820_T15_SeacoSwap] checkModelFiles fallback", () => {
  let cache: string;

  beforeEach(() => {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), "t15-fb-"));
  });

  afterEach(() => {
    fs.rmSync(cache, { recursive: true, force: true });
  });

  function makeManager(): Surface {
    const m = asSurface(new ModelManager(null));
    m.clearCache();
    m.getModelCachePath = () => cache;
    return m;
  }

  it("old-only layout (upgrading user): minimum_ready=true, models_downloaded=false", async () => {
    seedRepo(cache, OLD_DIR);
    seedRepo(cache, VAD_DIR);
    const result = await makeManager().checkModelFiles();
    expect(result.minimum_ready).toBe(true);
    expect(result.models_downloaded).toBe(false);
    expect(result.model_details.asr?.downloaded).toBe(true);
  });

  it("both generations present: fully downloaded (SeACo counts)", async () => {
    seedRepo(cache, SEACO_DIR);
    seedRepo(cache, OLD_DIR);
    seedRepo(cache, VAD_DIR);
    seedRepo(cache, "punc_ct-transformer_zh-cn-common-vocab272727-pytorch");
    const result = await makeManager().checkModelFiles();
    expect(result.minimum_ready).toBe(true);
    expect(result.models_downloaded).toBe(true);
  });

  it("neither ASR on disk: minimum_ready=false, only 'asr' missing", async () => {
    seedRepo(cache, VAD_DIR);
    const result = await makeManager().checkModelFiles();
    expect(result.minimum_ready).toBe(false);
    expect(result.missing_models).toContain("asr");
  });
});
