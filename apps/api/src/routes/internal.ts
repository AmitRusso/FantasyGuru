import type { FastifyInstance } from 'fastify';
import { authenticateInternalRequest } from '../auth.js';
import type { AuthRequest } from '../auth.js';
import { runPlayersSync } from '../jobs/players-sync.js';

/**
 * Routes the scheduler calls. Nothing here is user-facing and nothing here is unauthenticated.
 */
export async function internalRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * QStash signs the raw request body, so this scope keeps the unparsed string around.
   * Content type parsers are encapsulated per plugin, so this does not affect any other route.
   */
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    (request as AuthRequest).rawBody = raw;
    try {
      done(null, raw.length > 0 ? JSON.parse(raw) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  fastify.addHook('onRequest', async (request, reply) => {
    const auth = await authenticateInternalRequest(request as AuthRequest, fastify.config);
    if (!auth.ok) {
      request.log.warn({ reason: auth.reason, path: request.url }, 'internal route rejected');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    request.log.info({ via: auth.via }, 'internal route authorised');
  });

  /**
   * Loop A. Idempotent: a retry re-upserts the same rows, and a *concurrent* retry is turned
   * away by the advisory lock.
   *
   * The skip returns 200, deliberately. A non-2xx here teaches QStash to retry a job that is
   * already running, which is the exact loop the lock exists to prevent (spec §1.1).
   */
  fastify.post('/internal/jobs/players-sync', async (_request, reply) => {
    const result = await runPlayersSync({
      db: fastify.db,
      pool: fastify.pool,
      sleeper: fastify.sleeper,
      logger: fastify.log,
    });

    if (result.status === 'skipped') {
      return reply.code(200).send({ skipped: result.reason });
    }

    return reply.code(200).send({
      upserted: result.upserted,
      batches: result.batches,
      missingFields: result.missingFields,
      skipped: result.skipped,
      week: result.week,
      durationMs: result.durationMs,
    });
  });
}
