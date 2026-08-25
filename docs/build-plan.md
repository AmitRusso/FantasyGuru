# FantasyGuru — Development Plan

**Companions:** `docs/fantasyguru-v1-spec.html` (what to build) · `docs/design-brief.md` (what it looks like)
**Status:** Rev 1 · 24 Aug 2026
**Target:** Sunday 18 October 2026, NFL Week 6

This document turns §7 of the build spec into stages, and designs each stage as an
engineering unit: what gets decided, what gets built, what "done" means, and what is
explicitly _not_ in it. The spec's day numbering is preserved so the two documents can be
read side by side.

The organising rule from §7 holds throughout: **the app is shippable at the end of every
stage.** No stage leaves the tree in a state where the previous stage stopped working.

---

## 0. Two things in the spec that must be resolved before Stage 1

**§5.1 says "Single Next.js repo."** That line is a survivor from rev 2 and contradicts §1,
which puts the client in Expo and the backend in a standalone service. §1 wins — there is no
Next.js in this build. §5.1's _other_ claims (main deploys to production, branch previews with
matching Neon branches, strict TS, lint-staged, Actions on every PR) all survive intact and
are implemented in Stage 1.

**The store-gate arithmetic in §1.3 is now comfortable, and that is worth knowing before
pacing the work.** Google Play closed testing needs 14 continuous days with 12 testers, then up
to 7 days of production review — ~21 days. Stage 3 (spec Day 5–6) is when the test starts.
Starting the build 25 August puts Stage 3 around 29–30 August, closed test clearing ~13
September, production access ~20 September, against an 18 October launch. **Roughly four weeks
of slack.** The lead-time crisis of rev 2 is gone. What has not gone away is that the clock
does not start until twelve named testers are _opted in_ — the one item on this plan that
cannot be done from inside the repo.

---

## 1. Repository shape

Locked in Stage 1, and every later stage assumes it.

**One language across the whole tree: TypeScript, `strict`, no exceptions.** §1 specifies it for
the client ("Expo · Expo Router · TypeScript") and §5.1 for the repo. The API, the client, the
shared packages and the tests are all the same language, which is the point of the workspace —
a league type defined once in `packages/sleeper` is the same type in the Fastify handler and in
the React Native component that renders it.

```
FantasyGuru/
├── apps/
│   ├── api/            TypeScript · Fastify 5 on Node 22 → Fly.io
│   │                   Sync loops, scheduler routes, alarm dispatch
│   └── mobile/         TypeScript · Expo + Expo Router + NativeWind (Stage 3)
│                       Android is the product; web export → Vercel; iOS later
├── packages/
│   ├── db/             TypeScript · Drizzle schema + migrations + client
│   ├── sleeper/        TypeScript · Typed Sleeper client, normalisers, cache, limiter
│   └── rules/          TypeScript · The rule engine — pure functions, zero dependencies
├── fixtures/           Captured real Sleeper payloads (Stage 2 onward)
└── docs/
```

### The two hosts, and why only one of them is in Stage 1

§1 names two hosts for two different jobs, and it is worth stating the split plainly because
they are easy to conflate:

|                          | Host       | What runs there                                           | First appears |
| ------------------------ | ---------- | --------------------------------------------------------- | ------------- |
| `apps/api`               | **Fly.io** | Sync loops, scheduled routes, rule engine, alarm dispatch | Stage 1       |
| `apps/mobile` web export | **Vercel** | The static Expo web build — the "front door" funnel of §6 | Stage 3       |

The backend row of §1's stack table reads "Standalone API — **Fly.io or Railway**"; Fly is the
pick within the choice the spec already made, for the reason in §1.1's table below. Vercel's
row is "Web hosting — the Expo web export deploys as a normal site." Nothing in Stage 1 has a
web surface, so Vercel is simply not provisioned yet.

They cannot be collapsed into one host. §1.1 is the reason: Vercel's Hobby cron fires once a
day inside a ±59 minute window, and the entire product is a notification that must land between
10:00 and 11:00 ET. The scheduled work has to live somewhere that is not Vercel — which is the
same conclusion that put QStash in front of it.

One consequence for Stage 1's CI: §5.1 says feature branches get "a Vercel preview plus a
matching Neon database branch." Stage 1 wires the Neon branch only. The Vercel preview half
arrives in Stage 3 along with the app that would be previewed.

**Why a workspace and not two repos.** `packages/rules` is imported by the API (to dispatch
alarms) and by the mobile app (to render the verdict from already-synced data without a round
trip). `fixtures/` is shared by both. Splitting the repo means publishing internal packages or
duplicating types, and the rule engine is the one place in this codebase where a type drifting
out of sync is expensive.

**The cost, paid in Stage 3.** Expo's Metro bundler needs `watchFolders` pointed at the
workspace root to resolve `packages/*`. It is a ten-line `metro.config.js` and a solved
problem — but it is real work, and it belongs in Stage 3's estimate rather than being
discovered there.

**`packages/rules` has no dependencies. None.** No database client, no HTTP, no framework, no
date library that reaches for the system clock. In: rosters, players, league settings, week,
bye table. Out: a list of problems. This is §1.2's instruction, and it is what makes the
fixture testing in §5.1 possible.

---

## 2. Stage map

| Stage  | Spec days | Name                             | Ships when                                             | Cuttable                          |
| ------ | --------- | -------------------------------- | ------------------------------------------------------ | --------------------------------- |
| **0**  | Day 0     | Store clock and testers          | Play Console live, app name reserved, 15 testers named | No — longest lead item            |
| **1**  | Day 1–2   | Skeleton and player sync         | Loop A runs on schedule against Neon; CI green         | No                                |
| **2**  | Day 3–4   | Sleeper adapter and league sync  | Loop B cached and rate-limited; fixtures captured      | No                                |
| **3**  | Day 5–6   | Expo app: username → dashboard   | Ten-second path works on web and device                | No — **starts the Play clock**    |
| **4**  | Day 7     | Bye weeks and shared-player view | 32 rows entered and double-verified                    | No — verification is non-cuttable |
| **5**  | Day 8–9   | Rule engine, rules 1–3           | Verdict renders on the dashboard, fixture-tested       | No                                |
| **6**  | Day 10–11 | Accounts, email, scheduler       | Loop C dry-runs to you alone via Resend                | No                                |
| **7**  | Day 12–13 | Visual design pass               | The ten artboards, dark theme, deep links out          | No                                |
| **8**  | Day 14    | Android push and permission flow | FCM to a physical device, channels, pre-prompt         | No                                |
| **9**  | Day 15    | Observability and load           | Sentry, sync_log, canary, 500-user sweep               | No — limiter proof                |
| **10** | Day 16    | Rules 4–7                        | Each rule fixture-tested; rule 7 only if tuned         | **Yes — cut first**               |
| **11** | Day 17+   | Freeze and closed test           | §5.4 checklist clean; 14 days running                  | No                                |

**Cut order if you fall behind** (§7, unchanged): rule 7 → rules 4–6 → web push → live
scoreboard. Never cut: the per-league cache, the concurrency limiter, bye-week verification,
`alarms_sent`.

**Stage gates.** Stages 1 and 2 are pure backend and run continuously. Stage 3 is a gate — it
starts a 14-day clock that cannot be restarted, so it ships the moment it launches, however
rough it looks. Stage 7 is where it stops looking like a side project, and it is deliberately
_after_ the alarm works, not before.

---

# Stage 1 — Skeleton and player sync

> **Spec:** §1 (stack), §1.1 (scheduler), §2.2 Loop A, §2.3 (schema), §5.1 (CI), §5.2 (sync_log)
> **Goal:** a deployed backend service that, unattended, keeps an 11,000-row `players` table
> and the current NFL week fresh — and a repo that will not need re-litigating in Stage 7.
> **Nothing user-facing. No client. No leagues. No rules.**

Stage 1 is where getting the boring parts right buys the most, because every later stage
inherits them. Two days of work, and the acceptance test is a `curl` and a row count.

## 1.1 Decisions to lock

| Decision          | Choice                                | Why, and what was rejected                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language          | TypeScript, `strict`, every package   | Per §1's Client row and §5.1. One language for API, client and shared packages — see §1 above.                                                                                                                                                                                                                         |
| Package manager   | pnpm workspaces                       | Fast, and strict about phantom dependencies — exactly the discipline `packages/rules` needs to stay dependency-free.                                                                                                                                                                                                   |
| Runtime           | Node 22 LTS                           | Native `fetch`, stable, boring.                                                                                                                                                                                                                                                                                        |
| API framework     | Fastify 5                             | §1.2 asks for a boring always-on server with scheduled jobs, a concurrency limiter and a retry queue. Fastify has the plugin ecosystem for that and first-class TS types. Rejected: Hono (edge-shaped, and we are not going to the edge), Expo API Routes (§1.2 rejects them explicitly).                              |
| Host — `apps/api` | Fly.io, single machine, 512MB, `iad`  | §1's Backend row is "Fly.io or Railway"; this picks within it. Always-on, so no cold start on the Sunday path. **512MB not 256MB** — see §1.6. Railway is genuinely equivalent; Fly's `min_machines_running = 1` and its region pinning are the tiebreak. **Not Vercel** — §1.1 rules that out for anything scheduled. |
| Host — web export | Vercel, from Stage 3                  | §1's Web hosting row. Static Expo web build only; no server code, no cron. See §1 above.                                                                                                                                                                                                                               |
| Database          | Neon Postgres + Drizzle + drizzle-kit | Per §1. Branching gives each PR its own dataset.                                                                                                                                                                                                                                                                       |
| Scheduler         | Upstash QStash → protected route      | Per §1.1. Set up in Stage 1 so Loop A proves the whole scheduling path before Loop C depends on it.                                                                                                                                                                                                                    |
| Cache             | Upstash Redis                         | Provisioned in Stage 1, first used in Stage 2.                                                                                                                                                                                                                                                                         |
| Errors            | Sentry                                | Wired in Stage 1 because it costs twenty minutes now and catches Stage 2's mistakes.                                                                                                                                                                                                                                   |
| Tests             | Vitest + PGlite                       | PGlite gives real Postgres semantics in-process, so the upsert path is tested for real in CI without a service container.                                                                                                                                                                                              |

## 1.2 Schema — land all of it now, in one migration

§5.1 forbids destructive migrations between September and January, and it is already the end of
August. So the full core schema from §2.3 goes in as a single initial migration in Stage 1,
even though Stage 1 only writes to two tables. Adding columns later is fine; renaming them in
October is not.

Nine tables ship in `packages/db`: the seven from §2.3 — `users`, `leagues`, `memberships`,
`rosters`, `players`, `team_bye_weeks`, `alarms_sent` — plus two the spec implies but never
gives a home:

- **`sync_log`** — job, target, started_at, duration_ms, outcome, rows_affected, error.
  §5.2 requires it, and Stage 1 is the first job that can write to it.
- **`nfl_state`** — a single row holding season, season_type, week, display_week, updated_at,
  from `/v1/state/nfl`. §2.2 requires the current week; §2.3 gives it nowhere to live. Every
  later stage reads it, and a singleton table is the honest place for it.

Two constraints matter more than the rest, and both go in now:

```sql
-- §2.3: this one line is what makes the notification path idempotent
UNIQUE (user_id, league_id, rule, player_id, week)  -- alarms_sent

-- §2.1: usernames are mutable; sleeper_user_id is the identity
UNIQUE (sleeper_user_id)                            -- users
```

## 1.3 Loop A — the design

`POST /internal/jobs/players-sync`, called by QStash daily at 03:00 ET.

**Authentication — two gates.** QStash signature verification (`Upstash-Signature`) for
scheduled calls, and a shared-secret header (`x-internal-secret`) for manual triggers. Either
passes. §1.1 requires the gate; the manual path is what makes the acceptance test possible.

**Idempotency, and why it is not a database constraint here.** §1.1 warns that external
schedulers retry on timeout. For Loop A a retry is _harmless_ — it is an upsert — but a
concurrent retry while the first run is still parsing 5MB is not, so the job takes a Postgres
advisory lock:

```sql
SELECT pg_try_advisory_lock(hashtext('players-sync'))
```

If the lock is not acquired, return **200** with `{ skipped: "locked" }`. Two hundred, not
409 — a non-2xx teaches QStash to retry, and retrying a job that is already running is the
exact loop being avoided.

**Fetch and parse.** `GET https://api.sleeper.app/v1/players/nfl` — ~5MB, ~11k players, keyed
by player id. §2.2 is emphatic: **once globally, never per user, never per request.**
`res.json()` on 5MB is fine at 512MB of RAM; a streaming parser is a Stage 9 optimisation if
the `sync_log` durations call for it, not a Stage 1 concern.

**Normalise leniently — do not schema-validate 11,000 objects.** The mapper is hand-rolled and
pulls only the columns §2.3 names: `player_id`, `full_name`, `team`, `position`, `status`,
`injury_status`, `practice_participation`, `depth_chart_order`. Unknown fields are ignored
without complaint; a _missing_ expected field increments a counter that lands in `sync_log`
rather than throwing. The reasoning is §6's top risk — the Sleeper API "owes you nothing." A
strict parser turns any upstream field rename into a total sync failure at 03:00 on a Sunday;
a lenient mapper degrades it to a logged counter that the Stage 9 canary alerts on. Rows that
cannot produce a `player_id` and a name are skipped and counted.

**Write.** Batched `insert().onConflictDoUpdate()` at 500 rows per statement, in one
transaction. **Never delete.** Players that vanish upstream stay — `rosters.players[]` still
references them, and a roster row pointing at a deleted player is a Stage 5 crash.

**Then `/v1/state/nfl`** → upsert the `nfl_state` singleton. Cheap, and every later stage needs
the current week.

**Then `sync_log`** — one row, always, success or failure, with duration and counts.

**A DST note that Stage 6 will need.** A plain UTC cron of `0 7 * * *` is 03:00 ET during EDT
and 02:00 ET after 1 November. For Loop A that is irrelevant. For **Loop C it is not** — a
Sunday alarm job that silently moves to 08:00 ET after the clocks change fires an hour late
into the one window that matters, mid-season. Pin QStash's schedule timezone explicitly here,
in Stage 1, on a job where being wrong costs nothing, so Stage 6 inherits a scheduling path
that is already correct.

## 1.4 Everything else in Stage 1

- **`GET /health`** — process up, `SELECT 1` against Neon, and the age of the last successful
  `players-sync`. This is the endpoint the Stage 9 alerting hangs off, so it returns
  timestamps, not `"ok"`.
- **CI** (§5.1) — GitHub Actions on every PR: `typecheck`, `lint`, `test`, `build`. Node 22,
  pnpm cache. TS `strict` everywhere. Prettier and ESLint enforced through husky + lint-staged
  so CI never has to argue about formatting.
- **Neon branch per PR** — created in CI, with the migration applied against it, so every PR
  proves its own migration before merge.
- **`main` deploys to Fly** on green.
- **Secrets** — `DATABASE_URL`, `INTERNAL_SECRET`, `QSTASH_CURRENT_SIGNING_KEY`,
  `QSTASH_NEXT_SIGNING_KEY`, `SENTRY_DSN`, and `UPSTASH_REDIS_REST_URL` / `_TOKEN` provisioned
  but unused until Stage 2. `.env.example` committed; nothing else.

## 1.5 Tests that earn their place in Stage 1

§5.1 is right that the rule engine is the only thing that _must_ be tested — but it does not
exist yet, and two of Stage 1's behaviours are worth locking now because Stage 2 builds
directly on them:

1. **`normalisePlayer`** against a saved slice of a real `/v1/players/nfl` response — a healthy
   player, an injured one, a free agent with `team: null`, and a deliberately mangled object
   that must be skipped rather than throw.
2. **The batched upsert** against PGlite — insert 1,200 synthetic players, re-run with 300
   changed, assert 1,200 rows and 300 updates. This is the assertion that the daily re-run is
   genuinely idempotent.

No HTTP tests, no route tests. The acceptance test in §1.7 covers the wiring.

## 1.6 Risks specific to Stage 1

| Risk                                              | Handling                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The 5MB fetch plus parse OOMs a small Fly machine | 512MB, not the 256MB default. Parsed, 5MB of JSON is comfortably 60–90MB of heap. Cheap insurance; revisit only if `sync_log` says otherwise. |
| Sleeper renames a field                           | Lenient mapper plus a missing-field counter in `sync_log` (§1.3). Turns a total failure into a signal.                                        |
| QStash retries overlap a slow run                 | Advisory lock, 200-on-skip (§1.3).                                                                                                            |
| The 03:00 job silently stops firing               | `/health` reports last-success age from Stage 1; Stage 9 alerts on it. A sync that stops is otherwise invisible until a Sunday.               |
| Schema churn in October                           | Full schema in the initial migration (§1.2).                                                                                                  |

## 1.7 Definition of done

Stage 1 is finished when, against the **deployed** service:

1. `curl -X POST https://<app>.fly.dev/internal/jobs/players-sync -H "x-internal-secret: ..."`
   returns `{ upserted: ~11400, missingFields: 0, durationMs: ... }`.
2. `select count(*) from players` is ~11,000; `select * from nfl_state` shows the live week.
3. The same call fired twice within a second returns `{ skipped: "locked" }` on the second and
   leaves row counts unchanged.
4. The same call without the secret header returns 401.
5. A QStash schedule exists, is timezone-pinned to `America/New_York`, and has fired once
   unattended.
6. `sync_log` has one row per run, with a duration.
7. A PR runs typecheck, lint, test and build green, against its own Neon branch.

## 1.8 Explicitly not in Stage 1

No Expo app, no league sync, no Redis reads, no rule engine, no users, no auth, no email, no
`team_bye_weeks` rows (the table exists; Stage 4 fills and verifies it). If a Stage 1 PR
touches `packages/rules`, it has gone out of scope.

## 1.9 What the build measured — corrections to the spec

Written after Stage 1 was built, against the live API on **24 August 2026**. These supersede
the estimates in the spec, which §7's closing note already flagged as "estimates to be revised
against real traffic."

**`/v1/players/nfl` is 14.6MB and 12,222 players — about three times the spec's "roughly 5MB
and 11k players."** Fetch plus parse plus normalise peaks at **102MB RSS** in the production
shape (no database in-process), so the 512MB machine in §1.1 still holds comfortably and the
256MB default still would not. Full sweep, measured end to end: ~2.4s to fetch and normalise,
~2.2s to write 12,222 rows in 25 batches.

**The missing-field tripwire had to be re-derived from real data.** The plan proposed counting
absent `team`, `position` and `status`. In the live payload **8,977 players have no team, and
5,474 of those are status `Active`** — free agents. Counting `team` would have reported ~9,000
missing fields every single night and buried a genuine upstream rename in the noise, which is
the exact failure the counter exists to prevent. Counted fields are now `position` and
`status` only. Measured baseline: **285 across 12,222 rows, ~2.3%.** Stage 9 must alert on
that rate moving, not on the count being non-zero.

**Team defences are keyed by team abbreviation and carry no `full_name`.** All 32 of them
(`HOU`, `NE`, `BAL`, …) have `first_name`/`last_name` instead. A normaliser that required
`full_name` would silently drop every DEF — blinding rules 1–3 to a whole starting slot. The
fallback is implemented and tested.

**`alarms_sent` needs `UNIQUE NULLS NOT DISTINCT`, not plain `UNIQUE`.** Rule 1's `player_id`
is always null, and Postgres treats nulls as distinct by default — so the spec's constraint as
written would let the same empty-slot alarm send at 09:00 and again at 11:30, every Sunday.
That is precisely what §2.3 says the constraint exists to prevent. Asserted in a test rather
than trusted.

**Two things to carry into later stages.** During preseason `/v1/state/nfl` returns
`season_type: "pre"` with the _preseason_ week (week 3 on 24 August) — Stage 5 must not read
that as a regular-season week. And `practice_participation` is currently null across the entire
payload, so **rule 5 has nothing to fire on until the regular season starts**; it cannot be
verified before then. Live `injury_status` values are `Out`, `IR`, `Sus`, `PUP`, `Doubtful`,
`Questionable`, plus `NA`, `DNR` and `COV`, which the spec's rule table does not mention.

---

# Stage 2 — Sleeper adapter and league sync

> **Spec:** §2.1 (onboarding), §2.2 (Loop B + the TTL table), §2.3 (rate-limit math), §5.1
> (fixtures), §5.2 (sync_log)
> **Goal:** any Sleeper username in, that person's leagues, rosters and lineups in Postgres
> out — fetched through a cache and a rate limiter that keep a 2,200-league Sunday sweep
> inside Sleeper's published ceiling.
> **No rule engine. No client. No notifications.**

Spec §2.3 is blunt about why this stage cannot be deferred or half-done: "Build the
concurrency limiter and the per-league cache on day one. Retrofitting either one under real
load, on a Sunday morning, with an IP block in progress, is the failure mode that ends the
project."

## 2.1 Five decisions, three of which depart from the spec

### Decision 1 — the per-user leagues list already IS the league object; `/league/{id}` is not a sweep-time call

Verified against a real league on 25 Aug 2026 (Sleeper's own published docs example,
`289646328504385536`): `GET /user/{id}/leagues/nfl/{season}` does not return a thin list of
ids. Each entry is the **complete** league object — `name`, `roster_positions`,
`scoring_settings`, `settings`, `total_rosters`, `status` — byte-for-byte the same shape as a
standalone `GET /league/{id}`. The spec's §2.3 call table treats these as two separate calls;
they are the same data.

That makes the standalone `/league/{id}` call **not part of the routine sweep at all**. Spec
§2.2's Loop C already does "for each registered user: sync leagues" as its first step — that
one call, which is unavoidable (there is no way to discover a user's league memberships
except by asking for that user), refreshes every one of that user's leagues' settings for
free. `/league/{id}` stays in the client as a standalone method (debugging, and a fallback for
refreshing a single league with no active member), but the sync service does not call it on a
schedule.

This also **corrects an arithmetic gap in the original Decision 1** — that version priced the
sweep as "~2,200 calls" but implicitly assumed the per-league settings refresh was free
without ever counting the per-user leagues-list call needed to discover league membership in
the first place. The honest total:

| Call                              | Count                                     | Why                                                                                                        |
| --------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/user/{id}/leagues/nfl/{season}` | ~1,000 (one per registered user)          | Unavoidable — no other way to enumerate a user's leagues. Also refreshes league settings as a side effect. |
| `/league/{id}/rosters`            | ~2,200 (one per distinct league, deduped) | The alarm's actual input — `starters[]`.                                                                   |
| `/league/{id}`                    | 0 in the routine sweep                    | Folded into the leagues-list response above.                                                               |
| `/league/{id}/users`              | 0 in the routine sweep                    | Not needed for the alarm; display names are a Stage 5+ nicety, refreshed on demand.                        |
| `/league/{id}/matchups/{week}`    | 0 in the routine sweep                    | Not needed pre-kickoff; the live scoreboard (out of scope until later) is the consumer.                    |

**~3,200 calls per full sweep**, not 2,200 and not the spec's 8,800. At the 800/min token
bucket from Decision 2, a bucket that starts full (the API process is always-on, so it is
idle and near-capacity going into Sunday) admits its first 800 calls immediately and drains
the remaining 2,400 at the refill rate — **~3 minutes total**, confirmed by simulation in
`rate-limiter.test.ts`, well inside the 10-minute spread window §2.3 targets, with room for
retries.

### Decision 2 — TTL is a function of endpoint _and_ time of week, not time of week alone

Spec §2.2's TTL table varies only by when. The two endpoints actually on the sweep path have
different volatility, and treating them alike would waste the saving above:

| Endpoint                                   | What it holds                                   | Changes                        | TTL            |
| ------------------------------------------ | ----------------------------------------------- | ------------------------------ | -------------- |
| `/user/{id}/leagues/nfl/{season}`          | league settings, `roster_positions`, membership | Effectively never mid-season   | **24h, fixed** |
| `/league/{id}/rosters`                     | `starters` — the alarm's actual input           | Constantly on Sunday morning   | **§2.3 table** |
| `/league/{id}/users` (on demand)           | display names                                   | Effectively never mid-season   | **24h, fixed** |
| `/league/{id}/matchups/{week}` (on demand) | live points                                     | Constantly on Sunday afternoon | **§2.3 table** |

### Decision 3 — A concurrency cap is not a rate limiter

Spec §2.3 says: "Spread across a ten-minute window with a concurrency limiter at ~10 you sit
near 880/min." That equivalence only holds if every call takes ~680ms. Sleeper's small
endpoints are far faster than that — Stage 1 measured the _14.6MB_ players payload at ~2.4s,
so a few-KB roster response will land in the low hundreds of milliseconds. At 150ms per call,
concurrency 10 yields **~4,000 calls/min — four times the published ceiling**, which is the
IP block §6 lists as a Critical risk.

Concurrency bounds how many requests are _in flight_; it does not bound _throughput_. Stage 2
builds both, because they do different jobs:

- **Token bucket** — the real limit. Refills at a configured calls/second, default **800/min**
  (a 20% margin under Sleeper's 1,000). This is what keeps us legal.
- **Semaphore, ~10** — caps in-flight sockets and memory. This is what keeps the process sane.

### Decision 4 — Redis is the fast path, `synced_at` is the durable fallback

There is an unstated overlap in the spec: Postgres already stores league state with a
`synced_at` column, so "is this league fresh?" is answerable without Redis at all. Rather than
pick one and leave the other redundant, they get distinct jobs:

- **Redis (Upstash)** holds the raw Sleeper response per `(league, endpoint)` with the TTL
  above. It is the freshness check and it avoids re-normalising.
- **Postgres `synced_at`** is the fallback. If Redis is unreachable, freshness falls back to
  comparing `synced_at` against the same TTL policy.

The cache **fails open** — a Redis outage degrades to slower syncs, never to no syncs. That is
safe precisely because the token bucket, not the cache, is what protects Sleeper.

### Decision 5 — The rate limiter is only correct while exactly one machine is running

An in-process token bucket bounds _this process_. Two machines means two buckets and double
the effective rate, silently. Today [fly.toml](../fly.toml) pins `min_machines_running = 1`
with `auto_stop_machines = false`, so the invariant holds — but it is an invariant, not an
accident, and it must be written down before Stage 9's 500-user load test tempts anyone to
scale out. **If a second machine is ever added, the limiter must move to a Redis-backed
counter first.** The API logs its machine id at boot so a violation is visible.

## 2.2 The endpoints

Stage 1 built `/players/nfl` and `/state/nfl`. Stage 2 adds the six that remain:

| #   | Endpoint                                      | Purpose                                                                                                  | Cached                   |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | `GET /v1/user/{username}`                     | username → `user_id` (§2.1 step 2)                                                                       | No — cheap, and identity |
| 2   | `GET /v1/user/{user_id}/leagues/nfl/{season}` | every league, FULL objects (§2.1 step 3, Decision 1)                                                     | Per user, 24h            |
| 3   | `GET /v1/league/{id}`                         | standalone fetch — debugging / single-league fallback only, NOT called by the routine sweep (Decision 1) | 24h                      |
| 4   | `GET /v1/league/{id}/rosters`                 | `players[]`, `starters[]` — the alarm's actual input                                                     | Time-of-week             |
| 5   | `GET /v1/league/{id}/users`                   | display names — fetched on demand, not swept                                                             | 24h                      |
| 6   | `GET /v1/league/{id}/matchups/{week}`         | points, per-week lineups — fetched on demand, not swept                                                  | Time-of-week             |

`{season}` comes from `nfl_state`, written by Stage 1's Loop A — never hardcoded. That is what
the extra table was for.

**An unknown username returns HTTP 200 with a body of `null`, not a 404.** Verified against
the live API on 25 Aug 2026. This matters more than it looks: "I typed my username wrong" is
the most-travelled error path in the entire product, and Stage 1's client would hand a bare
`null` back to the caller as if it were a user. The adapter must translate it into an explicit
typed miss. (`GET /v1/user/` with no username returns a 404 carrying an HTML body, which would
throw on `res.json()` — Stage 1's client already rejects non-2xx before parsing, so that path
is covered.)

## 2.3 The TTL policy, and the hole in the spec's table

A pure function: `(instant, endpoint) → seconds`. No I/O, no ambient clock, so it is
table-testable.

| Window (ET)         | TTL    | From                            |
| ------------------- | ------ | ------------------------------- |
| Tue–Fri             | 6h     | §2.2                            |
| Sat                 | 1h     | §2.2                            |
| **Sun 00:00–06:00** | **1h** | **Not in the spec — see below** |
| Sun 06:00–13:00     | 5min   | §2.2                            |
| Sun 13:00–24:00     | 60s    | §2.2                            |
| Mon                 | 15min  | §2.2                            |

**The spec's table has a gap:** Saturday ends and Sunday 06:00 begins, leaving Sunday midnight
to 06:00 undefined. Filling it with 1 hour (continuous with Saturday) is the conservative read
— nobody is setting lineups at 3am, and the 06:00 window takes over well before kickoff.

**All windows are Eastern wall-clock, so the policy must do a real timezone conversion**, not
UTC arithmetic with a fixed offset. On 1 November 2026 the clocks go back and every boundary
in that table moves relative to UTC. `Intl.DateTimeFormat` with `timeZone: 'America/New_York'`
does this correctly with no dependency, and the DST boundary gets an explicit test — same
class of bug as the QStash schedule pinning in Stage 1, and the same reason to handle it on a
cheap job before Loop C depends on it.

## 2.4 Cache keys and the stampede

```
sleeper:v1:league:{id}              -> raw /league/{id}
sleeper:v1:league:{id}:rosters      -> raw /league/{id}/rosters
sleeper:v1:league:{id}:users        -> raw /league/{id}/users
sleeper:v1:league:{id}:matchups:{w} -> raw matchups for week w
sleeper:v1:user:{username}:leagues  -> league list for a user
```

**Keyed by league, never by user** — §2.2 is explicit, and it is what makes the rate-limit
arithmetic work: two members of the same league share one entry, which is why 3,000
memberships collapse to ~2,200 distinct leagues.

The `v1:` segment is a manual kill switch. If a normaliser changes shape, bumping the prefix
invalidates everything without waiting out a TTL or flushing a shared database.

**Single-flight.** Fifty members of one league opening the app at 10:00 on a cold cache must
produce one upstream fetch, not fifty. An in-process promise map keyed by cache key
deduplicates concurrent misses. In-process is sufficient because of Decision 5 — one machine,
one map. It moves to a Redis lock at the same time the limiter does.

## 2.5 What lands in Postgres

Stage 1 created these tables and left them empty. Stage 2 is what fills them:

- **`leagues`** — one row per league, extracted from endpoint 2's response (Decision 1) —
  not from a standalone endpoint-3 call.
- **`memberships`** — the join table. Resolving `user_id` → `roster_id` per league is what
  makes rule 7 possible later.
- **`rosters`** — `players[]` and `starters[]` per roster, from endpoint 4.
- **`users`** — identity only: `sleeper_user_id` and `username`. **No email, no timezone** —
  §2.1 is emphatic that nothing is asked for until after leagues are on screen, and Stage 6 is
  where accounts acquire the rest. The schema already allows this: `email` is nullable and
  `tz` defaults.
- **`sync_log`** — one row _per league_, which is what the `target` column exists for. A
  single league failing must not abort a 2,200-league sweep; each is caught, logged, and
  counted, and Stage 9 alerts when the failure rate crosses 5%.

## 2.6 A public read route, and why it belongs in this stage

Stage 3 is a two-day budget for an Expo app, and it starts a 14-day Play clock that cannot be
restarted. It must not spend day one building backend. So Stage 2 ships the endpoint the
ten-second path needs:

```
GET /v1/users/{username}/leagues
```

Resolve username → sync → return leagues with rosters. Stage 3 then consumes exactly one route.

This is the first **unauthenticated public** surface in the project, and it triggers upstream
fetches, so it is also the first abuse vector. Three defences, in order: the cache absorbs
repeats, the token bucket caps what reaches Sleeper no matter how hard the route is hit, and a
per-IP throttle (`@fastify/rate-limit`) keeps one client from monopolising the bucket.

## 2.7 Fixtures — capture them while building, not after

§5.1: "Capture a set of real league payloads into `/fixtures` in week one, before you need
them." Stage 5's rule engine is tested entirely against these, and §5.1 notes they are also
how work continues through the offseason when live data says nothing.

Capture for each of endpoints 3–6, from real leagues, committed verbatim. Where a payload
carries other league members' display names, it stays as captured — this is a private repo and
the data is already public through Sleeper's own unauthenticated API.

**This is the one part of Stage 2 that needs something only you have: a real Sleeper
username.** Everything else can be built and tested without it; fixtures cannot.

## 2.8 Verified against the live API on 25 Aug 2026, before building on it

Stage 1's lesson was that the spec's estimates were three times off and that measuring changed
the design. Same approach here, against a real league (Sleeper's own published docs example,
`league_id 289646328504385536`):

1. **`starters[]` → `roster_positions[]` mapping — CONFIRMED.** `roster_positions` for this
   league is `[QB, RB, RB, WR, WR, TE, FLEX, FLEX, DEF, BN×6]` — nine non-`BN` slots.
   `starters` for its rosters has exactly nine entries, and `starters[8]` is a team-defence id
   (`"CLE"`) matching the lone `DEF` slot at the end. `starters[i]` is the i-th non-`BN` entry
   in `roster_positions`, positionally, as assumed. Rule 2's copy ("on bye at WR2") can be
   built on this with confidence.
2. **The empty-slot sentinel — CONFIRMED, `"0"`, not `null`.** Not found in the docs-example
   league, but hit live while exercising the public route end to end against a real
   18-league account (25 Aug 2026): a pre-draft roster with zero players returned
   `starters: ["0","0","0","0","0","0"]` and `players: []`. Rule 1's check needs `"0"` as a
   real, observed case, not a hypothetical — `null` remains theoretically possible per the
   spec's own wording but has still never been observed.
3. **`matchups[week].starters` vs `rosters.starters` — CONFIRMED to diverge.** For roster 1,
   week 1 of this (2018, now-historical) season: `matchups` starters were
   `[421, 4035, 3242, 2133, 2449, 4531, 2257, 788, PHI]`; the _current_ `rosters.starters` for
   the same roster is `[4881, 4035, 788, 2133, 2449, 2118, 223, 1352, CLE]` — different
   players, different team defence. `rosters.starters` reflects whatever the roster is set to
   **right now**; `matchups[week]` is that week's frozen record. This was a theoretical risk
   in the original plan; it is now a demonstrated fact. **Consequence for Stage 5:**
   evaluating "is this Sunday's lineup broken" must read `rosters.starters` — it is the only
   endpoint that reflects a lineup not yet locked. `matchups` is for the live scoreboard
   (later), not the alarm.
4. **The per-user leagues-list response is the full league object — CONFIRMED**, and folded
   into Decision 1 above.
5. **The real `/user/{username}` shape is richer, and inconsistent on case.** The response
   carries a `username` field (lowercased — `"2ksports"`) alongside `display_name` (original
   case — `"2KSports"`), plus a long tail of always-null fields (`cookies`, `phone`,
   `real_name`, `token`, …) that the normaliser ignores by construction. **Persist the API's
   own `username` field, not what the caller typed** — it is the canonical value, and storing
   it is what makes a second lookup by the same person resolve consistently regardless of the
   case they typed.
6. **Upstash round-trip latency from Fly `iad` — not yet measured.** Needs the Redis
   credentials wired into a deployed environment; deferred to the implementation itself rather
   than blocking the design.
7. **Upstash free-tier command ceiling — not yet measured**, same reason as above. At 15
   testers irrelevant; revisit before Stage 9's 500-user load test.
8. **PGlite mis-parses a `null` element inside a `text[]` column, real Postgres does not —
   found while writing `upsertRosters`.** A roster with an empty starting slot (spec rule 1,
   `starters[i] == null`) written through PGlite reads back as the _string_ `"NULL"`, not a
   real `null`. Verified two ways against the actually-deployed database (node-postgres +
   Neon): `x[2] IS NULL` is server-side `TRUE` even when PGlite's own client read comes back
   wrong, and node-postgres itself parses the identical column as a genuine JS `null`. **This
   is a PGlite test-harness limitation, not an application bug** — production is correct
   today. It matters for Stage 5: if a rule-1 fixture test against PGlite ever behaves
   strangely around a null starter, check this before assuming the rule engine is broken.
9. **Two performance bugs, found only by running the public route against a real 18-league
   account rather than trusting the unit tests.** All 79 unit/service tests passed the whole
   time; neither bug was visible from mocked or PGlite-backed tests, because both are about
   what happens at real scale against a real remote database.
   - **The per-league loop was sequential.** `syncUserLeagues` awaited one league at a time
     despite `Semaphore(10)` existing specifically to allow controlled concurrency — the
     semaphore was built and never actually used for the thing it was built for. Fixed to
     `Promise.all` across leagues, which is what the semaphore was already there to bound.
   - **`upsertRosters` and `upsertLeagues` wrote one row per remote round trip, in a loop,
     unconditionally — including on a cache hit.** This is why a warm-cache repeat request
     was barely faster than the cold one: caching was working correctly the whole time (both
     Redis keys and TTLs were verified directly), but the DB write dominated regardless.
     Batched into one multi-row `INSERT ... VALUES ... ON CONFLICT` each, matching Stage 1's
     `upsertPlayers` pattern.
   - **Measured, same real account, before and after both fixes:** cold sync 14.3s → 5.1s;
     warm (cached) sync 11.4s → 2.1s — a 5.4x improvement on the path the "materially faster"
     cache-hit criterion (§2.11 item 3) actually depends on. 2.1s for an 18-league account is
     still short of spec §2.1's "under ten seconds," though comfortably within it — a typical
     3-5 league user should land well under a second on the warm path.

## 2.9 Tests

The rule engine (§5.1's "only tests that matter") is Stage 5. Stage 2's testable surface is the
machinery underneath it, and three pieces genuinely earn tests:

1. **TTL policy** — table-driven across every window, both sides of each boundary, and
   explicitly across the 1 Nov 2026 DST change. Pure function, fixed instants, no clock.
2. **Token bucket** — with an injected clock: exhausts, refills at the right rate, never
   exceeds budget over a simulated sweep. A rate limiter tested only against the real clock is
   not tested.
3. **Normalisers for endpoints 1–6** — against the captured fixtures, including the
   `null`-body unknown-user case from §2.2.

Plus the sync service against PGlite with a stubbed client: cache hit skips the fetch, cache
miss writes both stores, one league failing does not abort the sweep, and concurrent misses for
one league produce exactly one fetch.

## 2.10 Risks

| Risk                                                   | Handling                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Rate limiter silently wrong if a second machine starts | Decision 5: invariant documented, machine id logged at boot; Redis-backed limiter before any scale-out |
| Cache stampede on a cold Sunday                        | Single-flight promise map (§2.4)                                                                       |
| Redis down mid-sweep                                   | Fail open to `synced_at`; the token bucket still bounds upstream load                                  |
| A league 404s or changes shape mid-sweep               | Per-league try/catch → `sync_log` row; sweep continues                                                 |
| `starters` ↔ `roster_positions` mapping assumed wrong  | §2.8 item 1, verified before Stage 5 depends on it                                                     |
| Public route abused                                    | Cache, token bucket, per-IP throttle (§2.6)                                                            |
| Sunday sweep exceeds the 09:15 completion alert (§5.2) | Decision 1 cuts the sweep ~4x; pacing target is the 10-minute window                                   |

## 2.11 Definition of done

1. `GET /v1/users/{username}/leagues` returns real leagues, rosters and lineups for a real
   username against the deployed service.
2. An unknown username returns a clean 404 from _our_ API — not a 200 carrying `null`.
3. A second identical request inside the TTL is served from cache, provably: `sync_log` shows
   no new fetch, and the response is materially faster.
4. `leagues`, `memberships` and `rosters` are populated in Neon and consistent with what
   Sleeper returns.
5. A simulated sweep of ≥500 leagues against a stubbed client stays under the configured
   per-minute budget, measured — not asserted.
6. Killing Redis (bad credentials) degrades to `synced_at` and still syncs.
7. Fixtures for endpoints 3–6 committed under `fixtures/`.
8. CI green; deployed to Fly through the pipeline that now works.

## 2.12 Explicitly not in Stage 2

No rule engine and nothing in `packages/rules`. No bye weeks (Stage 4). No Expo app (Stage 3).
No notifications, no email, no scheduler wiring — Loop C is Stage 6 and merely _calls_ the
sweep this stage builds. No live scoreboard. No auth, no accounts beyond an identity row.

## 2.13 What Stage 2 needs from you

**Your Sleeper username** — the one item that blocks fixture capture (§2.7), and the same data
that §7's Day 7 and the rule-7 tuning in §6 depend on. Everything else in this stage can be
built, tested and deployed without it.

---

## Stages 3–11

Designed one at a time, as each becomes next.
