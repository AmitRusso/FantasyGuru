import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Semaphore, SingleFlight, TokenBucket } from '@fantasyguru/sleeper';
import type {
  CacheStore,
  NormalisedLeague,
  NormalisedRoster,
  NormalisedUser,
} from '@fantasyguru/sleeper';
import {
  leagues as leaguesTable,
  schema,
  syncLog,
  upsertLeague,
  upsertMembership,
  upsertNflState,
  upsertUser,
  users as usersTable,
} from '@fantasyguru/db';
import type { Database } from '@fantasyguru/db';
import { NflStateNotSyncedError, syncUserLeagues } from '../src/services/league-sync.js';
import type { LeagueSyncDeps, SleeperReader } from '../src/services/league-sync.js';

/**
 * build-plan.md S2 §2.9: "the sync service against PGlite with a stubbed client: cache hit
 * skips the fetch, cache miss writes both stores, one league failing does not abort the
 * sweep, and concurrent misses for one league produce exactly one fetch."
 */

const migrationsFolder = fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url));

let client: PGlite;
let db: Database;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(db as never, { migrationsFolder });
});

beforeEach(async () => {
  await upsertNflState(db, { season: '2026', seasonType: 'regular', week: 6, displayWeek: 6 });
});

afterEach(async () => {
  // PGlite has no transactional test isolation wired here (Stage 1/2 use one shared instance
  // per test file), so each test that writes identity-bearing rows uses unique ids.
});

function inMemoryCache(): CacheStore {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => Promise.resolve((data.get(key) as T) ?? null),
    set: (key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

function alwaysMissCache(): CacheStore {
  return { get: () => Promise.resolve(null), set: () => Promise.resolve() };
}

async function countUsers(): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
  return rows[0]?.count ?? 0;
}

function noopLogger(): LeagueSyncDeps['logger'] {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as LeagueSyncDeps['logger'];
}

function baseDeps(overrides: Partial<LeagueSyncDeps> & { sleeper: SleeperReader }): LeagueSyncDeps {
  return {
    db,
    cache: inMemoryCache(),
    singleFlight: new SingleFlight(),
    bucket: new TokenBucket({ callsPerMinute: 10_000 }),
    semaphore: new Semaphore(10),
    logger: noopLogger(),
    ...overrides,
  };
}

function user(sleeperUserId: string, username: string): NormalisedUser {
  return { sleeperUserId, username, displayName: null };
}

function league(id: string, name: string): NormalisedLeague {
  return {
    sleeperLeagueId: id,
    name,
    season: '2026',
    totalRosters: 2,
    rosterPositions: ['QB', 'BN'],
    scoringSettings: null,
  };
}

function roster(
  rosterId: number,
  ownerUserId: string | null,
  starters: (string | null)[],
): NormalisedRoster {
  return {
    rosterId,
    ownerUserId,
    players: starters.filter((s): s is string => s !== null),
    starters,
    reserve: [],
    taxi: [],
  };
}

describe('syncUserLeagues', () => {
  it('returns not_found for an unknown username, and creates no user row', async () => {
    const sleeper: SleeperReader = {
      getUser: vi.fn().mockResolvedValue(null),
      getUserLeagues: vi.fn(),
      getLeagueRosters: vi.fn(),
    };

    const before = await countUsers();

    const result = await syncUserLeagues(baseDeps({ sleeper }), 'nobody');

    expect(result).toEqual({ status: 'not_found' });
    expect(await countUsers()).toBe(before);
  });

  it('throws NflStateNotSyncedError if Loop A has never run', async () => {
    // A separate, unseeded PGlite instance -- this one deliberately has no nfl_state row.
    const emptyClient = new PGlite();
    const emptyDb = drizzle(emptyClient, { schema }) as unknown as Database;
    await migrate(emptyDb as never, { migrationsFolder });

    const sleeper: SleeperReader = {
      getUser: vi.fn().mockResolvedValue(user('u-empty', 'someone')),
      getUserLeagues: vi.fn(),
      getLeagueRosters: vi.fn(),
    };

    await expect(syncUserLeagues(baseDeps({ db: emptyDb, sleeper }), 'someone')).rejects.toThrow(
      NflStateNotSyncedError,
    );

    await emptyClient.close();
  });

  it('on a cache miss, fetches from Sleeper and writes both the cache and Postgres', async () => {
    const getUserLeagues = vi.fn().mockResolvedValue({
      leagues: [league('league-miss', 'Miss League')],
      skipped: 0,
    });
    const sleeper: SleeperReader = {
      getUser: vi.fn().mockResolvedValue(user('u-miss', 'ghost')),
      getUserLeagues,
      getLeagueRosters: vi.fn().mockResolvedValue({
        rosters: [roster(1, 'u-miss', ['4983'])],
        skipped: 0,
      }),
    };
    const cache = inMemoryCache();

    const result = await syncUserLeagues(baseDeps({ sleeper, cache }), 'ghost');

    expect(result.status).toBe('ok');
    expect(getUserLeagues).toHaveBeenCalledTimes(1);
    expect(await cache.get('sleeper:v1:user:u-miss:leagues')).not.toBeNull();

    const [dbLeague] = await db
      .select()
      .from(leaguesTable)
      .where(eq(leaguesTable.sleeperLeagueId, 'league-miss'));
    expect(dbLeague?.name).toBe('Miss League');
  });

  it('on a cache hit, never calls Sleeper for the leagues list', async () => {
    const cache = inMemoryCache();
    await cache.set('sleeper:v1:user:u-hit:leagues', [league('league-hit', 'Hit League')], 60);

    const getUserLeagues = vi.fn();
    const sleeper: SleeperReader = {
      getUser: vi.fn().mockResolvedValue(user('u-hit', 'cached')),
      getUserLeagues,
      getLeagueRosters: vi.fn().mockResolvedValue({ rosters: [], skipped: 0 }),
    };

    const result = await syncUserLeagues(baseDeps({ sleeper, cache }), 'cached');

    expect(result.status).toBe('ok');
    expect(getUserLeagues).not.toHaveBeenCalled();
  });

  it('Decision 4: a cache miss (indistinguishable from Redis being down) falls back to a still-fresh Postgres row instead of hitting Sleeper', async () => {
    // Seed as if a prior sync already happened: a user, a league synced moments ago, and a
    // membership linking them.
    const { id: userId } = await upsertUser(db, user('u-fallback', 'returning'));
    await upsertLeague(db, league('league-fallback', 'Fallback League'));
    await upsertMembership(db, { userId, leagueId: 'league-fallback', rosterId: 1 });

    const getUserLeagues = vi.fn();
    const sleeper: SleeperReader = {
      getUser: vi.fn().mockResolvedValue(user('u-fallback', 'returning')),
      getUserLeagues, // must NOT be called -- the DB row is fresh
      getLeagueRosters: vi.fn().mockResolvedValue({
        rosters: [roster(1, 'u-fallback', ['4983'])],
        skipped: 0,
      }),
    };

    // alwaysMissCache simulates Redis being unreachable: every get() returns null, exactly
    // as a genuine cold cache would, which is the point of Decision 4's fallback.
    const result = await syncUserLeagues(
      baseDeps({ sleeper, cache: alwaysMissCache() }),
      'returning',
    );

    expect(result.status).toBe('ok');
    expect(getUserLeagues).not.toHaveBeenCalled();
  });

  it('one league failing does not abort the sweep, and is logged to sync_log', async () => {
    const sleeper: SleeperReader = {
      getUser: vi.fn().mockResolvedValue(user('u-partial', 'partial')),
      getUserLeagues: vi.fn().mockResolvedValue({
        leagues: [league('league-good', 'Good League'), league('league-bad', 'Bad League')],
        skipped: 0,
      }),
      getLeagueRosters: vi.fn().mockImplementation((leagueId: string) => {
        if (leagueId === 'league-bad') return Promise.reject(new Error('Sleeper 500'));
        return Promise.resolve({ rosters: [roster(1, 'u-partial', ['4983'])], skipped: 0 });
      }),
    };

    const result = await syncUserLeagues(baseDeps({ sleeper }), 'partial');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.leagues).toHaveLength(2);

    const good = result.leagues.find((l) => l.league.sleeperLeagueId === 'league-good');
    const bad = result.leagues.find((l) => l.league.sleeperLeagueId === 'league-bad');
    expect(good?.myRoster).not.toBeNull();
    expect(bad?.myRoster).toBeNull();

    const [failureLog] = await db
      .select()
      .from(syncLog)
      .where(
        and(
          eq(syncLog.job, 'league-rosters-sync'),
          eq(syncLog.target, 'league-bad'),
          eq(syncLog.outcome, 'failure'),
        ),
      );
    expect(failureLog?.error).toContain('Sleeper 500');
  });

  it('concurrent syncs sharing one league produce exactly one roster fetch for it', async () => {
    const sharedLeagueId = 'league-shared';
    // Deliberately slow: everything before this point (upsertUser, getNflState,
    // fetchUserLeagues) is real PGlite work with variable timing, so A and B do not reach
    // the shared singleFlight.run() call at exactly the same microtask. A short delay here
    // holds the first call "in flight" long enough that the second definitely arrives while
    // it is still pending, which is what actually exercises the dedup rather than letting
    // A finish (and its cache write land) before B even starts.
    const getLeagueRosters = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                rosters: [roster(1, 'u-a', ['4983']), roster(2, 'u-b', ['1234'])],
                skipped: 0,
              }),
            20,
          );
        }),
    );

    // Two different users, both in the same shared league, syncing concurrently -- exactly
    // the "fifty members of one league open the app at once" scenario from build-plan.md
    // S2 §2.4, driven through the real service rather than SingleFlight in isolation.
    const singleFlight = new SingleFlight();
    const cache = inMemoryCache();

    const sleeperA: SleeperReader = {
      getUser: vi.fn().mockResolvedValue(user('u-a', 'alice')),
      getUserLeagues: vi
        .fn()
        .mockResolvedValue({ leagues: [league(sharedLeagueId, 'Shared')], skipped: 0 }),
      getLeagueRosters,
    };
    const sleeperB: SleeperReader = {
      getUser: vi.fn().mockResolvedValue(user('u-b', 'bob')),
      getUserLeagues: vi
        .fn()
        .mockResolvedValue({ leagues: [league(sharedLeagueId, 'Shared')], skipped: 0 }),
      getLeagueRosters,
    };

    await Promise.all([
      syncUserLeagues(baseDeps({ sleeper: sleeperA, singleFlight, cache }), 'alice'),
      syncUserLeagues(baseDeps({ sleeper: sleeperB, singleFlight, cache }), 'bob'),
    ]);

    expect(getLeagueRosters).toHaveBeenCalledTimes(1);
  });
});
