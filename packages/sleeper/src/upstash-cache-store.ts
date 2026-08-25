import { Redis } from '@upstash/redis';
import type { CacheStore } from './cache.js';

/**
 * The real `CacheStore`, backed by Upstash's REST-based Redis (spec §1: "HTTP-based, no
 * connection pooling pain"). Kept as a thin adapter so every test in this package exercises
 * `CacheStore` against an in-memory fake instead -- this file has no tests of its own because
 * there is nothing here to unit test that would not just be re-testing the SDK.
 */
export function createUpstashCacheStore(url: string, token: string): CacheStore {
  const redis = new Redis({ url, token });

  return {
    async get<T>(key: string): Promise<T | null> {
      const value = await redis.get<T>(key);
      return value ?? null;
    },
    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      await redis.set(key, value, { ex: ttlSeconds });
    },
  };
}
