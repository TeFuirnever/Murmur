// [20260724_TS_BigBang_FunasrServer] Migrated from .js to .ts (ADR-010).
// `module.exports = FunASRServer` (class) became `export default FunASRServer`.
// The attached `module.exports.calculateTranscriptionTimeout` became a named
// export. ipc-contracts consumed via namespace import.
import { spawn, spawnSync } from "child_process";
import type { ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import ServerMessageRouter from "./serverMessageRouter";
import { createTempAudioFile, cleanupTempFile } from "./audioFileHelpers";
import * as C from "./ipc-contracts";
// [20260725_CodeReview_OperationResult] Replaces inline `{ success; error? }`
// shape duplicated across diarizeAudio + cancelTranscription.
import type { OperationResult } from "../types/ipc";

// [20260724_Fix_DynamicTranscriptionTimeout] Dynamic timeout based on file
// size. Previously hardcoded to 300000ms (5 min), which failed for long
// meeting recordings (>30 min audio). Now scales proportionally with file
// size as a proxy for audio duration.
// Heuristic: ~1MB ≈ ~1 min of 16kHz mono speech audio (lossless).
const MIN_TIMEOUT_MS = 300_000; // 5 min — minimum for any file
const MAX_TIMEOUT_MS = 3_600_000; // 60 min — hard cap
const TIMEOUT_PER_MB_MS = 6_000; // 6s per MB of audio (RTFx ~10x on CPU)

// [20260822_T12_IdleUnload] Cold Windows reload can reach minutes
// (Defender scans + HDD); 10 minutes matches Python's per-loader join
// ceiling and keeps the request alive through progress renewals.
const RELOAD_COMMAND_TIMEOUT_MS = 600_000;

/** Timeout result for transcription. */
export interface TranscriptionTimeout {
  ms: number;
  label: string;
}

/**
 * Calculate a dynamic transcription timeout based on file size.
 *
 * [20260724_TS_BigBang_Export] Kept as a standalone function (used internally)
 * and ALSO attached as a static method on FunASRServer below so that
 * `require("./funasrServer").calculateTranscriptionTimeout` works after the
 * setupFile unwraps the default export to the class. This keeps the module as
 * a default-only export ({__esModule, default}) so the unwrap fires for
 * `new require()()`, while still exposing the helper as a class static.
 */
function calculateTranscriptionTimeout(
  fileSizeBytes: number,
): TranscriptionTimeout {
  const sizeMB = Math.max(0, fileSizeBytes) / (1024 * 1024);
  const calculatedMs = MIN_TIMEOUT_MS + sizeMB * TIMEOUT_PER_MB_MS;
  const ms = Math.min(Math.max(calculatedMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
  const minutes = Math.round(ms / 60_000);
  const label = `文件转录超时（${minutes}分钟）`;
  return { ms, label };
}

// [20260817_T2_KillTree] Ticket #179 (spec #177 T2): the ONLY way any code
// path may kill the Python server process. On Windows proc.kill() only kills
// the direct child, so a wedged server leaks its whole subprocess tree
// (~1GB RSS per crash). taskkill /T kills the tree, /F forces termination;
// spawnSync blocks until the tree is dead so callers may respawn right after.
export function killProcessTree(proc: ChildProcess | null): void {
  if (!proc) return;
  try {
    if (process.platform === "win32" && proc.pid) {
      // [20260817_T2_KillTreeReview] taskkill exit status 1 ("process not
      // found") is the expected already-dead case; other non-zero statuses
      // (e.g. access denied) are also swallowed here — callers respawn right
      // after, and a surviving tree would be caught by the next ping cycle.
      spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], {
        windowsHide: true,
      });
    } else {
      proc.kill("SIGKILL");
    }
  } catch (_e) {
    /* already dead */
  }
}

/** Logger interface (accepts console or LogManager). */
interface Logger {
  info?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
  logFunASR?(level: string, message: string, data?: unknown): void;
}

interface ServerCommandResult {
  success?: boolean;
  error?: string;
  text?: string;
  raw_text?: string;
  confidence?: number;
  language?: string;
  action?: string;
}

interface TranscriptionFileResult {
  success: boolean;
  error?: string;
  code?: string;
  text?: string;
  raw_text?: string;
  segments?: Array<{ start_ms: number; end_ms: number; text: string }>;
  duration?: number;
  confidence?: number;
  language?: string;
}

interface StartupParams {
  pythonEnv: NodeJS.ProcessEnv;
  pythonCmd: string;
  serverPath: string;
  modelCachePath: string;
}

class FunASRServer {
  private logger: Logger;
  private serverProcess: ChildProcess | null;
  serverReady: boolean;
  modelsInitialized: boolean;
  initializationPromise: Promise<void | unknown> | null;
  messageRouter: ServerMessageRouter;
  private healthMonitorInterval: NodeJS.Timeout | null;
  restartCount: number;
  private maxRestarts: number;
  private _startupParams: StartupParams | null;
  private _stopping: boolean;
  // [20260822_T12_IdleUnload] True while an intentional reload_models
  // command is in flight — suppresses health-monitor crash handling.
  private _reloadInFlight: boolean;

  // [20260724_TS_BigBang_Export] Exposed as a static so external consumers
  // (and tests) can access it via `FunASRServer.calculateTranscriptionTimeout`
  // after the default-export unwrap in the test setupFile.
  static calculateTranscriptionTimeout = calculateTranscriptionTimeout;

  constructor(logger: Logger | null = null) {
    this.logger = logger || console;
    this.serverProcess = null;
    this.serverReady = false;
    this.modelsInitialized = false;
    this.initializationPromise = null;
    this.messageRouter = new ServerMessageRouter(logger || console);
    this.healthMonitorInterval = null;
    this.restartCount = 0;
    this.maxRestarts = 3;
    this._startupParams = null;
    this._stopping = false;
    this._reloadInFlight = false;
  }

  private _saveStartupParams(params: StartupParams): void {
    this._startupParams = params;
  }

  async _startFunASRServer(
    pythonEnv: NodeJS.ProcessEnv,
    pythonCmd: string,
    serverPath: string,
    modelCachePath: string,
  ): Promise<void | unknown> {
    try {
      this._saveStartupParams({
        pythonEnv,
        pythonCmd,
        serverPath,
        modelCachePath,
      });
      this._stopping = false;
      this.logger.info && this.logger.info("启动FunASR服务器...");

      if (!fs.existsSync(serverPath)) {
        this.logger.error &&
          this.logger.error("FunASR服务器脚本未找到", { serverPath });
        return;
      }

      return new Promise((resolve, reject) => {
        this.logger.info &&
          this.logger.info("启动FunASR Python进程", {
            command: pythonCmd,
            args: [serverPath],
          });

        this.serverProcess = spawn(
          pythonCmd,
          [serverPath, "--damo-root", modelCachePath],
          {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: pythonEnv,
          },
        );

        let initResponseReceived = false;

        const initListener = (data: Buffer) => {
          const lines = data
            .toString()
            .split("\n")
            .filter((l) => l.trim());
          for (const line of lines) {
            this.logger.debug &&
              this.logger.debug("FunASR服务器输出", { line });
            try {
              const result = JSON.parse(line) as ServerCommandResult;
              if (!initResponseReceived) {
                initResponseReceived = true;
                if (result.success) {
                  this.serverReady = true;
                  this.modelsInitialized = true;
                  this.logger.info &&
                    this.logger.info("FunASR服务器启动成功，模型已初始化");
                  this._startHealthMonitor();
                } else {
                  this.logger.error &&
                    this.logger.error("FunASR服务器初始化失败", result);
                }
                this.serverProcess!.stdout!.removeListener(
                  "data",
                  initListener,
                );
                this.messageRouter.attach(this.serverProcess!);
                resolve(undefined);
              }
            } catch (_parseError) {
              this.logger.debug &&
                this.logger.debug("FunASR服务器非JSON输出", { line });
            }
          }
        };

        this.serverProcess.stdout!.on("data", initListener);

        this.serverProcess.stderr!.on("data", (data: Buffer) => {
          const errorOutput = data.toString();
          this.logger.error &&
            this.logger.error("FunASR服务器错误输出", { errorOutput });
          if (this.logger.logFunASR) {
            this.logger.logFunASR("error", "Python stderr", { errorOutput });
          }
        });

        // [20260817_T2_KillTreeReview] Capture the process identity: a
        // stale close from a superseded process must not tear down state
        // belonging to the current one (crash handling removes these
        // listeners before killing, this guard covers any other stale path).
        const proc = this.serverProcess;
        this.serverProcess.on("close", (code) => {
          if (this.serverProcess !== proc) return;
          this.logger.warn &&
            this.logger.warn("FunASR服务器进程退出", { code });
          this._stopHealthMonitor();
          this.messageRouter.detach();
          this.serverProcess = null;
          this.serverReady = false;
          this.modelsInitialized = false;
          if (!initResponseReceived) {
            reject(new Error("FunASR服务器进程异常退出"));
          } else if (!this._stopping) {
            this._handleServerCrash();
          }
        });

        this.serverProcess.on("error", (error: Error) => {
          this.logger.error && this.logger.error("FunASR服务器进程错误", error);
          this.messageRouter.detach();
          this.serverProcess = null;
          this.serverReady = false;
          if (!initResponseReceived) {
            reject(new Error("FunASR服务器进程启动失败: " + error.message));
          }
        });

        setTimeout(() => {
          if (!initResponseReceived) {
            this.logger.warn && this.logger.warn("FunASR服务器启动超时");
            // [20260817_T2_KillTree] Tree kill — bare kill() leaves the
            // Python child tree alive on Windows.
            killProcessTree(this.serverProcess);
            reject(new Error("FunASR服务器启动超时(120秒)"));
          }
        }, 120000);
      });
    } catch (error) {
      this.logger.error && this.logger.error("启动FunASR服务器异常", error);
    }
  }

  _startHealthMonitor(): void {
    this._stopHealthMonitor();
    this.restartCount = 0;
    this.healthMonitorInterval = setInterval(async () => {
      if (!this.serverProcess || !this.serverReady) return;
      // [20260822_T12_IdleUnload] Ticket #190: an intentional reload runs
      // on the Python worker thread and can take minutes on a cold Windows
      // start — the ping is still answered (read loop stays free), but a
      // slow queued-ahead file job can stall it past the 5s timeout.
      // Suppress crash handling for the duration; reloadModels owns the
      // flag. Intentional reloads never touch restartCount (only
      // _handleServerCrash increments it).
      if (this._reloadInFlight) return;
      try {
        const result = (await Promise.race([
          this._sendServerCommand({ action: "ping" }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("ping timeout")), 5000),
          ),
        ])) as ServerCommandResult;
        if (result && result.success && result.action === "pong") return;
        this.logger.warn &&
          this.logger.warn("Health check: unexpected response", result);
        await this._handleServerCrash();
      } catch (err) {
        this.logger.error &&
          this.logger.error("Health check failed", (err as Error).message);
        await this._handleServerCrash();
      }
    }, 30000);
  }

  _stopHealthMonitor(): void {
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = null;
    }
  }

  async _handleServerCrash(): Promise<void> {
    this._stopHealthMonitor();
    this.restartCount++;
    if (this.restartCount > this.maxRestarts) {
      this.logger.error &&
        this.logger.error(
          `FunASR server crashed ${this.restartCount} times, giving up`,
        );
      this.serverReady = false;
      return;
    }
    this.logger.warn &&
      this.logger.warn(
        `FunASR server crash detected, restart attempt ${this.restartCount}/${this.maxRestarts}`,
      );
    if (this._startupParams) {
      const { pythonEnv, pythonCmd, serverPath, modelCachePath } =
        this._startupParams;
      // [20260817_T2_KillTreeReview] A ping-timeout crash means the process
      // is wedged, not exited — dropping the handle without killing leaks
      // the entire Python tree (double ~1GB RSS within one crash cycle).
      // Kill the tree BEFORE respawning. The close listeners are removed
      // first: the kill's close event arrives asynchronously (after this
      // function has already respawned), and a flag-based guard can never
      // cover that window — only removal (plus the identity guard on the
      // listener) prevents the stale close from re-entering crash handling
      // and tearing down the fresh process.
      const oldProc = this.serverProcess;
      if (oldProc) oldProc.removeAllListeners("close");
      killProcessTree(oldProc);
      this.serverProcess = null;
      this.serverReady = false;
      try {
        await this._startFunASRServer(
          pythonEnv,
          pythonCmd,
          serverPath,
          modelCachePath,
        );
      } catch (err) {
        this.logger.error &&
          this.logger.error(
            "FunASR server restart failed",
            (err as Error).message,
          );
      }
    }
  }

  async _sendServerCommand(command: Record<string, unknown>): Promise<unknown> {
    if (!this.serverProcess || !this.serverReady) {
      throw new Error("FunASR服务器未就绪");
    }
    return this.messageRouter.sendRaw(command);
  }

  async _stopFunASRServer(): Promise<void> {
    this._stopping = true;
    this._stopHealthMonitor();
    if (this.serverProcess) {
      try {
        await this._sendServerCommand({ action: "exit" });
      } catch (_error) {
        // [20260817_T2_KillTree] Exit command failed (dead/wedged pipe) —
        // tree kill so Windows does not keep the Python child tree.
        killProcessTree(this.serverProcess);
      }
      this.messageRouter.detach();
      this.serverProcess = null;
      this.serverReady = false;
      this.modelsInitialized = false;
    }
  }

  async gracefulShutdown(): Promise<void> {
    // [20260817_T2_KillTreeReview] Mark stopping so the close event fired by
    // the timeout-arm tree kill below cannot trigger a crash-restart while
    // the app is quitting (which would respawn a Python process that
    // outlives the app). _stopFunASRServer already does the same.
    this._stopping = true;
    this._stopHealthMonitor();
    if (!this.serverProcess) return;
    const proc = this.serverProcess;
    try {
      proc.stdin!.write(JSON.stringify({ action: "exit" }) + "\n");
    } catch (_e) {
      // stdin may already be closed
    }
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // [20260817_T2_KillTree] Shared tree killer (Windows process-tree
        // task-kill via blocking spawnSync; SIGKILL elsewhere). See
        // killProcessTree for rationale.
        killProcessTree(proc);
        resolve(undefined);
      }, 5000);
      proc.on("close", () => {
        clearTimeout(timeout);
        resolve(undefined);
      });
    });
    this.messageRouter.detach();
    this.serverProcess = null;
    this.serverReady = false;
    this.modelsInitialized = false;
  }

  resetState(): void {
    this.serverReady = false;
    this.modelsInitialized = false;
    this.initializationPromise = null;
    this.restartCount = 0;
  }

  // [20260822_T12_IdleUnload] Ticket #190 (spec #177 T12): the two T11
  // protocol commands with their TS-side envelopes. unload uses the
  // default timeout (it only frees references — near-instant); reload
  // gets an explicit LONG envelope because a cold Windows reload can
  // reach minutes and the 60s default would reject while Python keeps
  // loading (the result would then be dropped as an unknown request).
  async unloadModels(): Promise<unknown> {
    if (!this.serverProcess || !this.serverReady) {
      return { success: false, error: "FunASR服务器未就绪" };
    }
    const result = (await this.messageRouter.sendCommand(
      "unload_models",
    )) as { success?: boolean };
    // [T12 review BLOCKER] The TS-side flag drives STATUS → renderer
    // isReady; without this the unloaded server still reads "ready" and
    // the hotkey pre-trigger never fires in its core scenario.
    if (result && result.success) {
      this.modelsInitialized = false;
    }
    return result;
  }

  async reloadModels(): Promise<unknown> {
    if (!this.serverProcess || !this.serverReady) {
      return { success: false, error: "FunASR服务器未就绪" };
    }
    this._reloadInFlight = true;
    try {
      const result = (await this.messageRouter.sendCommand(
        "reload_models",
        {},
        {
          timeout: RELOAD_COMMAND_TIMEOUT_MS,
          timeoutError: "模型重载超时",
        },
      )) as { success?: boolean };
      if (result && result.success) {
        this.modelsInitialized = true;
      }
      return result;
    } finally {
      this._reloadInFlight = false;
    }
  }

  async transcribeAudio(
    audioBlob: unknown,
    options: Record<string, unknown> = {},
  ): Promise<{
    success: boolean;
    text?: string;
    raw_text?: string;
    confidence?: number;
    language?: string;
    error?: string;
  }> {
    if (!this.serverReady && this.initializationPromise) {
      this.logger.info && this.logger.info("等待FunASR服务器就绪...");
      await this.initializationPromise;
    }

    const tempAudioPath = await createTempAudioFile(
      this.logger as never,
      audioBlob as never,
    );
    try {
      if (!this.serverReady) {
        throw new Error("FunASR服务器未就绪，请稍后重试");
      }

      this.logger.info && this.logger.info("使用FunASR服务器模式进行转录");
      const result = (await this._sendServerCommand({
        action: "transcribe",
        audio_path: tempAudioPath,
        options: options,
      })) as ServerCommandResult;

      if (!result.success) {
        throw new Error(result.error || "转录失败");
      }

      return {
        success: true,
        text: (result.text || "").trim(),
        raw_text: result.raw_text,
        confidence: result.confidence || 0.0,
        language: result.language || "zh-CN",
      };
    } finally {
      await cleanupTempFile(tempAudioPath);
    }
  }

  async transcribeFile(
    audioPath: string,
    options: Record<string, unknown> = {},
  ): Promise<TranscriptionFileResult> {
    const MAX_FILE_SIZE = 500 * 1024 * 1024;
    const ALLOWED_EXT = C.AUDIO_EXTENSIONS;

    if (!audioPath || typeof audioPath !== "string") {
      return { success: false, error: "无效的文件路径", code: "INVALID_PATH" };
    }

    const ext = path.extname(audioPath).toLowerCase();
    if (!(ALLOWED_EXT as readonly string[]).includes(ext)) {
      return {
        success: false,
        error: `不支持的格式: ${ext}`,
        code: "FORMAT_NOT_SUPPORTED",
      };
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(audioPath);
    } catch {
      return {
        success: false,
        error: "文件不存在或无法访问",
        code: "FILE_NOT_FOUND",
      };
    }

    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: "文件超过500MB限制",
        code: "FILE_TOO_LARGE",
      };
    }

    if (!this.serverReady) {
      if (this.initializationPromise) await this.initializationPromise;
      if (!this.serverReady) {
        return {
          success: false,
          error: "FunASR服务器未就绪",
          code: "SERVER_NOT_READY",
        };
      }
    }

    try {
      // [20260724_Fix_DynamicTranscriptionTimeout] Use dynamic timeout based
      // on file size instead of hardcoded 5-minute limit. This prevents
      // long meeting recordings (>30 min) from timing out.
      const { ms: dynamicTimeout, label: timeoutLabel } =
        calculateTranscriptionTimeout(stats.size);
      return (await this.messageRouter.sendCommand(
        "transcribe_file",
        { audio_path: audioPath, options },
        {
          timeout: dynamicTimeout,
          timeoutError: timeoutLabel,
          onProgress:
            (options.onProgress as
              | ((msg: Record<string, unknown>) => void)
              | undefined) || null,
        },
      )) as TranscriptionFileResult;
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        code: "TRANSCRIPTION_FAILED",
      };
    }
  }

  async diarizeAudio(
    audioPath: string,
    segments: unknown,
  ): Promise<OperationResult> {
    if (!this.serverReady) return { success: false, error: "服务器未就绪" };
    try {
      return (await this.messageRouter.sendCommand(
        "diarize",
        { audio_path: audioPath, segments },
        { timeout: 120000 },
      )) as OperationResult;
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async cancelTranscription(): Promise<OperationResult> {
    if (!this.serverReady) return { success: false, error: "服务器未就绪" };
    try {
      return (await this.messageRouter.sendCommand(
        "cancel_transcription",
        {},
        { timeout: 5000 },
      )) as OperationResult;
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

export default FunASRServer;
