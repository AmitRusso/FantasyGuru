/**
 * Shapes we read from the Sleeper API.
 *
 * Every field is optional and `unknown`-ish on purpose. Spec §6 lists "Sleeper changes or
 * restricts the API" as a Critical risk with no contract and no notice period, so nothing
 * here asserts that a field will be present. Narrowing happens in `normalise.ts`, once,
 * leniently, and with a counter.
 */

/** One entry from `GET /v1/players/nfl`, keyed in the response by player id. */
export interface RawSleeperPlayer {
  player_id?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  team?: unknown;
  position?: unknown;
  status?: unknown;
  injury_status?: unknown;
  practice_participation?: unknown;
  depth_chart_order?: unknown;
  [key: string]: unknown;
}

/** The whole `GET /v1/players/nfl` payload: a map of player id -> player. */
export type RawPlayersResponse = Record<string, RawSleeperPlayer>;

/** `GET /v1/state/nfl`. */
export interface RawNflState {
  season?: unknown;
  season_type?: unknown;
  week?: unknown;
  display_week?: unknown;
  [key: string]: unknown;
}

/** A player, normalised to exactly the columns the `players` table holds (spec §2.3). */
export interface NormalisedPlayer {
  sleeperPlayerId: string;
  fullName: string;
  team: string | null;
  position: string | null;
  status: string | null;
  injuryStatus: string | null;
  practiceParticipation: string | null;
  depthChartOrder: number | null;
}

/** The current NFL week, normalised. */
export interface NormalisedNflState {
  season: string;
  seasonType: string;
  week: number;
  displayWeek: number;
}

/**
 * `GET /v1/user/{username}`. Verified against the live API 25 Aug 2026: the real object
 * carries a long tail of always-null fields (`cookies`, `phone`, `real_name`, `token`, …)
 * that are omitted here by construction. An unknown username returns HTTP 200 with a body
 * of `null`, not a 404 -- see `normaliseUser`.
 */
export interface RawSleeperUser {
  user_id?: unknown;
  /** Canonical, lowercased. Persist this, not what the caller typed -- see build-plan.md S2. */
  username?: unknown;
  display_name?: unknown;
  [key: string]: unknown;
}

export interface NormalisedUser {
  sleeperUserId: string;
  username: string;
  displayName: string | null;
}

/**
 * `GET /v1/user/{id}/leagues/nfl/{season}`. Verified live 25 Aug 2026: each entry is the
 * SAME shape as a standalone `GET /league/{id}` -- full settings, not a thin reference. That
 * is Decision 1 in build-plan.md S2: the standalone league fetch is not needed on the sweep
 * path because this response already carries everything it would return.
 */
export interface RawSleeperLeague {
  league_id?: unknown;
  name?: unknown;
  season?: unknown;
  status?: unknown;
  total_rosters?: unknown;
  roster_positions?: unknown;
  scoring_settings?: unknown;
  [key: string]: unknown;
}

export interface NormalisedLeague {
  sleeperLeagueId: string;
  name: string;
  season: string;
  totalRosters: number | null;
  rosterPositions: string[] | null;
  scoringSettings: Record<string, unknown> | null;
}

/** `GET /v1/league/{id}/rosters`. One entry per team in the league. */
export interface RawSleeperRoster {
  roster_id?: unknown;
  owner_id?: unknown;
  players?: unknown;
  /**
   * Positional: starters[i] is the i-th non-"BN" slot in the league's roster_positions.
   * Confirmed against real data 25 Aug 2026 -- see build-plan.md S2 §2.8. Spec §3 rule 1 says
   * an empty slot is "0" or null; no example of either turned up in the league probed, so
   * that remains unconfirmed until Stage 5.
   */
  starters?: unknown;
  [key: string]: unknown;
}

export interface NormalisedRoster {
  rosterId: number;
  /** Sleeper's user id of the owner. Null for an unclaimed/orphaned roster. */
  ownerUserId: string | null;
  players: string[];
  starters: (string | null)[];
}

/** `GET /v1/league/{id}/users`. Display names for a league's members. */
export interface RawSleeperLeagueUser {
  user_id?: unknown;
  display_name?: unknown;
  [key: string]: unknown;
}

export interface NormalisedLeagueUser {
  sleeperUserId: string;
  displayName: string | null;
}

/**
 * `GET /v1/league/{id}/matchups/{week}`. One entry per roster for that week.
 *
 * CONFIRMED to diverge from the same roster's live `rosters.starters` for a past week
 * (build-plan.md S2 §2.8, item 3) -- this is the week's frozen record, not the current
 * lineup. The alarm reads `rosters.starters`; this is for the live scoreboard, later.
 */
export interface RawSleeperMatchup {
  roster_id?: unknown;
  matchup_id?: unknown;
  points?: unknown;
  starters?: unknown;
  [key: string]: unknown;
}

export interface NormalisedMatchup {
  rosterId: number;
  matchupId: number | null;
  points: number | null;
  starters: (string | null)[];
}
