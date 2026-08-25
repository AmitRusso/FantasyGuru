import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { memberships } from './schema.js';

/**
 * `memberships` links one of OUR registered users to the roster they own in a league --
 * built from `rosters.owner_id` matching the user's `sleeper_user_id`, not from the league's
 * full member list (`/league/{id}/users`), which includes people who have never signed up
 * with FantasyGuru and, per build-plan.md S2 §2.8 item 5, is not even 1:1 with rosters in
 * the first place. Resolving `user_id` -> `roster_id` per league is what makes rule 7
 * (cross-league inconsistency) possible later.
 */
export async function upsertMembership(
  db: Database,
  membership: { userId: string; leagueId: string; rosterId: number },
): Promise<void> {
  await db
    .insert(memberships)
    .values(membership)
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.leagueId],
      set: { rosterId: sql`excluded.roster_id` },
    });
}
