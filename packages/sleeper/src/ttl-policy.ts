/**
 * Cache TTL by time of week and endpoint (build-plan.md S2 §2.3, Decision 2).
 *
 * A fixed TTL is wrong for this app: nothing moves Tuesday through Friday; everything moves
 * in one four-hour window on Sunday (spec §2.2). Pure function -- no I/O, no ambient clock --
 * so every window boundary is table-testable.
 */

export type CachedEndpoint = 'userLeagues' | 'leagueRosters' | 'leagueUsers' | 'leagueMatchups';

/**
 * `userLeagues` and `leagueUsers` change effectively never mid-season (build-plan.md S2
 * Decision 1 and Decision 2) -- both are fixed at 24h regardless of time of week.
 */
const FIXED_24H_ENDPOINTS = new Set<CachedEndpoint>(['userLeagues', 'leagueUsers']);

const HOUR = 3600;
const MINUTE = 60;

/**
 * Spec §2.2's table, plus the gap it leaves (Sunday 00:00-06:00 ET, filled conservatively
 * with 1h -- see build-plan.md S2 §2.3) and the boundary this function must get right across
 * DST: every window here is Eastern WALL-CLOCK time, and 1 Nov 2026 moves every one of these
 * boundaries by an hour relative to UTC.
 */
function timeOfWeekTtlSeconds(dayOfWeek: number, hour: number): number {
  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday (Intl's weekday numbering via getDay-equivalent
  // below).
  if (dayOfWeek === 0) {
    if (hour < 6) return HOUR; // Not in the spec -- see build-plan.md S2 §2.3.
    if (hour < 13) return 5 * MINUTE;
    return 60; // Sun 13:00-24:00: games live, scores only.
  }
  if (dayOfWeek === 1) return 15 * MINUTE; // Monday: MNF plus the aftermath view.
  if (dayOfWeek === 6) return HOUR; // Saturday: lineups begin moving.
  return 6 * HOUR; // Tue-Fri: static.
}

/**
 * Reads the wall-clock day-of-week and hour in `America/New_York`, correctly across DST,
 * without a date library. `Intl.DateTimeFormat` resolves the IANA zone's actual UTC offset
 * for the given instant -- unlike a fixed offset, which would silently drift by an hour
 * after 1 Nov 2026.
 */
function easternWallClock(instant: Date): { dayOfWeek: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const weekdayName = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeek = weekdays.indexOf(weekdayName);

  return { dayOfWeek: dayOfWeek === -1 ? 0 : dayOfWeek, hour: Number.parseInt(hourStr, 10) };
}

/**
 * The TTL, in seconds, for a given endpoint at a given instant.
 *
 * `instant` defaults to now but is always accepted explicitly so this stays a pure function
 * under test -- a rate limiter or TTL policy tested only against the real clock is not
 * tested (build-plan.md S2 §2.9).
 */
export function ttlSeconds(endpoint: CachedEndpoint, instant: Date = new Date()): number {
  if (FIXED_24H_ENDPOINTS.has(endpoint)) return 24 * HOUR;

  const { dayOfWeek, hour } = easternWallClock(instant);
  return timeOfWeekTtlSeconds(dayOfWeek, hour);
}
