import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createDatabase, createPool } from '@fantasyguru/db';
import type { Database } from '@fantasyguru/db';
import { SleeperClient } from '@fantasyguru/sleeper';
import type pg from 'pg';
import type { Config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { internalRoutes } from './routes/internal.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
    pool: pg.Pool;
    sleeper: SleeperClient;
  }
}

export interface BuildServerOptions {
  config: Config;
  /** Overridable so tests and the Stage 9 canary can drive a stub. */
  sleeper?: SleeperClient;
}

export async function buildServer({
  config,
  sleeper,
}: BuildServerOptions): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // The internal secret arrives in a header. It must never reach Sentry or the log drain.
      redact: ['req.headers["x-internal-secret"]', 'req.headers["upstash-signature"]'],
    },
    // The players payload is large; the job itself is slow by nature.
    requestTimeout: 120_000,
    bodyLimit: 1_048_576,
  });

  const pool = createPool({ connectionString: config.DATABASE_URL });
  const db = createDatabase(pool);

  fastify.decorate('config', config);
  fastify.decorate('pool', pool);
  fastify.decorate('db', db);
  fastify.decorate('sleeper', sleeper ?? new SleeperClient());

  fastify.addHook('onClose', async () => {
    await pool.end();
  });

  await fastify.register(healthRoutes);
  await fastify.register(internalRoutes);

  return fastify;
}
