import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

const ServerMessageRouter = require("../../src/helpers/serverMessageRouter");

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin.writable = true;
  return proc;
}

describe("ServerMessageRouter", () => {
  let router;
  let proc;
  const logger = { info() {}, warn() {}, error() {}, debug() {} };

  beforeEach(() => {
    router = new ServerMessageRouter(logger);
    proc = createMockProcess();
    router.attach(proc);
  });

  afterEach(() => {
    router.detach();
  });

  it("resolves sendRaw when matching request_id arrives", async () => {
    const promise = router.sendRaw({ action: "status" });

    const written = await new Promise((resolve) => {
      proc.stdin.once("data", (d) => resolve(JSON.parse(d.toString())));
    });

    expect(written.action).toBe("status");
    expect(written.request_id).toBeTruthy();

    proc.stdout.push(
      JSON.stringify({
        success: true,
        request_id: written.request_id,
      }) + "\n",
    );

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.request_id).toBe(written.request_id);
  });

  it("resolves sendCommand with action and params", async () => {
    const promise = router.sendCommand("ping", {}, { timeout: 5000 });

    const written = await new Promise((resolve) => {
      proc.stdin.once("data", (d) => resolve(JSON.parse(d.toString())));
    });

    expect(written.action).toBe("ping");

    proc.stdout.push(
      JSON.stringify({
        success: true,
        action: "pong",
        request_id: written.request_id,
      }) + "\n",
    );

    const result = await promise;
    expect(result.action).toBe("pong");
  });

  it("rejects on timeout", async () => {
    vi.useFakeTimers();

    const promise = router.sendCommand("slow", {}, { timeout: 100 });

    vi.advanceTimersByTime(150);

    await expect(promise).rejects.toThrow("超时");

    vi.useRealTimers();
  });

  it("ignores messages with unknown request_id", async () => {
    const promise = router.sendRaw({ action: "test" });

    const written = await new Promise((resolve) => {
      proc.stdin.once("data", (d) => resolve(JSON.parse(d.toString())));
    });

    proc.stdout.push(
      JSON.stringify({ success: true, request_id: "unknown-id" }) + "\n",
    );

    proc.stdout.push(
      JSON.stringify({
        success: true,
        request_id: written.request_id,
      }) + "\n",
    );

    const result = await promise;
    expect(result.request_id).toBe(written.request_id);
  });

  it("rejects all pending when process closes", async () => {
    const p1 = router.sendRaw({ action: "a" });
    const p2 = router.sendRaw({ action: "b" });

    proc.emit("close");

    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();
  });

  it("rejects when server process is not attached", () => {
    router.detach();
    expect(router.sendCommand("test")).rejects.toThrow("未就绪");
  });
});
