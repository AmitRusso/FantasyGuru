import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createDatabase, createPool } from '@fantasyguru/db';
import type { Database } from '@fantasyguru/db';
import {
  SingleFlight,
  SleeperClient,
  Semaphore,
  TokenBucket,
  createUpstashCacheStore,
  failOpen,
} from '@fantasyguru/sleeper';
import type { CacheStore } from '@fantasyguru/sleeper';
import type pg from 'pg';
import type { Config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { internalRoutes } from './routes/internal.js';
import { publicRoutes } from './routes/public.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
    pool: pg.Pool;
    sleeper: SleeperClient;
    cache: CacheStore;
    singleFlight: SingleFlight;
    /** The real limit -- calls/minute against Sleeper's published ceiling (spec §2.3). */
    rateLimitBucket: TokenBucket;
    /** Caps in-flight sockets. Concurrency is not throughput -- see build-plan.md S2 Decision 3. */
    rateLimitSemaphore: Semaphore;
  }
}

export interface BuildServerOptions {
  config: Config;
  /** Overridable so tests and the Stage 9 canary can drive a stub. */
  sleeper?: SleeperClient;
  /** Overridable so tests can inject an in-memory store without real Upstash credentials. */
  cache?: CacheStore;
}

/**
 * A cache that always misses. Used when Redis credentials are not configured, so the sync
 * service degrades to hitting Sleeper (and its own DB-freshness fallback, Decision 4) rather
 * than the process failing to boot -- matching Stage 1's "nothing breaks without accounts"
 * posture.
 */
const NO_REDIS_STORE: CacheStore = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
};

export async function buildServer({
  config,
  sleeper,
  cache,
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

  const rawCache =
    cache ??
    (config.UPSTASH_REDIS_REST_URL && config.UPSTASH_REDIS_REST_TOKEN
      ? createUpstashCacheStore(config.UPSTASH_REDIS_REST_URL, config.UPSTASH_REDIS_REST_TOKEN)
      : NO_REDIS_STORE);

  fastify.decorate('config', config);
  fastify.decorate('pool', pool);
  fastify.decorate('db', db);
  fastify.decorate('sleeper', sleeper ?? new SleeperClient());
  fastify.decorate(
    'cache',
    failOpen(rawCache, {
      warn: (context) => fastify.log.warn(context, 'cache operation failed; failing open'),
    }),
  );
  fastify.decorate('singleFlight', new SingleFlight());
  fastify.decorate('rateLimitBucket', new TokenBucket());
  fastify.decorate('rateLimitSemaphore', new Semaphore(10));

  fastify.addHook('onClose', async () => {
    await pool.end();
  });

  // Third of the three defences on the public route (build-plan.md S2 §2.6): the cache
  // absorbs repeats and the token bucket caps what reaches Sleeper regardless, but neither
  // stops one caller from monopolising the bucket at everyone else's expense.
  await fastify.register(rateLimit, {
    global: false,
    max: 30,
    timeWindow: '1 minute',
  });

  await fastify.register(healthRoutes);
  await fastify.register(internalRoutes);
  // `global: false` above means the throttle applies only where a route opts in -- publicRoutes
  // does, via `config.rateLimit` on the route itself. /health and /internal/* stay unthrottled:
  // Fly polls /health every 30s and QStash/manual triggers must never be rate-limited by IP.
  await fastify.register(publicRoutes);

  return fastify;
}
