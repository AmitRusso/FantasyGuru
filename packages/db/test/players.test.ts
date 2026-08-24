import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NormalisedPlayer } from '@fantasyguru/sleeper';
import type { Database } from '../src/client.js';
import { upsertPlayers } from '../src/players.js';
import { alarmsSent, leagues, players, users } from '../src/schema.js';
import * as schema from '../src/schema.js';

/**
 * build-plan.md S1 §1.5, test 2 -- the batched upsert against real Postgres semantics.
 *
 * PGlite runs Postgres in-process, so CI needs no service container and the assertions below
 * are about actual behaviour (ON CONFLICT, NULLS NOT DISTINCT) rather than about Drizzle's
 * query builder.
 */

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

let client: PGlite;
let db: Database;

async function countPlayers(where?: SQL): Promise<number> {
  const query = db.select({ count: sql<number>`count(*)::int` }).from(players);
  const rows = where ? await query.where(where) : await query;
  return rows[0]?.count ?? 0;
}

function makePlayer(index: number, overrides: Partial<NormalisedPlayer> = {}): NormalisedPlayer {
  return {
    sleeperPlayerId: `p${index}`,
    fullName: `Player ${index}`,
    team: 'BUF',
    position: 'WR',
    status: 'Active',
    injuryStatus: null,
    practiceParticipation: null,
    depthChartOrder: 1,
    ...overrides,
  };
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  // The committed migration is what runs here -- so the test also proves the migration
  // applies cleanly to an empty database, which is what CI does per PR against a Neon branch.
  await migrate(db as never, { migrationsFolder });
});

afterAll(async () => {
  await client.close();
});

describe('upsertPlayers', () => {
  it('inserts a full sweep in batches and re-runs idempotently', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => makePlayer(i));

    const first = await upsertPlayers(db, rows);
    expect(first.upserted).toBe(1200);
    expect(first.batches).toBe(3); // 500 + 500 + 200

    expect(await countPlayers()).toBe(1200);

    // The daily re-run: 300 players changed, 900 identical, nothing new.
    const changed = rows.map((row, i) =>
      i < 300 ? { ...row, injuryStatus: 'Out', status: 'Inactive' } : row,
    );

    const second = await upsertPlayers(db, changed);
    expect(second.upserted).toBe(1200);

    // Re-running adds no rows -- the assertion that the daily sweep is genuinely idempotent.
    expect(await countPlayers()).toBe(1200);
    expect(await countPlayers(eq(players.injuryStatus, 'Out'))).toBe(300);
  });

  it('updates every mutable column on conflict', async () => {
    await upsertPlayers(db, [makePlayer(9001)]);
    await upsertPlayers(db, [
      makePlayer(9001, {
        fullName: 'Renamed Player',
        team: 'KC',
        position: 'TE',
        status: 'Inactive',
        injuryStatus: 'IR',
        practiceParticipation: 'DNP',
        depthChartOrder: 4,
      }),
    ]);

    const [row] = await db.select().from(players).where(eq(players.sleeperPlayerId, 'p9001'));
    expect(row).toMatchObject({
      fullName: 'Renamed Player',
      team: 'KC',
      position: 'TE',
      status: 'Inactive',
      injuryStatus: 'IR',
      practiceParticipation: 'DNP',
      depthChartOrder: 4,
    });
  });

  it('never deletes players that disappear upstream', async () => {
    // rosters.players[] still references them; a dangling id is a Stage 5 crash.
    await upsertPlayers(db, [makePlayer(7001), makePlayer(7002)]);
    await upsertPlayers(db, [makePlayer(7001)]);

    const survivors = await db.select().from(players).where(eq(players.sleeperPlayerId, 'p7002'));
    expect(survivors).toHaveLength(1);
  });

  it('handles an empty sweep without opening a transaction', async () => {
    expect(await upsertPlayers(db, [])).toEqual({ upserted: 0, batches: 0 });
  });
});

describe('alarms_sent dedupe constraint', () => {
  /**
   * Spec §2.3 calls this constraint "the difference between a useful app and one people mute
   * in week two", so it is asserted here rather than trusted. The NULLS NOT DISTINCT half is
   * the part the spec's own SQL would have got wrong.
   */
  it('rejects a duplicate alarm, including when player_id is null', async () => {
    const [user] = await db
      .insert(users)
      .values({ sleeperUserId: 'sleeper-1', username: 'guru' })
      .returning();
    await db
      .insert(leagues)
      .values({ sleeperLeagueId: 'league-1', name: 'Dynasty Degenerates', season: '2026' });

    const alarm = { userId: user!.id, leagueId: 'league-1', rule: 3, playerId: '4983', week: 6 };
    await db.insert(alarmsSent).values(alarm);
    await expect(db.insert(alarmsSent).values(alarm)).rejects.toThrow();

    // Rule 1 -- an empty starting slot has no player id. Under a plain UNIQUE, Postgres
    // treats each NULL as distinct and this second insert would succeed, re-sending the same
    // alarm at 09:00 and again at 11:30 every Sunday.
    const emptySlot = { userId: user!.id, leagueId: 'league-1', rule: 1, playerId: null, week: 6 };
    await db.insert(alarmsSent).values(emptySlot);
    await expect(db.insert(alarmsSent).values(emptySlot)).rejects.toThrow();

    // A different week is a different alarm and must still be allowed through.
    await db.insert(alarmsSent).values({ ...emptySlot, week: 7 });
  });
});
