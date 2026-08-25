import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normaliseNflState, normalisePlayer, normalisePlayers } from '../src/normalise.js';
import type { RawPlayersResponse } from '../src/types.js';

/**
 * build-plan.md S1 §1.5, test 1.
 *
 * The fixture is a real slice of `GET /v1/players/nfl`, captured 24 Aug 2026 -- one player
 * per edge case the live payload actually contains. Synthetic cases are constructed inline;
 * the captured file stays pure so it keeps its value as evidence of the upstream shape.
 */

const fixturePath = fileURLToPath(
  new URL('../../../fixtures/sleeper/players-slice.json', import.meta.url),
);
const slice = JSON.parse(readFileSync(fixturePath, 'utf8')) as RawPlayersResponse;

describe('normalisePlayer', () => {
  it('normalises a healthy starter', () => {
    const { player, missingFields } = normalisePlayer('4983', slice['4983']);

    expect(player).toEqual({
      sleeperPlayerId: '4983',
      fullName: 'DJ Moore',
      team: 'BUF',
      position: 'WR',
      status: 'Active',
      injuryStatus: null,
      practiceParticipation: null,
      depthChartOrder: 1,
    });
    expect(missingFields).toBe(0);
  });

  it('carries the injury designations rule 3 fires on', () => {
    expect(normalisePlayer('3159', slice['3159']).player?.injuryStatus).toBe('Out');
    expect(normalisePlayer('3526', slice['3526']).player?.injuryStatus).toBe('IR');
    expect(normalisePlayer('44', slice['44']).player?.injuryStatus).toBe('Sus');
    // Rule 4, Warning severity.
    expect(normalisePlayer('7118', slice['7118']).player?.injuryStatus).toBe('Doubtful');
  });

  it('recovers team defence names from first/last, which have no full_name', () => {
    const { player } = normalisePlayer('HOU', slice['HOU']);

    expect(player?.fullName).toBe('Houston Texans');
    expect(player?.position).toBe('DEF');
    // 32 of these exist in the live payload and every one is startable, so dropping them
    // would silently blind rules 1-3 to a whole roster slot.
    expect(player?.sleeperPlayerId).toBe('HOU');
  });

  it('does not count an absent team as missing data', () => {
    // 8,977 players in the live payload have no team, 5,474 of them status Active. Counting
    // this would bury a genuine upstream rename under ~9,000 nightly false positives.
    const { player, missingFields } = normalisePlayer('184', slice['184']);

    expect(player?.fullName).toBe('Adrian Peterson');
    expect(player?.team).toBeNull();
    expect(missingFields).toBe(0);
  });

  it('counts an absent position without dropping the row', () => {
    const { player, missingFields } = normalisePlayer('2901', slice['2901']);

    expect(player?.fullName).toBe('Malcome Kennedy');
    expect(player?.position).toBeNull();
    expect(missingFields).toBe(1);
  });

  it('skips a mangled row instead of throwing', () => {
    // The whole point of the lenient mapper: one bad object must not fail a 12k-row sync at
    // 03:00. Spec §6 -- the API "owes you nothing".
    for (const mangled of [null, undefined, 42, 'nope', [], { full_name: null }]) {
      expect(() => normalisePlayer('x', mangled)).not.toThrow();
      expect(normalisePlayer('x', mangled).player).toBeNull();
    }
  });

  it('ignores fields it does not know about', () => {
    const { player, missingFields } = normalisePlayer('1', {
      full_name: 'Test Player',
      position: 'QB',
      status: 'Active',
      some_new_field_sleeper_added: { nested: true },
    });

    expect(player?.fullName).toBe('Test Player');
    expect(missingFields).toBe(0);
  });

  it('coerces a numeric depth_chart_order arriving as a string', () => {
    const { player } = normalisePlayer('1', {
      full_name: 'Test Player',
      position: 'QB',
      status: 'Active',
      depth_chart_order: '2',
    });

    expect(player?.depthChartOrder).toBe(2);
  });
});

describe('normalisePlayers', () => {
  it('normalises the whole slice and aggregates the counters', () => {
    const result = normalisePlayers(slice);

    expect(result.players).toHaveLength(Object.keys(slice).length);
    expect(result.skipped).toBe(0);
    // Two rows in the slice are missing a counted field: 2901 has no position, and the HOU
    // team defence has no status -- all 32 DEF entries in the live payload are like that.
    // Both are baseline noise, which is why Stage 9 alerts on the rate rather than on zero.
    expect(result.missingFields).toBe(2);
  });

  it('counts skipped rows rather than failing the sweep', () => {
    const result = normalisePlayers({
      ...slice,
      broken: { first_name: null, last_name: null } as never,
    });

    expect(result.skipped).toBe(1);
    expect(result.players).toHaveLength(Object.keys(slice).length);
  });
});

describe('normaliseNflState', () => {
  it('normalises a real state payload', () => {
    // Captured 24 Aug 2026. Note season_type 'pre': during preseason the week is the
    // PRESEASON week, which Stage 5 must not read as a regular-season week.
    const state = normaliseNflState({
      week: 3,
      season: '2026',
      season_type: 'pre',
      display_week: 3,
    });

    expect(state).toEqual({ season: '2026', seasonType: 'pre', week: 3, displayWeek: 3 });
  });

  it('throws on an unusable payload rather than guessing a week', () => {
    // Unlike the player map, this one is small and load-bearing. A wrong week means the
    // alarm evaluates the wrong slate, which is worse than not running.
    expect(() => normaliseNflState({})).toThrow(/Unusable/);
    expect(() => normaliseNflState({ season: '2026' })).toThrow(/Unusable/);
  });

  it('falls back to week when display_week is absent', () => {
    expect(normaliseNflState({ season: '2026', week: 6 }).displayWeek).toBe(6);
  });
});
