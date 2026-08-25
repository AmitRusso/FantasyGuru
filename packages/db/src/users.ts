import { sql, eq } from 'drizzle-orm';
import type { NormalisedUser } from '@fantasyguru/sleeper';
import type { Database } from './client.js';
import { users } from './schema.js';

/**
 * Identity only (spec §2.1): `sleeper_user_id` and `username`. No email, no timezone -- §2.1
 * is emphatic that nothing is asked for until after the person has seen their own leagues on
 * screen, and Stage 6 is where accounts acquire the rest. The columns already allow this:
 * `email` is nullable and `tz` defaults.
 *
 * `sleeperUserId` is the identity (spec §2.1's data-model gotcha: usernames are mutable).
 * `username` is refreshed on every upsert to the API's own canonical value -- see
 * build-plan.md S2 §2.8 item 5 -- which is what lets a second lookup by the same person
 * resolve consistently even if they typed a different case this time.
 */
export async function upsertUser(db: Database, user: NormalisedUser): Promise<{ id: string }> {
  const [row] = await db
    .insert(users)
    .values({ sleeperUserId: user.sleeperUserId, username: user.username })
    .onConflictDoUpdate({
      target: users.sleeperUserId,
      set: { username: sql`excluded.username` },
    })
    .returning({ id: users.id });

  if (!row) throw new Error(`upsertUser: no row returned for ${user.sleeperUserId}`);
  return row;
}

export async function getUserBySleeperId(
  db: Database,
  sleeperUserId: string,
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.sleeperUserId, sleeperUserId))
    .limit(1);
  return rows[0] ?? null;
}
