// [20260726_Tier3_ServerMessageRouterCoverageMigrate] Migrated from .js to
// .ts as part of Tier 3 batch 4. Pattern: typed `const ServerMessageRouter`
// via `typeof import("...").default` (TS7005), explicit `let router`/`let
// proc` types (TS7034). The mock process is EventEmitter+PassThrough trio
// cast to `ChildProcess` at attach() (router expects Node's ChildProcess).
// The router's `pending` Map is private; tests poke it directly, so a
// `RouterPrivateSurface` cast exposes the Map. `proc.stdin.write` overrides
// go through the PassThrough's public method shape. `result.success` reads
// on the unknown resolution go through a `RouterResult` cast.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { ChildProcess } from "child_process";

const ServerMessageRouter: typeof import("../../src/helpers/serverMessageRouter").default = require("../../src/helpers/serverMessageRouter");
const MAX_ENTRY_AGE = 15 * 60 * 1000;

// [20260726_Tier3_ServerMessageRouterCoverageMigrate] Mock process shape:
// EventEmitter with PassThrough stdio. Cast to ChildProcess at the attach()
// call site so the source signature is satisfied without `any`.
interface MockProcess extends EventEmitter {
  stdin: PassThrough & { write: (...args: unknown[]) => boolean };
  stdout: PassThrough;
  stderr: PassThrough;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = new PassThrough() as MockProcess["stdin"];
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin.writable = true;
  return proc;
}

// [20260726_Tier3_ServerMessageRouterCoverageMigrate] Surface the router
// exposes to the suite: pending is private in source, but the cleanup test
// injects a stale entry directly.
interface PendingEntryShape {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  createdAt: number;
}
interface RouterPrivateSurface {
  pending: Map<string, PendingEntryShape>;
}

// [20260726_Tier3_ServerMessageRouterCoverageMigrate] Resolved promise
// shape the suite reads `.success` from.
interface RouterResult {
  success?: boolean;
}

describe("ServerMessageRouter - extended coverage", () => {
  let router: InstanceType<typeof ServerMessageRouter>;
  let proc: MockProcess;
  const logger = { info() {}, warn() {}, error() {}, debug() {} };

  beforeEach(() => {
    router = new ServerMessageRouter(logger);
    proc = createMockProcess();
  });

  afterEach(() => {
    router.detach();
  });

  it("ignores non-JSON stdout lines", async () => {
    router.attach(proc as unknown as ChildProcess);
    const promise = router.sendRaw({ action: "test" });

    const written = (await new Promise((resolve) => {
      proc.stdin.once("data", (d: Buffer) => resolve(JSON.parse(d.toString())));
    })) as { request_id: string };

    proc.stdout.push("not json\n");
    proc.stdout.push(
      JSON.stringify({ success: true, request_id: written.request_id }) + "\n",
    );

    const result = (await promise) as RouterResult;
    expect(result.success).toBe(true);
  });

  it("handles progress messages", async () => {
    router.attach(proc as unknown as ChildProcess);
    const onProgress = vi.fn();
    const promise = router.sendCommand(
      "transcribe",
      {},
      { onProgress, timeout: 5000 },
    );

    const written = (await new Promise((resolve) => {
      proc.stdin.once("data", (d: Buffer) => resolve(JSON.parse(d.toString())));
    })) as { request_id: string };

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
    const result = (await promise) as RouterResult;
    expect(result.success).toBe(true);
  });

  it("rejects all pending on process error", async () => {
    router.attach(proc as unknown as ChildProcess);
    const p1 = router.sendRaw({ action: "a" });
    const p2 = router.sendRaw({ action: "b" });

    proc.emit("error", new Error("crashed"));

    await expect(p1).rejects.toThrow("错误");
    await expect(p2).rejects.toThrow("错误");
  });

  it("sendCommand rejects when stdin not writable", async () => {
    router.attach(proc as unknown as ChildProcess);
    proc.stdin.writable = false;
    // [20260725_TDDFix_UnawaitedRejection] Add `await` — without it Vitest
    // emits "Promise returned by expect().rejects.toThrow() was not awaited"
    // which will fail in the next Vitest major. Guarded by the regression
    // test in rejection-assertions-awaited.test.ts.
    await expect(router.sendCommand("test")).rejects.toThrow("未就绪");
    // [20260725_TDDFix_UnawaitedRejection] END
  });

  it("sendRaw rejects when stdin not writable", async () => {
    router.attach(proc as unknown as ChildProcess);
    proc.stdin.writable = false;
    // [20260725_TDDFix_UnawaitedRejection] See note above.
    await expect(router.sendRaw({ action: "test" })).rejects.toThrow("未就绪");
    // [20260725_TDDFix_UnawaitedRejection] END
  });

  it("sendCommand uses default timeout", async () => {
    vi.useFakeTimers();
    router.attach(proc as unknown as ChildProcess);

    const promise = router.sendCommand("slow");
    vi.advanceTimersByTime(61000);

    await expect(promise).rejects.toThrow("超时");
    vi.useRealTimers();
  });

  it("sendCommand uses custom timeout error message", async () => {
    vi.useFakeTimers();
    router.attach(proc as unknown as ChildProcess);

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
    // [20260726_Tier3_ServerMessageRouterCoverageMigrate] Source ctor sig
    // is `(logger: Logger)`; passing undefined requires the unknown bridge.
    const r = new ServerMessageRouter(
      undefined as unknown as ConstructorParameters<
        typeof ServerMessageRouter
      >[0],
    );
    r.attach(proc as unknown as ChildProcess);
    r.detach();
  });

  it("dispatch ignores messages without request_id", async () => {
    router.attach(proc as unknown as ChildProcess);
    const promise = router.sendRaw({ action: "test" });

    proc.stdout.push(JSON.stringify({ no_id: true }) + "\n");

    const written = (await new Promise((resolve) => {
      proc.stdin.once("data", (d: Buffer) => resolve(JSON.parse(d.toString())));
    })) as { request_id: string };

    proc.stdout.push(
      JSON.stringify({ success: true, request_id: written.request_id }) + "\n",
    );
    const result = (await promise) as RouterResult;
    expect(result.success).toBe(true);
  });

  it("detach rejects pending requests", async () => {
    router.attach(proc as unknown as ChildProcess);
    const promise = router.sendRaw({ action: "test" });
    router.detach();
    await expect(promise).rejects.toThrow();
  });

  it("progress messages re-register with extended timeout", async () => {
    vi.useFakeTimers();
    router.attach(proc as unknown as ChildProcess);

    const onProgress = vi.fn();
    const promise = router.sendCommand(
      "transcribe",
      {},
      { onProgress, timeout: 5000 },
    );

    const written = (await new Promise((resolve) => {
      proc.stdin.once("data", (d: Buffer) => resolve(JSON.parse(d.toString())));
    })) as { request_id: string };

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
    const result = (await promise) as RouterResult;
    expect(result.success).toBe(true);

    vi.useRealTimers();
  });

  it("progress re-registered timer expires and rejects", async () => {
    vi.useFakeTimers();
    router.attach(proc as unknown as ChildProcess);

    const onProgress = vi.fn();
    const promise = router.sendCommand(
      "transcribe",
      {},
      { onProgress, timeout: 5000 },
    );

    const written = (await new Promise((resolve) => {
      proc.stdin.once("data", (d: Buffer) => resolve(JSON.parse(d.toString())));
    })) as { request_id: string };

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
    router.attach(proc as unknown as ChildProcess);

    const promise = router.sendCommand("transcribe", {}, { timeout: 5000 });

    vi.advanceTimersByTime(MAX_ENTRY_AGE + 61000);

    await expect(promise).rejects.toThrow();
    vi.useRealTimers();
  });

  it("sendRaw timeout rejects with server timeout message", async () => {
    vi.useFakeTimers();
    router.attach(proc as unknown as ChildProcess);

    const promise = router.sendRaw({ action: "test" });

    vi.advanceTimersByTime(61000);

    await expect(promise).rejects.toThrow("服务器响应超时");
    vi.useRealTimers();
  });

  it("progress message without onProgress callback is handled", async () => {
    router.attach(proc as unknown as ChildProcess);
    const promise = router.sendCommand("transcribe", {}, { timeout: 5000 });

    const written = (await new Promise((resolve) => {
      proc.stdin.once("data", (d: Buffer) => resolve(JSON.parse(d.toString())));
    })) as { request_id: string };

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
    const result = (await promise) as RouterResult;
    expect(result.success).toBe(true);
  });

  it("sendCommand rejects when stdin.write throws", async () => {
    router.attach(proc as unknown as ChildProcess);
    proc.stdin.write = (() => {
      throw new Error("EPIPE");
    }) as unknown as MockProcess["stdin"]["write"];
    await expect(router.sendCommand("test")).rejects.toThrow(
      "FunASR服务器写入失败",
    );
  });

  it("sendRaw rejects when stdin.write throws", async () => {
    router.attach(proc as unknown as ChildProcess);
    proc.stdin.write = (() => {
      throw new Error("EPIPE");
    }) as unknown as MockProcess["stdin"]["write"];
    await expect(router.sendRaw({ action: "test" })).rejects.toThrow(
      "FunASR服务器写入失败",
    );
  });

  it("_purgeExpired removes stale entries via cleanup interval", async () => {
    vi.useFakeTimers();
    router.attach(proc as unknown as ChildProcess);

    // [20260726_Tier3_ServerMessageRouterCoverageMigrate] Capture the reject
    // fn via a deferred so we can wire it into the manually injected entry;
    // tsc needs the binding initialized before use.
    let rejectFn: ((reason: Error) => void) | undefined;
    const promise = new Promise((_, rej) => {
      rejectFn = rej;
    });

    // Manually inject a stale entry into pending
    (router as unknown as RouterPrivateSurface).pending.set("stale-id", {
      resolve: vi.fn(),
      reject: rejectFn!,
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now() - MAX_ENTRY_AGE - 1000,
    });

    // Trigger the 60s cleanup interval
    vi.advanceTimersByTime(61000);

    await expect(promise).rejects.toThrow("请求超时（条目过期）");
    expect(
      (router as unknown as RouterPrivateSurface).pending.has("stale-id"),
    ).toBe(false);
    vi.useRealTimers();
  });
});
