const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ServerMessageRouter = require("./serverMessageRouter");
const {
  createTempAudioFile,
  cleanupTempFile,
  convertAudioFile,
} = require("./audioFileHelpers");

class FunASRServer {
  constructor(logger = null) {
    this.logger = logger || console;
    this.serverProcess = null;
    this.serverReady = false;
    this.modelsInitialized = false;
    this.initializationPromise = null;
    this.messageRouter = new ServerMessageRouter(logger || console);
    this.healthMonitorInterval = null;
    this.restartCount = 0;
    this.maxRestarts = 3;
  }

  async _startFunASRServer(pythonEnv, pythonCmd, serverPath, modelCachePath) {
    try {
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

        const initListener = (data) => {
          const lines = data
            .toString()
            .split("\n")
            .filter((l) => l.trim());
          for (const line of lines) {
            this.logger.debug &&
              this.logger.debug("FunASR服务器输出", { line });
            try {
              const result = JSON.parse(line);
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
                this.serverProcess.stdout.removeListener("data", initListener);
                this.messageRouter.attach(this.serverProcess);
                resolve();
              }
            } catch (_parseError) {
              this.logger.debug &&
                this.logger.debug("FunASR服务器非JSON输出", { line });
            }
          }
        };

        this.serverProcess.stdout.on("data", initListener);

        this.serverProcess.stderr.on("data", (data) => {
          const errorOutput = data.toString();
          this.logger.error &&
            this.logger.error("FunASR服务器错误输出", { errorOutput });
          if (this.logger.logFunASR) {
            this.logger.logFunASR("error", "Python stderr", { errorOutput });
          }
        });

        this.serverProcess.on("close", (code) => {
          this.logger.warn &&
            this.logger.warn("FunASR服务器进程退出", { code });
          this._stopHealthMonitor();
          this.messageRouter.detach();
          this.serverProcess = null;
          this.serverReady = false;
          this.modelsInitialized = false;
          if (!initResponseReceived) {
            reject(new Error("FunASR服务器进程异常退出"));
          }
        });

        this.serverProcess.on("error", (error) => {
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
            if (this.serverProcess) this.serverProcess.kill();
            reject(new Error("FunASR服务器启动超时(120秒)"));
          }
        }, 120000);
      });
    } catch (error) {
      this.logger.error && this.logger.error("启动FunASR服务器异常", error);
    }
  }

  _startHealthMonitor() {
    this._stopHealthMonitor();
    this.restartCount = 0;
    this.healthMonitorInterval = setInterval(async () => {
      if (!this.serverProcess || !this.serverReady) return;
      try {
        const result = await Promise.race([
          this._sendServerCommand({ action: "ping" }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("ping timeout")), 5000),
          ),
        ]);
        if (result && result.success && result.action === "pong") return;
        this.logger.warn &&
          this.logger.warn("Health check: unexpected response", result);
        await this._handleServerCrash();
      } catch (err) {
        this.logger.error &&
          this.logger.error("Health check failed", err.message);
        await this._handleServerCrash();
      }
    }, 30000);
  }

  _stopHealthMonitor() {
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = null;
    }
  }

  async _handleServerCrash() {
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
    throw new Error("FunASR server crashed, restart needed");
  }

  async _sendServerCommand(command) {
    if (!this.serverProcess || !this.serverReady) {
      throw new Error("FunASR服务器未就绪");
    }
    return this.messageRouter.sendRaw(command);
  }

  async _stopFunASRServer() {
    this._stopHealthMonitor();
    if (this.serverProcess) {
      try {
        await this._sendServerCommand({ action: "exit" });
      } catch (_error) {
        this.serverProcess.kill();
      }
      this.messageRouter.detach();
      this.serverProcess = null;
      this.serverReady = false;
      this.modelsInitialized = false;
    }
  }

  async gracefulShutdown() {
    this._stopHealthMonitor();
    if (!this.serverProcess) return;
    const proc = this.serverProcess;
    try {
      proc.stdin.write(JSON.stringify({ action: "exit" }) + "\n");
    } catch (_e) {
      // stdin may already be closed
    }
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch (_e) {
          /* already dead */
        }
        resolve();
      }, 5000);
      proc.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.messageRouter.detach();
    this.serverProcess = null;
    this.serverReady = false;
    this.modelsInitialized = false;
  }

  resetState() {
    this.serverReady = false;
    this.modelsInitialized = false;
    this.initializationPromise = null;
    this.restartCount = 0;
  }

  async transcribeAudio(audioBlob, options = {}) {
    if (!this.serverReady && this.initializationPromise) {
      this.logger.info && this.logger.info("等待FunASR服务器就绪...");
      await this.initializationPromise;
    }

    const tempAudioPath = await createTempAudioFile(this.logger, audioBlob);
    try {
      if (!this.serverReady) {
        throw new Error("FunASR服务器未就绪，请稍后重试");
      }

      this.logger.info && this.logger.info("使用FunASR服务器模式进行转录");
      const result = await this._sendServerCommand({
        action: "transcribe",
        audio_path: tempAudioPath,
        options: options,
      });

      if (!result.success) {
        throw new Error(result.error || "转录失败");
      }

      return {
        success: true,
        text: result.text.trim(),
        raw_text: result.raw_text,
        confidence: result.confidence || 0.0,
        language: result.language || "zh-CN",
      };
    } finally {
      await cleanupTempFile(tempAudioPath);
    }
  }

  async transcribeFile(audioPath, options = {}) {
    const MAX_FILE_SIZE = 500 * 1024 * 1024;
    const ALLOWED_EXT = [
      ".wav",
      ".mp3",
      ".m4a",
      ".flac",
      ".ogg",
      ".wma",
      ".aac",
    ];

    if (!audioPath || typeof audioPath !== "string") {
      return { success: false, error: "无效的文件路径", code: "INVALID_PATH" };
    }

    const ext = path.extname(audioPath).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return {
        success: false,
        error: `不支持的格式: ${ext}`,
        code: "FORMAT_NOT_SUPPORTED",
      };
    }

    let stats;
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

    let wavPath = audioPath;
    let converted = false;
    try {
      if (ext !== ".wav" && ext !== ".flac") {
        wavPath = await convertAudioFile(this.logger, audioPath);
        converted = true;
      }

      return await this.messageRouter.sendCommand(
        "transcribe_file",
        { audio_path: wavPath, options },
        {
          timeout: 600000,
          timeoutError: "文件转录超时（10分钟）",
          onProgress: options.onProgress || null,
        },
      );
    } catch (err) {
      return {
        success: false,
        error: err.message,
        code: "TRANSCRIPTION_FAILED",
      };
    } finally {
      if (converted && wavPath !== audioPath) {
        try {
          fs.unlinkSync(wavPath);
        } catch (e) {
          this.logger?.warn?.("WAV cleanup failed", e.message);
        }
      }
    }
  }

  async cancelTranscription() {
    if (!this.serverReady) return { success: false, error: "服务器未就绪" };
    try {
      return await this.messageRouter.sendCommand(
        "cancel_transcription",
        {},
        { timeout: 5000 },
      );
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = FunASRServer;
