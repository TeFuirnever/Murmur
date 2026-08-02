// [20260724_TS_BigBang_FunasrManager] Migrated from .js to .ts (ADR-010).
// `module.exports = FunASRManager` (class) became `export default
// FunASRManager`. All three helper imports are default class imports.
import PythonEnvironment from "./pythonEnvironment";
import ModelManager from "./modelManager";
import FunASRServer from "./funasrServer";

/** Logger interface (accepts console or LogManager). */
interface Logger {
  info?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

class FunASRManager {
  private logger: Logger;
  isInitialized: boolean;
  private pythonEnv: PythonEnvironment;
  private modelManager: ModelManager;
  private server: FunASRServer;

  constructor(logger: Logger | null = null) {
    this.logger = logger || console;
    this.isInitialized = false;

    this.pythonEnv = new PythonEnvironment(logger);
    this.modelManager = new ModelManager(logger);
    this.server = new FunASRServer(logger);
  }

  // Property accessors that maintain the old interface
  get pythonCmd(): string | null {
    return this.pythonEnv.pythonCmd;
  }
  set pythonCmd(v: string | null) {
    this.pythonEnv.pythonCmd = v;
  }
  get funasrInstalled(): unknown {
    return this.pythonEnv.funasrInstalled;
  }
  get modelsInitialized(): boolean {
    return this.server.modelsInitialized;
  }
  get serverReady(): boolean {
    return this.server.serverReady;
  }
  get modelsDownloaded(): boolean | null {
    return this.modelManager.modelsDownloaded;
  }
  get initializationPromise(): Promise<void | unknown> | null {
    return this.server.initializationPromise;
  }

  // Python & environment delegation
  getFunASRServerPath(): string {
    return this.pythonEnv.getFunASRServerPath();
  }
  getEmbeddedPythonPath(): string {
    return this.pythonEnv.getEmbeddedPythonPath();
  }
  setupIsolatedEnvironment(): boolean {
    return this.pythonEnv.setupIsolatedEnvironment();
  }
  buildPythonEnvironment(): NodeJS.ProcessEnv {
    return this.pythonEnv.buildPythonEnvironment();
  }
  findPythonExecutable(): Promise<string> {
    return this.pythonEnv.findPythonExecutable();
  }
  checkPythonInstallation(): Promise<{ installed: boolean }> {
    return this.pythonEnv.checkPythonInstallation();
  }
  installPython(
    cb: ((progress: Record<string, unknown>) => void) | null,
  ): Promise<unknown> {
    return this.pythonEnv.installPython(cb);
  }
  checkFunASRInstallation(): Promise<unknown> {
    return this.pythonEnv.checkFunASRInstallation();
  }
  installFunASR(
    cb: ((progress: Record<string, unknown>) => void) | null,
  ): Promise<unknown> {
    return this.pythonEnv.installFunASR(cb);
  }

  // Model delegation
  getModelCachePath(): string {
    return this.modelManager.getModelCachePath();
  }
  checkModelFiles(): Promise<unknown> {
    return this.modelManager.checkModelFiles();
  }
  getDownloadProgress(): Promise<unknown> {
    return this.modelManager.getDownloadProgress();
  }
  async downloadModels(
    cb: ((progress: Record<string, unknown>) => void) | null,
  ): Promise<unknown> {
    const pythonCmd = await this.pythonEnv.findPythonExecutable();
    return this.modelManager.downloadModels(cb, pythonCmd);
  }

  // Transcription delegation
  transcribeAudio(
    audioBlob: unknown,
    options: Record<string, unknown>,
  ): Promise<unknown> {
    return this.server.transcribeAudio(audioBlob, options);
  }
  transcribeFile(
    audioPath: string,
    options: Record<string, unknown>,
  ): Promise<unknown> {
    return this.server.transcribeFile(audioPath, options);
  }
  diarizeAudio(audioPath: string, segments: unknown): Promise<unknown> {
    return this.server.diarizeAudio(audioPath, segments);
  }
  cancelTranscription(): Promise<unknown> {
    return this.server.cancelTranscription();
  }
  gracefulShutdown(): Promise<void> {
    return this.server.gracefulShutdown();
  }

  // Orchestration methods
  async restartServer(): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      this.logger.info && this.logger.info("重启FunASR服务器...");
      if (this.server.initializationPromise) {
        try {
          await this.server.initializationPromise;
        } catch {
          /* ignore */
        }
      }
      if (
        (this.server as unknown as { serverProcess: unknown }).serverProcess
      ) {
        await this.server._stopFunASRServer();
        this.logger.info && this.logger.info("已停止现有FunASR服务器");
      }

      this.server.resetState();
      this.modelManager.clearCache();
      this.pythonEnv.clearFunASRInstallCache();

      const modelStatus = (await this.checkModelFiles()) as {
        minimum_ready: boolean;
        models_downloaded: boolean;
      };
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
      (this.server as unknown as { restartCount: number }).restartCount = 0;
      return { success: true, message: "FunASR服务器重启成功" };
    } catch (error) {
      this.logger.error && this.logger.error("重启FunASR服务器失败:", error);
      return { success: false, error: (error as Error).message };
    }
  }

  async initializeAtStartup(): Promise<void> {
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
      this.preInitializeModels();
    }
  }

  async preInitializeModels(): Promise<Promise<void | unknown> | null> {
    if (this.server.initializationPromise)
      return this.server.initializationPromise;

    this.server.initializationPromise = (async () => {
      const installStatus = (await this.checkFunASRInstallation()) as {
        installed: boolean;
      };
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

  async checkStatus(): Promise<Record<string, unknown>> {
    try {
      if (this.serverReady) {
        return (await this.server._sendServerCommand({
          action: "status",
        })) as Record<string, unknown>;
      }
      const installStatus = (await this.checkFunASRInstallation()) as {
        installed: boolean;
      };
      const modelStatus = (await this.checkModelFiles()) as {
        minimum_ready: boolean;
        models_downloaded: boolean;
        missing_models: string[];
      };

      let error = "FunASR未安装";
      if (installStatus.installed) {
        if (!modelStatus.minimum_ready && !modelStatus.models_downloaded) {
          error = "模型文件未下载，请先下载模型";
        } else {
          error = "FunASR服务器正在启动中...";
        }
      }

      return {
        success:
          installStatus.installed &&
          (modelStatus.minimum_ready || modelStatus.models_downloaded),
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
        error: (error as Error).message,
        installed: false,
        models_downloaded: false,
      };
    }
  }
}

export default FunASRManager;
