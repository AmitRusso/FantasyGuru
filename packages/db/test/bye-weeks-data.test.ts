import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Spec §3 calls the bye table "the cheapest artifact in this entire spec and by far the most
 * humiliating one to get wrong", and asks for it to be entered and then verified a second
 * time from a different source.
 *
 * These tests are what turns that instruction into something the build re-checks on every
 * run instead of a claim made once. Nothing here touches a database: the subject is the
 * DATA, and the data is wrong or right long before Postgres sees it.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

interface ByeFixture {
  season: string;
  sources: { id: string; name: string; url: string }[];
  teamNames: Record<string, string>;
  byWeekAsPublished: Record<string, string[]>;
  transcriptions: Record<string, Record<string, number>>;
}

const fixture = JSON.parse(
  readFileSync(`${repoRoot}/fixtures/nfl/bye-weeks-2026.json`, 'utf8'),
) as ByeFixture;

const seedSql = readFileSync(
  `${repoRoot}/packages/db/migrations/0002_seed_2026_bye_weeks.sql`,
  'utf8',
);

/**
 * The 32 Sleeper team abbreviations, confirmed against all 12,225 rows of the live `players`
 * table on 26 Aug 2026 (build-plan.md S4 Decision 4). These are rule 2's join key: a code
 * that does not match `players.team` means that team's byes never fire, and nothing anywhere
 * reports an error.
 *
 * Note the live table actually holds 33 distinct codes -- one stale `OAK` row survives for a
 * guard, six years after the Raiders became `LV`. Harmless (a guard is not rosterable in any
 * Sleeper fantasy format) but it is exactly the class of drift this list exists to catch.
 */
const SLEEPER_TEAMS = [
  'ARI',
  'ATL',
  'BAL',
  'BUF',
  'CAR',
  'CHI',
  'CIN',
  'CLE',
  'DAL',
  'DEN',
  'DET',
  'GB',
  'HOU',
  'IND',
  'JAX',
  'KC',
  'LAC',
  'LAR',
  'LV',
  'MIA',
  'MIN',
  'NE',
  'NO',
  'NYG',
  'NYJ',
  'PHI',
  'PIT',
  'SEA',
  'SF',
  'TB',
  'TEN',
  'WAS',
];

/** `('2026', 'ARI', 14, true)` -> ['ARI', 14] */
function parseSeed(sql: string): Map<string, number> {
  const rows = new Map<string, number>();
  const pattern = /\('2026',\s*'([A-Z]{2,3})',\s*(\d+),\s*true\)/g;
  for (const match of sql.matchAll(pattern)) {
    rows.set(match[1]!, Number(match[2]));
  }
  return rows;
}

const seeded = parseSeed(seedSql);
const canonical = fixture.transcriptions.A!;

describe('the four sources agree', () => {
  /**
   * Spec §3: "Enter it, then verify it a second time from a different source." Four sources
   * were consulted rather than two, because each page was read through a summarising model --
   * a transcription risk the spec does not anticipate (build-plan.md S4 Decision 1).
   */
  it('records at least the two sources the spec demands', () => {
    expect(fixture.sources.length).toBeGreaterThanOrEqual(2);
    for (const source of fixture.sources) {
      expect(source.url).toMatch(/^https:\/\//);
    }
  });

  it('has one transcription per recorded source', () => {
    expect(Object.keys(fixture.transcriptions).sort()).toEqual(
      fixture.sources.map((s) => s.id).sort(),
    );
  });

  it.each(Object.keys(fixture.transcriptions))('source %s matches source A exactly', (id) => {
    expect(fixture.transcriptions[id]).toEqual(canonical);
  });
});

describe('the 2026 table', () => {
  it('has exactly 32 teams, all distinct, all known to Sleeper', () => {
    const teams = Object.keys(canonical);
    expect(teams).toHaveLength(32);
    expect(new Set(teams).size).toBe(32);
    expect(teams.sort()).toEqual([...SLEEPER_TEAMS].sort());
  });

  it('names every team, so a future re-verification can be done by a human', () => {
    expect(Object.keys(fixture.teamNames).sort()).toEqual([...SLEEPER_TEAMS].sort());
  });

  /**
   * Spec §5.4 describes the 2026 bye distribution while arguing for a Week 6 launch -- it is
   * not trying to validate anything, which is what makes it a genuinely independent check on
   * the table (build-plan.md S4 Decision 2).
   */
  describe('matches the distribution spec §5.4 describes', () => {
    const byWeek = new Map<number, string[]>();
    for (const [team, week] of Object.entries(canonical)) {
      byWeek.set(week, [...(byWeek.get(week) ?? []), team]);
    }
    const count = (week: number) => byWeek.get(week)?.length ?? 0;

    it('has no byes at all before Week 5', () => {
      for (let week = 1; week <= 4; week += 1) expect(count(week)).toBe(0);
    });

    it('runs Week 5 through Week 14, and not beyond', () => {
      const weeks = Object.values(canonical);
      expect(Math.min(...weeks)).toBe(5);
      expect(Math.max(...weeks)).toBe(14);
    });

    it('peaks at six teams in Week 11, with no week higher', () => {
      expect(count(11)).toBe(6);
      for (let week = 1; week <= 18; week += 1) expect(count(week)).toBeLessThanOrEqual(6);
    });

    it('has none at all in Week 12', () => {
      expect(count(12)).toBe(0);
    });

    it('has four teams on bye in each of Weeks 6, 7 and 8', () => {
      expect([count(6), count(7), count(8)]).toEqual([4, 4, 4]);
    });

    it('has the full distribution, week by week', () => {
      const distribution = Array.from({ length: 14 }, (_, i) => count(i + 1));
      expect(distribution).toEqual([0, 0, 0, 0, 2, 4, 4, 4, 2, 4, 6, 0, 4, 2]);
      expect(distribution.reduce((a, b) => a + b, 0)).toBe(32);
    });
  });

  it('agrees with its own by-week index', () => {
    for (const [week, teams] of Object.entries(fixture.byWeekAsPublished)) {
      for (const team of teams) expect(canonical[team]).toBe(Number(week));
    }
    const indexed = Object.values(fixture.byWeekAsPublished).flat();
    expect(indexed).toHaveLength(32);
  });
});

describe('the seed migration cannot drift from the verified artifact', () => {
  /**
   * migrations/0002 was generated from the fixture, but a migration is an ordinary text file
   * that anyone can hand-edit afterwards. This is what stops a "quick fix" applied to one and
   * not the other from reaching a Sunday.
   */
  it('seeds exactly the 32 verified rows, with the same weeks', () => {
    expect(seeded.size).toBe(32);
    expect(Object.fromEntries(seeded)).toEqual(canonical);
  });

  it('is idempotent, so re-running it is how a correction gets applied', () => {
    expect(seedSql).toMatch(/ON CONFLICT \("season", "team"\) DO UPDATE/);
  });

  it('marks the rows verified — the read helpers filter on it', () => {
    expect(seedSql).not.toMatch(/,\s*false\)/);
  });
});
