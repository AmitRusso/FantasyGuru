#!/usr/bin/env node
/**
 * Creates (or replaces) the QStash schedule that drives Loop A.
 *
 * Run once per environment:
 *   node scripts/schedule-players-sync.mjs
 *
 * Requires QSTASH_TOKEN and API_BASE_URL in the environment.
 *
 * ---------------------------------------------------------------------------------------
 * Why this script exists rather than a line in the README
 *
 * build-plan.md S1 §1.3: QStash evaluates plain cron in UTC by default. A Sunday alarm job
 * that silently moves an hour when EDT ends on 1 November would fire late into the only
 * window the product has, so this Stage 1 job -- where being wrong costs nothing -- is where
 * the timezone-pinning path gets proven.
 *
 * CONFIRMED WORKING against the live API on 24 Aug 2026: QStash accepts a `CRON_TZ=<iana>`
 * prefix on the cron expression and stores it verbatim (read back as
 * "CRON_TZ=America/New_York 0 3 * * *"), and computes nextScheduleTime correctly against it
 * (verified as 07:00 UTC = 03:00 ET). Stage 6 can use the identical form for Loop C.
 *
 * Two API quirks discovered while writing this, neither documented in the QStash SDK's
 * (2.11.3) types:
 *   1. The destination path segment must be the RAW url, not percent-encoded --
 *      encodeURIComponent(destination) is rejected with "invalid destination url: endpoint
 *      has invalid scheme". The colon and slashes are meant to pass through literally.
 *   2. `GET /v2/schedules` returns a bare JSON array, not an { schedules: [...] } wrapper.
 */

const TOKEN = process.env.QSTASH_TOKEN;
const BASE_URL = process.env.API_BASE_URL;

if (!TOKEN || !BASE_URL) {
  console.error('QSTASH_TOKEN and API_BASE_URL must both be set.');
  process.exit(1);
}

const DESTINATION = `${BASE_URL.replace(/\/$/, '')}/internal/jobs/players-sync`;
const CRON = 'CRON_TZ=America/New_York 0 3 * * *';

const QSTASH = 'https://qstash.upstash.io/v2';

async function qstash(path, init = {}) {
  const response = await fetch(`${QSTASH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function createSchedule() {
  // NOT encodeURIComponent(DESTINATION) -- see the header comment. QStash wants the literal
  // URL as the trailing path segment.
  return qstash(`/schedules/${DESTINATION}`, {
    method: 'POST',
    headers: {
      'upstash-cron': CRON,
      'upstash-method': 'POST',
      'content-type': 'application/json',
      // QStash retries on non-2xx. The route is idempotent and returns 200 on a
      // concurrent-run skip, so retries are safe -- but three is plenty.
      'upstash-retries': '3',
    },
    body: JSON.stringify({ job: 'players-sync', source: 'qstash-schedule' }),
  });
}

async function main() {
  console.log(`destination: ${DESTINATION}`);
  console.log(`cron:        ${CRON}`);

  // Remove any existing schedule for this destination so re-running is idempotent.
  const existing = await qstash('/schedules');
  if (existing.ok) {
    for (const schedule of JSON.parse(existing.text)) {
      if (schedule.destination === DESTINATION) {
        await qstash(`/schedules/${schedule.scheduleId}`, { method: 'DELETE' });
        console.log(`removed existing schedule ${schedule.scheduleId}`);
      }
    }
  }

  const created = await createSchedule();
  if (!created.ok) {
    console.error(`Failed to create schedule (${created.status}): ${created.text}`);
    process.exit(1);
  }

  const { scheduleId } = JSON.parse(created.text);
  const readBack = await qstash(`/schedules/${scheduleId}`);
  const stored = readBack.ok ? JSON.parse(readBack.text) : null;

  console.log(`\ncreated schedule ${scheduleId}`);
  console.log(`cron read back:      ${stored?.cron ?? readBack.text}`);
  console.log(
    `next run (UTC):      ${stored ? new Date(stored.nextScheduleTime).toISOString() : 'unknown'}`,
  );
  console.log(
    `next run (ET):       ${
      stored
        ? new Date(stored.nextScheduleTime).toLocaleString('en-US', {
            timeZone: 'America/New_York',
          })
        : 'unknown'
    }`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
