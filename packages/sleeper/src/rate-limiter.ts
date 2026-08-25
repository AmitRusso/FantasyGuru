/**
 * Throughput and concurrency limits for calls to Sleeper (build-plan.md S2 §2.1, Decisions 2
 * and 5).
 *
 * These are deliberately two different mechanisms:
 *
 *   - TokenBucket bounds CALLS PER MINUTE. This is the real limit -- Sleeper's published
 *     guidance is to stay under 1,000/min or risk an IP block (spec §2.3), and this is what
 *     keeps the sweep legal.
 *   - Semaphore bounds IN-FLIGHT REQUESTS. Concurrency is not throughput: at 150ms/call,
 *     concurrency 10 alone is ~4,000/min -- four times the ceiling. Semaphore keeps sockets
 *     and memory sane; TokenBucket keeps the process legal. Neither substitutes for the
 *     other.
 *
 * Both accept an injected clock so they are testable without the real clock (§2.9) --
 * "a rate limiter tested only against the real clock is not tested."
 */

export interface Clock {
  now(): number;
}

export const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

export interface TokenBucketOptions {
  /** Default 800/min: a 20% margin under Sleeper's published 1,000/min ceiling (spec §2.3). */
  callsPerMinute?: number;
  clock?: Clock;
}

/**
 * Classic token bucket: capacity equals the per-minute budget, refilling continuously
 * (fractionally, not in discrete per-minute chunks) so the limiter is smooth rather than
 * bursty at minute boundaries.
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly clock: Clock;
  private tokens: number;
  private lastRefillAt: number;

  constructor(options: TokenBucketOptions = {}) {
    this.capacity = options.callsPerMinute ?? 800;
    this.refillPerMs = this.capacity / 60_000;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.tokens = this.capacity;
    this.lastRefillAt = this.clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsedMs = Math.max(0, now - this.lastRefillAt);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * this.refillPerMs);
    this.lastRefillAt = now;
  }

  /** Non-blocking check: true and consumes a token if one is available, false otherwise. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** How many whole tokens are available right now, for observability. */
  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Blocks the caller until a token is available, then consumes it. Used by the sync
   * service so a sweep self-paces instead of needing an external scheduler loop.
   */
  async take(): Promise<void> {
    for (;;) {
      if (this.tryTake()) return;
      // Sleep for roughly the time until the next token, with a floor so this cannot busy-loop.
      const msPerToken = 1 / this.refillPerMs;
      await new Promise((resolve) => setTimeout(resolve, Math.max(5, msPerToken / 4)));
    }
  }
}

/** Caps the number of requests in flight at once. Deliberately independent of TokenBucket. */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    this.available = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.available -= 1;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  /** For observability / tests. */
  get inFlight(): number {
    return this.limit - this.available;
  }
}

/**
 * Runs `fn` through both gates: waits for a token (throughput) and a semaphore slot
 * (concurrency), in that order, so a burst of callers queues on the cheaper check first.
 */
export async function limited<T>(
  bucket: TokenBucket,
  semaphore: Semaphore,
  fn: () => Promise<T>,
): Promise<T> {
  await bucket.take();
  const release = await semaphore.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
