// [20261002_T9_MigrationUx] Ticket #420: funasrManager's migration wiring —
// checkOnnxMigration() composes the pure state module with the modelManager
// collaborators, and downloadOnnxModels() runs the v2 pipeline with the same
// concurrency-collapse + skip-when-ready + fire-and-forget-restart contract
// the torch flow established (#216 review MAJOR: never bounce a healthy
// server for nothing). Pattern: funasrManager-orchestration.test.ts
// (asSurface structural cast, vi.mock("electron") shim, spied collaborators).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "0.0.0"),
    getPath: vi.fn(() => "/tmp"),
    getAppPath: vi.fn(() => "/tmp"),
  },
  shell: { openPath: vi.fn() },
}));

import FunASRManager from "../../src/helpers/funasrManager";

interface ModelManagerSurface {
  getModelPinPath: (...args: never[]) => string;
  getOnnxModelsRoot: (...args: never[]) => string;
  isTorchGenerationPresent: (...args: never[]) => boolean;
  downloadOnnxModels: (
    cb: ((progress: Record<string, unknown>) => void) | null,
  ) => Promise<unknown>;
  clearCache: (...args: never[]) => void;
}

interface FunASRManagerTestSurface {
  modelManager: ModelManagerSurface;
  checkOnnxMigration: () => Record<string, unknown>;
  downloadOnnxModels: (
    cb: ((progress: Record<string, unknown>) => void) | null,
  ) => Promise<unknown>;
  restartServer: () => Promise<{ success: boolean; error?: string }>;
}

function asSurface(
  m: InstanceType<typeof FunASRManager>,
): FunASRManagerTestSurface {
  return m as unknown as FunASRManagerTestSurface;
}

function makeManager() {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const manager = asSurface(new FunASRManager(logger));
  return manager;
}

function sha256(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const VAD_CONFIG = Buffer.from("vad_config: fsmn\n");
const ASR_CONFIG = Buffer.from("model_config: seaco\nvocab: 8404\n");

function makePin(vadName: string, asrName: string): string {
  const pin = {
    schema_version: 1,
    generated_utc: "2026-10-02T00:00:00+00:00",
    license: "Apache-2.0",
    attribution: "Exported from official iic checkpoints (FunASR).",
    release: {
      tag: "models-migration-1",
      url: "https://gh-mirror.test/releases/tags/models-migration-1",
      asset_base_url: "https://gh-mirror.test/download/models-migration-1/",
    },
    models: {
      asr: {
        name: asrName,
        modelscope_repo: "iic/speech_seaco_paraformer_test",
        model_revision: "v2.0.4",
        checkpoint_commit: "a".repeat(40),
        export: { funasr: "1.3.1", torch: "2.0.1" },
        files: [
          {
            path: "config.yaml",
            sha256: sha256(ASR_CONFIG),
            size_bytes: ASR_CONFIG.length,
            asset: `${asrName}__config.yaml`,
          },
        ],
      },
      vad: {
        name: vadName,
        modelscope_repo: "iic/speech_fsmn_vad_test",
        model_revision: "v2.0.4",
        checkpoint_commit: "b".repeat(40),
        export: { funasr: "1.3.1", torch: "2.0.1" },
        files: [
          {
            path: "vad_config.yaml",
            sha256: sha256(VAD_CONFIG),
            size_bytes: VAD_CONFIG.length,
            asset: `${vadName}__vad_config.yaml`,
          },
        ],
      },
    },
  };
  return JSON.stringify(pin);
}

describe("[20261002_T9_MigrationUx] funasrManager migration wiring (#420)", () => {
  let tmpDir: string;
  let pinPath: string;
  let modelsRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-migration-"));
    modelsRoot = path.join(tmpDir, "onnx-int8");
    pinPath = path.join(tmpDir, "model-pin.json");
    fs.writeFileSync(pinPath, makePin("vad-fsmn", "asr-seaco-paraformer"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function pointModelManagerAtFixture(torchPresent: boolean) {
    const manager = makeManager();
    manager.modelManager.getModelPinPath = vi.fn(() => pinPath);
    manager.modelManager.getOnnxModelsRoot = vi.fn(() => modelsRoot);
    manager.modelManager.isTorchGenerationPresent = vi.fn(() => torchPresent);
    return manager;
  }

  it("checkOnnxMigration composes pin path + models root + torch probe", () => {
    const manager = pointModelManagerAtFixture(true);
    const status = manager.checkOnnxMigration();
    expect(status["needed"]).toBe(true);
    expect(status["onnx_ready"]).toBe(false);
    expect(status["torch_fallback_available"]).toBe(true);
    expect(status["total_bytes"]).toBe(VAD_CONFIG.length + ASR_CONFIG.length);
  });

  it("downloadOnnxModels skips the whole pipeline when the ONNX set is ready", async () => {
    const manager = pointModelManagerAtFixture(true);
    // Make the pinned required set ready on disk: readiness → skip.
    const vadDir = path.join(modelsRoot, "vad-fsmn");
    fs.mkdirSync(vadDir, { recursive: true });
    fs.writeFileSync(path.join(vadDir, "vad_config.yaml"), VAD_CONFIG);
    const asrDir = path.join(modelsRoot, "asr-seaco-paraformer");
    fs.mkdirSync(asrDir, { recursive: true });
    fs.writeFileSync(path.join(asrDir, "config.yaml"), ASR_CONFIG);
    const delegate = vi.spyOn(manager.modelManager, "downloadOnnxModels");
    const restart = vi
      .spyOn(manager, "restartServer")
      .mockResolvedValue({ success: true });
    const result = (await manager.downloadOnnxModels(null)) as {
      success: boolean;
      skipped?: boolean;
    };
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(delegate).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it("downloadOnnxModels delegates with the progress callback and restarts the server on success", async () => {
    const manager = pointModelManagerAtFixture(true);
    const progress: Array<Record<string, unknown>> = [];
    const delegate = vi
      .spyOn(manager.modelManager, "downloadOnnxModels")
      .mockImplementation(async (cb) => {
        cb?.({ stage: "downloading", overall_progress: 42 });
        return { success: true, verified: ["vad-fsmn"] };
      });
    const restart = vi
      .spyOn(manager, "restartServer")
      .mockResolvedValue({ success: true });
    const result = (await manager.downloadOnnxModels((p) =>
      progress.push({ ...p }),
    )) as { success: boolean };
    expect(result.success).toBe(true);
    expect(delegate).toHaveBeenCalledTimes(1);
    expect(progress[0]!["overall_progress"]).toBe(42);
    // The restart is fire-and-forget: give the microtask chain a tick.
    await Promise.resolve();
    await Promise.resolve();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("downloadOnnxModels does not restart the server on download failure", async () => {
    const manager = pointModelManagerAtFixture(true);
    vi.spyOn(manager.modelManager, "downloadOnnxModels").mockRejectedValue(
      new Error("模型下载失败：所有下载源均不可用"),
    );
    const restart = vi
      .spyOn(manager, "restartServer")
      .mockResolvedValue({ success: true });
    await expect(manager.downloadOnnxModels(null)).rejects.toThrow(
      /所有下载源均不可用/,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(restart).not.toHaveBeenCalled();
  });

  it("a failed server restart after download success stays non-fatal", async () => {
    const manager = pointModelManagerAtFixture(true);
    vi.spyOn(manager.modelManager, "downloadOnnxModels").mockResolvedValue({
      success: true,
      verified: ["vad-fsmn"],
    });
    vi.spyOn(manager, "restartServer").mockResolvedValue({
      success: false,
      error: "启动失败",
    });
    const result = (await manager.downloadOnnxModels(null)) as {
      success: boolean;
    };
    expect(result.success).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("concurrent downloadOnnxModels invokes collapse onto the first promise", async () => {
    const manager = pointModelManagerAtFixture(true);
    let release: ((value: unknown) => void) | null = null;
    const delegate = vi
      .spyOn(manager.modelManager, "downloadOnnxModels")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    const first = manager.downloadOnnxModels(null);
    const second = manager.downloadOnnxModels(null);
    release!({ success: true, verified: ["vad-fsmn"] });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(delegate).toHaveBeenCalledTimes(1);
    expect(secondResult).toBe(firstResult);
  });
});
