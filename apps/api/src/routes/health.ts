import { lastSuccessfulSync } from '@fantasyguru/db';
import type { FastifyInstance } from 'fastify';
import { PLAYERS_SYNC_JOB } from '../jobs/players-sync.js';

/**
 * `/health` returns timestamps, not "ok".
 *
 * Stage 9's alerting hangs off this endpoint, and the failure it has to catch is not "the
 * process died" -- it is "the 03:00 job quietly stopped firing three weeks ago", which is
 * invisible until the Sunday it matters (build-plan.md S1 §1.4, §1.6).
 */

/** Loop A runs daily. Past 36 hours without a success, something is wrong. */
const PLAYERS_SYNC_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_request, reply) => {
    const checkedAt = new Date();

    let database: 'up' | 'down' = 'down';
    let lastPlayersSyncAt: string | null = null;
    let lastPlayersSyncAgeMs: number | null = null;

    try {
      await fastify.pool.query('select 1');
      database = 'up';

      const last = await lastSuccessfulSync(fastify.db, PLAYERS_SYNC_JOB);
      if (last) {
        lastPlayersSyncAt = last.startedAt.toISOString();
        lastPlayersSyncAgeMs = checkedAt.getTime() - last.startedAt.getTime();
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'health check could not reach the database');
    }

    const playersSyncStale =
      lastPlayersSyncAgeMs === null || lastPlayersSyncAgeMs > PLAYERS_SYNC_STALE_AFTER_MS;

    const healthy = database === 'up';

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      checkedAt: checkedAt.toISOString(),
      database,
      playersSync: {
        lastSuccessAt: lastPlayersSyncAt,
        ageMs: lastPlayersSyncAgeMs,
        stale: playersSyncStale,
        staleAfterMs: PLAYERS_SYNC_STALE_AFTER_MS,
      },
    });
  });
}
