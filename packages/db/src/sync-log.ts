import { desc, eq, and } from 'drizzle-orm';
import type { Database } from './client.js';
import { syncLog } from './schema.js';
import type { SyncOutcome } from './schema.js';

/** Spec §5.2. One row per run, always -- success, failure or skipped. */

export interface SyncLogEntry {
  job: string;
  target?: string;
  startedAt: Date;
  durationMs: number;
  outcome: SyncOutcome;
  rowsAffected?: number;
  missingFields?: number;
  error?: string;
}

export async function recordSync(db: Database, entry: SyncLogEntry): Promise<void> {
  await db.insert(syncLog).values({
    job: entry.job,
    target: entry.target ?? 'global',
    startedAt: entry.startedAt,
    durationMs: entry.durationMs,
    outcome: entry.outcome,
    rowsAffected: entry.rowsAffected ?? null,
    missingFields: entry.missingFields ?? null,
    // Truncated: a stack trace from a 5MB parse can be enormous and this column is read by
    // humans at 09:00 on a Sunday.
    error: entry.error ? entry.error.slice(0, 2000) : null,
  });
}

/**
 * When did this job last succeed? `/health` reports it and Stage 9 alerts on it -- a sync
 * that quietly stops firing is otherwise invisible until the Sunday it matters.
 */
export async function lastSuccessfulSync(
  db: Database,
  job: string,
): Promise<{ startedAt: Date; durationMs: number | null } | null> {
  const rows = await db
    .select({ startedAt: syncLog.startedAt, durationMs: syncLog.durationMs })
    .from(syncLog)
    .where(and(eq(syncLog.job, job), eq(syncLog.outcome, 'success')))
    .orderBy(desc(syncLog.startedAt))
    .limit(1);

  return rows[0] ?? null;
}
