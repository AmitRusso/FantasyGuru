import type {
  NormalisedNflState,
  NormalisedPlayer,
  RawNflState,
  RawPlayersResponse,
  RawSleeperPlayer,
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
