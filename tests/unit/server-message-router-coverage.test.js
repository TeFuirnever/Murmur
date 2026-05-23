import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

const ServerMessageRouter = require("../../src/helpers/serverMessageRouter");
const MAX_ENTRY_AGE = 15 * 60 * 1000;

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin.writable = true;
  return proc;
}

describe("ServerMessageRouter - extended coverage", () => {
  let router;
  let proc;
  const logger = { info() {}, warn() {}, error() {}, debug() {} };

  beforeEach(() => {
    router = new ServerMessageRouter(logger);
    proc = createMockProcess();
  });

  afterEach(() => {
    router.detach();
  });

  it("ignores non-JSON stdout lines", async () => {
    router.attach(proc);
    const promise = router.sendRaw({ action: "test" });

    const written = await new Promise((resolve) => {
      proc.stdin.once("data", (d) => resolve(JSON.parse(d.toString())));
    });

    proc.stdout.push("not json\n");
    proc.stdout.push(
      JSON.stringify({ success: true, request_id: written.request_id }) + "\n",
    );

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("handles progress messages", async () => {
    router.attach(proc);
    const onProgress = vi.fn();
    const promise = router.sendCommand(
      "transcribe",
      {},
      { onProgress, timeout: 5000 },
    );

    const written = await new Promise((resolve) => {
      proc.stdin.once("data", (d) => resolve(JSON.parse(d.toString())));
    });

    proc.stdout.push(
      JSON.stringify({
        type: "progress",
        request_id: written.request_id,
        percent: 50,
      }) + "\n",
    );
    expect(onProgress).toHaveBeenCalled();

    proc.stdout.push(
      JSON.stringify({ success: true, request_id: written.request_id }) + "\n",
    );
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("rejects all pending on process error", async () => {
    router.attach(proc);
    const p1 = router.sendRaw({ action: "a" });
    const p2 = router.sendRaw({ action: "b" });

    proc.emit("error", new Error("crashed"));

    await expect(p1).rejects.toThrow("错误");
    await expect(p2).rejects.toThrow("错误");
  });

  it("sendCommand rejects when stdin not writable", () => {
    router.attach(proc);
    proc.stdin.writable = false;
    expect(router.sendCommand("test")).rejects.toThrow("未就绪");
  });

  it("sendRaw rejects when stdin not writable", () => {
    router.attach(proc);
    proc.stdin.writable = false;
    expect(router.sendRaw({ action: "test" })).rejects.toThrow("未就绪");
  });

  it("sendCommand uses default timeout", async () => {
    vi.useFakeTimers();
    router.attach(proc);

    const promise = router.sendCommand("slow");
    vi.advanceTimersByTime(61000);

    await expect(promise).rejects.toThrow("超时");
    vi.useRealTimers();
  });

  it("sendCommand uses custom timeout error message", async () => {
    vi.useFakeTimers();
    router.attach(proc);

    const promise = router.sendCommand(
      "slow",
      {},
      { timeout: 100, timeoutError: "custom timeout" },
    );
    vi.advanceTimersByTime(150);

    await expect(promise).rejects.toThrow("custom timeout");
    vi.useRealTimers();
  });

  it("constructor works without logger", () => {
    const r = new ServerMessageRouter();
    r.attach(proc);
    r.detach();
  });

  it("dispatch ignores messages without request_id", async () => {
    router.attach(proc);
    const promise = router.sendRaw({ action: "test" });

    proc.stdout.push(JSON.stringify({ no_id: true }) + "\n");

    const written = await new Promise((resolve) => {
      proc.stdin.once("data", (d) => resolve(JSON.parse(d.toString())));
    });

    proc.stdout.push(
      JSON.stringify({ success: true, request_id: written.request_id }) + "\n",
    );
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("detach rejects pending requests", async () => {
    router.attach(proc);
    const promise = router.sendRaw({ action: "test" });
    router.detach();
    await expect(promise).rejects.toThrow();
  });

  it("progress messages re-register with extended timeout", async () => {
    vi.useFakeTimers();
    router.attach(proc);

    const onProgress = vi.fn();
    const promise = router.sendCommand(
      "transcribe",
      {},
      { onProgress, timeout: 5000 },
    );

    const written = await new Promise((resolve) => {
      proc.stdin.once("data", (d) => resolve(JSON.parse(d.toString())));
    });

    proc.stdout.push(
      JSON.stringify({
        type: "progress",
        request_id: written.request_id,
        percent: 50,
      }) + "\n",
    );

    vi.advanceTimersByTime(10000);

    proc.stdout.push(
      JSON.stringify({ success: true, request_id: written.request_id }) + "\n",
    );
    const result = await promise;
    expect(result.success).toBe(true);

    vi.useRealTimers();
  });

  it("progress re-registered timer expires and rejects", async () => {
    vi.useFakeTimers();
    router.attach(proc);

    const onProgress = vi.fn();
    const promise = router.sendCommand(
      "transcribe",
      {},
      { onProgress, timeout: 5000 },
    );

    const written = await new Promise((resolve) => {
      proc.stdin.once("data", (d) => resolve(JSON.parse(d.toString())));
    });

    proc.stdout.push(
      JSON.stringify({
        type: "progress",
        request_id: written.request_id,
        percent: 50,
      }) + "\n",
    );

    vi.advanceTimersByTime(MAX_ENTRY_AGE + 1000);

    await expect(promise).rejects.toThrow("服务器响应超时");

    vi.useRealTimers();
  });

  it("_purgeExpired removes old entries", async () => {
    vi.useFakeTimers();
    router.attach(proc);

    const promise = router.sendCommand("transcribe", {}, { timeout: 5000 });

    vi.advanceTimersByTime(MAX_ENTRY_AGE + 61000);

    await expect(promise).rejects.toThrow();
    vi.useRealTimers();
  });

  it("sendRaw timeout rejects with server timeout message", async () => {
    vi.useFakeTimers();
    router.attach(proc);

    const promise = router.sendRaw({ action: "test" });

    vi.advanceTimersByTime(61000);

    await expect(promise).rejects.toThrow("服务器响应超时");
    vi.useRealTimers();
  });

  it("progress message without onProgress callback is handled", async () => {
    router.attach(proc);
    const promise = router.sendCommand("transcribe", {}, { timeout: 5000 });

    const written = await new Promise((resolve) => {
      proc.stdin.once("data", (d) => resolve(JSON.parse(d.toString())));
    });

    // Progress message arrives but no onProgress callback registered
    proc.stdout.push(
      JSON.stringify({
        type: "progress",
        request_id: written.request_id,
        percent: 50,
      }) + "\n",
    );

    proc.stdout.push(
      JSON.stringify({ success: true, request_id: written.request_id }) + "\n",
    );
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("sendCommand rejects when stdin.write throws", async () => {
    router.attach(proc);
    proc.stdin.write = () => {
      throw new Error("EPIPE");
    };
    await expect(router.sendCommand("test")).rejects.toThrow(
      "FunASR服务器写入失败",
    );
  });

  it("sendRaw rejects when stdin.write throws", async () => {
    router.attach(proc);
    proc.stdin.write = () => {
      throw new Error("EPIPE");
    };
    await expect(router.sendRaw({ action: "test" })).rejects.toThrow(
      "FunASR服务器写入失败",
    );
  });

  it("_purgeExpired removes stale entries via cleanup interval", async () => {
    vi.useFakeTimers();
    router.attach(proc);

    let rejectFn;
    const promise = new Promise((_, rej) => {
      rejectFn = rej;
    });

    // Manually inject a stale entry into pending
    router.pending.set("stale-id", {
      resolve: vi.fn(),
      reject: rejectFn,
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now() - MAX_ENTRY_AGE - 1000,
    });

    // Trigger the 60s cleanup interval
    vi.advanceTimersByTime(61000);

    await expect(promise).rejects.toThrow("请求超时（条目过期）");
    expect(router.pending.has("stale-id")).toBe(false);
    vi.useRealTimers();
  });
});
