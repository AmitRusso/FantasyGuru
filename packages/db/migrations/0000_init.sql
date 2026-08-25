CREATE TABLE "alarms_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"league_id" text NOT NULL,
	"rule" integer NOT NULL,
	"player_id" text,
	"week" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alarms_sent_dedupe" UNIQUE NULLS NOT DISTINCT("user_id","league_id","rule","player_id","week")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"sleeper_league_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"season" text NOT NULL,
	"scoring_settings" jsonb,
	"roster_positions" jsonb,
	"total_rosters" integer,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"league_id" text NOT NULL,
	"roster_id" integer NOT NULL,
	CONSTRAINT "memberships_user_id_league_id_pk" PRIMARY KEY("user_id","league_id")
);
--> statement-breakpoint
CREATE TABLE "nfl_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"season" text NOT NULL,
	"season_type" text NOT NULL,
	"week" integer NOT NULL,
	"display_week" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfl_state_singleton" CHECK ("nfl_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "players" (
	"sleeper_player_id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"team" text,
	"position" text,
	"status" text,
	"injury_status" text,
	"practice_participation" text,
	"depth_chart_order" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rosters" (
	"league_id" text NOT NULL,
	"roster_id" integer NOT NULL,
	"owner_user_id" text,
	"players" text[],
	"starters" text[],
	"synced_at" timestamp with time zone,
	CONSTRAINT "rosters_league_id_roster_id_pk" PRIMARY KEY("league_id","roster_id")
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"target" text DEFAULT 'global' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"outcome" text NOT NULL,
	"rows_affected" integer,
	"missing_fields" integer,
	"error" text,
	CONSTRAINT "sync_log_outcome_valid" CHECK ("sync_log"."outcome" in ('success', 'failure', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "team_bye_weeks" (
	"season" text NOT NULL,
	"team" text NOT NULL,
	"bye_week" integer NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "team_bye_weeks_season_team_pk" PRIMARY KEY("season","team"),
	CONSTRAINT "team_bye_weeks_week_range" CHECK ("team_bye_weeks"."bye_week" between 1 and 18)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sleeper_user_id" text NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"tz" text DEFAULT 'America/New_York' NOT NULL,
	"push_subscription" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_sleeper_user_id_unique" UNIQUE("sleeper_user_id")
);
--> statement-breakpoint
ALTER TABLE "alarms_sent" ADD CONSTRAINT "alarms_sent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarms_sent" ADD CONSTRAINT "alarms_sent_league_id_leagues_sleeper_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("sleeper_league_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_league_id_leagues_sleeper_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("sleeper_league_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_league_id_leagues_sleeper_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("sleeper_league_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_league_idx" ON "memberships" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "players_team_idx" ON "players" USING btree ("team");--> statement-breakpoint
CREATE INDEX "players_injury_status_idx" ON "players" USING btree ("injury_status");--> statement-breakpoint
CREATE INDEX "sync_log_job_started_idx" ON "sync_log" USING btree ("job","started_at");