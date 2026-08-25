import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The whole core schema, landed in one migration in Stage 1.
 *
 * Spec §5.1 forbids destructive migrations between September and January and it is already
 * late August, so every table the v1 spec names exists from day one even though Stage 1 only
 * writes to `players`, `nfl_state` and `sync_log`. Adding a column in October is fine;
 * renaming one is not.
 *
 * Seven tables come from spec §2.3. Two more (`sync_log`, `nfl_state`) are required by §5.2
 * and §2.2 respectively but have nowhere to live in §2.3's list -- see build-plan.md S1 §1.2.
 */

/* ------------------------------------------------------------------ users -- */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * Spec §2.1, data model gotcha: Sleeper usernames are MUTABLE. The id is the identity and
   * the username is only ever a lookup key -- otherwise returning users silently fork into
   * new accounts.
   */
  sleeperUserId: text('sleeper_user_id').notNull().unique(),
  username: text('username').notNull(),
  email: text('email'),
  /** Spec §3.1: never notify between midnight and 07:00 LOCAL, so tz is not optional. */
  tz: text('tz').notNull().default('America/New_York'),
  pushSubscription: jsonb('push_subscription'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------------------------------------------------------- leagues -- */

export const leagues = pgTable('leagues', {
  /** Sleeper's own id is the primary key: it is stable, and it saves a lookup on every sync. */
  sleeperLeagueId: text('sleeper_league_id').primaryKey(),
  name: text('name').notNull(),
  season: text('season').notNull(),
  scoringSettings: jsonb('scoring_settings'),
  rosterPositions: jsonb('roster_positions'),
  totalRosters: integer('total_rosters'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
});

/* ------------------------------------------------------------ memberships -- */

export const memberships = pgTable(
  'memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.sleeperLeagueId, { onDelete: 'cascade' }),
    rosterId: integer('roster_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leagueId] }),
    index('memberships_league_idx').on(table.leagueId),
  ],
);

/* --------------------------------------------------------------- rosters -- */

export const rosters = pgTable(
  'rosters',
  {
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.sleeperLeagueId, { onDelete: 'cascade' }),
    rosterId: integer('roster_id').notNull(),
    /** Sleeper's user id of the owner, not our `users.id` -- rosters sync before users exist. */
    ownerUserId: text('owner_user_id'),
    /**
     * Sleeper player ids. Text arrays rather than a join table: they are read whole, always,
     * and `starters` is positional -- index i IS roster slot i, which is what rule 1 reads.
     */
    players: text('players').array(),
    starters: text('starters').array(),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.leagueId, table.rosterId] })],
);

/* --------------------------------------------------------------- players -- */

export const players = pgTable(
  'players',
  {
    sleeperPlayerId: text('sleeper_player_id').primaryKey(),
    fullName: text('full_name').notNull(),
    team: text('team'),
    position: text('position'),
    status: text('status'),
    injuryStatus: text('injury_status'),
    practiceParticipation: text('practice_participation'),
    depthChartOrder: integer('depth_chart_order'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Rule 2 joins players to bye weeks by team; rule 3 filters on injury status. */
    index('players_team_idx').on(table.team),
    index('players_injury_status_idx').on(table.injuryStatus),
  ],
);

/* -------------------------------------------------------- team_bye_weeks -- */

export const teamByeWeeks = pgTable(
  'team_bye_weeks',
  {
    /**
     * Spec §3 calls for 32 rows, hand-entered. Season is part of the key anyway: byes change
     * every year, and a table that silently serves 2026 byes in 2027 is exactly the
     * "humiliating" failure the spec warns about.
     */
    season: text('season').notNull(),
    team: text('team').notNull(),
    byeWeek: integer('bye_week').notNull(),
    /** Stage 4 enters these twice, from two sources. Nothing reads them until both agree. */
    verified: boolean('verified').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.season, table.team] }),
    check('team_bye_weeks_week_range', sql`${table.byeWeek} between 1 and 18`),
  ],
);

/* ---------------------------------------------------------- alarms_sent -- */

export const alarmsSent = pgTable(
  'alarms_sent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.sleeperLeagueId, { onDelete: 'cascade' }),
    rule: integer('rule').notNull(),
    /** Null for rule 1: an empty starting slot has no player. See the constraint below. */
    playerId: text('player_id'),
    week: integer('week').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Spec §2.3: "one line and it is the difference between a useful app and one people mute
     * in week two."
     *
     * NULLS NOT DISTINCT is load-bearing and is NOT in the spec's version. Postgres treats
     * NULLs as distinct in a unique constraint by default, so a plain UNIQUE would let rule 1
     * -- whose player_id is always NULL -- re-send the same empty-slot alarm at 09:00 and
     * again at 11:30, every Sunday. That is precisely the failure the constraint exists to
     * prevent. Requires PG 15+; Neon is well past that.
     */
    unique('alarms_sent_dedupe')
      .on(table.userId, table.leagueId, table.rule, table.playerId, table.week)
      .nullsNotDistinct(),
  ],
);

/* ------------------------------------------------------------- nfl_state -- */

/**
 * Singleton. Spec §2.2 refreshes `/v1/state/nfl` in Loop A and every later stage needs the
 * current week, but §2.3 gives it nowhere to live. A one-row table beats an env var that
 * needs a deploy, and beats Redis for something that must survive a cache flush.
 */
export const nflState = pgTable(
  'nfl_state',
  {
    id: integer('id').primaryKey().default(1),
    season: text('season').notNull(),
    seasonType: text('season_type').notNull(),
    week: integer('week').notNull(),
    displayWeek: integer('display_week').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('nfl_state_singleton', sql`${table.id} = 1`)],
);

/* -------------------------------------------------------------- sync_log -- */

export const syncOutcome = ['success', 'failure', 'skipped'] as const;
export type SyncOutcome = (typeof syncOutcome)[number];

/**
 * Spec §5.2: "When Sleeper changes something you find out in minutes rather than on a
 * Sunday." Stage 1 is the first job that can write to it; Stage 9 alerts off it.
 */
export const syncLog = pgTable(
  'sync_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    job: text('job').notNull(),
    /** A league id for Loop B, or 'global' for the jobs that have no per-league target. */
    target: text('target').notNull().default('global'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer('duration_ms'),
    outcome: text('outcome').notNull(),
    rowsAffected: integer('rows_affected'),
    /** Expected-but-absent Sleeper fields. A non-zero value here is an upstream change. */
    missingFields: integer('missing_fields'),
    error: text('error'),
  },
  (table) => [
    index('sync_log_job_started_idx').on(table.job, table.startedAt),
    check('sync_log_outcome_valid', sql`${table.outcome} in ('success', 'failure', 'skipped')`),
  ],
);
