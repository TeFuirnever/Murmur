const PythonEnvironment = require("./pythonEnvironment");
const ModelManager = require("./modelManager");
const FunASRServer = require("./funasrServer");

class FunASRManager {
  constructor(logger = null) {
    this.logger = logger || console;
    this.isInitialized = false;

    this.pythonEnv = new PythonEnvironment(logger);
    this.modelManager = new ModelManager(logger);
    this.server = new FunASRServer(logger);
  }

  // Property accessors that maintain the old interface
  get pythonCmd() {
    return this.pythonEnv.pythonCmd;
  }
  set pythonCmd(v) {
    this.pythonEnv.pythonCmd = v;
  }
  get funasrInstalled() {
    return this.pythonEnv.funasrInstalled;
  }
  get modelsInitialized() {
    return this.server.modelsInitialized;
  }
  get serverReady() {
    return this.server.serverReady;
  }
  get modelsDownloaded() {
    return this.modelManager.modelsDownloaded;
  }
  get initializationPromise() {
    return this.server.initializationPromise;
  }

  // Python & environment delegation
  getFunASRServerPath() {
    return this.pythonEnv.getFunASRServerPath();
  }
  getEmbeddedPythonPath() {
    return this.pythonEnv.getEmbeddedPythonPath();
  }
  setupIsolatedEnvironment() {
    return this.pythonEnv.setupIsolatedEnvironment();
  }
  buildPythonEnvironment() {
    return this.pythonEnv.buildPythonEnvironment();
  }
  findPythonExecutable() {
    return this.pythonEnv.findPythonExecutable();
  }
  checkPythonInstallation() {
    return this.pythonEnv.checkPythonInstallation();
  }
  installPython(cb) {
    return this.pythonEnv.installPython(cb);
  }
  checkFunASRInstallation() {
    return this.pythonEnv.checkFunASRInstallation();
  }
  installFunASR(cb) {
    return this.pythonEnv.installFunASR(cb);
  }

  // Model delegation
  getModelCachePath() {
    return this.modelManager.getModelCachePath();
  }
  checkModelFiles() {
    return this.modelManager.checkModelFiles();
  }
  getDownloadProgress() {
    return this.modelManager.getDownloadProgress();
  }
  async downloadModels(cb) {
    const pythonCmd = await this.pythonEnv.findPythonExecutable();
    return this.modelManager.downloadModels(cb, pythonCmd);
  }

  // Transcription delegation
  transcribeAudio(audioBlob, options) {
    return this.server.transcribeAudio(audioBlob, options);
  }
  transcribeFile(audioPath, options) {
    return this.server.transcribeFile(audioPath, options);
  }
  cancelTranscription() {
    return this.server.cancelTranscription();
  }
  gracefulShutdown() {
    return this.server.gracefulShutdown();
  }

  // Orchestration methods
  async restartServer() {
    try {
      this.logger.info && this.logger.info("重启FunASR服务器...");
      if (this.server.initializationPromise) {
        try {
          await this.server.initializationPromise;
        } catch {
          /* ignore */
        }
      }
      if (this.server.serverProcess) {
        await this.server._stopFunASRServer();
        this.logger.info && this.logger.info("已停止现有FunASR服务器");
      }

      this.server.resetState();
      this.modelManager.clearCache();
      this.pythonEnv.clearFunASRInstallCache();

      const modelStatus = await this.checkModelFiles();
      if (!modelStatus.minimum_ready && !modelStatus.models_downloaded) {
        throw new Error("模型文件未下载，无法启动服务器");
      }

      const pythonCmd = await this.findPythonExecutable();
      const serverPath = this.getFunASRServerPath();
      this.setupIsolatedEnvironment();
      const pythonEnv = this.buildPythonEnvironment();
      const cachePath = this.getModelCachePath();

      this.server.initializationPromise = this.server._startFunASRServer(
        pythonEnv,
        pythonCmd,
        serverPath,
        cachePath,
      );
      await this.server.initializationPromise;

      this.logger.info && this.logger.info("FunASR服务器重启完成");
      this.server.restartCount = 0;
      return { success: true, message: "FunASR服务器重启成功" };
    } catch (error) {
      this.logger.error && this.logger.error("重启FunASR服务器失败:", error);
      return { success: false, error: error.message };
    }
  }

  async initializeAtStartup() {
    try {
      this.logger.info && this.logger.info("FunASR管理器启动初始化开始");
      const pythonCmd = await this.findPythonExecutable();
      this.logger.info &&
        this.logger.info("Python可执行文件找到", { pythonCmd });
      const funasrStatus = await this.checkFunASRInstallation();
      this.logger.info &&
        this.logger.info("FunASR安装状态检查完成", funasrStatus);
      this.isInitialized = true;
      this.preInitializeModels();
      this.logger.info && this.logger.info("FunASR管理器启动初始化完成");
    } catch (error) {
      this.logger.warn &&
        this.logger.warn("FunASR启动初始化失败，但不影响应用启动", error);
      this.isInitialized = true;
    }
  }

  async preInitializeModels() {
    if (this.server.initializationPromise)
      return this.server.initializationPromise;

    this.server.initializationPromise = (async () => {
      const installStatus = await this.checkFunASRInstallation();
      if (!installStatus.installed) return;

      const pythonCmd = await this.findPythonExecutable();
      const serverPath = this.getFunASRServerPath();
      this.setupIsolatedEnvironment();
      const pythonEnv = this.buildPythonEnvironment();
      const cachePath = this.getModelCachePath();

      return this.server._startFunASRServer(
        pythonEnv,
        pythonCmd,
        serverPath,
        cachePath,
      );
    })();
    return this.server.initializationPromise;
  }

  async checkStatus() {
    try {
      if (this.serverReady) {
        return await this.server._sendServerCommand({ action: "status" });
      }
      const installStatus = await this.checkFunASRInstallation();
      const modelStatus = await this.checkModelFiles();

      let error = "FunASR未安装";
      if (installStatus.installed) {
        if (!modelStatus.minimum_ready && !modelStatus.models_downloaded) {
          error = "模型文件未下载，请先下载模型";
        } else {
          error = "FunASR服务器正在启动中...";
        }
      }

      return {
        success: installStatus.installed && (modelStatus.minimum_ready || modelStatus.models_downloaded),
        error: error,
        installed: installStatus.installed,
        models_downloaded: modelStatus.models_downloaded,
        minimum_ready: modelStatus.minimum_ready || false,
        missing_models: modelStatus.missing_models || [],
        initializing: this.server.initializationPromise !== null,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        installed: false,
        models_downloaded: false,
      };
    }
  }
}

module.exports = FunASRManager;
