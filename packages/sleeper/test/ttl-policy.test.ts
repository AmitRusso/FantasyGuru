import { describe, expect, it } from 'vitest';
import { ttlSeconds } from '../src/ttl-policy.js';

/**
 * build-plan.md S2 §2.9: a pure function is tested at fixed instants, both sides of every
 * boundary, and explicitly across the 1 Nov 2026 DST change -- confirmed by direct probe
 * (below) to land at 2026-11-01T06:00:00Z, where America/New_York jumps from 01:59 EDT to
 * 01:00 EST.
 */

const HOUR = 3600;
const MINUTE = 60;

describe('ttlSeconds -- fixed 24h endpoints', () => {
  it('is always 24h regardless of time of week', () => {
    for (const iso of ['2026-08-25T12:00:00Z', '2026-10-18T14:30:00Z', '2026-11-02T05:00:00Z']) {
      expect(ttlSeconds('userLeagues', new Date(iso))).toBe(24 * HOUR);
      expect(ttlSeconds('leagueUsers', new Date(iso))).toBe(24 * HOUR);
    }
  });
});

describe('ttlSeconds -- leagueRosters, time-of-week windows (EDT, before 1 Nov)', () => {
  // 2026-08-25 is a Tuesday.
  it('Tue-Fri is 6h', () => {
    expect(ttlSeconds('leagueRosters', new Date('2026-08-25T15:00:00Z'))).toBe(6 * HOUR); // Tue
    expect(ttlSeconds('leagueRosters', new Date('2026-08-28T15:00:00Z'))).toBe(6 * HOUR); // Fri
  });

  it('Saturday is 1h', () => {
    expect(ttlSeconds('leagueRosters', new Date('2026-08-29T15:00:00Z'))).toBe(HOUR);
  });

  it('Sunday 00:00-06:00 ET is 1h -- the gap the spec leaves undefined', () => {
    // 2026-08-30 is a Sunday. 04:00Z = 00:00 EDT.
    expect(ttlSeconds('leagueRosters', new Date('2026-08-30T04:00:00Z'))).toBe(HOUR);
    // 09:59Z = 05:59 EDT -- still inside the gap.
    expect(ttlSeconds('leagueRosters', new Date('2026-08-30T09:59:00Z'))).toBe(HOUR);
  });

  it('Sunday 06:00-13:00 ET is 5 minutes -- both sides of the boundary', () => {
    // 10:00Z = 06:00 EDT: the boundary itself.
    expect(ttlSeconds('leagueRosters', new Date('2026-08-30T10:00:00Z'))).toBe(5 * MINUTE);
    expect(ttlSeconds('leagueRosters', new Date('2026-08-30T09:59:00Z'))).toBe(HOUR);
    // 16:59Z = 12:59 EDT: still inside the window.
    expect(ttlSeconds('leagueRosters', new Date('2026-08-30T16:59:00Z'))).toBe(5 * MINUTE);
  });

  it('Sunday 13:00-24:00 ET is 60 seconds', () => {
    // 17:00Z = 13:00 EDT: the boundary.
    expect(ttlSeconds('leagueRosters', new Date('2026-08-30T17:00:00Z'))).toBe(60);
    expect(ttlSeconds('leagueRosters', new Date('2026-08-30T16:59:00Z'))).toBe(5 * MINUTE);
    // 23:59 EDT, still Sunday.
    expect(ttlSeconds('leagueRosters', new Date('2026-08-31T03:59:00Z'))).toBe(60);
  });

  it('Monday is 15 minutes', () => {
    // 2026-08-31 is a Monday. 04:00Z = 00:00 EDT Monday.
    expect(ttlSeconds('leagueRosters', new Date('2026-08-31T04:00:00Z'))).toBe(15 * MINUTE);
    expect(ttlSeconds('leagueRosters', new Date('2026-08-31T23:00:00Z'))).toBe(15 * MINUTE);
  });
});

describe('ttlSeconds -- the DST boundary, 1 Nov 2026', () => {
  it('resolves the real IANA offset rather than assuming a fixed UTC offset', () => {
    // Probed directly: America/New_York is 01:59 EDT at 2026-11-01T05:59:00Z and 01:00 EST
    // one minute later, at 2026-11-01T06:00:00Z. A fixed-offset implementation (always -4,
    // matching EDT) would compute the wrong Eastern hour for every instant after this point
    // in the season.
    const beforeFallBack = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).format(new Date('2026-11-01T05:59:00Z'));
    const afterFallBack = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).format(new Date('2026-11-01T06:00:00Z'));

    expect(beforeFallBack).toContain('EDT');
    expect(afterFallBack).toContain('EST');
  });

  it('computes the correct TTL bucket after the fall-back, where a fixed -4 offset would not', () => {
    // 2026-11-01 is a Sunday. 10:30Z, post-fall-back (EST, UTC-5), is 05:30 ET -- inside the
    // Sun 00:00-06:00 gap, TTL 1h.
    //
    // A fixed-EDT (-4) implementation would compute this same UTC instant as 06:30 ET --
    // one bucket later, TTL 5 minutes. The two implementations disagree here, which is
    // exactly why this instant is the assertion and not an arbitrary one.
    expect(ttlSeconds('leagueRosters', new Date('2026-11-01T10:30:00Z'))).toBe(HOUR);
  });

  it('is back to the 6h Tue-Fri TTL the week after the change, under EST', () => {
    // 2026-11-03 is a Tuesday, safely past the transition.
    expect(ttlSeconds('leagueRosters', new Date('2026-11-03T18:00:00Z'))).toBe(6 * HOUR);
  });
});
