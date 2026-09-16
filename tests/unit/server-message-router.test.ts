// [20260726_Tier3_ServerMessageRouterMigrate] Migrated from .js to .ts as
// part of Tier 3 batch 3. Pattern: type the module-level `const
// ServerMessageRouter` via `typeof import("...").default`; type `let router`
// as the instance and `let proc` via a MockProcess intersection
// (EventEmitter + stdin/stdout/stderr PassThrough). The mock is cast to
// ChildProcess at the attach() call — PassThrough satisfies the stream
// subset the router touches. The `written` Promise result (JSON.parse →
// unknown) is cast to a WrittenMsg shape for the property accesses.
// Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { ChildProcess } from "child_process";
// [20260726_Tier32_ServerMessageRouter] Convert CJS require() → ESM default import.
import ServerMessageRouter from "../../src/helpers/serverMessageRouter";

// [20260726_Tier3_ServerMessageRouterMigrate] Mock process: an EventEmitter
// (for close/error) plus the three PassThrough streams the router reads/writes.
interface MockProcess extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
}

// [20260726_Tier3_ServerMessageRouterMigrate] Shape of messages written to
// stdin / resolved from stdout — JSON-parsed so typed via a structural cast.
interface WrittenMsg {
  action?: string;
  request_id?: string;
}

function createMockProcess(): MockProcess {
  // [20260726_Tier3_ServerMessageRouterMigrate] Build the mock then assert
  // the intersection shape: EventEmitter + assigned stream props.
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin.writable = true;
  return proc;
}

describe("ServerMessageRouter", () => {
  let router: InstanceType<typeof ServerMessageRouter>;
  let proc: MockProcess;
  const logger = { info() {}, warn() {}, error() {}, debug() {} };

  beforeEach(() => {
    router = new ServerMessageRouter(logger);
    proc = createMockProcess();
    // [20260726_Tier3_ServerMessageRouterMigrate] Cast MockProcess to the
    // ChildProcess attach() expects — PassThrough streams satisfy the
    // readable/writable + EventEmitter subset the router uses. `unknown`
    // bridge — no `any`.
    router.attach(proc as unknown as ChildProcess);
  });

  afterEach(() => {
    router.detach();
  });

  it("resolves sendRaw when matching request_id arrives", async () => {
    const promise = router.sendRaw({ action: "status" });

    const written = (await new Promise((resolve) => {
      proc.stdin.once("data", (d: Buffer) => resolve(JSON.parse(d.toString())));
    })) as WrittenMsg;

    expect(written.action).toBe("status");
    expect(written.request_id).toBeTruthy();

    proc.stdout.push(
      JSON.stringify({
        success: true,
        request_id: written.request_id,
      }) + "\n",
    );

    // [20260726_Tier3_ServerMessageRouterMigrate] sendRaw resolves unknown;
    // cast to the result shape the assertion reads.
    const result = (await promise) as { success: boolean; request_id: string };
    expect(result.success).toBe(true);
    expect(result.request_id).toBe(written.request_id);
  });

  it("resolves sendCommand with action and params", async () => {
    const promise = router.sendCommand("ping", {}, { timeout: 5000 });

    const written = (await new Promise((resolve) => {
      proc.stdin.once("data", (d: Buffer) => resolve(JSON.parse(d.toString())));
    })) as WrittenMsg;

    expect(written.action).toBe("ping");

    proc.stdout.push(
      JSON.stringify({
        success: true,
        action: "pong",
        request_id: written.request_id,
      }) + "\n",
    );

    const result = (await promise) as { action: string };
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

    const written = (await new Promise((resolve) => {
      proc.stdin.once("data", (d: Buffer) => resolve(JSON.parse(d.toString())));
    })) as WrittenMsg;

    proc.stdout.push(
      JSON.stringify({ success: true, request_id: "unknown-id" }) + "\n",
    );

    proc.stdout.push(
      JSON.stringify({
        success: true,
        request_id: written.request_id,
      }) + "\n",
    );

    const result = (await promise) as { request_id: string };
    expect(result.request_id).toBe(written.request_id);
  });

  it("rejects all pending when process closes", async () => {
    const p1 = router.sendRaw({ action: "a" });
    const p2 = router.sendRaw({ action: "b" });

    proc.emit("close");

    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();
  });

  it("rejects when server process is not attached", async () => {
    router.detach();
    // [20260725_TDDFix_UnawaitedRejection] Add `await` — without it Vitest
    // emits "Promise returned by expect().rejects.toThrow() was not awaited"
    // which will fail in the next Vitest major. Guarded by the regression
    // test in rejection-assertions-awaited.test.ts.
    await expect(router.sendCommand("test")).rejects.toThrow("未就绪");
    // [20260725_TDDFix_UnawaitedRejection] END
  });
});
