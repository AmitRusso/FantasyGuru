-- 2026 NFL bye weeks: the 32 hand-maintained rows spec §3 requires.
--
-- Derived from fixtures/nfl/bye-weeks-2026.json, which records four independent sources and
-- their full transcriptions. packages/db/test/bye-weeks.test.ts asserts this file and that
-- fixture still agree, so the two cannot drift apart unnoticed.
--
-- `verified` is TRUE here because the four-source agreement IS the verification spec §3 asks
-- for ("Enter it, then verify it a second time from a different source"). It is a gate, not a
-- label: byeWeekForTeam / byeTeamsForWeek filter on it, so an unverified season makes rule 2
-- go quiet rather than go wrong (build-plan.md S4 Decision 3).
--
-- Idempotent: safe to re-run, and re-running is how a correction would be applied.

INSERT INTO "team_bye_weeks" ("season", "team", "bye_week", "verified") VALUES
  ('2026', 'ARI', 14, true),
  ('2026', 'ATL', 11, true),
  ('2026', 'BAL', 13, true),
  ('2026', 'BUF', 7, true),
  ('2026', 'CAR', 5, true),
  ('2026', 'CHI', 10, true),
  ('2026', 'CIN', 6, true),
  ('2026', 'CLE', 11, true),
  ('2026', 'DAL', 14, true),
  ('2026', 'DEN', 10, true),
  ('2026', 'DET', 6, true),
  ('2026', 'GB', 11, true),
  ('2026', 'HOU', 8, true),
  ('2026', 'IND', 13, true),
  ('2026', 'JAX', 7, true),
  ('2026', 'KC', 5, true),
  ('2026', 'LAC', 7, true),
  ('2026', 'LAR', 11, true),
  ('2026', 'LV', 13, true),
  ('2026', 'MIA', 6, true),
  ('2026', 'MIN', 6, true),
  ('2026', 'NE', 11, true),
  ('2026', 'NO', 8, true),
  ('2026', 'NYG', 8, true),
  ('2026', 'NYJ', 13, true),
  ('2026', 'PHI', 10, true),
  ('2026', 'PIT', 9, true),
  ('2026', 'SEA', 11, true),
  ('2026', 'SF', 8, true),
  ('2026', 'TB', 10, true),
  ('2026', 'TEN', 9, true),
  ('2026', 'WAS', 7, true)
ON CONFLICT ("season", "team") DO UPDATE SET
  "bye_week" = excluded."bye_week",
  "verified" = excluded."verified";
