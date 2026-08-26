/**
 * The wire shape of `GET /v1/users/{sleeperUserId}/shared-players` (build-plan.md S4).
 *
 * Types only, like the rest of this package -- nothing here is bundled into the app.
 *
 * This is the "cross-league player list that rule 7 will later read from" (spec §7, Day 7).
 * Rule 7 itself is Stage 10 and this stage deliberately does not implement it; what lands
 * here is the ground truth it stands on, shaped so the suppression clause can actually be
 * evaluated later.
 */

/**
 * Why the path takes `sleeperUserId` and not a username: spec §2.1's data-model gotcha is
 * that Sleeper usernames are MUTABLE. `GET /v1/users/{username}/leagues` takes one only
 * because it is the onboarding route and a brand-new user knows nothing else. Every route
 * after it takes the stable id that route returned (build-plan.md S4 Decision 9).
 */

/** One starting slot in one league, positionally. */
export interface LineupSlot {
  /** Index into the league roster's `starters` array. */
  index: number;
  /**
   * The `roster_positions` label for this slot -- "QB", "FLEX", "WRRB_FLEX", and so on.
   *
   * Null when the slot cannot be labelled honestly: labelling depends on `starters[i]`
   * lining up with the i-th non-bench entry of `roster_positions`, which held for all 216
   * rosters checked (build-plan.md S4 §4.2) but is not guaranteed by Sleeper. When it does
   * not hold, this is null rather than wrong.
   */
  label: string | null;
  /** Null when the slot is empty -- Sleeper's "0" sentinel, or a literal null (spec §3 rule 1). */
  playerId: string | null;
}

/** One of the caller's leagues, and the lineup they are currently fielding in it. */
export interface LeagueLineup {
  leagueId: string;
  name: string;
  season: string;
  /** The caller's own roster in this league. */
  rosterId: number;
  rosterPositions: string[] | null;
  slots: LineupSlot[];
  /**
   * Genuinely benched: `players - starters - reserve - taxi`.
   *
   * The subtraction of `reserve` and `taxi` is load-bearing and is NOT what spec §3 rule 7
   * says (it says `players - starters`). IR and practice-squad ids are subsets of `players`
   * and absent from `starters`, so the spec's formula counts every IR stash as a deliberate
   * bench decision -- see build-plan.md S4 Decision 5.
   */
  bench: string[];
  reserve: string[];
  taxi: string[];
  /** When Loop B last wrote this league's rosters. Null if never. */
  syncedAt: string | null;
}

/** Where a player sits on one roster. Rule 7 fires on started-here + benched-there only. */
export type SharedPlayerStatus = 'started' | 'benched' | 'reserve' | 'taxi';

export interface SharedPlayerLeagueEntry {
  leagueId: string;
  status: SharedPlayerStatus;
  /** Index into that league's `slots`, when started. Null otherwise. */
  slotIndex: number | null;
  /** That slot's label, when started and labelable. Null otherwise. */
  slotLabel: string | null;
}

/** A player the caller holds in two or more of their leagues. */
export interface SharedPlayer {
  playerId: string;
  fullName: string | null;
  team: string | null;
  position: string | null;
  injuryStatus: string | null;
  /**
   * From the verified `team_bye_weeks` table only. Null means "no verified bye on record" --
   * which is also what an unverified season looks like, deliberately (S4 Decision 3).
   */
  byeWeek: number | null;
  /** Always length >= 2 -- that is what makes the player shared. */
  leagues: SharedPlayerLeagueEntry[];
}

/**
 * Normalised on purpose: each league's lineup appears once in `leagues`, and `sharedPlayers`
 * references leagues by id rather than embedding them. For an 18-league account the embedded
 * shape would serialise the same slot arrays dozens of times -- and rule 7's suppression
 * clause needs to see the OTHER league's whole lineup anyway, not just the one player
 * (build-plan.md S4 Decision 7).
 */
export interface GetSharedPlayersResponse {
  sleeperUserId: string;
  season: string;
  leagues: LeagueLineup[];
  sharedPlayers: SharedPlayer[];
}
