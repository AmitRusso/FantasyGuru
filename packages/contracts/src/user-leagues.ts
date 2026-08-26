/**
 * The wire shape of `GET /v1/users/{username}/leagues` (build-plan.md S2 §2.6).
 *
 * This is the ONLY thing in this package: no runtime code, no imports, nothing to bundle.
 * `apps/api` imports these types to type what it returns; `apps/mobile` imports the same
 * types to type what it receives. That is what stops the client and server drifting without
 * either one importing the other's runtime -- `packages/db` pulls in `pg` and
 * `packages/sleeper` pulls in `@upstash/redis`, and Metro would happily bundle a Postgres
 * driver into an Android app if either were imported directly (build-plan.md S3 Decision 2).
 */

export interface RosterSummary {
  rosterId: number;
  players: string[];
  /**
   * Positional: starters[i] is the i-th non-BN slot in the league's roster_positions.
   * Confirmed against real data (build-plan.md S2 §2.8). An empty slot is the string "0"
   * (confirmed live, S2 §2.8 item 2) or possibly `null` (spec §3 rule 1, never yet observed).
   */
  starters: (string | null)[];
}

export interface LeagueSummary {
  leagueId: string;
  name: string;
  season: string;
  totalRosters: number | null;
  rosterPositions: string[] | null;
  /** The roster this user owns in this league, or null if none was found. */
  myRoster: RosterSummary | null;
}

export interface GetUserLeaguesResponse {
  userId: string;
  sleeperUserId: string;
  leagues: LeagueSummary[];
}

/** The `{ error: string }` shape every non-2xx response from this route uses. */
export interface ApiErrorResponse {
  error: string;
}
