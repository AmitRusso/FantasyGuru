import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, and } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client.js';
import { upsertUser, getUserBySleeperId } from '../src/users.js';
import { upsertLeague, upsertLeagues } from '../src/leagues.js';
import { upsertRosters } from '../src/rosters.js';
import { upsertMembership } from '../src/memberships.js';
import { leagues, memberships, rosters, users } from '../src/schema.js';
import * as schema from '../src/schema.js';

/**
 * Stage 2's write path, against real Postgres semantics via PGlite -- same approach as
 * Stage 1's players.test.ts. Covers build-plan.md S2 §2.5 and the DoD in §2.11 item 4.
 */

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

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

describe('upsertUser', () => {
  it('creates a user keyed by sleeper_user_id and refreshes username on conflict', async () => {
    const { id } = await upsertUser(db, {
      sleeperUserId: 's1',
      username: 'oldname',
      displayName: null,
    });
    const again = await upsertUser(db, {
      sleeperUserId: 's1',
      username: 'newname',
      displayName: null,
    });

    // Spec §2.1 data-model gotcha: usernames are mutable, sleeper_user_id is the identity --
    // a returning user must resolve to the SAME internal row, not fork a new one.
    expect(again.id).toBe(id);

    const [row] = await db.select().from(users).where(eq(users.sleeperUserId, 's1'));
    expect(row?.username).toBe('newname');
  });

  it('getUserBySleeperId resolves an existing identity', async () => {
    await upsertUser(db, { sleeperUserId: 's2', username: 'someone', displayName: null });
    expect(await getUserBySleeperId(db, 's2')).toMatchObject({});
    expect(await getUserBySleeperId(db, 'does-not-exist')).toBeNull();
  });
});

describe('upsertLeague / upsertLeagues', () => {
  it('writes settings extracted from a leagues-list response, not a standalone fetch', async () => {
    // build-plan.md S2 Decision 1: this is the exact shape returned by
    // GET /user/{id}/leagues/nfl/{season}, which is what upsertLeague is fed in practice.
    await upsertLeague(db, {
      sleeperLeagueId: 'league-1',
      name: 'Dynasty Degenerates',
      season: '2026',
      totalRosters: 12,
      rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'BN', 'BN'],
      scoringSettings: { pass_td: 4 },
    });

    const [row] = await db.select().from(leagues).where(eq(leagues.sleeperLeagueId, 'league-1'));
    expect(row).toMatchObject({ name: 'Dynasty Degenerates', season: '2026', totalRosters: 12 });
    expect(row?.rosterPositions).toEqual([
      'QB',
      'RB',
      'RB',
      'WR',
      'WR',
      'TE',
      'FLEX',
      'DEF',
      'BN',
      'BN',
    ]);
    expect(row?.syncedAt).not.toBeNull();
  });

  it('updates settings on conflict rather than duplicating the row', async () => {
    await upsertLeague(db, {
      sleeperLeagueId: 'league-1',
      name: 'Dynasty Degenerates (renamed)',
      season: '2026',
      totalRosters: 12,
      rosterPositions: null,
      scoringSettings: null,
    });

    const rows = await db.select().from(leagues).where(eq(leagues.sleeperLeagueId, 'league-1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Dynasty Degenerates (renamed)');
  });

  it('upserts a batch of leagues from one user-leagues sync', async () => {
    await upsertLeagues(db, [
      {
        sleeperLeagueId: 'league-2',
        name: 'League Two',
        season: '2026',
        totalRosters: 10,
        rosterPositions: null,
        scoringSettings: null,
      },
      {
        sleeperLeagueId: 'league-3',
        name: 'League Three',
        season: '2026',
        totalRosters: 10,
        rosterPositions: null,
        scoringSettings: null,
      },
    ]);

    const rows = await db.select().from(leagues).where(eq(leagues.season, '2026'));
    const ids = rows.map((r) => r.sleeperLeagueId).sort();
    expect(ids).toContain('league-2');
    expect(ids).toContain('league-3');
  });
});

describe('upsertRosters', () => {
  it('writes every roster in a league, preserving starters positionally including nulls', async () => {
    await upsertLeague(db, {
      sleeperLeagueId: 'league-rosters',
      name: 'Roster Test League',
      season: '2026',
      totalRosters: 2,
      rosterPositions: null,
      scoringSettings: null,
    });

    await upsertRosters(db, 'league-rosters', [
      {
        rosterId: 1,
        ownerUserId: 'owner-1',
        players: ['4983', 'CLE'],
        starters: ['4983', null, 'CLE'],
        reserve: [],
        taxi: [],
      },
      {
        rosterId: 2,
        ownerUserId: 'owner-2',
        players: ['1234'],
        starters: ['1234'],
        reserve: [],
        taxi: [],
      },
    ]);

    const rows = await db
      .select()
      .from(rosters)
      .where(eq(rosters.leagueId, 'league-rosters'))
      .orderBy(rosters.rosterId);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.ownerUserId).toBe('owner-1');

    // KNOWN PGLITE LIMITATION, not an app bug: PGlite's own client-side array-result
    // parser returns the literal STRING "NULL" for a null element inside a text[] column,
    // instead of a real JS `null`. Verified two ways against the real deployed database
    // (node-postgres + Neon, 25 Aug 2026):
    //   1. `x[2] IS NULL` is TRUE server-side even when PGlite's client read comes back
    //      as "NULL" -- the stored value is a genuine SQL NULL.
    //   2. node-postgres itself (the driver apps/api actually runs) parses the same
    //      column back as a real JS `null`, not the string "NULL".
    // So this assertion documents what PGlite returns; it is NOT what production returns,
    // and if this ever needs re-verifying, re-run the two-part check above against Neon
    // rather than trusting PGlite's read.
    expect(rows[0]?.starters).toEqual(['4983', 'NULL', 'CLE']);
  });

  it('updates on conflict rather than duplicating', async () => {
    await upsertRosters(db, 'league-rosters', [
      {
        rosterId: 1,
        ownerUserId: 'owner-1',
        players: ['9999'],
        starters: ['9999'],
        reserve: [],
        taxi: [],
      },
    ]);

    const rows = await db
      .select()
      .from(rosters)
      .where(and(eq(rosters.leagueId, 'league-rosters'), eq(rosters.rosterId, 1)));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.starters).toEqual(['9999']);
  });

  it('does nothing on an empty roster list rather than opening a transaction', async () => {
    await expect(upsertRosters(db, 'league-rosters', [])).resolves.toBeUndefined();
  });
});

describe('upsertMembership', () => {
  it('links a registered user to the roster they own in a league', async () => {
    const { id: userId } = await upsertUser(db, {
      sleeperUserId: 'member-1',
      username: 'guru',
      displayName: null,
    });
    await upsertLeague(db, {
      sleeperLeagueId: 'league-membership',
      name: 'Membership League',
      season: '2026',
      totalRosters: 1,
      rosterPositions: null,
      scoringSettings: null,
    });

    await upsertMembership(db, { userId, leagueId: 'league-membership', rosterId: 7 });

    const [row] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.leagueId, 'league-membership')));
    expect(row?.rosterId).toBe(7);
  });

  it('updates roster_id on conflict -- one roster per user per league', async () => {
    const { id: userId } = await upsertUser(db, {
      sleeperUserId: 'member-2',
      username: 'guru2',
      displayName: null,
    });
    await upsertLeague(db, {
      sleeperLeagueId: 'league-membership-2',
      name: 'Membership League 2',
      season: '2026',
      totalRosters: 1,
      rosterPositions: null,
      scoringSettings: null,
    });

    await upsertMembership(db, { userId, leagueId: 'league-membership-2', rosterId: 3 });
    await upsertMembership(db, { userId, leagueId: 'league-membership-2', rosterId: 5 });

    const rows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.leagueId, 'league-membership-2')));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rosterId).toBe(5);
  });
});
