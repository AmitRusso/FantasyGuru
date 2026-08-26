import type {
  NormalisedLeague,
  NormalisedLeagueUser,
  NormalisedMatchup,
  NormalisedNflState,
  NormalisedPlayer,
  NormalisedRoster,
  NormalisedUser,
  RawNflState,
  RawPlayersResponse,
  RawSleeperLeague,
  RawSleeperLeagueUser,
  RawSleeperMatchup,
  RawSleeperPlayer,
  RawSleeperRoster,
  RawSleeperUser,
} from './types.js';

/**
 * Lenient normalisation, per build-plan.md S1 §1.3.
 *
 * Deliberately NOT a schema validator. `GET /v1/players/nfl` carries ~11k objects and the
 * upstream API "owes you nothing" (spec §6) -- a strict parser turns a single upstream field
 * rename into a total sync failure at 03:00 on a Sunday. So:
 *
 *   - unknown fields are ignored without complaint;
 *   - an expected-but-missing field yields null and increments a counter that lands in
 *     sync_log, where the Stage 9 canary can alert on it;
 *   - only a row that cannot produce an id AND a name is dropped, and that is counted too.
 */

/** A field is "missing" if absent or null; that is a signal, not an error. */
function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function int(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Sleeper omits `full_name` for team defences (DEF), which carry first/last only. */
function nameOf(raw: RawSleeperPlayer): string | null {
  const full = str(raw.full_name);
  if (full) return full;
  const first = str(raw.first_name);
  const last = str(raw.last_name);
  const joined = [first, last].filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : null;
}

/**
 * Fields counted when absent -- the tripwire for an upstream rename.
 *
 * The list is short because it was measured, not guessed. Against the live payload on
 * 24 Aug 2026 (12,222 players):
 *
 *   position   240 absent  (2.0%)
 *   status      45 absent  (0.4%)
 *   team     8,977 absent  (73%)  <- free agents; 5,474 of them are status Active
 *   full_name   32 absent  (0.3%) <- team defences, recovered from first/last below
 *
 * `team` is therefore useless as a signal and is not counted: it would report ~9,000
 * "missing" fields every night and bury a real rename. `injury_status` and
 * `practice_participation` are excluded for the same reason -- null is the healthy case.
 *
 * Baseline is ~285 across the payload, ~2.3%. Stage 9 should alert on the RATE moving, not
 * on the count being non-zero.
 */
const COUNTED_FIELDS = ['position', 'status'] as const;

export interface NormalisedPlayerResult {
  player: NormalisedPlayer | null;
  /** How many expected-but-absent fields this row had. Aggregated into sync_log. */
  missingFields: number;
}

export function normalisePlayer(id: string, raw: unknown): NormalisedPlayerResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { player: null, missingFields: 0 };
  }

  const player = raw as RawSleeperPlayer;

  // The map key is authoritative; player_id inside the object is a fallback, because the
  // key is what rosters[].players[] actually references.
  const sleeperPlayerId = str(id) ?? str(player.player_id);
  const fullName = nameOf(player);

  if (!sleeperPlayerId || !fullName) {
    return { player: null, missingFields: 0 };
  }

  const normalised: NormalisedPlayer = {
    sleeperPlayerId,
    fullName,
    team: str(player.team),
    position: str(player.position),
    status: str(player.status),
    injuryStatus: str(player.injury_status),
    practiceParticipation: str(player.practice_participation),
    depthChartOrder: int(player.depth_chart_order),
  };

  let missingFields = 0;
  for (const field of COUNTED_FIELDS) {
    if (normalised[field] === null) missingFields += 1;
  }

  return { player: normalised, missingFields };
}

export interface NormalisedPlayersResult {
  players: NormalisedPlayer[];
  /** Total expected-but-absent fields across every row. */
  missingFields: number;
  /** Rows dropped for having no usable id or name. */
  skipped: number;
}

export function normalisePlayers(response: RawPlayersResponse): NormalisedPlayersResult {
  const players: NormalisedPlayer[] = [];
  let missingFields = 0;
  let skipped = 0;

  for (const [id, raw] of Object.entries(response)) {
    const result = normalisePlayer(id, raw);
    if (!result.player) {
      skipped += 1;
      continue;
    }
    players.push(result.player);
    missingFields += result.missingFields;
  }

  return { players, missingFields, skipped };
}

/**
 * `/v1/state/nfl`. Unlike the player map this one is small and load-bearing -- every later
 * stage reads the current week -- so a malformed response throws rather than being papered
 * over with a wrong week.
 */
export function normaliseNflState(raw: RawNflState): NormalisedNflState {
  const season = str(raw.season);
  const week = int(raw.week);

  if (!season || week === null) {
    throw new Error(
      `Unusable /v1/state/nfl payload: season=${String(raw.season)} week=${String(raw.week)}`,
    );
  }

  return {
    season,
    seasonType: str(raw.season_type) ?? 'regular',
    week,
    displayWeek: int(raw.display_week) ?? week,
  };
}

/**
 * `GET /v1/user/{username}`.
 *
 * CONFIRMED live 25 Aug 2026: an unknown username is HTTP 200 with a body of `null`, not a
 * 404 -- the most-travelled error path in the product (a typo'd username), and the reason
 * this returns `null` explicitly rather than throwing on a shape it cannot use. Persists the
 * API's own `username` field, not what the caller typed: it is canonical and lowercased,
 * where `display_name` preserves the case the person actually chose.
 */
export function normaliseUser(raw: unknown): NormalisedUser | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const user = raw as RawSleeperUser;
  const sleeperUserId = str(user.user_id);
  const username = str(user.username);
  if (!sleeperUserId || !username) return null;

  return { sleeperUserId, username, displayName: str(user.display_name) };
}

/** A player id array. Non-string entries are dropped silently -- they cannot be looked up. */
function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v)).filter((v): v is string => v !== null);
}

/**
 * A starters array. Unlike `strArray`, nulls are preserved rather than dropped: spec rule 1
 * says an empty starting slot is `"0"` or `null`, and dropping either would shift every
 * later index out of alignment with `roster_positions` -- silently corrupting the one
 * positional mapping confirmed in build-plan.md S2 §2.8.
 */
function starterArray(value: unknown): (string | null)[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v));
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * `GET /v1/user/{id}/leagues/nfl/{season}`.
 *
 * CONFIRMED live 25 Aug 2026 (build-plan.md S2, Decision 1): each entry is the full league
 * object, identical in shape to a standalone `GET /league/{id}` -- so this one function
 * normalises both that response's entries AND a standalone league fetch.
 */
export function normaliseLeague(raw: unknown): NormalisedLeague | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const league = raw as RawSleeperLeague;
  const sleeperLeagueId = str(league.league_id);
  const name = str(league.name);
  const season = str(league.season);
  if (!sleeperLeagueId || !name || !season) return null;

  return {
    sleeperLeagueId,
    name,
    season,
    totalRosters: int(league.total_rosters),
    rosterPositions: Array.isArray(league.roster_positions)
      ? strArray(league.roster_positions)
      : null,
    scoringSettings: record(league.scoring_settings),
  };
}

export interface NormalisedLeaguesResult {
  leagues: NormalisedLeague[];
  skipped: number;
}

export function normaliseLeagues(raw: unknown): NormalisedLeaguesResult {
  if (!Array.isArray(raw)) return { leagues: [], skipped: 0 };

  const leagues: NormalisedLeague[] = [];
  let skipped = 0;
  for (const entry of raw) {
    const league = normaliseLeague(entry);
    if (league) leagues.push(league);
    else skipped += 1;
  }
  return { leagues, skipped };
}

/**
 * `GET /v1/league/{id}/rosters`. This is the alarm's actual input -- `starters[]` is what
 * rules 1-3 read.
 */
export function normaliseRoster(raw: unknown): NormalisedRoster | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const roster = raw as RawSleeperRoster;
  const rosterId = int(roster.roster_id);
  if (rosterId === null) return null;

  return {
    rosterId,
    ownerUserId: str(roster.owner_id),
    players: strArray(roster.players),
    starters: starterArray(roster.starters),
    // `strArray` not `starterArray`: unlike `starters` these are not positional, so dropping
    // nulls is correct here and would be data loss there (build-plan.md S2 §2.8).
    reserve: strArray(roster.reserve),
    taxi: strArray(roster.taxi),
  };
}

export interface NormalisedRostersResult {
  rosters: NormalisedRoster[];
  skipped: number;
}

export function normaliseRosters(raw: unknown): NormalisedRostersResult {
  if (!Array.isArray(raw)) return { rosters: [], skipped: 0 };

  const rosters: NormalisedRoster[] = [];
  let skipped = 0;
  for (const entry of raw) {
    const roster = normaliseRoster(entry);
    if (roster) rosters.push(roster);
    else skipped += 1;
  }
  return { rosters, skipped };
}

/** `GET /v1/league/{id}/users`. Fetched on demand (build-plan.md S2, Decision 1), not swept. */
export function normaliseLeagueUser(raw: unknown): NormalisedLeagueUser | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const user = raw as RawSleeperLeagueUser;
  const sleeperUserId = str(user.user_id);
  if (!sleeperUserId) return null;

  return { sleeperUserId, displayName: str(user.display_name) };
}

export interface NormalisedLeagueUsersResult {
  users: NormalisedLeagueUser[];
  skipped: number;
}

export function normaliseLeagueUsers(raw: unknown): NormalisedLeagueUsersResult {
  if (!Array.isArray(raw)) return { users: [], skipped: 0 };

  const users: NormalisedLeagueUser[] = [];
  let skipped = 0;
  for (const entry of raw) {
    const user = normaliseLeagueUser(entry);
    if (user) users.push(user);
    else skipped += 1;
  }
  return { users, skipped };
}

/**
 * `GET /v1/league/{id}/matchups/{week}`.
 *
 * CONFIRMED live 25 Aug 2026 to diverge from the same roster's `rosters.starters` once a
 * week is in the past (build-plan.md S2 §2.8, item 3) -- this is that week's frozen record,
 * not the current lineup. Not read by the alarm; kept for the later live scoreboard.
 */
export function normaliseMatchup(raw: unknown): NormalisedMatchup | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const matchup = raw as RawSleeperMatchup;
  const rosterId = int(matchup.roster_id);
  if (rosterId === null) return null;

  return {
    rosterId,
    matchupId: int(matchup.matchup_id),
    points: (() => {
      const p = matchup.points;
      return typeof p === 'number' && Number.isFinite(p) ? p : null;
    })(),
    starters: starterArray(matchup.starters),
  };
}

export interface NormalisedMatchupsResult {
  matchups: NormalisedMatchup[];
  skipped: number;
}

export function normaliseMatchups(raw: unknown): NormalisedMatchupsResult {
  if (!Array.isArray(raw)) return { matchups: [], skipped: 0 };

  const matchups: NormalisedMatchup[] = [];
  let skipped = 0;
  for (const entry of raw) {
    const matchup = normaliseMatchup(entry);
    if (matchup) matchups.push(matchup);
    else skipped += 1;
  }
  return { matchups, skipped };
}
