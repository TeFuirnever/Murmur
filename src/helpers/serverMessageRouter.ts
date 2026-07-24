// [20260724_TS_Migration_ServerMessageRouter] Migrated from .js to .ts (ADR-010 Phase 3).
// Manages stdin/stdout JSON communication with the FunASR Python server process.
import { randomUUID } from "crypto";
import type { ChildProcess } from "child_process";

const DEFAULT_TIMEOUT = 60_000;
const MAX_ENTRY_AGE = 15 * 60 * 1000;

/** Logger interface (accepts console or LogManager). */
interface Logger {
  warn(message: string, ...args: unknown[]): void;
  info?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

/** Options for sendCommand. */
interface SendCommandOptions {
  timeout?: number;
  timeoutError?: string;
  onProgress?: ((msg: Record<string, unknown>) => void) | null;
}

/** A pending request entry tracking resolve/reject/timer. */
interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  createdAt: number;
  lastProgressAt?: number;
  originalTimeout?: number;
  onProgress?: ((msg: Record<string, unknown>) => void) | null;
}

class ServerMessageRouter {
  private logger: Logger;
  private pending: Map<string, PendingEntry>;
  private serverProcess: ChildProcess | null;
  private _cleanupInterval: NodeJS.Timeout | null;

  constructor(logger: Logger) {
    this.logger = logger;
    this.pending = new Map();
    this.serverProcess = null;
    this._cleanupInterval = null;
  }

  attach(serverProcess: ChildProcess): void {
    this.serverProcess = serverProcess;
    let buffer = "";

    serverProcess.stdout!.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this._dispatch(msg);
        } catch {
          this.logger.warn("Failed to parse stdout JSON", line.length);
        }
      }
    });

    serverProcess.on("close", () => {
      this._rejectAll("服务器进程已退出");
    });

    serverProcess.on("error", (err: Error) => {
      this._rejectAll(`服务器进程错误: ${err.message}`);
    });

    this._cleanupInterval = setInterval(() => this._purgeExpired(), 60000);
  }

  detach(): void {
    this._rejectAll("Router 已分离");
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    this.serverProcess = null;
  }

  sendCommand(
    action: string,
    params: Record<string, unknown> = {},
    options: SendCommandOptions = {},
  ): Promise<unknown> {
    if (!this.serverProcess || !this.serverProcess.stdin?.writable) {
      return Promise.reject(new Error("FunASR服务器未就绪"));
    }

    const requestId = (params.request_id as string) || randomUUID();
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const onProgress = options.onProgress || null;

    const command = { ...params, action, request_id: requestId };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(options.timeoutError || "服务器响应超时"));
      }, timeout);

      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        createdAt: Date.now(),
        lastProgressAt: Date.now(),
        originalTimeout: timeout,
        onProgress,
      });

      try {
        this.serverProcess!.stdin!.write(JSON.stringify(command) + "\n");
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error("FunASR服务器写入失败: " + (e as Error).message));
      }
    });
  }

  sendRaw(command: Record<string, unknown>): Promise<unknown> {
    if (!this.serverProcess || !this.serverProcess.stdin?.writable) {
      return Promise.reject(new Error("FunASR服务器未就绪"));
    }

    const requestId = (command.request_id as string) || randomUUID();
    command.request_id = requestId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("服务器响应超时"));
      }, DEFAULT_TIMEOUT);

      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        createdAt: Date.now(),
      });

      try {
        this.serverProcess!.stdin!.write(JSON.stringify(command) + "\n");
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error("FunASR服务器写入失败: " + (e as Error).message));
      }
    });
  }

  private _dispatch(msg: Record<string, unknown>): void {
    const requestId = msg.request_id as string;
    if (!requestId) return;

    const entry = this.pending.get(requestId);
    if (!entry) return;

    if (msg.type === "progress") {
      if (entry.onProgress) {
        entry.onProgress(msg);
      }
      clearTimeout(entry.timer);
      const nextTimeout = Math.max(
        entry.originalTimeout || MAX_ENTRY_AGE,
        5 * 60 * 1000,
      );
      this.pending.set(requestId, {
        ...entry,
        lastProgressAt: Date.now(),
        timer: setTimeout(() => {
          this.pending.delete(requestId);
          entry.reject(new Error("服务器响应超时"));
        }, nextTimeout),
      });
      return;
    }

    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(msg);
  }

  private _rejectAll(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private _purgeExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.pending) {
      const absoluteAge = now - entry.createdAt;
      const progressAge = now - (entry.lastProgressAt || entry.createdAt);
      if (absoluteAge > 60 * 60 * 1000 || progressAge > 5 * 60 * 1000) {
        clearTimeout(entry.timer);
        entry.reject(new Error("请求超时（条目过期）"));
        this.pending.delete(id);
      }
    }
  }
}

export default ServerMessageRouter;
