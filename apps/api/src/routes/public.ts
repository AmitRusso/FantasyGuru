import type { FastifyInstance } from 'fastify';
import { NflStateNotSyncedError, syncUserLeagues } from '../services/league-sync.js';

/**
 * The first unauthenticated PUBLIC surface in the project (build-plan.md S2 §2.6). Stage 3
 * consumes exactly this one route for the ten-second onboarding path (spec §2.1).
 *
 * Three defences against abuse, in order: the cache absorbs repeats, the token bucket caps
 * what reaches Sleeper no matter how hard this route is hit, and a per-IP throttle
 * (registered in server.ts) keeps one client from monopolising the bucket.
 */
export async function publicRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { username: string } }>(
    '/v1/users/:username/leagues',
    // Third of the three defences on this route (build-plan.md S2 §2.6): the cache absorbs
    // repeats and the token bucket caps what reaches Sleeper regardless, but neither stops
    // one caller from monopolising the bucket at everyone else's expense. `global: false` on
    // the plugin registration in server.ts means this is opt-in per route, not a default.
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { username } = request.params;

      if (!username || username.length > 64) {
        return reply.code(400).send({ error: 'invalid username' });
      }

      try {
        const result = await syncUserLeagues(
          {
            db: fastify.db,
            sleeper: fastify.sleeper,
            cache: fastify.cache,
            singleFlight: fastify.singleFlight,
            bucket: fastify.rateLimitBucket,
            semaphore: fastify.rateLimitSemaphore,
            logger: fastify.log,
          },
          username,
        );

        if (result.status === 'not_found') {
          // CONFIRMED live 25 Aug 2026: Sleeper answers an unknown username with HTTP 200
          // and a body of null, not a 404 (build-plan.md S2 §2.2). This route corrects that
          // -- a real 404 is what makes "I typed my username wrong" distinguishable from
          // every other failure mode for a caller.
          return reply.code(404).send({ error: 'unknown Sleeper username' });
        }

        return reply.code(200).send({
          userId: result.userId,
          sleeperUserId: result.sleeperUserId,
          leagues: result.leagues.map(({ league, myRoster }) => ({
            leagueId: league.sleeperLeagueId,
            name: league.name,
            season: league.season,
            totalRosters: league.totalRosters,
            rosterPositions: league.rosterPositions,
            myRoster: myRoster
              ? {
                  rosterId: myRoster.rosterId,
                  players: myRoster.players,
                  starters: myRoster.starters,
                }
              : null,
          })),
        });
      } catch (error) {
        if (error instanceof NflStateNotSyncedError) {
          request.log.error({ err: error }, 'nfl_state not synced yet');
          return reply.code(503).send({ error: 'service warming up, try again shortly' });
        }
        throw error;
      }
    },
  );
}
