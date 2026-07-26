// [20260726_Tier3_IpcRateLimiterMigrate] Migrated from .js to .ts as part
// of Tier 3 batch 4. Pattern: typed `let createRateLimitedHandler` via
// `typeof import("...").default` (TS7034) since the source uses
// `export default`. The handler's return type is `Promise<unknown>` (the
// source's IpcHandler), so test reads of `.success`/`.error` on the rate-
// limited branch are bridged via a small `RateLimitResult` structural cast —
// the under-limit branch returns whatever the wrapped handler returned
// (string here), so each call site picks the right union member via the
// assertion flow. Template reference: phase4-i18n.test.ts (commit d52f2e0).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// [20260726_Tier3_IpcRateLimiterMigrate] The over-limit branch returns this
// shape from the source. Tests reading `.success`/`.error` cast the unknown
// result through this type.
interface RateLimitResult {
  success: boolean;
  error: string;
}

describe("ipcRateLimiter", () => {
  // [20260726_Tier3_IpcRateLimiterMigrate] Default export of a function.
  let createRateLimitedHandler: typeof import("../../src/helpers/ipcRateLimiter").default;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    createRateLimitedHandler = require("../../src/helpers/ipcRateLimiter");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows calls within rate limit", async () => {
    const handler = vi.fn(async () => "ok");
    const limited = createRateLimitedHandler(handler, {
      maxCalls: 3,
      windowMs: 1000,
    });

    for (let i = 0; i < 3; i++) {
      const result = await limited({}, "arg");
      expect(result).toBe("ok");
    }
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("blocks calls exceeding rate limit", async () => {
    const handler = vi.fn(async () => "ok");
    const limited = createRateLimitedHandler(handler, {
      maxCalls: 2,
      windowMs: 1000,
    });

    await limited({}, "a");
    await limited({}, "b");
    const result = (await limited({}, "c")) as RateLimitResult;

    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate/i);
  });

  it("resets after window expires", async () => {
    const handler = vi.fn(async () => "ok");
    const limited = createRateLimitedHandler(handler, {
      maxCalls: 2,
      windowMs: 1000,
    });

    await limited({}, "a");
    await limited({}, "b");
    await limited({}, "c"); // blocked

    vi.advanceTimersByTime(1001);
    const result = await limited({}, "d");
    expect(result).toBe("ok");
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("passes through event and arguments", async () => {
    const handler = vi.fn(async () => "ok");
    const limited = createRateLimitedHandler(handler, {
      maxCalls: 5,
      windowMs: 1000,
    });

    const event = { sender: "test" };
    await limited(event, "arg1", "arg2");
    expect(handler).toHaveBeenCalledWith(event, "arg1", "arg2");
  });

  it("defaults to 30 calls per 60 seconds", async () => {
    const handler = vi.fn(async () => "ok");
    const limited = createRateLimitedHandler(handler);

    // 30 calls should all succeed
    for (let i = 0; i < 30; i++) {
      await limited({}, i);
    }
    // 31st should fail
    const result = (await limited({}, "extra")) as RateLimitResult;
    expect(result.success).toBe(false);
  });

  // [20260725_TDD_IpcRateLimiter] Explicit execution-path coverage for the
  // returned rateLimitedHandler closure (line 29+ in ipcRateLimiter.ts).
  // Targets the function-coverage gap that remained at 50%.
  describe("rateLimitedHandler execution path", () => {
    it("calls the wrapped handler and returns its result when under limit", async () => {
      const handler = vi.fn(
        async (_event: unknown, arg: unknown) => `result:${arg}`,
      );
      const limited = createRateLimitedHandler(handler, {
        maxCalls: 5,
        windowMs: 1000,
      });

      // Under limit → handler invoked, return value passes through.
      const result = await limited({ id: 1 }, "payload");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ id: 1 }, "payload");
      expect(result).toBe("result:payload");
    });

    it('returns { success: false, error: "Rate limit exceeded" } when over limit', async () => {
      const handler = vi.fn(async () => "ok");
      const limited = createRateLimitedHandler(handler, {
        maxCalls: 1,
        windowMs: 1000,
      });

      // First call fills the window; second call must be rejected.
      await limited({}, "first");
      const blocked = await limited({}, "second");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(blocked).toEqual({
        success: false,
        error: "Rate limit exceeded",
      });
    });

    it("clears old timestamps after the window expires and allows calls again", async () => {
      const handler = vi.fn(async () => "ok");
      const limited = createRateLimitedHandler(handler, {
        maxCalls: 2,
        windowMs: 1000,
      });

      // Exhaust the limit at t=0.
      await limited({}, "a");
      await limited({}, "b");
      // Now blocked — would return rate-limit error.
      const blocked = (await limited({}, "c")) as RateLimitResult;
      expect(blocked.success).toBe(false);

      // Advance past the window so stale timestamps get shifted out of the
      // sliding window (the while-loop at line 36-38).
      vi.advanceTimersByTime(1500);

      // After expiry, fresh calls must succeed again.
      const result = await limited({}, "d");
      expect(result).toBe("ok");
      expect(handler).toHaveBeenCalledTimes(3); // a, b, d (c was blocked)
    });
  });
});
