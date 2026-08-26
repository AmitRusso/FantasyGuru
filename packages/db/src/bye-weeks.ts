import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { teamByeWeeks } from './schema.js';

/**
 * Rule 2 (spec §3): `player.team ∈ byeWeeks[week]`, Critical severity.
 *
 * Both helpers filter `verified = true`, and that filter is the point (build-plan.md S4
 * Decision 3). The spec calls a false bye-week alarm "worse than no alarm at all", so an
 * unverified season must make rule 2 go SILENT, not make it go wrong. Add 2027's rows without
 * the second-source check and the alarm simply stops firing -- which is the correct direction
 * for a Critical rule to fail, and is asserted by a test rather than left to good intentions.
 *
 * Seeded by migration 0002 from fixtures/nfl/bye-weeks-2026.json, which carries four
 * independent sources and their full transcriptions.
 */

/** The bye week for one team, or null if unknown or not yet verified. */
export async function byeWeekForTeam(
  db: Database,
  season: string,
  team: string,
): Promise<number | null> {
  const rows = await db
    .select({ byeWeek: teamByeWeeks.byeWeek })
    .from(teamByeWeeks)
    .where(
      and(
        eq(teamByeWeeks.season, season),
        eq(teamByeWeeks.team, team),
        eq(teamByeWeeks.verified, true),
      ),
    )
    .limit(1);

  return rows[0]?.byeWeek ?? null;
}

/**
 * Every team on bye in a given week -- rule 2's actual lookup, as a Set so the rule reads as
 * the spec writes it (`player.team ∈ byeWeeks[week]`).
 *
 * Empty is a legitimate answer, not an error: there are no byes at all before Week 5, none in
 * Week 12, and none after Week 14 (spec §5.4).
 */
export async function byeTeamsForWeek(
  db: Database,
  season: string,
  week: number,
): Promise<Set<string>> {
  const rows = await db
    .select({ team: teamByeWeeks.team })
    .from(teamByeWeeks)
    .where(
      and(
        eq(teamByeWeeks.season, season),
        eq(teamByeWeeks.byeWeek, week),
        eq(teamByeWeeks.verified, true),
      ),
    );

  return new Set(rows.map((row) => row.team));
}

/** The whole verified table for a season, as `team -> byeWeek`. One query, for bulk work. */
export async function byeWeeksForSeason(
  db: Database,
  season: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ team: teamByeWeeks.team, byeWeek: teamByeWeeks.byeWeek })
    .from(teamByeWeeks)
    .where(and(eq(teamByeWeeks.season, season), eq(teamByeWeeks.verified, true)));

  return new Map(rows.map((row) => [row.team, row.byeWeek]));
}
