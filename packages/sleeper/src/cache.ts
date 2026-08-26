/**
 * The Redis side of caching (build-plan.md S2 §2.1 Decision 4, §2.4).
 *
 * This module has no Postgres dependency, deliberately: `packages/sleeper` stays a typed
 * client plus its own supporting infrastructure, and the "fall back to `synced_at` when Redis
 * is unreachable" decision needs both stores at once, so it lives in the sync service in
 * `apps/api`, not here. What belongs here is making Redis itself impossible to depend on
 * unsafely: every read and write is fail-open by construction.
 */

export interface CacheStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export interface CacheLogger {
  warn(context: { key: string; op: 'get' | 'set'; error: unknown }): void;
}

const NOOP_LOGGER: CacheLogger = { warn: () => undefined };

/**
 * Wraps a `CacheStore` so neither method can throw. A read failure returns `null` (a cache
 * miss, indistinguishable from a cold key) and a write failure is swallowed after being
 * logged. This is Decision 4's "fails open" made structural: the caller cannot forget to
 * catch a Redis outage, because there is nothing to catch.
 */
export function failOpen(store: CacheStore, logger: CacheLogger = NOOP_LOGGER): CacheStore {
  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        return await store.get<T>(key);
      } catch (error) {
        logger.warn({ key, op: 'get', error });
        return null;
      }
    },
    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      try {
        await store.set(key, value, ttlSeconds);
      } catch (error) {
        logger.warn({ key, op: 'set', error });
      }
    },
  };
}

/**
 * Cache keys (build-plan.md S2 §2.4). The `v1:` segment is a manual kill switch -- bumping it
 * invalidates everything at once if a normaliser's shape ever changes, without waiting out a
 * TTL or flushing a shared database.
 *
 * There is no standalone `league:{id}` key. Decision 1 established that the per-user
 * leagues-list response already carries full league settings, so nothing in the routine
 * sweep ever needs to cache a standalone league fetch.
 */
export const CacheKeys = {
  userLeagues: (userId: string): string => `sleeper:v1:user:${userId}:leagues`,
  /**
   * v2, not v1, and the bump is load-bearing rather than cosmetic.
   *
   * What Redis holds under this key is a `NormalisedRoster[]`, not the raw Sleeper payload --
   * so when that TYPE gains a field, every entry already in the cache is a stale shape.
   * Stage 4 added `reserve` and `taxi` (build-plan.md S4 Decision 5), and without a bump the
   * deploy would spend one TTL window writing rosters whose IR and taxi lists silently came
   * back `undefined` -- which is precisely the wrong answer for the rule that reads them.
   *
   * Only this key changed shape, which is why only this one is v2.
   */
  leagueRosters: (leagueId: string): string => `sleeper:v2:league:${leagueId}:rosters`,
  leagueUsers: (leagueId: string): string => `sleeper:v1:league:${leagueId}:users`,
  leagueMatchups: (leagueId: string, week: number): string =>
    `sleeper:v1:league:${leagueId}:matchups:${week}`,
} as const;

/**
 * Deduplicates concurrent calls that share a key, so fifty members of one league opening the
 * app on a cold cache produce one upstream fetch, not fifty (build-plan.md S2 §2.4).
 *
 * In-process only, which is sufficient while exactly one machine runs (Decision 5). It moves
 * to a Redis lock at the same time the rate limiter does.
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** For observability / tests. */
  get pending(): number {
    return this.inFlight.size;
  }
}
