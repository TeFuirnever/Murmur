// [20260724_TS_BigBang_FunasrManager] Migrated from .js to .ts (ADR-010).
// `module.exports = FunASRManager` (class) became `export default
// FunASRManager`. All three helper imports are default class imports.
import PythonEnvironment from "./pythonEnvironment";
import ModelManager from "./modelManager";
import FunASRServer from "./funasrServer";

// [20260822_T12_IdleUnload] Ticket #190 (spec #177 T12): idle-unload
// constants. MURMUR_IDLE_UNLOAD_MS overrides the default (ADR-006
// MURMUR_DEVICE pattern), clamped to [10s, 24h]; invalid values fall back
// to the default. Env reaches only dev launches (packaged GUI apps do not
// inherit the user shell) — developer stories only, by design.
const IDLE_UNLOAD_DEFAULT_MS = 300_000; // 5 minutes
export const IDLE_UNLOAD_MIN_MS = 10_000;
export const IDLE_UNLOAD_MAX_MS = 24 * 60 * 60_000;

function resolveIdleUnloadTimeoutMs(): number {
  const raw = process.env.MURMUR_IDLE_UNLOAD_MS;
  if (!raw) return IDLE_UNLOAD_DEFAULT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return IDLE_UNLOAD_DEFAULT_MS;
  return Math.min(Math.max(parsed, IDLE_UNLOAD_MIN_MS), IDLE_UNLOAD_MAX_MS);
}

export const IDLE_UNLOAD_TIMEOUT_MS = resolveIdleUnloadTimeoutMs();

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

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  // [20260822_T12_IdleUnload] In-flight/pending transcription COUNTER
  // (review MINOR: a boolean clears when the FIRST of two concurrent
  // transcriptions finishes, letting the idle unload fire mid-flight on
  // the second) — the idle deadline defers while any work is active.
  private _transcriptionCount = 0;

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
  async downloadModels(
    cb: ((progress: Record<string, unknown>) => void) | null,
  ): Promise<unknown> {
    const pythonCmd = await this.pythonEnv.findPythonExecutable();
    return this.modelManager.downloadModels(cb, pythonCmd);
  }

  // Transcription delegation — each entry point arms the idle-unload
  // timer and guards the busy flag around the in-flight window
  // ([20260822_T12_IdleUnload]; ping/status/stats never reset it).
  async transcribeAudio(
    audioBlob: unknown,
    options: Record<string, unknown>,
  ): Promise<unknown> {
    this._resetIdleUnloadTimer();
    this._transcriptionCount += 1;
    try {
      return await this.server.transcribeAudio(audioBlob, options);
    } finally {
      this._transcriptionCount -= 1;
      this._resetIdleUnloadTimer();
    }
  }
  async transcribeFile(
    audioPath: string,
    options: Record<string, unknown>,
  ): Promise<unknown> {
    this._resetIdleUnloadTimer();
    this._transcriptionCount += 1;
    try {
      return await this.server.transcribeFile(audioPath, options);
    } finally {
      this._transcriptionCount -= 1;
      this._resetIdleUnloadTimer();
    }
  }
  async diarizeAudio(audioPath: string, segments: unknown): Promise<unknown> {
    this._resetIdleUnloadTimer();
    this._transcriptionCount += 1;
    try {
      return await this.server.diarizeAudio(audioPath, segments);
    } finally {
      this._transcriptionCount -= 1;
      this._resetIdleUnloadTimer();
    }
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
      const funasrStatus = (await this.checkFunASRInstallation()) as {
        installed?: boolean;
        working?: boolean;
        error?: string;
      };
      this.logger.info &&
        this.logger.info("FunASR安装状态检查完成", funasrStatus);
      // [20260818_T3_PythonSelfCheckMilestone] Ticket #184: unambiguous boot
      // milestone for the packaged-app smoke gate. Until now a broken
      // embedded env only produced a non-fatal warn and the app still booted
      // green — exactly how the broken Windows env shipped through every
      // boot smoke (spec #177 B-0). The check itself spawns a real Python
      // subprocess running `import funasr` (which pulls numpy/torch), so
      // "通过" proves interpreter resolution AND the dependency stack of the
      // packaged environment. Smokes assert: 通过 present, 失败 absent.
      if (funasrStatus && funasrStatus.working) {
        this.logger.info &&
          this.logger.info("Python链路自检通过", { pythonCmd });
      } else {
        this.logger.warn &&
          this.logger.warn("Python链路自检失败", funasrStatus);
      }
      this.isInitialized = true;
      this.preInitializeModels();
      this.logger.info && this.logger.info("FunASR管理器启动初始化完成");
    } catch (error) {
      // [20260818_T3_PythonSelfCheckMilestone] Same milestone on the
      // resolution-failure path (e.g. embedded interpreter missing) so the
      // smoke can gate on it regardless of which step failed.
      this.logger.warn && this.logger.warn("Python链路自检失败", error);
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

  // [20260822_T12_IdleUnload] Arm/re-arm the idle-unload timer. Called ONLY
  // from transcription entry points (mic/file/diarize) — ping, status and
  // stats polls must NEVER postpone an unload.
  _resetIdleUnloadTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this._onIdleUnloadTimeout();
    }, IDLE_UNLOAD_TIMEOUT_MS);
  }

  async _onIdleUnloadTimeout(): Promise<void> {
    // Busy = deferred: re-arm for another full window instead of unloading
    // mid-flight (the Python side also defers under the models lock, but
    // avoiding the pointless command keeps logs clean).
    if (this._transcriptionCount > 0) {
      this.logger.info && this.logger.info("空闲超时但转写进行中，顺延卸载");
      this._resetIdleUnloadTimer();
      return;
    }
    this.logger.info &&
      this.logger.info(`空闲 ${IDLE_UNLOAD_TIMEOUT_MS / 60000} 分钟，卸载模型`);
    try {
      // [T12 review MINOR] The wrapper returns {success:false} instead of
      // throwing when the server is down — log that too, don't swallow.
      const result = (await this.server.unloadModels()) as {
        success?: boolean;
        error?: string;
      };
      if (result && result.success === false) {
        this.logger.warn &&
          this.logger.warn(
            "空闲卸载未执行（服务器未就绪；下次转写将懒重载）",
            result.error,
          );
      }
    } catch (error) {
      this.logger.warn &&
        this.logger.warn("空闲卸载失败（下次转写将懒重载）", error);
    }
  }

  // [20260822_T12_IdleUnload] Hotkey-down pre-trigger: start the reload
  // immediately so the user's speech covers the reload window (the Python
  // read loop stays ping-answerable; health monitoring is suppressed for
  // the duration inside the server wrapper).
  reloadModels(): Promise<unknown> {
    return this.server.reloadModels();
  }
}

export default FunASRManager;
