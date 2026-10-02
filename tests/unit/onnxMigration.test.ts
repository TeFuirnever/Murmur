// [20261002_T9_MigrationUx] Ticket #420 (spec #412 user stories 3/5): the
// old-user migration state module. On first launch after the ONNX upgrade the
// app must TELL the user a ~660MB model re-download is required (explicit
//告知, never a silent background pull) and whether the old torch generation
// is still available as the fallback while the download is deferred. These
// tests pin the state computation: readiness against the pinned exact sets,
// the required-model policy (asr + vad — mirroring the Python startup gate
// _find_missing_required_models, punc/speaker optional), the dialog volume
// numbers, and the invalid-pin suppression path.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

import { getOnnxMigrationStatus } from "../../src/helpers/onnxMigration";
import type { ModelPin } from "../../src/helpers/modelDownloader";

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function makePin(): ModelPin {
  const asrMain = Buffer.from("asr-main-graph-bytes");
  const asrTokens = Buffer.from("a\nb\nc\n");
  const vadConfig = Buffer.from("vad_config: fsmn\n");
  return {
    schema_version: 1,
    generated_utc: "2026-10-02T00:00:00+00:00",
    license: "Apache-2.0",
    attribution: "Exported from official iic checkpoints (FunASR).",
    release: {
      tag: "models-onnx-int8-1",
      url: "https://gh-mirror.test/releases/tags/models-onnx-int8-1",
      asset_base_url: "https://gh-mirror.test/download/models-onnx-int8-1/",
    },
    models: {
      asr: {
        name: "asr-seaco-paraformer",
        modelscope_repo: "iic/speech_seaco_paraformer_test",
        model_revision: "v2.0.4",
        checkpoint_commit: "a".repeat(40),
        export: { funasr: "1.3.1", torch: "2.0.1" },
        files: [
          {
            path: "model_quant.onnx",
            sha256: sha256(asrMain),
            size_bytes: asrMain.length,
            asset: "asr-seaco-paraformer__model_quant.onnx",
          },
          {
            path: "tokens.txt",
            sha256: sha256(asrTokens),
            size_bytes: asrTokens.length,
            asset: "asr-seaco-paraformer__tokens.txt",
          },
        ],
      },
      vad: {
        name: "vad-fsmn",
        modelscope_repo: "iic/speech_fsmn_vad_test",
        model_revision: "v2.0.4",
        checkpoint_commit: "b".repeat(40),
        export: { funasr: "1.3.1", torch: "2.0.1" },
        files: [
          {
            path: "vad_config.yaml",
            sha256: sha256(vadConfig),
            size_bytes: vadConfig.length,
            asset: "vad-fsmn__vad_config.yaml",
          },
        ],
      },
    },
  };
}

describe("[20261002_T9_MigrationUx] migration state (#420)", () => {
  let tmpDir: string;
  let pinPath: string;
  let modelsRoot: string;
  let pin: ModelPin;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onnx-migration-"));
    modelsRoot = path.join(tmpDir, "root");
    pinPath = path.join(tmpDir, "model-pin.json");
    pin = makePin();
    fs.writeFileSync(pinPath, JSON.stringify(pin));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeModelFile(
    modelName: string,
    fileName: string,
    content: Buffer,
  ) {
    const dir = path.join(modelsRoot, modelName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), content);
  }

  function statusWithTorch(torchPresent: boolean) {
    return getOnnxMigrationStatus({
      pinPath,
      modelsRoot,
      torchFallbackPresent: () => torchPresent,
    });
  }

  it("fresh install shape: nothing on disk → needed, full volume remaining, no fallback", () => {
    const status = statusWithTorch(false);
    expect(status.needed).toBe(true);
    expect(status.onnx_ready).toBe(false);
    expect(status.torch_fallback_available).toBe(false);
    const total = Object.values(pin.models).reduce(
      (sum, m) => sum + m.files.reduce((s, f) => s + f.size_bytes, 0),
      0,
    );
    expect(status.total_bytes).toBe(total);
    expect(status.remaining_bytes).toBe(total);
    expect(status.error).toBeUndefined();
  });

  it("upgrade shape: torch generation present → fallback available while needed", () => {
    const status = statusWithTorch(true);
    expect(status.needed).toBe(true);
    expect(status.torch_fallback_available).toBe(true);
  });

  it("complete pinned set → not needed, zero remaining", () => {
    writeModelFile(
      "asr-seaco-paraformer",
      "model_quant.onnx",
      Buffer.from("asr-main-graph-bytes"),
    );
    writeModelFile(
      "asr-seaco-paraformer",
      "tokens.txt",
      Buffer.from("a\nb\nc\n"),
    );
    writeModelFile(
      "vad-fsmn",
      "vad_config.yaml",
      Buffer.from("vad_config: fsmn\n"),
    );
    const status = statusWithTorch(true);
    expect(status.needed).toBe(false);
    expect(status.onnx_ready).toBe(true);
    expect(status.remaining_bytes).toBe(0);
  });

  it("size-mismatched files still count as remaining bytes (they re-download)", () => {
    writeModelFile(
      "asr-seaco-paraformer",
      "model_quant.onnx",
      Buffer.from("corrupt"),
    );
    const status = statusWithTorch(true);
    expect(status.needed).toBe(true);
    const asrMainBytes = pin.models["asr"]!.files[0]!.size_bytes;
    const asrTokensBytes = pin.models["asr"]!.files[1]!.size_bytes;
    const vadBytes = pin.models["vad"]!.files[0]!.size_bytes;
    expect(status.remaining_bytes).toBe(
      asrMainBytes + asrTokensBytes + vadBytes,
    );
  });

  it("invalid pin record → needed=false with error (never nag on a packaging bug)", () => {
    fs.writeFileSync(pinPath, JSON.stringify({ schema_version: 2 }));
    const status = statusWithTorch(true);
    expect(status.needed).toBe(false);
    expect(status.onnx_ready).toBe(false);
    expect(status.error).toBeTruthy();
    expect(status.total_bytes).toBe(0);
    expect(status.remaining_bytes).toBe(0);
  });

  it("unreadable pin file → needed=false with error", () => {
    fs.rmSync(pinPath);
    const status = statusWithTorch(false);
    expect(status.needed).toBe(false);
    expect(status.error).toBeTruthy();
  });
});
