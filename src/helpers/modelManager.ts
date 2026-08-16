// [20260724_TS_BigBang_ModelManager] Migrated from .js to .ts (ADR-010).
// `module.exports = ModelManager` (class) became `export default ModelManager`.
// Lazy require("electron") kept inside try/catch (special case: import is
// hoisted and would lose the error handling for the missing-electron case in
// unit tests). fs/path/spawn use top-level ESM imports.
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import os from "os";

/** Logger interface (accepts console or LogManager). */
interface Logger {
  info?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

interface ModelConfig {
  name: string;
  cache_path: string;
  expected_size: number;
  required: boolean;
}

interface ModelCheckResult {
  success: boolean;
  models_downloaded: boolean;
  minimum_ready?: boolean;
  missing_models: string[];
  model_details?: Record<string, { downloaded: boolean; complete?: boolean }>;
  cache_path: string;
}

// [20260815_Refactor_DeadIpc] The DownloadProgress interface was removed with
// getDownloadProgress(); the MODEL_DOWNLOAD_PROGRESS payload shape lives in
// types/ipc.ts for the renderer side.

type ProgressCallback = (progress: Record<string, unknown>) => void;

let globalModelCheckCache: ModelCheckResult | null = null;
let globalModelCheckTime = 0;
const GLOBAL_CACHE_TIME = 2000;

class ModelManager {
  private logger: Logger;
  modelsDownloaded: boolean | null;
  modelConfigs: Record<string, ModelConfig>;

  constructor(logger: Logger | null = null) {
    this.logger = logger || console;
    this.modelsDownloaded = null;
    this.modelConfigs = {
      asr: {
        name: "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        cache_path:
          "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        expected_size: 840 * 1024 * 1024,
        required: true,
      },
      vad: {
        name: "damo/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        cache_path: "speech_fsmn_vad_zh-cn-16k-common-pytorch",
        expected_size: 1.6 * 1024 * 1024,
        required: true,
      },
      punc: {
        name: "damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        cache_path: "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        expected_size: 278 * 1024 * 1024,
        required: false,
      },
    };
  }

  findDamoRoot(startDir: string, depth = 0, maxDepth = 5): string | null {
    if (depth > maxDepth || !fs.existsSync(startDir)) return null;
    const entries = fs.readdirSync(startDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "damo") {
          const damoPath = path.join(startDir, entry.name);
          const subdirs = fs.readdirSync(damoPath, { withFileTypes: true });
          const hasExpectedModel = subdirs.some(
            (m) => m.isDirectory() && m.name.startsWith("speech_paraformer"),
          );
          if (hasExpectedModel) return damoPath;
        }
        const found = this.findDamoRoot(
          path.join(startDir, entry.name),
          depth + 1,
          maxDepth,
        );
        if (found) return found;
      }
    }
    return null;
  }

  getModelCachePath(): string {
    // [20260724_TS_BigBang_LazyRequire] Lazy require("electron") kept inside
    // try/catch — import is hoisted and would throw at load time in unit tests
    // where electron is not available. app.getPath is only needed at runtime.
    let userDataPath: string;
    try {
      const { app } = require("electron");
      userDataPath = app.getPath("userData");
    } catch {
      userDataPath = os.tmpdir();
    }
    const userDataModels = path.join(userDataPath, "models");
    // [20260724_TS_BigBang_LazyRequire] END
    const modelScopeCache = path.join(
      os.homedir(),
      ".cache",
      "modelscope",
      "hub",
      "models",
    );

    const candidates: string[] = [];
    if (process.env.NODE_ENV === "development") {
      // [20260724_TS_BigBang_DirnameFix] app.getAppPath()-based model path
      let devRoot: string;
      try {
        const { app } = require("electron");
        devRoot = app.getAppPath();
      } catch {
        devRoot = process.cwd();
      }
      candidates.push(path.join(devRoot, "models"));
      // [20260724_TS_BigBang_DirnameFix] END
    }
    candidates.push(userDataModels);
    candidates.push(modelScopeCache);

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      const damoSub = path.join(candidate, "damo");
      if (fs.existsSync(damoSub) && fs.readdirSync(damoSub).length > 0)
        return damoSub;
      if (fs.readdirSync(candidate).length > 0) {
        const hasExpected = fs
          .readdirSync(candidate)
          .some(
            (n) =>
              n.startsWith("speech_paraformer") ||
              n.startsWith("speech_fsmn") ||
              n.startsWith("punc_ct"),
          );
        if (hasExpected) return candidate;
      }
    }

    // [20260724_TS_BigBang_DirnameFix] app.getAppPath()-based damo root search
    let searchRoot: string;
    try {
      const { app } = require("electron");
      searchRoot = app.getAppPath();
    } catch {
      searchRoot = process.cwd();
    }
    const found = this.findDamoRoot(searchRoot);
    // [20260724_TS_BigBang_DirnameFix] END
    if (found) return found;

    fs.mkdirSync(userDataModels, { recursive: true });
    return userDataModels;
  }

  async checkModelFiles(): Promise<ModelCheckResult> {
    const now = Date.now();
    if (
      globalModelCheckCache &&
      now - globalModelCheckTime < GLOBAL_CACHE_TIME
    ) {
      return globalModelCheckCache;
    }

    const cachePath = this.getModelCachePath();
    if (!fs.existsSync(cachePath)) {
      const result: ModelCheckResult = {
        success: true,
        models_downloaded: false,
        missing_models: ["all"],
        cache_path: cachePath,
      };
      this.modelsDownloaded = false;
      return result;
    }

    let allDownloaded = true;
    let minimumReady = true;
    const missingModels: string[] = [];
    const modelDetails: Record<
      string,
      { downloaded: boolean; complete?: boolean }
    > = {};

    for (const [modelType, config] of Object.entries(this.modelConfigs)) {
      const modelFile = path.join(cachePath, config.cache_path);
      if (fs.existsSync(modelFile)) {
        const isComplete = this._verifyModel(modelFile, config);
        modelDetails[modelType] = { downloaded: true, complete: isComplete };
        if (!isComplete) {
          allDownloaded = false;
          missingModels.push(modelType);
          if (config.required) minimumReady = false;
        }
      } else {
        allDownloaded = false;
        missingModels.push(modelType);
        modelDetails[modelType] = { downloaded: false };
        if (config.required) minimumReady = false;
      }
    }

    const result: ModelCheckResult = {
      success: true,
      models_downloaded: allDownloaded,
      minimum_ready: minimumReady,
      missing_models: missingModels,
      model_details: modelDetails,
      cache_path: cachePath,
    };

    this.modelsDownloaded = allDownloaded;
    globalModelCheckCache = result;
    globalModelCheckTime = now;
    return result;
  }

  _verifyModel(modelFile: string, config: ModelConfig): boolean {
    try {
      const stats = fs.statSync(modelFile);
      if (stats.isDirectory()) {
        const entries = fs.readdirSync(modelFile);
        return entries.some(
          (e) =>
            e === "model.pt" ||
            e === "pytorch_model.bin" ||
            e === "configuration.json" ||
            e === "config.yaml",
        );
      }
      return stats.size >= config.expected_size * 0.9;
    } catch {
      return false;
    }
  }

  // [20260815_Refactor_DeadIpc] getDownloadProgress removed — the renderer
  // consumes download progress exclusively via the MODEL_DOWNLOAD_PROGRESS
  // push event; this pull-based method had zero end-to-end callers.

  getDownloadScriptPath(): string {
    if (process.env.NODE_ENV === "development") {
      // [20260724_TS_BigBang_DirnameFix] app.getAppPath()-based script path
      const { app } = require("electron");
      return path.join(app.getAppPath(), "download_models.py");
      // [20260724_TS_BigBang_DirnameFix] END
    }
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "download_models.py",
    );
  }

  async downloadModels(
    progressCallback: ProgressCallback | null = null,
    pythonCmd: string,
  ): Promise<{ success: boolean; message?: string }> {
    const checkResult = await this.checkModelFiles();
    if (checkResult.models_downloaded) {
      return { success: true, message: "模型文件已下载" };
    }

    const hasPartial =
      checkResult.missing_models.length < Object.keys(this.modelConfigs).length;
    if (hasPartial && progressCallback) {
      progressCallback({ stage: "resuming", percentage: 0 });
    }

    const scriptPath = this.getDownloadScriptPath();
    if (!fs.existsSync(scriptPath)) {
      throw new Error("下载脚本不存在: " + scriptPath);
    }

    const cachePath = this.getModelCachePath();

    return new Promise((resolve, reject) => {
      const downloadProcess = spawn(
        pythonCmd,
        [scriptPath, "--output", cachePath],
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );

      let hasError = false;

      downloadProcess.stdout.on("data", (data: Buffer) => {
        const lines = data
          .toString()
          .split("\n")
          .filter((l) => l.trim());
        for (const line of lines) {
          try {
            const result = JSON.parse(line) as {
              error?: string;
              stage?: string;
              percentage?: number;
              success?: boolean;
            };
            if (result.error) {
              hasError = true;
              reject(new Error(result.error));
              return;
            }
            if (result.stage && progressCallback) {
              progressCallback({
                stage: result.stage,
                percentage: result.percentage || 0,
                overall_progress: result.percentage || 0,
                progress: result.percentage || 0,
              });
            }
            if (result.success !== undefined) {
              if (result.success) {
                this.modelsDownloaded = true;
                this.clearCache();
                resolve({ success: true, message: "模型下载完成" });
              } else {
                reject(new Error(result.error || "模型下载失败"));
              }
              return;
            }
          } catch {
            // Non-JSON output, ignore
          }
        }
      });

      downloadProcess.stderr.on("data", (data: Buffer) => {
        this.logger.warn("Download stderr:", data.toString());
      });

      downloadProcess.on("close", (code: number | null) => {
        if (!hasError) {
          if (code === 0) {
            this.modelsDownloaded = true;
            this.clearCache();
            resolve({ success: true, message: "模型下载完成" });
          } else {
            reject(new Error(`模型下载进程退出，代码: ${code}`));
          }
        }
      });

      downloadProcess.on("error", (error: Error) => {
        if (!hasError) {
          reject(new Error(`启动下载进程失败: ${error.message}`));
        }
      });

      setTimeout(
        () => {
          hasError = true;
          downloadProcess.kill();
          reject(new Error("模型下载超时（10分钟）"));
        },
        10 * 60 * 1000,
      );
    });
  }

  clearCache(): void {
    globalModelCheckCache = null;
    globalModelCheckTime = 0;
  }
}

export default ModelManager;
