import { eq, sql } from 'drizzle-orm';
import type { NormalisedRoster } from '@fantasyguru/sleeper';
import type { Database } from './client.js';
import { rosters } from './schema.js';

/**
 * `starters[]` is the alarm's actual input (spec §3, rules 1-3) -- this is the highest-churn
 * write in Stage 2, refreshed on the time-of-week TTL from build-plan.md S2 §2.3.
 *
 * No delete path, matching Stage 1's players table: a roster that temporarily 404s or a team
 * removed mid-season should not vanish out from under a `memberships` row that still points
 * at it.
 */
/**
 * The `synced_at` fallback for `leagueRosters` freshness (build-plan.md S2 Decision 4). The
 * oldest `synced_at` among a league's rosters, conservatively: every roster in one sweep is
 * written in the same batch, so using the oldest rather than the newest never reports a
 * league fresher than its slowest-written row actually is.
 */
export async function getRostersSyncedAt(db: Database, leagueId: string): Promise<Date | null> {
  const rows = await db
    .select({ syncedAt: rosters.syncedAt })
    .from(rosters)
    .where(eq(rosters.leagueId, leagueId));

  const timestamps = rows
    .map((r) => r.syncedAt)
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());

  return timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
}

/** Reconstructs `NormalisedRoster[]` from Postgres -- the read half of the Decision 4 fallback. */
export async function getRostersForLeague(
  db: Database,
  leagueId: string,
): Promise<NormalisedRoster[]> {
  const rows = await db
    .select({
      rosterId: rosters.rosterId,
      ownerUserId: rosters.ownerUserId,
      players: rosters.players,
      starters: rosters.starters,
      reserve: rosters.reserve,
      taxi: rosters.taxi,
    })
    .from(rosters)
    .where(eq(rosters.leagueId, leagueId));

  return rows.map((row) => ({
    rosterId: row.rosterId,
    ownerUserId: row.ownerUserId,
    players: row.players ?? [],
    starters: row.starters ?? [],
    reserve: row.reserve ?? [],
    taxi: row.taxi ?? [],
  }));
}

/**
 * One statement for the whole league, not one per roster.
 *
 * Found by actually running the public route end to end against a real 18-team-league
 * account (build-plan.md S2 §2.9): a per-row loop here dominated response time regardless of
 * whether the roster data came from a cache hit or a fresh Sleeper fetch -- a *cached* repeat
 * request still took ~11s, because this function re-wrote every roster row one sequential
 * remote round trip at a time, unconditionally, on every call. Batched into one multi-row
 * `INSERT ... VALUES ... ON CONFLICT` (here and in the matching fix to `upsertLeagues`), the
 * same 18-league sweep measured at 14.3s cold / 11.4s warm dropped to 5.1s cold / 2.1s warm --
 * a 5.4x improvement on the cache-hit path, which is what the "materially faster" acceptance
 * criterion (§2.11 item 3) actually requires. Same pattern as Stage 1's `upsertPlayers`.
 */
export async function upsertRosters(
  db: Database,
  leagueId: string,
  rosterRows: NormalisedRoster[],
): Promise<void> {
  if (rosterRows.length === 0) return;

  const now = new Date();

  await db
    .insert(rosters)
    .values(
      rosterRows.map((roster) => ({
        leagueId,
        rosterId: roster.rosterId,
        ownerUserId: roster.ownerUserId,
        players: roster.players,
        // Drizzle types a `text().array()` column as `string[]`, with no way to declare
        // nullable elements -- but Postgres itself has no such restriction on a plain
        // TEXT[] column, and an empty starting slot IS a null element (spec §3 rule 1,
        // confirmed live 25 Aug 2026 as the string "0" -- see build-plan.md S2 §2.8 item 2).
        // The cast corrects a type-level gap, not a runtime one.
        starters: roster.starters as string[],
        // Belt and braces alongside the `sleeper:v2:` cache-key bump: a roster reconstructed
        // from anything written by an older build has no `reserve`/`taxi` at all, and an
        // `undefined` here would reach Postgres as a column default rather than as the empty
        // list it actually means.
        reserve: roster.reserve ?? [],
        taxi: roster.taxi ?? [],
        syncedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [rosters.leagueId, rosters.rosterId],
      set: {
        ownerUserId: sql`excluded.owner_user_id`,
        players: sql`excluded.players`,
        starters: sql`excluded.starters`,
        reserve: sql`excluded.reserve`,
        taxi: sql`excluded.taxi`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}
