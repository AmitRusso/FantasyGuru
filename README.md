# FantasyGuru

A cross-league dashboard for Sleeper, and a Sunday-morning alarm that tells you whether any of
your lineups are broken while you can still fix them.

- **What to build:** [`docs/fantasyguru-v1-spec.html`](docs/fantasyguru-v1-spec.html)
- **How it gets built, stage by stage:** [`docs/build-plan.md`](docs/build-plan.md)
- **What it looks like:** [`docs/design-brief.md`](docs/design-brief.md)

**Current stage: 1 — skeleton and player sync.** The backend keeps the player universe and
the current NFL week fresh. Nothing is user-facing yet.

## Layout

```
apps/api/          TypeScript · Fastify 5 on Node 22 → Fly.io
packages/db/       Drizzle schema, migrations, query helpers
packages/sleeper/  Typed Sleeper client and the lenient normaliser
fixtures/          Real captured Sleeper payloads
```

`apps/mobile` (Expo, → Vercel for the web export) arrives in Stage 3, and `packages/rules` in
Stage 5. That package will have **no dependencies** — an ESLint rule already enforces it.

## Getting set up

Node 22+ and pnpm 11. If pnpm is not installed:

```bash
corepack enable
```

On Windows that needs an elevated shell; without one, prefix every pnpm command with
`corepack` (`corepack pnpm install`).

```bash
pnpm install
```

Then copy `.env.example` to `apps/api/.env` and fill in `DATABASE_URL` and `INTERNAL_SECRET`.

## Everyday commands

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm lint
```

```bash
pnpm build
```

Database migrations, from a shell with `DATABASE_URL` set:

```bash
pnpm db:generate
```

```bash
pnpm db:migrate
```

## The scheduled job

Loop A (spec §2.2) refreshes the ~12,000-player universe and the current NFL week, daily at
03:00 ET. It is driven by Upstash QStash calling a protected route — not by platform cron,
which spec §1.1 rules out.

Register the schedule once per environment, with `QSTASH_TOKEN` and `API_BASE_URL` set:

```bash
node scripts/schedule-players-sync.mjs
```

Trigger a run by hand:

```bash
curl -X POST "$API_BASE_URL/internal/jobs/players-sync" -H "x-internal-secret: $INTERNAL_SECRET"
```

A second call while the first is still running returns `{"skipped":"locked"}` with a 200 —
deliberately, because a non-2xx teaches QStash to retry a job that is already running.

## Deploying

`main` deploys to Fly on green CI. The workflow **refuses to deploy on Saturday or Sunday ET**
(spec §5.4): eighty percent of this app's value lands in one four-hour window a week, and a
bad deploy at 10:00 Sunday is not a rollback — the moment passes for seven days. Override by
running `fly deploy` yourself, deliberately.
