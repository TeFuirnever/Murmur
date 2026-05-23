import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ipcRateLimiter", () => {
  let createRateLimitedHandler;

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
    const result = await limited({}, "c");

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
    const result = await limited({}, "extra");
    expect(result.success).toBe(false);
  });
});
