// [20261006_T12_LegacyCacheCleanup] Ticket #425: funasrManager's boot-time
// wiring for the old torch cache reclaim — the N+1 release deletes the
// rollback-era torch dirs exactly ONE version cycle after the ONNX cutover
// shipped them (spec #412 decision 11). Contract under test:
//   * The cleanup runs ONLY when the ONNX generation is pin-ready (the
//     in-process "确认无用" signal) — otherwise the rollback dirs stay.
//   * It runs at most once per launch, is scheduled AFTER the server-boot
//     promise settles (no overlap with a model load), and a boot failure
//     neither blocks nor skips it.
//   * Any cleanup error is logged, never thrown — app availability is
//     untouched (acceptance criterion 4).
// Pattern: funasrManager-onnx-migration.test.ts (vi.mock("electron") shim,
// asSurface structural cast, spied collaborators).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "0.0.0"),
    getPath: vi.fn(() => "/tmp"),
    getAppPath: vi.fn(() => "/tmp"),
  },
  shell: { openPath: vi.fn() },
}));

import FunASRManager from "../../src/helpers/funasrManager";

const VAD_REPO = "speech_fsmn_vad_zh-cn-16k-common-pytorch";
const SEACO_REPO =
  "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch";
const REVISION = "v2.0.4";

interface FunASRManagerTestSurface {
  modelManager: {
    getUserDataModelsRoot: () => string;
  };
  checkOnnxMigration: () => { onnx_ready: boolean };
  _cleanupLegacyTorchCachesOnce: () => Promise<void>;
  _scheduleLegacyTorchCacheCleanup: (boot: Promise<unknown> | null) => void;
  findPythonExecutable: () => Promise<string>;
  checkFunASRInstallation: () => Promise<unknown>;
  initializeAtStartup: () => Promise<void>;
}

function asSurface(
  m: InstanceType<typeof FunASRManager>,
): FunASRManagerTestSurface {
  return m as unknown as FunASRManagerTestSurface;
}

describe("[20261006_T12_LegacyCacheCleanup] funasrManager wiring", () => {
  let tmpDir: string;
  let homeDir: string;
  let userDataModels: string;
  function makeLogger() {
    return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-legacy-clean-"));
    homeDir = path.join(tmpDir, "home");
    userDataModels = path.join(tmpDir, "userdata", "models");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(userDataModels, { recursive: true });
    delete process.env.MODELSCOPE_CACHE;
    vi.spyOn(os, "homedir").mockReturnValue(homeDir);
    logger = makeLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeManager(): FunASRManagerTestSurface {
    const manager = asSurface(new FunASRManager(logger));
    manager.modelManager.getUserDataModelsRoot = () => userDataModels;
    return manager;
  }

  function materializeLegacyCaches(): [string, string] {
    const legacyDir = path.join(userDataModels, VAD_REPO);
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "model.pt"), "x");
    const hubDir = path.join(
      homeDir,
      ".cache",
      "modelscope",
      "models",
      `damo--${SEACO_REPO}`,
    );
    const snapshot = path.join(hubDir, "snapshots", REVISION);
    fs.mkdirSync(snapshot, { recursive: true });
    fs.writeFileSync(path.join(snapshot, "model.pt"), "x");
    return [legacyDir, hubDir];
  }

  it("deletes the legacy torch dirs and logs when ONNX is pin-ready", async () => {
    const [legacyDir, hubDir] = materializeLegacyCaches();
    const manager = makeManager();
    manager.checkOnnxMigration = () => ({ onnx_ready: true });

    await manager._cleanupLegacyTorchCachesOnce();

    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(fs.existsSync(hubDir)).toBe(false);
    const infoLines = logger.info.mock.calls.map((call) => call.join(" "));
    expect(infoLines.some((line) => line.includes("清理完成"))).toBe(true);
  });

  it("keeps the rollback dirs while the ONNX generation is not ready", async () => {
    const [legacyDir, hubDir] = materializeLegacyCaches();
    const manager = makeManager();
    manager.checkOnnxMigration = () => ({ onnx_ready: false });

    await manager._cleanupLegacyTorchCachesOnce();

    expect(fs.existsSync(legacyDir)).toBe(true);
    expect(fs.existsSync(hubDir)).toBe(true);
    expect(logger.debug).toHaveBeenCalled();
  });

  it("survives a throwing migration check (warn, no throw, dirs stay)", async () => {
    const [legacyDir] = materializeLegacyCaches();
    const manager = makeManager();
    manager.checkOnnxMigration = () => {
      throw new Error("pin broken");
    };

    await expect(
      manager._cleanupLegacyTorchCachesOnce(),
    ).resolves.toBeUndefined();

    expect(fs.existsSync(legacyDir)).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("runs at most once per launch", async () => {
    const manager = makeManager();
    manager.checkOnnxMigration = () => ({ onnx_ready: true });

    await manager._cleanupLegacyTorchCachesOnce();

    // A cache that appears AFTER the first attempt must survive it.
    const lateDir = path.join(userDataModels, SEACO_REPO);
    fs.mkdirSync(lateDir, { recursive: true });
    fs.writeFileSync(path.join(lateDir, "model.pt"), "x");

    await manager._cleanupLegacyTorchCachesOnce();

    expect(fs.existsSync(lateDir)).toBe(true);
  });

  it("initializeAtStartup schedules the cleanup after the boot settles", async () => {
    const manager = makeManager();
    manager.findPythonExecutable = vi.fn(() => Promise.resolve("/py/3.11"));
    manager.checkFunASRInstallation = vi.fn(() =>
      Promise.resolve({ installed: true, working: true }),
    );
    vi.spyOn(
      manager as unknown as { preInitializeModels: () => Promise<unknown> },
      "preInitializeModels",
    ).mockResolvedValue(null);
    const cleanupSpy = vi
      .spyOn(manager, "_cleanupLegacyTorchCachesOnce")
      .mockResolvedValue();

    await manager.initializeAtStartup();
    await new Promise((resolve) => setImmediate(resolve));

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it("boot failure path still schedules the cleanup once", async () => {
    const manager = makeManager();
    manager.findPythonExecutable = vi.fn(() =>
      Promise.reject(new Error("no python")),
    );
    vi.spyOn(
      manager as unknown as { preInitializeModels: () => Promise<unknown> },
      "preInitializeModels",
    ).mockResolvedValue(null);
    const cleanupSpy = vi
      .spyOn(manager, "_cleanupLegacyTorchCachesOnce")
      .mockResolvedValue();

    await manager.initializeAtStartup();
    await new Promise((resolve) => setImmediate(resolve));

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it("a rejected server-boot promise neither blocks nor skips the cleanup", async () => {
    const [legacyDir] = materializeLegacyCaches();
    const manager = makeManager();
    manager.checkOnnxMigration = () => ({ onnx_ready: true });

    manager._scheduleLegacyTorchCacheCleanup(
      Promise.reject(new Error("boot exploded")),
    );
    // The cleanup chain is fire-and-forget async fs — wait (bounded) for
    // the deletion to land. Flushing without a real wait would also miss
    // the "no unhandled rejection" proof below (vitest fails the run on
    // unhandled rejections).
    for (let i = 0; i < 50 && fs.existsSync(legacyDir); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(fs.existsSync(legacyDir)).toBe(false);
  });
});
