import { eq, sql } from 'drizzle-orm';
import type { NormalisedLeague } from '@fantasyguru/sleeper';
import type { Database } from './client.js';
import { leagues, memberships } from './schema.js';

/**
 * build-plan.md S2 Decision 1: this is extracted from a per-user leagues-list response, not
 * from a standalone `/league/{id}` call -- the two are the same shape, confirmed live.
 */
export async function upsertLeague(db: Database, league: NormalisedLeague): Promise<void> {
  await db
    .insert(leagues)
    .values({
      sleeperLeagueId: league.sleeperLeagueId,
      name: league.name,
      season: league.season,
      totalRosters: league.totalRosters,
      rosterPositions: league.rosterPositions,
      scoringSettings: league.scoringSettings,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: leagues.sleeperLeagueId,
      set: {
        name: sql`excluded.name`,
        season: sql`excluded.season`,
        totalRosters: sql`excluded.total_rosters`,
        rosterPositions: sql`excluded.roster_positions`,
        scoringSettings: sql`excluded.scoring_settings`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}

/**
 * One statement for the whole batch, not one round trip per league. Same finding as
 * `upsertRosters` (build-plan.md S2 §2.9): a real account can carry 18+ leagues, and a
 * sequential per-row loop here measurably added to response time on every sync regardless
 * of cache status.
 */
export async function upsertLeagues(db: Database, leagueRows: NormalisedLeague[]): Promise<void> {
  if (leagueRows.length === 0) return;

  const now = new Date();

  await db
    .insert(leagues)
    .values(
      leagueRows.map((league) => ({
        sleeperLeagueId: league.sleeperLeagueId,
        name: league.name,
        season: league.season,
        totalRosters: league.totalRosters,
        rosterPositions: league.rosterPositions,
        scoringSettings: league.scoringSettings,
        syncedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: leagues.sleeperLeagueId,
      set: {
        name: sql`excluded.name`,
        season: sql`excluded.season`,
        totalRosters: sql`excluded.total_rosters`,
        rosterPositions: sql`excluded.roster_positions`,
        scoringSettings: sql`excluded.scoring_settings`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}

export interface StoredLeague {
  league: NormalisedLeague;
  syncedAt: Date;
}

/**
 * The `synced_at` fallback for `userLeagues` freshness (build-plan.md S2 Decision 4): the
 * leagues a registered user already has a `memberships` row for, from Postgres rather than
 * Sleeper. Used when the cache misses -- which a Redis outage looks identical to -- so a
 * user with a still-fresh membership set never has to wait on Sleeper at all.
 *
 * A brand-new user has no memberships yet and gets an empty array here, which is correct:
 * there is nothing to fall back to, and the caller must fetch from Sleeper regardless.
 */
export async function getLeaguesForUser(db: Database, userId: string): Promise<StoredLeague[]> {
  const rows = await db
    .select({
      sleeperLeagueId: leagues.sleeperLeagueId,
      name: leagues.name,
      season: leagues.season,
      totalRosters: leagues.totalRosters,
      rosterPositions: leagues.rosterPositions,
      scoringSettings: leagues.scoringSettings,
      syncedAt: leagues.syncedAt,
    })
    .from(memberships)
    .innerJoin(leagues, eq(memberships.leagueId, leagues.sleeperLeagueId))
    .where(eq(memberships.userId, userId));

  return rows
    .filter((row): row is typeof row & { syncedAt: Date } => row.syncedAt !== null)
    .map((row) => ({
      league: {
        sleeperLeagueId: row.sleeperLeagueId,
        name: row.name,
        season: row.season,
        totalRosters: row.totalRosters,
        rosterPositions: row.rosterPositions as string[] | null,
        scoringSettings: row.scoringSettings as Record<string, unknown> | null,
      },
      syncedAt: row.syncedAt,
    }));
}
