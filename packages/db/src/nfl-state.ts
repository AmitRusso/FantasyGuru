import { sql } from 'drizzle-orm';
import type { NormalisedNflState } from '@fantasyguru/sleeper';
import type { Database } from './client.js';
import { nflState } from './schema.js';

/** The singleton current-week row. Written by Loop A, read by every later stage. */

export async function upsertNflState(db: Database, state: NormalisedNflState): Promise<void> {
  await db
    .insert(nflState)
    .values({
      id: 1,
      season: state.season,
      seasonType: state.seasonType,
      week: state.week,
      displayWeek: state.displayWeek,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: nflState.id,
      set: {
        season: sql`excluded.season`,
        seasonType: sql`excluded.season_type`,
        week: sql`excluded.week`,
        displayWeek: sql`excluded.display_week`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function getNflState(db: Database): Promise<typeof nflState.$inferSelect | null> {
  const rows = await db.select().from(nflState).limit(1);
  return rows[0] ?? null;
}
