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
