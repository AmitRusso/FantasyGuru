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

## Stages 2–11

Designed the same way, one stage at a time, as each becomes next. Stage 2's shape is already
constrained by §2.2 and §2.3 — a per-league cache keyed by `league_id` rather than by user, the
concurrency limiter at ~10, the time-of-week TTL table, and fixture capture happening _while_
the adapter is written rather than after it.
