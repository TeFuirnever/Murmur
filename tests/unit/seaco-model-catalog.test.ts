// [20260820_T15_SeacoSwap] Ticket #192: catalog sync + fallback contract.
// RED first — every sync point that T13 flagged must move to SeACo while
// the OLD paraformer remains a valid fallback (load-failure rollback).
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp") },
}));

import ModelManager from "../../src/helpers/modelManager";

const ROOT = path.join(__dirname, "../..");

describe("[20260820_T15_SeacoSwap] model catalog", () => {
  it("asr config points at SeACo with the T13-measured expected size", () => {
    const mgr = new ModelManager(null);
    const cfg = mgr.modelConfigs.asr!;
    expect(cfg.name).toBe(
      "damo/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    );
    // T13 spike: 952.7 MB on disk.
    expect(cfg.expected_size).toBe(Math.round(952.7 * 1024 * 1024));
    expect(cfg.required).toBe(true);
  });

  it("fallback ASR (old paraformer) is recorded for rollback", () => {
    const mgr = new ModelManager(null);
    const cfg = mgr.modelConfigs.asr as { fallback_name?: string };
    expect(cfg.fallback_name).toBe(
      "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    );
  });
});

describe("[20260820_T15_SeacoSwap] source-contract sync points", () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

  it("funasr_server loads SeACo with paraformer fallback", () => {
    const src = read("funasr_server.py");
    // Class constants + loader loop (constants sit above the method).
    expect(src).toContain(
      'ASR_MODEL_SEACO = "damo/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"',
    );
    expect(src).toContain(
      'ASR_MODEL_FALLBACK = "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"',
    );
    const loadBody = src.slice(
      src.indexOf("def _load_asr_model"),
      src.indexOf("def _load_vad_model"),
    );
    expect(loadBody).toContain("for model_name in");
    expect(loadBody).toContain("self.asr_model_name = model_name");
  });

  it("startup repo check accepts either ASR generation", () => {
    const src = read("funasr_server.py");
    const check = src.slice(
      src.indexOf("asr_repos = ["),
      src.indexOf("if not missing_required:"),
    );
    expect(check).toContain("speech_seaco_paraformer_large");
    expect(check).toContain("speech_paraformer-large");
    expect(check).toContain("asr_satisfied");
  });

  it("cache discovery prefixes include the SeACo directory", () => {
    const src = read("src/helpers/modelManager.ts");
    expect(src).toContain('startsWith("speech_seaco_paraformer")');
    expect(src).toContain('startsWith("speech_paraformer")');
  });

  it("download script table carries SeACo", () => {
    const src = read("download_models.py");
    expect(src).toContain("speech_seaco_paraformer_large");
  });
});
