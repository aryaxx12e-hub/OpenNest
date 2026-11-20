export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: () => Date;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitResult;
  reset(key: string): void;
  cleanup(): void;
  size(): number;
}

interface Counter {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const counters = new Map<string, Counter>();
  const now = options.now ?? (() => new Date());

  function cleanup(): void {
    const timestamp = now().getTime();

    for (const [key, counter] of counters) {
      if (counter.resetAt <= timestamp) {
        counters.delete(key);
      }
    }
  }

  function consume(key: string): RateLimitResult {
    cleanup();

    const timestamp = now().getTime();
    let counter = counters.get(key);

    if (counter === undefined) {
      counter = {
        count: 0,
        resetAt: timestamp + options.windowMs,
      };
      counters.set(key, counter);
    }

    if (counter.count >= options.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((counter.resetAt - timestamp) / 1000)),
      };
    }

    counter.count += 1;

    return {
      allowed: true,
      remaining: Math.max(0, options.limit - counter.count),
      retryAfterSeconds: 0,
    };
  }

  return {
    consume,
    reset(key) {
      counters.delete(key);
    },
    cleanup,
    size() {
      return counters.size;
    },
  };
}
