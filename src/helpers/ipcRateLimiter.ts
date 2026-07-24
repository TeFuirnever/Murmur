// [20260724_TS_Migration_IpcRateLimiter] Migrated from .js to .ts (ADR-010 Phase 2).
// Pure logic — no external dependencies.

const DEFAULT_MAX_CALLS = 30;
const DEFAULT_WINDOW_MS = 60_000;

/** Options for creating a rate-limited handler. */
interface RateLimitOptions {
  maxCalls?: number;
  windowMs?: number;
}

/** An IPC handler function signature. */
type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

/**
 * Wrap an IPC handler with a sliding-window rate limiter.
 * Returns a new function that rejects calls exceeding the limit.
 */
function createRateLimitedHandler(
  handler: IpcHandler,
  options: RateLimitOptions = {},
): IpcHandler {
  const maxCalls = options.maxCalls ?? DEFAULT_MAX_CALLS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

  const timestamps: number[] = [];

  return async function rateLimitedHandler(
    event: unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    const now = Date.now();
    const windowStart = now - windowMs;

    while (timestamps.length > 0 && timestamps[0]! < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= maxCalls) {
      return { success: false, error: "Rate limit exceeded" };
    }

    timestamps.push(now);
    return handler(event, ...args);
  };
}

export default createRateLimitedHandler;
