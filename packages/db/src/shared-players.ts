import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from './client.js';
import { leagues, memberships, players, rosters, users } from './schema.js';
import { byeWeeksForSeason } from './bye-weeks.js';

/**
 * The cross-league player view (spec §7, Day 7: "the cross-league player list that rule 7
 * will later read from").
 *
 * A pure Postgres read model (build-plan.md S4 Decision 6): no Sleeper calls, no cache, no
 * rate limiter. It reports whatever the last Loop B sweep left behind, and hands back each
 * league's `syncedAt` so a caller can judge staleness for itself. That keeps the ten-second
 * onboarding path (spec §2.1) exactly one route, and makes this one cheap enough to call
 * freely.
 */

/** Slots that are not part of the starting lineup, and so are not in `starters`. */
const NON_STARTING_SLOTS = new Set(['BN', 'IR', 'TAXI']);

/**
 * Sleeper's sentinel for an unfilled starting slot. Confirmed live (build-plan.md S2 §2.8,
 * and seen repeatedly in production responses since); spec §3 rule 1 also allows a literal
 * null, which `starterArray` preserves positionally.
 */
const EMPTY_SLOT = '0';

export interface LineupSlot {
  index: number;
  label: string | null;
  playerId: string | null;
}

export interface LeagueLineup {
  leagueId: string;
  name: string;
  season: string;
  rosterId: number;
  rosterPositions: string[] | null;
  slots: LineupSlot[];
  bench: string[];
  reserve: string[];
  taxi: string[];
  syncedAt: Date | null;
}

export type SharedPlayerStatus = 'started' | 'benched' | 'reserve' | 'taxi';

export interface SharedPlayerLeagueEntry {
  leagueId: string;
  status: SharedPlayerStatus;
  slotIndex: number | null;
  slotLabel: string | null;
}

export interface SharedPlayer {
  playerId: string;
  fullName: string | null;
  team: string | null;
  position: string | null;
  injuryStatus: string | null;
  byeWeek: number | null;
  leagues: SharedPlayerLeagueEntry[];
}

export interface SharedPlayersView {
  sleeperUserId: string;
  season: string;
  leagues: LeagueLineup[];
  sharedPlayers: SharedPlayer[];
}

/**
 * The labels for a league's starting slots, in `starters` order.
 *
 * Depends on an invariant Sleeper documents nowhere: `starters[i]` is the i-th non-bench
 * entry of `roster_positions`. It held for every one of the 216 rosters across all 19 real
 * leagues in the database (build-plan.md S4 §4.2) -- but "held on everything I could check"
 * is not "guaranteed", and a mislabelled slot would feed rule 7 a wrong answer with total
 * confidence.
 *
 * So the length is checked, and on a mismatch every slot is labelled `null`. Rule 7 can then
 * see it does not know, instead of being told something false.
 */
function slotLabels(rosterPositions: string[] | null, starterCount: number): (string | null)[] {
  if (!rosterPositions) return Array.from({ length: starterCount }, () => null);

  const starting = rosterPositions.filter((slot) => !NON_STARTING_SLOTS.has(slot));
  if (starting.length !== starterCount) {
    return Array.from({ length: starterCount }, () => null);
  }
  return starting;
}

/**
 * Everything the caller holds in two or more of their leagues this season.
 *
 * Returns null when we have never seen this Sleeper user -- which is different from "they
 * have no shared players", and the route distinguishes the two.
 */
export async function getSharedPlayers(
  db: Database,
  sleeperUserId: string,
  season: string,
): Promise<SharedPlayersView | null> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.sleeperUserId, sleeperUserId))
    .limit(1);

  const user = userRows[0];
  if (!user) return null;

  // One join for the caller's roster in each of their leagues this season. `memberships`
  // already resolves user -> roster_id per league (see memberships.ts), so this never has to
  // scan other people's rosters.
  const rows = await db
    .select({
      leagueId: leagues.sleeperLeagueId,
      name: leagues.name,
      season: leagues.season,
      rosterPositions: leagues.rosterPositions,
      rosterId: memberships.rosterId,
      players: rosters.players,
      starters: rosters.starters,
      reserve: rosters.reserve,
      taxi: rosters.taxi,
      syncedAt: rosters.syncedAt,
    })
    .from(memberships)
    .innerJoin(leagues, eq(leagues.sleeperLeagueId, memberships.leagueId))
    .innerJoin(
      rosters,
      and(eq(rosters.leagueId, memberships.leagueId), eq(rosters.rosterId, memberships.rosterId)),
    )
    .where(and(eq(memberships.userId, user.id), eq(leagues.season, season)));

  const lineups: LeagueLineup[] = [];
  /** playerId -> where it sits in each league. Built in one pass over the rosters. */
  const appearances = new Map<string, SharedPlayerLeagueEntry[]>();

  const note = (playerId: string, entry: SharedPlayerLeagueEntry): void => {
    const existing = appearances.get(playerId);
    if (existing) existing.push(entry);
    else appearances.set(playerId, [entry]);
  };

  for (const row of rows) {
    const starters = row.starters ?? [];
    const reserve = row.reserve ?? [];
    const taxi = row.taxi ?? [];
    const rosterPositions = (row.rosterPositions as string[] | null) ?? null;
    const labels = slotLabels(rosterPositions, starters.length);

    const slots: LineupSlot[] = starters.map((playerId, index) => ({
      index,
      label: labels[index] ?? null,
      // Both sentinels collapse to null here so callers have exactly one empty-slot shape to
      // handle. Rule 1 (spec §3) reads this.
      playerId: playerId === EMPTY_SLOT || playerId === null ? null : playerId,
    }));

    const startedIds = new Set<string>();
    for (const slot of slots) {
      if (!slot.playerId) continue;
      startedIds.add(slot.playerId);
      note(slot.playerId, {
        leagueId: row.leagueId,
        status: 'started',
        slotIndex: slot.index,
        slotLabel: slot.label,
      });
    }

    const reserveIds = new Set(reserve);
    const taxiIds = new Set(taxi);

    for (const playerId of reserve) {
      note(playerId, {
        leagueId: row.leagueId,
        status: 'reserve',
        slotIndex: null,
        slotLabel: null,
      });
    }
    for (const playerId of taxi) {
      note(playerId, { leagueId: row.leagueId, status: 'taxi', slotIndex: null, slotLabel: null });
    }

    // The Decision 5 subtraction. Spec §3 rule 7 says `players - starters`; that would count
    // an IR stash as a bench decision the user should fix, on 9 of 12 real rosters.
    const bench = (row.players ?? []).filter(
      (playerId) =>
        !startedIds.has(playerId) && !reserveIds.has(playerId) && !taxiIds.has(playerId),
    );
    for (const playerId of bench) {
      note(playerId, {
        leagueId: row.leagueId,
        status: 'benched',
        slotIndex: null,
        slotLabel: null,
      });
    }

    lineups.push({
      leagueId: row.leagueId,
      name: row.name,
      season: row.season,
      rosterId: row.rosterId,
      rosterPositions,
      slots,
      bench,
      reserve,
      taxi,
      syncedAt: row.syncedAt,
    });
  }

  // Shared means "in more than one LEAGUE", not "more than one entry" -- a player who is
  // somehow listed twice within a single roster must not qualify on that alone.
  const sharedIds = [...appearances.entries()]
    .filter(([, entries]) => new Set(entries.map((e) => e.leagueId)).size >= 2)
    .map(([playerId]) => playerId);

  if (sharedIds.length === 0) {
    return { sleeperUserId, season, leagues: lineups, sharedPlayers: [] };
  }

  const [playerRows, byeWeeks] = await Promise.all([
    db
      .select({
        sleeperPlayerId: players.sleeperPlayerId,
        fullName: players.fullName,
        team: players.team,
        position: players.position,
        injuryStatus: players.injuryStatus,
      })
      .from(players)
      .where(inArray(players.sleeperPlayerId, sharedIds)),
    byeWeeksForSeason(db, season),
  ]);

  const playerById = new Map(playerRows.map((row) => [row.sleeperPlayerId, row]));

  const sharedPlayers: SharedPlayer[] = sharedIds.map((playerId) => {
    // A missing row is possible and is not an error: Loop A refreshes the player universe
    // daily, so a player added by Sleeper since this morning is rostered but not yet known
    // here. Reporting the id with null metadata beats dropping the player from the view.
    const player = playerById.get(playerId);
    const team = player?.team ?? null;
    return {
      playerId,
      fullName: player?.fullName ?? null,
      team,
      position: player?.position ?? null,
      injuryStatus: player?.injuryStatus ?? null,
      byeWeek: team ? (byeWeeks.get(team) ?? null) : null,
      leagues: appearances.get(playerId) ?? [],
    };
  });

  // Stable, useful ordering: the most-shared players first, then by name so the output does
  // not shuffle between identical calls.
  sharedPlayers.sort(
    (a, b) =>
      b.leagues.length - a.leagues.length ||
      (a.fullName ?? a.playerId).localeCompare(b.fullName ?? b.playerId),
  );

  return { sleeperUserId, season, leagues: lineups, sharedPlayers };
}
