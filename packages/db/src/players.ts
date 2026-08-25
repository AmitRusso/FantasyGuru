import { sql } from 'drizzle-orm';
import type { NormalisedPlayer } from '@fantasyguru/sleeper';
import { players } from './schema.js';
import type { Database } from './client.js';

/**
 * Loop A's write path (build-plan.md S1 §1.3).
 *
 * Lives in packages/db rather than in the job so it can be tested against real Postgres
 * semantics via PGlite, without standing up the API.
 */

/**
 * 500 rows/statement. Each player is 8 bound parameters, so a batch is ~4,000 parameters --
 * comfortably under Postgres's 65,535 limit, with room for the columns Stage 2+ may add.
 */
export const PLAYER_UPSERT_BATCH_SIZE = 500;

export interface UpsertPlayersResult {
  upserted: number;
  batches: number;
}

/**
 * Idempotent by construction: the daily re-run writes the same rows and changes nothing but
 * `updated_at`.
 *
 * There is deliberately no delete path. Players that vanish upstream stay, because
 * `rosters.players[]` still references them and a roster row pointing at a row we deleted is
 * a Stage 5 crash on a Sunday morning.
 */
export async function upsertPlayers(
  db: Database,
  rows: NormalisedPlayer[],
  batchSize: number = PLAYER_UPSERT_BATCH_SIZE,
): Promise<UpsertPlayersResult> {
  if (rows.length === 0) return { upserted: 0, batches: 0 };

  // One transaction for the whole sweep: a half-written player table is worse than a stale
  // one, because the alarm reads it without knowing which half it got.
  return db.transaction(async (tx) => {
    let upserted = 0;
    let batches = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize).map((row) => ({
        sleeperPlayerId: row.sleeperPlayerId,
        fullName: row.fullName,
        team: row.team,
        position: row.position,
        status: row.status,
        injuryStatus: row.injuryStatus,
        practiceParticipation: row.practiceParticipation,
        depthChartOrder: row.depthChartOrder,
        updatedAt: new Date(),
      }));

      await tx
        .insert(players)
        .values(batch)
        .onConflictDoUpdate({
          target: players.sleeperPlayerId,
          set: {
            fullName: sql`excluded.full_name`,
            team: sql`excluded.team`,
            position: sql`excluded.position`,
            status: sql`excluded.status`,
            injuryStatus: sql`excluded.injury_status`,
            practiceParticipation: sql`excluded.practice_participation`,
            depthChartOrder: sql`excluded.depth_chart_order`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      upserted += batch.length;
      batches += 1;
    }

    return { upserted, batches };
  });
}
