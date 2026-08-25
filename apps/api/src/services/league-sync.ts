import {
  getLeaguesForUser,
  getNflState,
  getRostersForLeague,
  getRostersSyncedAt,
  recordSync,
  upsertLeagues,
  upsertMembership,
  upsertRosters,
  upsertUser,
} from '@fantasyguru/db';
import type { Database } from '@fantasyguru/db';
import { CacheKeys, limited, ttlSeconds } from '@fantasyguru/sleeper';
import type {
  CacheStore,
  NormalisedLeague,
  NormalisedLeaguesResult,
  NormalisedRoster,
  NormalisedRostersResult,
  NormalisedUser,
  Semaphore,
  SingleFlight,
  TokenBucket,
} from '@fantasyguru/sleeper';
import type { FastifyBaseLogger } from 'fastify';

/**
 * The sync service (build-plan.md S2 §2.1-§2.6). Orchestrates the client, the cache, the
 * rate limiter and the DB writers -- the one place all of those meet, which is why this
 * lives in apps/api rather than in packages/sleeper or packages/db.
 */

export class NflStateNotSyncedError extends Error {
  constructor() {
    super('nfl_state has no row yet -- Loop A (Stage 1) has not run');
    this.name = 'NflStateNotSyncedError';
  }
}

/**
 * Only the three Sleeper calls this service makes. `SleeperClient` satisfies this
 * structurally, but depending on the narrower interface (rather than the concrete class,
 * which has private fields) is what lets a test stand up a stub without touching the
 * network -- a plain object cannot satisfy a class type with private members, but it can
 * satisfy an interface.
 */
export interface SleeperReader {
  getUser(username: string): Promise<NormalisedUser | null>;
  getUserLeagues(userId: string, season: string): Promise<NormalisedLeaguesResult>;
  getLeagueRosters(leagueId: string): Promise<NormalisedRostersResult>;
}

export interface LeagueSyncDeps {
  db: Database;
  sleeper: SleeperReader;
  cache: CacheStore;
  singleFlight: SingleFlight;
  bucket: TokenBucket;
  semaphore: Semaphore;
  logger: FastifyBaseLogger;
}

export interface LeagueWithRoster {
  league: NormalisedLeague;
  /** The roster this user owns in this league, or null if none was found (spec §2.5). */
  myRoster: NormalisedRoster | null;
}

export type SyncUserLeaguesResult =
  | { status: 'not_found' }
  | { status: 'ok'; userId: string; sleeperUserId: string; leagues: LeagueWithRoster[] };

/**
 * Endpoint 2 (`GET /user/{id}/leagues/nfl/{season}`), with the Decision-4 fallback: a cache
 * miss (genuine or a Redis outage look identical from here) checks Postgres before ever
 * touching Sleeper, so a user with a still-fresh membership set never waits on the network.
 */
async function fetchUserLeagues(
  deps: LeagueSyncDeps,
  sleeperUserId: string,
  season: string,
  userId: string,
): Promise<NormalisedLeague[]> {
  const key = CacheKeys.userLeagues(sleeperUserId);

  const cached = await deps.cache.get<NormalisedLeague[]>(key);
  if (cached) return cached;

  const ttl = ttlSeconds('userLeagues');
  const stored = await getLeaguesForUser(deps.db, userId);
  if (stored.length > 0) {
    const oldestMs = Math.min(...stored.map((s) => s.syncedAt.getTime()));
    if (Date.now() - oldestMs < ttl * 1000) {
      const leagues = stored.map((s) => s.league);
      await deps.cache.set(key, leagues, ttl);
      return leagues;
    }
  }

  const startedAt = new Date();
  const t0 = performance.now();
  try {
    const result = await deps.singleFlight.run(key, () =>
      limited(deps.bucket, deps.semaphore, () =>
        deps.sleeper.getUserLeagues(sleeperUserId, season),
      ),
    );
    await deps.cache.set(key, result.leagues, ttl);
    await recordSync(deps.db, {
      job: 'user-leagues-sync',
      target: `user:${sleeperUserId}`,
      startedAt,
      durationMs: Math.round(performance.now() - t0),
      outcome: 'success',
      rowsAffected: result.leagues.length,
      missingFields: result.skipped,
    });
    return result.leagues;
  } catch (error) {
    await recordSync(deps.db, {
      job: 'user-leagues-sync',
      target: `user:${sleeperUserId}`,
      startedAt,
      durationMs: Math.round(performance.now() - t0),
      outcome: 'failure',
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    throw error;
  }
}

/**
 * Endpoint 4 (`GET /league/{id}/rosters`) with the same Decision-4 fallback. Per-league, so a
 * failure here (spec §2.5) is caught by the CALLER -- syncOneLeague -- rather than here, so it
 * can be logged with the right context and the sweep can move to the next league.
 */
async function fetchLeagueRosters(
  deps: LeagueSyncDeps,
  leagueId: string,
): Promise<NormalisedRoster[]> {
  const key = CacheKeys.leagueRosters(leagueId);

  const cached = await deps.cache.get<NormalisedRoster[]>(key);
  if (cached) return cached;

  const ttl = ttlSeconds('leagueRosters');
  const syncedAt = await getRostersSyncedAt(deps.db, leagueId);
  if (syncedAt && Date.now() - syncedAt.getTime() < ttl * 1000) {
    const rosters = await getRostersForLeague(deps.db, leagueId);
    if (rosters.length > 0) {
      await deps.cache.set(key, rosters, ttl);
      return rosters;
    }
  }

  const result = await deps.singleFlight.run(key, () =>
    limited(deps.bucket, deps.semaphore, () => deps.sleeper.getLeagueRosters(leagueId)),
  );
  await deps.cache.set(key, result.rosters, ttl);
  return result.rosters;
}

/**
 * One league: rosters, plus the membership row if this user owns one of them. Failures are
 * caught and logged per-league (spec §2.5: "a single league failing must not abort the
 * sweep") rather than propagated, so one bad league cannot take down a user's whole sync.
 */
async function syncOneLeague(
  deps: LeagueSyncDeps,
  league: NormalisedLeague,
  sleeperUserId: string,
  userId: string,
): Promise<LeagueWithRoster> {
  const startedAt = new Date();
  const t0 = performance.now();

  try {
    const rosters = await fetchLeagueRosters(deps, league.sleeperLeagueId);
    await upsertRosters(deps.db, league.sleeperLeagueId, rosters);

    const myRoster = rosters.find((r) => r.ownerUserId === sleeperUserId) ?? null;
    if (myRoster) {
      await upsertMembership(deps.db, {
        userId,
        leagueId: league.sleeperLeagueId,
        rosterId: myRoster.rosterId,
      });
    }

    await recordSync(deps.db, {
      job: 'league-rosters-sync',
      target: league.sleeperLeagueId,
      startedAt,
      durationMs: Math.round(performance.now() - t0),
      outcome: 'success',
      rowsAffected: rosters.length,
    });

    return { league, myRoster };
  } catch (error) {
    deps.logger.error(
      { err: error, leagueId: league.sleeperLeagueId },
      'league sync failed; continuing sweep',
    );
    await recordSync(deps.db, {
      job: 'league-rosters-sync',
      target: league.sleeperLeagueId,
      startedAt,
      durationMs: Math.round(performance.now() - t0),
      outcome: 'failure',
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return { league, myRoster: null };
  }
}

/**
 * The whole onboarding path (spec §2.1): username in, that person's leagues and their own
 * roster in each, out. Backs `GET /v1/users/{username}/leagues`.
 */
export async function syncUserLeagues(
  deps: LeagueSyncDeps,
  username: string,
): Promise<SyncUserLeaguesResult> {
  const sleeperUser = await limited(deps.bucket, deps.semaphore, () =>
    deps.sleeper.getUser(username),
  );
  if (!sleeperUser) return { status: 'not_found' };

  const { id: userId } = await upsertUser(deps.db, sleeperUser);

  const state = await getNflState(deps.db);
  if (!state) throw new NflStateNotSyncedError();

  const leagues = await fetchUserLeagues(deps, sleeperUser.sleeperUserId, state.season, userId);
  await upsertLeagues(deps.db, leagues);

  // Parallel, not sequential: a real account can carry a dozen-plus leagues (measured
  // against a live Sleeper account, 25 Aug 2026: 18 for the current season alone), and
  // spec §2.1 promises the whole onboarding path in "under ten seconds." Awaiting one
  // league at a time defeats the entire point of the Semaphore(10) built for exactly this
  // -- it bounds how many are in flight at once, so the sweep IS the concurrency control;
  // sequencing it manually on top only serialises what the semaphore already governs.
  const results = await Promise.all(
    leagues.map((league) => syncOneLeague(deps, league, sleeperUser.sleeperUserId, userId)),
  );

  return {
    status: 'ok',
    userId,
    sleeperUserId: sleeperUser.sleeperUserId,
    leagues: results,
  };
}
