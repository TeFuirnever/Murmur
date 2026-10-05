// [20261002_T9_MigrationUx] Ticket #420: the torch-fallback probe backing
// the migration state's torch_fallback_available flag. The old torch
// generation stays on disk for one version cycle as the rollback path while
// the ONNX migration is deferred (spec #412 user story 5 / decision 11) —
// the probe must judge "usable fallback" with the SAME policy as the Python
// startup gate (ASR any generation + VAD ready; punc optional) and the SAME
// hub-layout resolution as the readiness checks (#336 class).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import ModelManager from "../../src/helpers/modelManager";

describe("[20261002_T9_MigrationUx] isTorchGenerationPresent (#420)", () => {
  let tmpDir: string;
  let manager: ModelManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "torch-fallback-"));
    manager = new ModelManager({
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    manager.getModelCachePath = () => tmpDir;
    manager.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeTorchRepo(repoName: string) {
    const dir = path.join(tmpDir, repoName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "model.pt"), "torch-bytes");
  }

  it("seaco ASR + VAD repos present → fallback available", () => {
    makeTorchRepo(
      "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    );
    makeTorchRepo("speech_fsmn_vad_zh-cn-16k-common-pytorch");
    expect(manager.isTorchGenerationPresent()).toBe(true);
  });

  it("old paraformer ASR rollback + VAD → fallback available", () => {
    makeTorchRepo(
      "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    );
    makeTorchRepo("speech_fsmn_vad_zh-cn-16k-common-pytorch");
    expect(manager.isTorchGenerationPresent()).toBe(true);
  });

  it("ASR without VAD → not a usable fallback (server gate needs both)", () => {
    makeTorchRepo(
      "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    );
    expect(manager.isTorchGenerationPresent()).toBe(false);
  });

  it("VAD without ASR → not a usable fallback", () => {
    makeTorchRepo("speech_fsmn_vad_zh-cn-16k-common-pytorch");
    expect(manager.isTorchGenerationPresent()).toBe(false);
  });

  it("modelscope 1.39 hub layout (damo--<repo>/snapshots/<rev>) counts", () => {
    const snap = path.join(
      tmpDir,
      "damo--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
      "snapshots",
      "v2.0.4",
    );
    fs.mkdirSync(snap, { recursive: true });
    fs.writeFileSync(path.join(snap, "model.pt"), "torch-bytes");
    makeTorchRepo("speech_fsmn_vad_zh-cn-16k-common-pytorch");
    expect(manager.isTorchGenerationPresent()).toBe(true);
  });

  it("a repo holding only temp part-files is NOT ready (mid-download dir)", () => {
    const dir = path.join(
      tmpDir,
      "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "model.pt_0_167772159"), "shard-part");
    makeTorchRepo("speech_fsmn_vad_zh-cn-16k-common-pytorch");
    expect(manager.isTorchGenerationPresent()).toBe(false);
  });
});
