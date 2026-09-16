// [20260724_TS_Migration_LogManager] Migrated from .js to .ts (ADR-010 Phase 2).
// Depends only on fs, path, os, and electron (lazy require in methods).
import fs from "fs";
import path from "path";
import os from "os";

/** A single log entry written to the log file. */
interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data: unknown;
  pid?: number;
  source?: string;
}

/** Log level type. */
type LogLevel = "info" | "error" | "warn" | "debug";

/** System info for debugging. */
interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  electronVersion: string | undefined;
  appVersion: string;
  userDataPath: string;
  logDir: string | null;
  env: {
    NODE_ENV: string | undefined;
    PATH: string | undefined;
    PYTHON_PATH: string | undefined;
  };
}

class LogManager {
  private _initialized = false;
  private logDir: string | null = null;
  private logFile: string | null = null;
  private funasrLogFile: string | null = null;
  private _pendingLogs: unknown[] = [];

  private _ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;
    this.logDir = this.getLogDirectory();
    this.logFile = path.join(this.logDir, "app.log");
    this.funasrLogFile = path.join(this.logDir, "funasr.log");
    this.ensureLogDirectory();
  }

  getLogDirectory(): string {
    try {
      // Lazy require electron — not available in test environment
      const electron = require("electron");
      return path.join(electron.app.getPath("userData"), "logs");
    } catch {
      return path.join(os.tmpdir(), "murmur-logs");
    }
  }

  ensureLogDirectory(): void {
    try {
      if (this.logDir && !fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error("创建日志目录失败:", error);
    }
  }

  log(level: LogLevel, message: string, data: unknown = null): void {
    this._ensureInitialized();
    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      message,
      data,
      pid: process.pid,
    };

    console[level](`[${timestamp}] ${message}`, data || "");

    try {
      const logLine = JSON.stringify(logEntry) + "\n";
      fs.appendFileSync(this.logFile!, logLine);
    } catch (error) {
      console.error("写入日志文件失败:", error);
    }
  }

  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }

  logFunASR(level: LogLevel, message: string, data: unknown = null): void {
    this._ensureInitialized();
    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      message,
      data,
      source: "FunASR",
    };

    console[level](`[FunASR] ${message}`, data || "");

    try {
      const logLine = JSON.stringify(logEntry) + "\n";
      fs.appendFileSync(this.funasrLogFile!, logLine);
    } catch (error) {
      console.error("写入FunASR日志文件失败:", error);
    }
  }

  getRecentLogs(lines = 100): LogEntry[] {
    try {
      if (!this.logFile || !fs.existsSync(this.logFile)) return [];

      const content = fs.readFileSync(this.logFile, "utf8");
      const logLines = content
        .trim()
        .split("\n")
        .filter((line: string) => line.trim());

      return logLines.slice(-lines).map((line: string) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return {
            message: line,
            timestamp: new Date().toISOString(),
          } as LogEntry;
        }
      });
    } catch (error) {
      console.error("读取日志文件失败:", error);
      return [];
    }
  }

  getFunASRLogs(lines = 100): LogEntry[] {
    try {
      if (!this.funasrLogFile || !fs.existsSync(this.funasrLogFile)) return [];

      const content = fs.readFileSync(this.funasrLogFile, "utf8");
      const logLines = content
        .trim()
        .split("\n")
        .filter((line: string) => line.trim());

      return logLines.slice(-lines).map((line: string) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return {
            message: line,
            timestamp: new Date().toISOString(),
          } as LogEntry;
        }
      });
    } catch (error) {
      console.error("读取FunASR日志文件失败:", error);
      return [];
    }
  }

  cleanOldLogs(daysToKeep = 7): void {
    try {
      const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

      [this.logFile, this.funasrLogFile].forEach((logFile) => {
        if (logFile && fs.existsSync(logFile)) {
          const stats = fs.statSync(logFile);
          if (stats.mtime.getTime() < cutoffTime) {
            fs.unlinkSync(logFile);
            console.log(`清理旧日志文件: ${logFile}`);
          }
        }
      });
    } catch (error) {
      console.error("清理旧日志失败:", error);
    }
  }

  getLogFilePath(): string {
    this._ensureInitialized();
    return this.logFile!;
  }

  getFunASRLogFilePath(): string {
    this._ensureInitialized();
    return this.funasrLogFile!;
  }

  getSystemInfo(): SystemInfo {
    const electron = require("electron");
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      appVersion: electron.app.getVersion(),
      userDataPath: electron.app.getPath("userData"),
      logDir: this.logDir,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        PYTHON_PATH: process.env.PYTHON_PATH,
      },
    };
  }
}

export default LogManager;
