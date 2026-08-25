import { describe, expect, it, vi } from 'vitest';
import { CacheKeys, SingleFlight, failOpen } from '../src/cache.js';
import type { CacheStore } from '../src/cache.js';

/**
 * build-plan.md S2 §2.9: "cache hit skips the fetch, cache miss writes both stores" is
 * exercised at the sync-service level (apps/api); this package's own responsibility is that
 * Redis itself can never throw past the boundary, and that concurrent misses collapse to one
 * fetch. Both are unit-testable with an in-memory fake, no real Upstash credentials needed.
 */

function inMemoryStore(): CacheStore {
  const data = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async get<T>(key: string): Promise<T | null> {
      const entry = data.get(key);
      if (!entry || entry.expiresAt < Date.now()) return null;
      return entry.value as T;
    },
    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      data.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
  };
}

describe('CacheKeys', () => {
  it('keys league-scoped reads by league, per build-plan.md S2 §2.4', () => {
    expect(CacheKeys.leagueRosters('abc')).toBe('sleeper:v1:league:abc:rosters');
    expect(CacheKeys.leagueUsers('abc')).toBe('sleeper:v1:league:abc:users');
    expect(CacheKeys.leagueMatchups('abc', 6)).toBe('sleeper:v1:league:abc:matchups:6');
  });

  it('keys the leagues-list read by user -- the one call that is unavoidably per-user', () => {
    expect(CacheKeys.userLeagues('u1')).toBe('sleeper:v1:user:u1:leagues');
  });

  it('carries a version prefix as a manual kill switch', () => {
    expect(CacheKeys.leagueRosters('abc')).toMatch(/^sleeper:v1:/);
  });
});

describe('failOpen', () => {
  it('passes reads and writes through to a healthy store', async () => {
    const store = inMemoryStore();
    const safe = failOpen(store);

    await safe.set('k', { hello: 'world' }, 60);
    expect(await safe.get('k')).toEqual({ hello: 'world' });
  });

  it('returns null on a read failure instead of throwing -- Decision 4, "fails open"', async () => {
    const broken: CacheStore = {
      get: () => Promise.reject(new Error('ECONNREFUSED')),
      set: () => Promise.resolve(),
    };
    const logger = { warn: vi.fn() };
    const safe = failOpen(broken, logger);

    await expect(safe.get('k')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'k', op: 'get' }));
  });

  it('swallows a write failure rather than throwing -- a cache write must never break a sync', async () => {
    const broken: CacheStore = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('rate limited')),
    };
    const logger = { warn: vi.fn() };
    const safe = failOpen(broken, logger);

    await expect(safe.set('k', 'v', 60)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'k', op: 'set' }));
  });
});

describe('SingleFlight', () => {
  it('collapses concurrent calls for the same key into one execution', async () => {
    const sf = new SingleFlight();
    let executions = 0;

    const fn = () =>
      new Promise<string>((resolve) => {
        executions += 1;
        setTimeout(() => resolve('result'), 10);
      });

    // Fifty members of one league opening the app at once (build-plan.md S2 §2.4).
    const results = await Promise.all(Array.from({ length: 50 }, () => sf.run('league-1', fn)));

    expect(executions).toBe(1);
    expect(results).toEqual(Array(50).fill('result'));
  });

  it('does not collapse calls for different keys', async () => {
    const sf = new SingleFlight();
    let executions = 0;
    const fn = () => {
      executions += 1;
      return Promise.resolve('ok');
    };

    await Promise.all([sf.run('a', fn), sf.run('b', fn), sf.run('c', fn)]);
    expect(executions).toBe(3);
  });

  it('runs a fresh execution once the previous one has settled', async () => {
    const sf = new SingleFlight();
    let executions = 0;
    const fn = () => {
      executions += 1;
      return Promise.resolve(executions);
    };

    expect(await sf.run('k', fn)).toBe(1);
    expect(await sf.run('k', fn)).toBe(2);
    expect(executions).toBe(2);
  });

  it('clears the in-flight entry even when the call rejects', async () => {
    const sf = new SingleFlight();
    await expect(sf.run('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(sf.pending).toBe(0);

    // A retry after the failure must actually re-run, not replay the rejection forever.
    await expect(sf.run('k', () => Promise.resolve('recovered'))).resolves.toBe('recovered');
  });
});
