import { describe, expect, it } from 'vitest';
import { Semaphore, TokenBucket, limited } from '../src/rate-limiter.js';
import type { Clock } from '../src/rate-limiter.js';

/**
 * build-plan.md S2 §2.9: "A rate limiter tested only against the real clock is not tested."
 * Every TokenBucket test here drives time explicitly through an injected clock -- no
 * setTimeout, no real elapsed time.
 */

class FakeClock implements Clock {
  private current = 0;
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

describe('TokenBucket', () => {
  it('starts full and exhausts exactly at capacity', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({ callsPerMinute: 5, clock });

    for (let i = 0; i < 5; i++) {
      expect(bucket.tryTake()).toBe(true);
    }
    expect(bucket.tryTake()).toBe(false);
  });

  it('refills continuously, not in discrete per-minute jumps', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({ callsPerMinute: 60, clock }); // 1/sec

    for (let i = 0; i < 60; i++) bucket.tryTake();
    expect(bucket.tryTake()).toBe(false);

    // Half the refill period should yield roughly half the tokens back, not zero and not all.
    clock.advance(30_000);
    expect(bucket.available()).toBeGreaterThanOrEqual(29);
    expect(bucket.available()).toBeLessThanOrEqual(31);

    clock.advance(30_000);
    expect(bucket.available()).toBe(60);
  });

  it('never exceeds capacity no matter how long it idles', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({ callsPerMinute: 800, clock });

    clock.advance(10 * 60_000); // ten idle minutes
    expect(bucket.available()).toBe(800);
  });

  it('never exceeds the configured budget over a simulated multi-minute sweep', () => {
    // build-plan.md S2 §2.11 item 5: "measured, not asserted." Simulate a sweep of 3,200
    // calls (the Decision-1 estimate for a full Sunday sweep) against an 800/min budget.
    const clock = new FakeClock();
    const bucket = new TokenBucket({ callsPerMinute: 800, clock });

    const callTimestamps: number[] = [];
    let calls = 0;
    const totalCalls = 3200;

    // Deterministic simulation: attempt a take every simulated millisecond; record when one
    // succeeds. This is the same self-pacing loop TokenBucket.take() performs, unrolled so
    // the test controls time itself rather than waiting on setTimeout.
    let elapsedMs = 0;
    const maxElapsedMs = 15 * 60_000; // fail the test if it would take > 15 minutes
    while (calls < totalCalls && elapsedMs < maxElapsedMs) {
      if (bucket.tryTake()) {
        callTimestamps.push(elapsedMs);
        calls += 1;
      } else {
        clock.advance(1);
        elapsedMs += 1;
      }
    }

    expect(calls).toBe(totalCalls);

    // A bucket starting FULL is entitled to one initial burst up to capacity (800) --
    // that is correct bucket semantics, not a leak, since a fresh process each day starts
    // with a full bucket. What must hold is the STEADY-STATE rate after that burst is
    // spent: every rolling 60s window measured from any point AFTER the first `capacity`
    // calls must not exceed capacity (+1 for float-refill rounding).
    const postBurstTimestamps = callTimestamps.slice(800);
    for (const start of postBurstTimestamps) {
      const windowEnd = start + 60_000;
      const inWindow = postBurstTimestamps.filter((t) => t >= start && t < windowEnd).length;
      expect(inWindow).toBeLessThanOrEqual(801);
    }

    // Analytically: capacity(800) admits instantly, then the remaining 2,400 calls drain at
    // exactly the refill rate -- 2400 / (800/60000 ms) = 180,000ms = 3 minutes. Confirmed by
    // an independent standalone simulation before writing this assertion.
    expect(elapsedMs / 60_000).toBeGreaterThan(2.9);
    expect(elapsedMs / 60_000).toBeLessThan(3.1);
  });
});

describe('Semaphore', () => {
  it('caps concurrent holders at the configured limit', async () => {
    const sem = new Semaphore(2);
    const release1 = await sem.acquire();
    const release2 = await sem.acquire();
    expect(sem.inFlight).toBe(2);

    let thirdAcquired = false;
    const thirdPromise = sem.acquire().then((release) => {
      thirdAcquired = true;
      return release;
    });

    // Give the microtask queue a tick; the third acquire must still be pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(thirdAcquired).toBe(false);

    release1();
    const release3 = await thirdPromise;
    expect(thirdAcquired).toBe(true);

    release2();
    release3();
    expect(sem.inFlight).toBe(0);
  });

  it('queues waiters in order', async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();

    const order: number[] = [];
    const p1 = sem.acquire().then((r) => {
      order.push(1);
      return r;
    });
    const p2 = sem.acquire().then((r) => {
      order.push(2);
      return r;
    });

    release();
    const r1 = await p1;
    r1();
    await p2;

    expect(order).toEqual([1, 2]);
  });
});

describe('limited', () => {
  it('gates a call through both the bucket and the semaphore', async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({ callsPerMinute: 1, clock });
    const sem = new Semaphore(1);

    // First call succeeds immediately (bucket starts full).
    const result = await limited(bucket, sem, async () => 'ok');
    expect(result).toBe('ok');
    expect(bucket.available()).toBe(0);
  });

  it('releases the semaphore even when fn throws', async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({ callsPerMinute: 10, clock });
    const sem = new Semaphore(1);

    await expect(
      limited(bucket, sem, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(sem.inFlight).toBe(0);
  });
});
