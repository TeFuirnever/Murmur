const { randomUUID } = require("crypto");

const DEFAULT_TIMEOUT = 60000;
const MAX_ENTRY_AGE = 15 * 60 * 1000;

class ServerMessageRouter {
  constructor(logger) {
    this.logger = logger;
    this.pending = new Map();
    this.serverProcess = null;
    this._cleanupInterval = null;
  }

  attach(serverProcess) {
    this.serverProcess = serverProcess;

    serverProcess.stdout.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((l) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          this._dispatch(msg);
        } catch {
          // ignore non-JSON
        }
      }
    });

    serverProcess.on("close", () => {
      this._rejectAll("服务器进程已退出");
    });

    serverProcess.on("error", (err) => {
      this._rejectAll(`服务器进程错误: ${err.message}`);
    });

    this._cleanupInterval = setInterval(() => this._purgeExpired(), 60000);
  }

  detach() {
    this._rejectAll("Router 已分离");
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    this.serverProcess = null;
  }

  sendCommand(action, params = {}, options = {}) {
    if (!this.serverProcess || !this.serverProcess.stdin.writable) {
      return Promise.reject(new Error("FunASR服务器未就绪"));
    }

    const requestId = params.request_id || randomUUID();
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
        onProgress,
      });

      try {
        this.serverProcess.stdin.write(JSON.stringify(command) + "\n");
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error("FunASR服务器写入失败: " + e.message));
      }
    });
  }

  sendRaw(command) {
    if (!this.serverProcess || !this.serverProcess.stdin.writable) {
      return Promise.reject(new Error("FunASR服务器未就绪"));
    }

    const requestId = command.request_id || randomUUID();
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
        this.serverProcess.stdin.write(JSON.stringify(command) + "\n");
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error("FunASR服务器写入失败: " + e.message));
      }
    });
  }

  _dispatch(msg) {
    const requestId = msg.request_id;
    if (!requestId) {
      return;
    }

    const entry = this.pending.get(requestId);
    if (!entry) {
      return;
    }

    clearTimeout(entry.timer);
    this.pending.delete(requestId);

    if (msg.type === "progress") {
      // Progress messages don't resolve the promise — call onProgress callback
      if (entry.onProgress) {
        entry.onProgress(msg);
      }
      // Re-register so the final result still resolves
      this.pending.set(requestId, {
        ...entry,
        timer: setTimeout(() => {
          this.pending.delete(requestId);
          entry.reject(new Error("服务器响应超时"));
        }, MAX_ENTRY_AGE),
      });
      return;
    }

    entry.resolve(msg);
  }

  _rejectAll(reason) {
    for (const [_id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  _purgeExpired() {
    const now = Date.now();
    for (const [id, entry] of this.pending) {
      if (now - entry.createdAt > MAX_ENTRY_AGE) {
        clearTimeout(entry.timer);
        entry.reject(new Error("请求超时（条目过期）"));
        this.pending.delete(id);
      }
    }
  }
}

module.exports = ServerMessageRouter;
