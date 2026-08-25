import {
  LOCK_ACQUIRED,
  recordSync,
  upsertNflState,
  upsertPlayers,
  withAdvisoryLock,
} from '@fantasyguru/db';
import type { Database } from '@fantasyguru/db';
import type { SleeperClient } from '@fantasyguru/sleeper';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Loop A -- the player universe (spec §2.2).
 *
 * Runs daily at 03:00 ET. Fetches `/v1/players/nfl` ONCE GLOBALLY -- never per user, never
 * per request -- and refreshes the current NFL week alongside it.
 */

export const PLAYERS_SYNC_JOB = 'players-sync';

export type PlayersSyncResult =
  | {
      status: 'ok';
      upserted: number;
      batches: number;
      missingFields: number;
      skipped: number;
      week: number | null;
      durationMs: number;
    }
  | { status: 'skipped'; reason: 'locked' };

export interface PlayersSyncDeps {
  db: Database;
  pool: pg.Pool;
  sleeper: SleeperClient;
  logger: FastifyBaseLogger;
}

export async function runPlayersSync({
  db,
  pool,
  sleeper,
  logger,
}: PlayersSyncDeps): Promise<PlayersSyncResult> {
  // Overlap guard. QStash retries on timeout, and a retry landing while the first run is
  // still parsing 5MB is the case this exists for.
  const outcome = await withAdvisoryLock(pool, PLAYERS_SYNC_JOB, async () => {
    const startedAt = new Date();
    const startedHr = performance.now();

    try {
      const { players, missingFields, skipped } = await sleeper.getPlayers();

      logger.info(
        { count: players.length, missingFields, skipped },
        'fetched sleeper player universe',
      );

      const { upserted, batches } = await upsertPlayers(db, players);

      // The current week, in the same job. Cheap, and every later stage reads it.
      // A failure here must not lose the player write that already succeeded, so it is
      // caught rather than thrown.
      let week: number | null = null;
      try {
        const state = await sleeper.getNflState();
        await upsertNflState(db, state);
        week = state.week;
      } catch (error) {
        logger.error({ err: error }, 'nfl state refresh failed; players were still written');
      }

      const durationMs = Math.round(performance.now() - startedHr);

      await recordSync(db, {
        job: PLAYERS_SYNC_JOB,
        startedAt,
        durationMs,
        outcome: 'success',
        rowsAffected: upserted,
        missingFields,
      });

      // A non-zero missingFields count means Sleeper changed a field name. It is not an
      // error -- the lenient normaliser absorbed it -- but it is the signal Stage 9's
      // canary alerts on, so it is logged loudly here too.
      if (missingFields > 0 || skipped > 0) {
        logger.warn(
          { missingFields, skipped },
          'sleeper player payload had unexpected shape; check for an upstream change',
        );
      }

      return { status: 'ok' as const, upserted, batches, missingFields, skipped, week, durationMs };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedHr);

      await recordSync(db, {
        job: PLAYERS_SYNC_JOB,
        startedAt,
        durationMs,
        outcome: 'failure',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });

      throw error;
    }
  });

  if (outcome.status !== LOCK_ACQUIRED) {
    logger.info('players-sync already running; skipping this trigger');
    return { status: 'skipped', reason: 'locked' };
  }

  return outcome.value;
}
