import type pg from 'pg';

/**
 * Postgres advisory locks, used to make the scheduled jobs safe against overlapping runs
 * (build-plan.md S1 §1.3).
 *
 * QStash retries on timeout. For Loop A a retry is harmless -- it is an upsert -- but a retry
 * that starts while the first run is still parsing 5MB is not. This is the guard.
 *
 * Session-level rather than transaction-level (`pg_try_advisory_xact_lock`) on purpose: the
 * job holds the lock across a ~15MB HTTP fetch, and holding an open transaction for the length
 * of a network call is how you end up with idle-in-transaction connections pinned on a Sunday.
 */

export const LOCK_ACQUIRED = 'acquired';
export const LOCK_BUSY = 'busy';

export type AdvisoryLockResult<T> =
  { status: typeof LOCK_ACQUIRED; value: T } | { status: typeof LOCK_BUSY };

/**
 * Runs `fn` iff the named lock is free. Returns `{ status: 'busy' }` rather than throwing --
 * the caller turns that into a 200, because a non-2xx teaches QStash to retry a job that is
 * already running.
 *
 * The lock is released in a `finally` on the same session it was taken on, and the connection
 * is destroyed rather than returned to the pool if the unlock itself fails, so a leaked lock
 * cannot outlive the process.
 */
export async function withAdvisoryLock<T>(
  pool: pg.Pool,
  lockName: string,
  fn: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  const client = await pool.connect();
  let acquired = false;

  try {
    const result = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtext($1)::bigint) as locked',
      [lockName],
    );

    acquired = result.rows[0]?.locked === true;
    if (!acquired) return { status: LOCK_BUSY };

    return { status: LOCK_ACQUIRED, value: await fn() };
  } finally {
    if (acquired) {
      try {
        await client.query('select pg_advisory_unlock(hashtext($1)::bigint)', [lockName]);
        client.release();
      } catch {
        // Could not unlock: the session is in an unknown state, so drop the connection
        // entirely. Postgres releases session locks when the backend goes away.
        client.release(true);
      }
    } else {
      client.release();
    }
  }
}
