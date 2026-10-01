// [20261001_T5_ModelManagerOnnx] Ticket #417 (spec #412 T5): modelManager
// integration surface for the v2 trust-chain downloader — production pin
// path resolution, the ONNX generation root, fast readiness checks over the
// pinned exact file sets, and the download entry that delegates to
// modelDownloader. The torch-era surface (checkModelFiles/downloadModels) is
// intentionally untouched here; the runtime flip lands with the server-side
// ONNX ticket.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

import ModelManager from "../../src/helpers/modelManager";
import { PARTIAL_SUFFIX } from "../../src/helpers/modelDownloader";

const MIRROR_BASE = "https://gh-mirror.test/download/models-pin-it-1/";

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        controller.enqueue(bytes);
        sent = true;
      } else {
        controller.close();
      }
    },
  });
}

function sha256(content: Uint8Array): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

describe("[20261001_T5_ModelManagerOnnx] v2 surface", () => {
  let tmpDir: string;
  let pinPath: string;
  let modelsRoot: string;

  const configContent = Buffer.from("vad_config: fsmn\n");
  const vadPin = {
    schema_version: 1,
    generated_utc: "2026-10-01T00:00:00+00:00",
    license: "Apache-2.0",
    attribution: "Exported from official iic checkpoints (FunASR).",
    release: {
      tag: "models-pin-it-1",
      url: "https://gh-mirror.test/releases/tags/models-pin-it-1",
      asset_base_url: MIRROR_BASE,
    },
    models: {
      vad: {
        name: "vad-fsmn",
        modelscope_repo: "iic/speech_fsmn_vad_test",
        model_revision: "v2.0.4",
        checkpoint_commit: "c".repeat(40),
        export: { funasr: "1.3.1", torch: "2.0.1" },
        files: [
          {
            path: "vad_config.yaml",
            sha256: sha256(configContent),
            size_bytes: configContent.length,
            asset: "vad-fsmn__vad_config.yaml",
          },
        ],
      },
    },
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-onnx-"));
    modelsRoot = path.join(tmpDir, "root");
    pinPath = path.join(tmpDir, "model-pin.json");
    fs.writeFileSync(pinPath, JSON.stringify(vadPin));
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

  it("resolves the ONNX generation root under the userData models dir", () => {
    const m = makeManager();
    // Unit-test fallback (no electron): os.tmpdir() stands in for userData.
    expect(
      m.getOnnxModelsRoot().endsWith(path.join("models", "onnx-int8")),
    ).toBe(true);
  });

  it("resolves the pin path inside the repo tree (dev/packaged layout)", () => {
    const m = makeManager();
    expect(
      m
        .getModelPinPath()
        .endsWith(path.join("scripts", "onnx-export", "model-pin.json")),
    ).toBe(true);
  });

  it("checkOnnxModels reports per-model readiness against the pinned exact set", async () => {
    const m = makeManager();
    const readyDir = path.join(modelsRoot, "vad-fsmn");
    fs.mkdirSync(readyDir, { recursive: true });
    fs.writeFileSync(path.join(readyDir, "vad_config.yaml"), configContent);

    const report = await m.checkOnnxModels(pinPath, modelsRoot);
    expect(report["vad-fsmn"]).toEqual({ ready: true, problems: [] });

    // 34MB-style single-file hole: a same-name temp file is not the anchor.
    const partialDir = path.join(modelsRoot, "partial-model");
    fs.mkdirSync(partialDir, { recursive: true });
    fs.writeFileSync(
      path.join(partialDir, `vad_config.yaml${PARTIAL_SUFFIX}`),
      configContent,
    );
    const partialReport = await m.checkOnnxModels(pinPath, modelsRoot);
    // (vad-fsmn dir still ready; the partial model is not part of this pin —
    // the readiness refusal itself is covered in modelDownloader.test.ts.)
    expect(partialReport["vad-fsmn"]!.ready).toBe(true);
  });

  it("checkOnnxModels reports missing files as problems, not ready", async () => {
    const m = makeManager();
    const emptyDir = path.join(modelsRoot, "vad-fsmn");
    fs.mkdirSync(emptyDir, { recursive: true });
    const report = await m.checkOnnxModels(pinPath, modelsRoot);
    expect(report["vad-fsmn"]!.ready).toBe(false);
    expect(report["vad-fsmn"]!.problems).toEqual([
      "missing file: vad_config.yaml",
    ]);
  });

  it("downloadOnnxModels delegates to the v2 pipeline and reports progress", async () => {
    const m = makeManager();
    const progress: Array<Record<string, unknown>> = [];
    const fetchImpl = (url: string) => {
      if (url === `${MIRROR_BASE}vad-fsmn__vad_config.yaml`) {
        return Promise.resolve({
          status: 200,
          body: streamOf(configContent),
        });
      }
      return Promise.reject(new Error(`connection failed: ${url}`));
    };
    const outcome = await m.downloadOnnxModels((p) => progress.push({ ...p }), {
      pinPath,
      modelsRoot,
      fetchImpl,
    });
    expect(outcome.success).toBe(true);
    expect(outcome.verified).toEqual(["vad-fsmn"]);
    expect(
      fs
        .readFileSync(path.join(modelsRoot, "vad-fsmn", "vad_config.yaml"))
        .equals(configContent),
    ).toBe(true);
    expect(progress.some((p) => p["stage"] === "downloading")).toBe(true);
    expect(progress[progress.length - 1]!["stage"]).toBe("completed");
  });

  it("torch-era surfaces are unchanged: checkModelFiles still uses the legacy anchors", async () => {
    const m = makeManager();
    m.clearCache();
    for (const config of Object.values(m.modelConfigs)) {
      const modelDir = path.join(tmpDir, config.cache_path);
      fs.mkdirSync(modelDir, { recursive: true });
      fs.writeFileSync(path.join(modelDir, "model.pt"), "x".repeat(100));
    }
    m.getModelCachePath = () => tmpDir;
    const r = await m.checkModelFiles();
    expect(r.models_downloaded).toBe(true);
  });
});
