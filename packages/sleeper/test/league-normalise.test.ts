import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  normaliseLeague,
  normaliseLeagues,
  normaliseLeagueUser,
  normaliseLeagueUsers,
  normaliseMatchup,
  normaliseMatchups,
  normaliseRoster,
  normaliseRosters,
  normaliseUser,
} from '../src/normalise.js';

/**
 * All fixtures here are real, captured from Sleeper's own published docs example league
 * (league_id 289646328504385536, season 2018) on 25 Aug 2026 -- see build-plan.md S2 §2.7,
 * §2.8. The league is old, but the API shape is current, which is what these tests exist to
 * pin down.
 */

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`../../../fixtures/sleeper/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('normaliseUser', () => {
  it('normalises a real user, preferring the canonical username over display_name', () => {
    const raw = fixture('user.json');
    const user = normaliseUser(raw);

    // Captured live: username is lowercased ("2ksports"), display_name preserves case
    // ("2KSports"). build-plan.md S2 §2.8 item 5: persist the canonical field.
    expect(user).toEqual({
      sleeperUserId: '457511950237696',
      username: '2ksports',
      displayName: '2KSports',
    });
  });

  it('returns null for an unknown username -- Sleeper answers 200 with body null, not 404', () => {
    const raw = fixture('user-unknown.json');
    expect(raw).toBeNull();
    expect(normaliseUser(raw)).toBeNull();
  });

  it('returns null rather than throwing on garbage', () => {
    for (const bad of [undefined, 42, 'nope', [], {}]) {
      expect(() => normaliseUser(bad)).not.toThrow();
    }
    expect(normaliseUser({})).toBeNull();
  });
});

describe('normaliseLeague / normaliseLeagues', () => {
  it('normalises a standalone GET /league/{id} response', () => {
    const raw = fixture('league.json');
    const league = normaliseLeague(raw);

    expect(league).toMatchObject({
      sleeperLeagueId: '289646328504385536',
      name: 'Sleeper Friends League',
      season: '2018',
      totalRosters: 12,
    });
    expect(league?.rosterPositions).toEqual([
      'QB',
      'RB',
      'RB',
      'WR',
      'WR',
      'TE',
      'FLEX',
      'FLEX',
      'DEF',
      'BN',
      'BN',
      'BN',
      'BN',
      'BN',
      'BN',
    ]);
    expect(league?.scoringSettings).not.toBeNull();
  });

  it('normalises every entry of GET /user/{id}/leagues/nfl/{season} with the same function', () => {
    // build-plan.md S2 Decision 1: this response's entries are the SAME shape as a
    // standalone league fetch -- confirmed by reusing normaliseLeague directly on it.
    const raw = fixture('user-leagues.json');
    const result = normaliseLeagues(raw);

    expect(result.skipped).toBe(0);
    expect(result.leagues.length).toBe(5);
    expect(result.leagues[0]).toMatchObject({
      sleeperLeagueId: '337383787396628480',
      name: 'Dynasty Warriors',
    });
    // Every league from a real user-leagues call carries roster_positions -- the whole point
    // of Decision 1 is that this call makes a standalone /league/{id} fetch unnecessary.
    for (const league of result.leagues) {
      expect(league.rosterPositions).not.toBeNull();
    }
  });

  it('skips entries with no usable id/name/season, without failing the batch', () => {
    const result = normaliseLeagues([fixture('league.json'), {}, null, 'garbage']);
    expect(result.leagues).toHaveLength(1);
    expect(result.skipped).toBe(3);
  });

  it('treats a non-array payload as empty rather than throwing', () => {
    expect(normaliseLeagues(null)).toEqual({ leagues: [], skipped: 0 });
    expect(normaliseLeagues({})).toEqual({ leagues: [], skipped: 0 });
  });
});

describe('normaliseRoster / normaliseRosters', () => {
  it('normalises a real roster, preserving starters positionally', () => {
    const raw = fixture('league-rosters.json') as unknown[];
    const roster = normaliseRoster(raw[0]);

    expect(roster).toMatchObject({ rosterId: 1, ownerUserId: '189140835533586432' });
    // Confirmed live 25 Aug 2026 (build-plan.md S2 §2.8 item 1): 9 non-BN slots in
    // roster_positions, 9 starters, index-for-index -- including a team defence id at the
    // DEF slot.
    expect(roster?.starters).toEqual([
      '4881',
      '4035',
      '788',
      '2133',
      '2449',
      '2118',
      '223',
      '1352',
      'CLE',
    ]);
    expect(roster?.players).toContain('CLE');
  });

  it('normalises every roster in the league', () => {
    const raw = fixture('league-rosters.json');
    const result = normaliseRosters(raw);

    expect(result.skipped).toBe(0);
    expect(result.rosters).toHaveLength(12); // total_rosters from league.json
  });

  it('preserves null/sentinel starters rather than dropping them', () => {
    // Spec §3 rule 1: an empty slot is "0" or null. No example occurred in the live fixture
    // (build-plan.md S2 §2.8 item 2, still open) -- this asserts the normaliser's contract
    // directly so Stage 5 can rely on it once a real example exists.
    const roster = normaliseRoster({ roster_id: 1, players: [], starters: ['4035', null, '0'] });
    expect(roster?.starters).toEqual(['4035', null, '0']);
  });

  it('drops a roster with no usable roster_id', () => {
    const result = normaliseRosters([{ players: [] }, { roster_id: 'not-a-number' }]);
    expect(result.rosters).toHaveLength(0);
    expect(result.skipped).toBe(2);
  });
});

describe('normaliseLeagueUser / normaliseLeagueUsers', () => {
  it('normalises real league members', () => {
    // 14 entries against 12 rosters in this league -- league membership and roster
    // ownership are NOT 1:1. `owner_id` on the roster itself is the only authoritative
    // source for who owns what; this endpoint is display names only, which is why it is
    // fetched on demand rather than swept (build-plan.md S2, Decision 1).
    const raw = fixture('league-users.json');
    const result = normaliseLeagueUsers(raw);

    expect(result.skipped).toBe(0);
    expect(result.users).toHaveLength(14);
    expect(result.users[0]).toEqual({ sleeperUserId: '457511950237696', displayName: '2KSports' });
  });

  it('drops an entry with no usable user_id', () => {
    expect(normaliseLeagueUser({ display_name: 'nobody' })).toBeNull();
  });
});

describe('normaliseMatchup / normaliseMatchups', () => {
  it('normalises a real week of matchups', () => {
    const raw = fixture('league-matchups-week1.json');
    const result = normaliseMatchups(raw);

    expect(result.skipped).toBe(0);
    expect(result.matchups).toHaveLength(12);
    expect(result.matchups[0]).toMatchObject({ rosterId: 1, matchupId: 2, points: 148.04 });
  });

  it('CONFIRMS matchups[week].starters diverges from the same roster in rosters.starters', () => {
    // build-plan.md S2 §2.8 item 3: this is not a theoretical risk, it is demonstrated. The
    // week-1 record is frozen; rosters.starters reflects whatever the roster is set to now.
    const rosters = normaliseRosters(fixture('league-rosters.json'));
    const matchups = normaliseMatchups(fixture('league-matchups-week1.json'));

    const currentRoster1 = rosters.rosters.find((r) => r.rosterId === 1);
    const week1Roster1 = matchups.matchups.find((m) => m.rosterId === 1);

    expect(currentRoster1?.starters).not.toEqual(week1Roster1?.starters);
  });

  it('drops a matchup with no usable roster_id', () => {
    expect(normaliseMatchup({ points: 10 })).toBeNull();
  });
});
