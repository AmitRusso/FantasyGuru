import { drizzle } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

/**
 * node-postgres against Neon, not the Neon HTTP driver.
 *
 * The API is an always-on Fly machine, so there is no serverless connection problem to solve,
 * and the HTTP driver cannot hold a session -- which both the Loop A transaction and the
 * advisory lock in build-plan.md S1 §1.3 require. Upstash Redis (spec §1) is the HTTP-shaped
 * dependency in this stack; the database is not.
 */

/**
 * Structural rather than `NodePgDatabase<typeof schema>`, so the same query helpers run
 * against node-postgres in production and against PGlite in the tests. Every helper in this
 * package is therefore exercised in CI on real Postgres semantics, not on a mock.
 */
export type Database = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface CreateDatabaseOptions {
  connectionString: string;
  /** Sized for Loop A plus Loop B's concurrency limiter of ~10 (spec §2.3). */
  max?: number;
}

export function createPool(options: CreateDatabaseOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

export { schema };
