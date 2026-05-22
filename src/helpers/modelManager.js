const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let globalModelCheckCache = null;
let globalModelCheckTime = 0;
const GLOBAL_CACHE_TIME = 2000;

class ModelManager {
  constructor(logger = null) {
    this.logger = logger || console;
    this.modelsDownloaded = null;
    this.modelConfigs = {
      asr: {
        name: "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        cache_path: "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        expected_size: 840 * 1024 * 1024,
      },
      vad: {
        name: "damo/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        cache_path: "speech_fsmn_vad_zh-cn-16k-common-pytorch",
        expected_size: 1.6 * 1024 * 1024,
      },
      punc: {
        name: "damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        cache_path: "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        expected_size: 278 * 1024 * 1024,
      },
    };
  }

  findDamoRoot(startDir, depth = 0, maxDepth = 5) {
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
        const found = this.findDamoRoot(path.join(startDir, entry.name), depth + 1, maxDepth);
        if (found) return found;
      }
    }
    return null;
  }

  getModelCachePath() {
    const userDataModels = path.join(require("electron").app.getPath("userData"), "models");
    const modelScopeCache = path.join(require("os").homedir(), ".cache", "modelscope", "hub", "models");

    const candidates = [];
    if (process.env.NODE_ENV === "development") {
      candidates.push(path.join(__dirname, "..", "..", "models"));
    }
    candidates.push(userDataModels);
    candidates.push(modelScopeCache);

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      const damoSub = path.join(candidate, "damo");
      if (fs.existsSync(damoSub) && fs.readdirSync(damoSub).length > 0) return damoSub;
      if (fs.readdirSync(candidate).length > 0) {
        const hasExpected = fs.readdirSync(candidate).some(
          (n) => n.startsWith("speech_paraformer") || n.startsWith("speech_fsmn") || n.startsWith("punc_ct"),
        );
        if (hasExpected) return candidate;
      }
    }

    const found = this.findDamoRoot(path.join(__dirname, "..", ".."));
    if (found) return found;

    fs.mkdirSync(userDataModels, { recursive: true });
    return userDataModels;
  }

  async checkModelFiles() {
    const now = Date.now();
    if (globalModelCheckCache && now - globalModelCheckTime < GLOBAL_CACHE_TIME) {
      return globalModelCheckCache;
    }

    const cachePath = this.getModelCachePath();
    if (!fs.existsSync(cachePath)) {
      const result = { models_downloaded: false, missing_models: ["all"] };
      this.modelsDownloaded = false;
      return result;
    }

    let allDownloaded = true;
    const missingModels = [];
    const modelDetails = {};

    for (const [modelType, config] of Object.entries(this.modelConfigs)) {
      const modelFile = path.join(cachePath, config.cache_path);
      if (fs.existsSync(modelFile)) {
        const isComplete = this._verifyModel(modelFile, config);
        modelDetails[modelType] = { downloaded: true, complete: isComplete };
        if (!isComplete) {
          allDownloaded = false;
          missingModels.push(modelType);
        }
      } else {
        allDownloaded = false;
        missingModels.push(modelType);
        modelDetails[modelType] = { downloaded: false };
      }
    }

    const result = {
      models_downloaded: allDownloaded,
      missing_models: missingModels,
      model_details: modelDetails,
      cache_path: cachePath,
    };

    this.modelsDownloaded = allDownloaded;
    globalModelCheckCache = result;
    globalModelCheckTime = now;
    return result;
  }

  _verifyModel(modelFile, config) {
    try {
      const stats = fs.statSync(modelFile);
      return stats.size >= config.expected_size * 0.9;
    } catch {
      return false;
    }
  }

  async getDownloadProgress() {
    const cachePath = this.getModelCachePath();
    if (!fs.existsSync(cachePath)) {
      return { progress: 0, stage: "waiting", downloaded: 0, total: 0 };
    }

    const totalExpected = Object.values(this.modelConfigs).reduce(
      (sum, config) => sum + config.expected_size, 0,
    );

    let totalDownloaded = 0;
    const modelProgress = {};

    for (const [modelType, config] of Object.entries(this.modelConfigs)) {
      const modelFile = path.join(cachePath, config.cache_path);
      if (fs.existsSync(modelFile)) {
        const stats = fs.statSync(modelFile);
        totalDownloaded += stats.size;
        modelProgress[modelType] = {
          downloaded: stats.size,
          total: config.expected_size,
          percentage: Math.min(100, (stats.size / config.expected_size) * 100),
        };
      } else {
        modelProgress[modelType] = { downloaded: 0, total: config.expected_size, percentage: 0 };
      }
    }

    return {
      progress: (totalDownloaded / totalExpected) * 100,
      stage: totalDownloaded > 0 ? "downloading" : "waiting",
      downloaded: totalDownloaded,
      total: totalExpected,
      models: modelProgress,
    };
  }

  getDownloadScriptPath() {
    if (process.env.NODE_ENV === "development") {
      return path.join(__dirname, "..", "..", "download_models.py");
    }
    return path.join(process.resourcesPath, "app.asar.unpacked", "download_models.py");
  }

  async downloadModels(progressCallback = null) {
    const checkResult = await this.checkModelFiles();
    if (checkResult.models_downloaded) {
      return { success: true, message: "模型文件已下载" };
    }

    const hasPartial = checkResult.missing_models.length < Object.keys(this.modelConfigs).length;
    if (hasPartial && progressCallback) {
      progressCallback({ stage: "resuming", percentage: 0 });
    }

    const scriptPath = this.getDownloadScriptPath();
    if (!fs.existsSync(scriptPath)) {
      throw new Error("下载脚本不存在: " + scriptPath);
    }

    const cachePath = this.getModelCachePath();

    return new Promise((resolve, reject) => {
      const downloadProcess = spawn("python3", [scriptPath, "--output", cachePath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let hasError = false;

      downloadProcess.stdout.on("data", (data) => {
        const lines = data.toString().split("\n").filter((l) => l.trim());
        for (const line of lines) {
          try {
            const result = JSON.parse(line);
            if (result.error) {
              hasError = true;
              reject(new Error(result.error));
              return;
            }
            if (result.stage && progressCallback) {
              progressCallback({
                stage: result.stage,
                percentage: result.percentage || 0,
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
          } catch (_parseError) {
            // Non-JSON output, ignore
          }
        }
      });

      downloadProcess.stderr.on("data", (data) => {
        this.logger.warn && this.logger.warn("Download stderr:", data.toString());
      });

      downloadProcess.on("close", (code) => {
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

      downloadProcess.on("error", (error) => {
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

  clearCache() {
    globalModelCheckCache = null;
    globalModelCheckTime = 0;
  }
}

module.exports = ModelManager;
