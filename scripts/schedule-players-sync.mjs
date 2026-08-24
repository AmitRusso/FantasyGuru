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
 * build-plan.md S1 §1.3: QStash evaluates plain cron in UTC. `0 7 * * *` is 03:00 ET during
 * EDT and 02:00 ET once the clocks go back on 1 November. For Loop A that drift is harmless.
 * For Loop C in Stage 6 it is not -- a Sunday alarm job that silently moves to 08:00 ET fires
 * an hour late into the only window the product has -- so the timezone-pinning path gets
 * proven here, on a job where being wrong costs nothing.
 *
 * The QStash SDK (2.11.3) types `cron` as a plain string with no timezone field, so this
 * script ATTEMPTS the `CRON_TZ=` prefix, reads the schedule back, and reports exactly which
 * form the API accepted. Do not assume -- read the output.
 */

const TOKEN = process.env.QSTASH_TOKEN;
const BASE_URL = process.env.API_BASE_URL;

if (!TOKEN || !BASE_URL) {
  console.error('QSTASH_TOKEN and API_BASE_URL must both be set.');
  process.exit(1);
}

const DESTINATION = `${BASE_URL.replace(/\/$/, '')}/internal/jobs/players-sync`;
const TZ_CRON = 'CRON_TZ=America/New_York 0 3 * * *';
const UTC_CRON = '0 7 * * *'; // 03:00 ET while EDT is in effect.

const QSTASH = 'https://qstash.upstash.io/v2';

async function qstash(path, init = {}) {
  const response = await fetch(`${QSTASH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function createSchedule(cron) {
  return qstash(`/schedules/${encodeURIComponent(DESTINATION)}`, {
    method: 'POST',
    headers: {
      'upstash-cron': cron,
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

  let created = await createSchedule(TZ_CRON);
  let cronUsed = TZ_CRON;

  if (!created.ok) {
    console.warn(`\nQStash rejected the timezone-pinned cron (${created.status}):`);
    console.warn(`  ${created.text}`);
    console.warn(`Falling back to UTC: "${UTC_CRON}".`);
    console.warn(
      'ACTION REQUIRED before Stage 6: this job will run at 02:00 ET after 1 Nov 2026.\n' +
        'Harmless for Loop A. For the Sunday alarm it is not -- Stage 6 must either pin the\n' +
        'timezone another way or register two schedules across the DST boundary.\n',
    );
    created = await createSchedule(UTC_CRON);
    cronUsed = UTC_CRON;
  }

  if (!created.ok) {
    console.error(`Failed to create schedule (${created.status}): ${created.text}`);
    process.exit(1);
  }

  const { scheduleId } = JSON.parse(created.text);
  const readBack = await qstash(`/schedules/${scheduleId}`);

  console.log(`\ncreated schedule ${scheduleId}`);
  console.log(`cron accepted:   ${cronUsed}`);
  console.log(`read back as:    ${readBack.ok ? JSON.parse(readBack.text).cron : readBack.text}`);
  console.log(
    cronUsed === TZ_CRON
      ? '\nTimezone pinning works. Stage 6 can use the same form for Loop C.'
      : '\nTimezone pinning NOT available. See the warning above.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
