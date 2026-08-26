import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client.js';
import { byeTeamsForWeek, byeWeekForTeam } from '../src/bye-weeks.js';
import { getSharedPlayers } from '../src/shared-players.js';
import { upsertUser } from '../src/users.js';
import { upsertLeagues } from '../src/leagues.js';
import { upsertRosters } from '../src/rosters.js';
import { upsertMembership } from '../src/memberships.js';
import { upsertPlayers } from '../src/players.js';
import { teamByeWeeks } from '../src/schema.js';
import * as schema from '../src/schema.js';

/**
 * Stage 4's two deliverables against real Postgres semantics via PGlite, same approach as
 * Stages 1 and 2.
 *
 * The migrations folder is the one the deployed database runs, so `team_bye_weeks` arrives
 * here already seeded with the 32 verified 2026 rows by migration 0002 -- meaning these
 * tests exercise the real seed, not a hand-made stand-in.
 */

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
const SEASON = '2026';

let client: PGlite;
let db: Database;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(db as never, { migrationsFolder });
});

afterAll(async () => {
  await client.close();
});

describe('bye-week read helpers', () => {
  it('serve the seeded 2026 table', async () => {
    expect(await byeWeekForTeam(db, SEASON, 'KC')).toBe(5);
    expect(await byeWeekForTeam(db, SEASON, 'LAR')).toBe(11);
    expect(await byeWeekForTeam(db, SEASON, 'DAL')).toBe(14);
  });

  it('answer null for a team with no row, rather than throwing', async () => {
    // The Raiders' old code, which still appears on one stale player row in production.
    expect(await byeWeekForTeam(db, SEASON, 'OAK')).toBeNull();
  });

  it('return the whole week as a set — rule 2 reads `player.team ∈ byeWeeks[week]`', async () => {
    expect([...(await byeTeamsForWeek(db, SEASON, 11))].sort()).toEqual([
      'ATL',
      'CLE',
      'GB',
      'LAR',
      'NE',
      'SEA',
    ]);
  });

  it('return an empty set for the weeks that genuinely have no byes', async () => {
    for (const week of [1, 4, 12, 15, 18]) {
      expect(await byeTeamsForWeek(db, SEASON, week)).toEqual(new Set());
    }
  });

  /**
   * build-plan.md S4 Decision 3. Rule 2 is Critical, and spec §3 says a false bye-week alarm
   * is "worse than no alarm at all" -- so unverified reference data must make the rule go
   * SILENT rather than go wrong. Adding a season and forgetting the second source should cost
   * an alarm, never fire a wrong one.
   */
  it('are blind to unverified rows, in whatever season', async () => {
    await db
      .insert(teamByeWeeks)
      .values({ season: '2027', team: 'KC', byeWeek: 9, verified: false });

    expect(await byeWeekForTeam(db, '2027', 'KC')).toBeNull();
    expect(await byeTeamsForWeek(db, '2027', 9)).toEqual(new Set());
  });
});

/* ------------------------------------------------------- the shared-player view -- */

/**
 * Three leagues for one user, built to put every status in play at once:
 *
 *   ALPHA  QB/RB/WR/FLEX/BN   starts mahomes, kelce      benches nacua
 *   BETA   QB/RB/WR/BN        starts mahomes             IR nacua, benches kelce
 *   GAMMA  QB/RB/BN           starts mahomes             (empty WR slot), benches noone
 *
 * mahomes is in all three, nacua and kelce in two, `solo` in one only.
 */
const MAHOMES = 'p-mahomes';
const NACUA = 'p-nacua';
const KELCE = 'p-kelce';
const SOLO = 'p-solo';
const TAXI_GUY = 'p-taxi';

beforeAll(async () => {
  await upsertPlayers(db, [
    {
      sleeperPlayerId: MAHOMES,
      fullName: 'Patrick Mahomes',
      team: 'KC',
      position: 'QB',
      status: 'Active',
      injuryStatus: null,
      practiceParticipation: null,
      depthChartOrder: 1,
    },
    {
      sleeperPlayerId: NACUA,
      fullName: 'Puka Nacua',
      team: 'LAR',
      position: 'WR',
      status: 'Active',
      injuryStatus: null,
      practiceParticipation: null,
      depthChartOrder: 1,
    },
    {
      sleeperPlayerId: KELCE,
      fullName: 'Travis Kelce',
      team: 'KC',
      position: 'TE',
      status: 'Active',
      injuryStatus: 'Questionable',
      practiceParticipation: null,
      depthChartOrder: 1,
    },
    {
      sleeperPlayerId: SOLO,
      fullName: 'Only One League',
      team: 'BUF',
      position: 'RB',
      status: 'Active',
      injuryStatus: null,
      practiceParticipation: null,
      depthChartOrder: 1,
    },
    {
      sleeperPlayerId: TAXI_GUY,
      fullName: 'Taxi Squad Guy',
      team: 'NYJ',
      position: 'WR',
      status: 'Active',
      injuryStatus: null,
      practiceParticipation: null,
      depthChartOrder: 3,
    },
  ]);

  await upsertLeagues(db, [
    {
      sleeperLeagueId: 'ALPHA',
      name: 'Alpha',
      season: SEASON,
      totalRosters: 10,
      rosterPositions: ['QB', 'RB', 'WR', 'FLEX', 'BN'],
      scoringSettings: null,
    },
    {
      sleeperLeagueId: 'BETA',
      name: 'Beta',
      season: SEASON,
      totalRosters: 10,
      rosterPositions: ['QB', 'RB', 'WR', 'BN', 'IR'],
      scoringSettings: null,
    },
    {
      sleeperLeagueId: 'GAMMA',
      name: 'Gamma',
      season: SEASON,
      totalRosters: 10,
      rosterPositions: ['QB', 'RB', 'BN'],
      scoringSettings: null,
    },
    {
      sleeperLeagueId: 'OLDSEASON',
      name: 'Last Year',
      season: '2025',
      totalRosters: 10,
      rosterPositions: ['QB', 'BN'],
      scoringSettings: null,
    },
  ]);

  const { id: userId } = await upsertUser(db, {
    sleeperUserId: 'shared-user',
    username: 'sharer',
    displayName: null,
  });

  await upsertRosters(db, 'ALPHA', [
    {
      rosterId: 1,
      ownerUserId: 'shared-user',
      players: [MAHOMES, KELCE, NACUA, SOLO],
      starters: [MAHOMES, SOLO, '0', KELCE],
      reserve: [],
      taxi: [],
    },
  ]);
  await upsertRosters(db, 'BETA', [
    // The empty RB slot uses "0" rather than a literal null deliberately -- see the
    // PGlite note in the sentinel test below.
    {
      rosterId: 2,
      ownerUserId: 'shared-user',
      players: [MAHOMES, KELCE, NACUA, TAXI_GUY],
      starters: [MAHOMES, '0', KELCE],
      reserve: [NACUA],
      taxi: [TAXI_GUY],
    },
  ]);
  await upsertRosters(db, 'GAMMA', [
    {
      rosterId: 3,
      ownerUserId: 'shared-user',
      players: [MAHOMES],
      starters: [MAHOMES, '0'],
      reserve: [],
      taxi: [],
    },
  ]);
  await upsertRosters(db, 'OLDSEASON', [
    {
      rosterId: 4,
      ownerUserId: 'shared-user',
      players: [SOLO],
      starters: [SOLO],
      reserve: [],
      taxi: [],
    },
  ]);

  for (const [leagueId, rosterId] of [
    ['ALPHA', 1],
    ['BETA', 2],
    ['GAMMA', 3],
    ['OLDSEASON', 4],
  ] as const) {
    await upsertMembership(db, { userId, leagueId, rosterId });
  }
});

describe('getSharedPlayers', () => {
  it('returns null for a Sleeper user we have never synced', async () => {
    expect(await getSharedPlayers(db, 'never-seen', SEASON)).toBeNull();
  });

  it('includes only the requested season', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    expect(view?.leagues.map((l) => l.leagueId).sort()).toEqual(['ALPHA', 'BETA', 'GAMMA']);
  });

  it('reports a player in two or more leagues, and no one else', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    const ids = view!.sharedPlayers.map((p) => p.playerId).sort();

    // SOLO is rostered in ALPHA this season and in OLDSEASON last season -- one league in
    // scope, so not shared. TAXI_GUY is in BETA only.
    expect(ids).toEqual([KELCE, MAHOMES, NACUA].sort());
  });

  it('does not pre-judge for rule 7: a player started everywhere is still shared', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    const mahomes = view!.sharedPlayers.find((p) => p.playerId === MAHOMES)!;

    // Started in all three. Rule 7 will not fire on him -- but that is rule 7's filter to
    // apply, and artboard 06 wants to show him regardless.
    expect(mahomes.leagues.map((l) => l.status)).toEqual(['started', 'started', 'started']);
    expect(mahomes.leagues).toHaveLength(3);
  });

  /**
   * build-plan.md S4 Decision 5, the finding of the stage, stated as a regression test.
   *
   * Spec §3 rule 7 detects `pid ∈ (B.players − B.starters)`. Nacua is on IR in BETA, which
   * puts him in `players` and not in `starters` -- so the spec's formula calls that a bench
   * decision the user should fix. It is not one. 9 of 12 rosters in the captured real league
   * have someone on IR, so this is the common case, not an edge case.
   */
  it('does not call an IR stash "benched"', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    const nacua = view!.sharedPlayers.find((p) => p.playerId === NACUA)!;

    const beta = nacua.leagues.find((l) => l.leagueId === 'BETA')!;
    expect(beta.status).toBe('reserve');
    expect(beta.status).not.toBe('benched');

    const alpha = nacua.leagues.find((l) => l.leagueId === 'ALPHA')!;
    expect(alpha.status).toBe('benched');

    const betaLineup = view!.leagues.find((l) => l.leagueId === 'BETA')!;
    expect(betaLineup.bench).not.toContain(NACUA);
    expect(betaLineup.reserve).toEqual([NACUA]);
  });

  it('does not call a taxi-squad player "benched" either', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    const beta = view!.leagues.find((l) => l.leagueId === 'BETA')!;

    expect(beta.taxi).toEqual([TAXI_GUY]);
    expect(beta.bench).not.toContain(TAXI_GUY);
    // Everyone accounted for: 4 players = 2 started + 1 IR + 1 taxi + 0 bench.
    expect(beta.bench).toEqual([]);
  });

  it('finds the started-here / benched-there case rule 7 exists for', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    const kelce = view!.sharedPlayers.find((p) => p.playerId === KELCE)!;

    expect(kelce.leagues.find((l) => l.leagueId === 'ALPHA')?.status).toBe('started');
    expect(kelce.leagues.find((l) => l.leagueId === 'BETA')?.status).toBe('started');
  });

  it('joins the verified bye week onto each shared player', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    const byId = new Map(view!.sharedPlayers.map((p) => [p.playerId, p]));

    expect(byId.get(MAHOMES)?.byeWeek).toBe(5); // KC
    expect(byId.get(NACUA)?.byeWeek).toBe(11); // LAR
    expect(byId.get(KELCE)?.byeWeek).toBe(5); // KC
  });

  it('carries the injury status rules 3-5 will read', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    const kelce = view!.sharedPlayers.find((p) => p.playerId === KELCE)!;
    expect(kelce.injuryStatus).toBe('Questionable');
    expect(kelce.position).toBe('TE');
  });

  it('orders the most-shared players first', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    expect(view!.sharedPlayers[0]?.playerId).toBe(MAHOMES);
  });
});

describe('slot labelling', () => {
  it('labels each starting slot from the non-bench roster_positions, positionally', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    const alpha = view!.leagues.find((l) => l.leagueId === 'ALPHA')!;

    // roster_positions QB/RB/WR/FLEX/BN -> four starting slots, BN excluded.
    expect(alpha.slots.map((s) => s.label)).toEqual(['QB', 'RB', 'WR', 'FLEX']);
    expect(alpha.slots.map((s) => s.playerId)).toEqual([MAHOMES, SOLO, null, KELCE]);
  });

  it('excludes IR and TAXI from the starting slots, not just BN', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);
    const beta = view!.leagues.find((l) => l.leagueId === 'BETA')!;

    // roster_positions QB/RB/WR/BN/IR -> three starting slots.
    expect(beta.slots.map((s) => s.label)).toEqual(['QB', 'RB', 'WR']);
  });

  /**
   * Spec §3 rule 1 says an empty starting slot is `starters[i] == "0" or null`.
   *
   * Only the "0" half is asserted here, and the reason is a test-harness limitation rather
   * than a gap in the code: PGlite's client-side array parser returns the literal STRING
   * "NULL" for a null element inside a `text[]` column. That was established in Stage 2 and
   * verified two independent ways against the real deployed database -- see the long note in
   * packages/db/test/league-sync.test.ts. node-postgres, which is what apps/api actually
   * runs, hands back a real JS `null`, which `getSharedPlayers` collapses on the same line as
   * "0".
   *
   * So the null branch is real and is exercised in production; PGlite simply cannot express
   * the input. "0" is in any case the only sentinel ever OBSERVED live, repeatedly, in real
   * responses (build-plan.md S2 §2.8).
   */
  it('collapses Sleeper\'s "0" sentinel to a null playerId', async () => {
    const view = await getSharedPlayers(db, 'shared-user', SEASON);

    // ALPHA's WR slot and BETA's RB slot both hold "0".
    expect(view!.leagues.find((l) => l.leagueId === 'ALPHA')!.slots[2]?.playerId).toBeNull();
    expect(view!.leagues.find((l) => l.leagueId === 'BETA')!.slots[1]?.playerId).toBeNull();
  });

  /**
   * build-plan.md S4 §4.2. The alignment held for all 216 rosters checked, but Sleeper does
   * not guarantee it -- and a mislabelled FLEX would hand rule 7's suppression clause a wrong
   * answer with complete confidence. Degrade to "I don't know" rather than to a lie.
   */
  it('labels nothing at all rather than guessing when the counts disagree', async () => {
    await upsertLeagues(db, [
      {
        sleeperLeagueId: 'SKEW',
        name: 'Skewed',
        season: SEASON,
        totalRosters: 10,
        rosterPositions: ['QB', 'RB', 'BN'],
        scoringSettings: null,
      },
    ]);
    const { id: userId } = await upsertUser(db, {
      sleeperUserId: 'skew-user',
      username: 'skewed',
      displayName: null,
    });
    // Three starters against two non-bench slots.
    await upsertRosters(db, 'SKEW', [
      {
        rosterId: 1,
        ownerUserId: 'skew-user',
        players: [MAHOMES, KELCE, SOLO],
        starters: [MAHOMES, KELCE, SOLO],
        reserve: [],
        taxi: [],
      },
    ]);
    await upsertMembership(db, { userId, leagueId: 'SKEW', rosterId: 1 });

    const view = await getSharedPlayers(db, 'skew-user', SEASON);
    const skew = view!.leagues.find((l) => l.leagueId === 'SKEW')!;

    expect(skew.slots).toHaveLength(3);
    expect(skew.slots.map((s) => s.label)).toEqual([null, null, null]);
    // The players are still reported -- only the labelling is withheld.
    expect(skew.slots.map((s) => s.playerId)).toEqual([MAHOMES, KELCE, SOLO]);
  });
});
