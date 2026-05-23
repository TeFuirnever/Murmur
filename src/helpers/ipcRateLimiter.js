const DEFAULT_MAX_CALLS = 30;
const DEFAULT_WINDOW_MS = 60_000;

function createRateLimitedHandler(handler, options = {}) {
  const maxCalls = options.maxCalls ?? DEFAULT_MAX_CALLS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

  const timestamps = [];

  return async function rateLimitedHandler(event, ...args) {
    const now = Date.now();
    const windowStart = now - windowMs;

    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= maxCalls) {
      return { success: false, error: "Rate limit exceeded" };
    }

    timestamps.push(now);
    return handler(event, ...args);
  };
}

module.exports = createRateLimitedHandler;
