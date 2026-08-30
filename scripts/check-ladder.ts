/**
 * scripts/check-ladder.ts — has the check-in reminder ladder failed anybody?
 *
 * The human-readable half of `/api/health/reminders`. Same module, same rule,
 * read straight from the cluster with the READ-ONLY credential rather than
 * through the app — so it can be run without a dev server, and so a person
 * looking into a red `reminder-ladder-monitor` run can see the same answer the
 * monitor saw and one thing the monitor cannot show: the DATE of the next rung.
 *
 * ⚠️ READ-ONLY, and that is enforced by the credential rather than by care. It
 * runs under `.env.ro` (`relay_ro`), which cannot write. Nothing here creates,
 * updates or deletes anything.
 *
 * WHAT "GREEN" MEANS HERE, and it is worth being precise because the ladder has
 * never fired: green means no rung is overdue and unrecorded. Until
 * `rungsEverRecorded` moves off zero, green ALSO means the ladder has never sent
 * anything to anybody — so the number is printed on every run rather than only
 * on failure. The first firing is the live owner's 75% rung; this is the command
 * that shows it happened.
 *
 * ⚠️ IT CAN BE MADE TO GO RED WITHOUT WRITING ANYTHING. `--as-of <iso>` runs
 * the same rule against the same live rows at a different moment, so "what will
 * this say the day after the rung passes" is answerable now, today, rather than
 * being taken on trust until 2026-09-21. Two sibling monitors carried comments
 * claiming they could be proven on demand when their target was hard-coded and
 * they could only ever pass; both were found on 2026-08-28/29. This is the same
 * property, built in rather than claimed. It changes only the clock — the read
 * is the same read, under the same read-only credential.
 *
 * Usage:
 *   npm run check:ladder
 *   npm run check:ladder -- --as-of 2026-09-22T00:00:00Z    (prove the red path)
 *
 * Exit codes:
 *   0  no rung is overdue and unrecorded
 *   1  a rung fell due more than the grace period ago with nothing to show
 *   2  could not look. Deliberately NOT 0 — a watchdog that cannot see is not a
 *      watchdog that is happy, the rule scripts/check-cadence.ts already sets.
 *
 * Feature: relay-standby
 * Requirements: J5-R4, B15.1
 */

import { query, closeAllPools } from '../lib/db/connection';
import { CHECKIN_REMINDER_RUNGS } from '../lib/release/checkin-reminder';
import {
  getReminderLadderHealth,
  REMINDER_GRACE_MS,
} from '../lib/release/reminder-ladder-health';

/**
 * When each rung next falls due, per owner — the one thing the HTTP probe
 * deliberately does not return, because a public endpoint should not hand out a
 * schedule of when a named person's vault starts opening. Read here, under a
 * credential, and printed without the address.
 */
async function nextRungs(now: Date): Promise<string[]> {
  const r = await query<{ interval_days: string; last_active: string }>(
    `SELECT u.checkin_interval_days::text AS interval_days,
            u.last_active_at::text AS last_active
       FROM users u
      WHERE u.status = 'active' AND u.is_demo_account = false
      ORDER BY u.last_active_at`,
  );

  const lines: string[] = [];
  for (const row of r.rows) {
    const intervalMs = Number(row.interval_days) * 86_400_000;
    const last = new Date(row.last_active).getTime();
    if (!Number.isFinite(last) || intervalMs <= 0) continue;
    for (const rung of CHECKIN_REMINDER_RUNGS) {
      const due = new Date(last + rung.atElapsedFraction * intervalMs);
      const when = due.getTime() < now.getTime() ? 'PASSED' : 'due  ';
      lines.push(
        `    ${when} ${due.toISOString()}  ${rung.key.padEnd(5)} ` +
          `(${Math.round(rung.atElapsedFraction * 100)}% of ${row.interval_days}d)`,
      );
    }
  }
  return lines;
}

/**
 * The moment the rule is applied at. Defaults to now; `--as-of` moves it, and a
 * moved clock is announced loudly so a pasted transcript can never be mistaken
 * for a reading of the present.
 */
function asOf(): { now: Date; simulated: boolean } {
  const i = process.argv.indexOf('--as-of');
  if (i === -1) return { now: new Date(), simulated: false };
  const parsed = new Date(process.argv[i + 1] ?? '');
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--as-of needs an ISO timestamp, got: ${String(process.argv[i + 1])}`);
  }
  return { now: parsed, simulated: true };
}

async function main(): Promise<void> {
  const { now, simulated } = asOf();
  if (simulated) {
    console.log(`⚠️  SIMULATED CLOCK: applying the rule as at ${now.toISOString()}`);
    console.log('    The rows are live and unchanged; only the moment differs.');
    console.log('');
  }

  let health;
  try {
    health = await getReminderLadderHealth(now);
  } catch (err) {
    console.error(`\n✗ COULD NOT LOOK: ${String(err instanceof Error ? err.message : err)}`);
    console.error('  A watchdog that cannot read is not a watchdog that is happy — exiting 2.\n');
    process.exitCode = 2;
    return;
  }

  console.log('check-in reminder ladder\n');
  console.log(`  owners examined     ${health.ownersExamined}`);
  console.log(`  grace before alarm  ${REMINDER_GRACE_MS / 3_600_000}h`);
  console.log(
    `  rungs ever sent     ${health.rungsEverRecorded}` +
      (health.rungsEverRecorded === 0
        ? '   ← this product has never sent a check-in reminder to anybody'
        : ''),
  );

  const schedule = await nextRungs(now);
  if (schedule.length) {
    console.log('\n  the ladder, per active owner:');
    for (const line of schedule) console.log(line);
  }

  if (health.blind.length) {
    console.log('\n  ⚠️ what this check CANNOT report on:');
    for (const b of health.blind) console.log(`    ${b.rung}: ${b.reason}`);
  }

  if (!health.healthy) {
    console.error('\n✗ A REMINDER WAS DUE AND THERE IS NO RECORD IT WAS SENT.\n');
    for (const f of health.unhonoured) {
      console.error(`    rung "${f.rung}" has been due for ${f.overdueHours}h with no audit row`);
    }
    console.error(
      '\n  The owner is approaching the point where Relay starts asking the people they\n' +
        '  named, and the warning that comes first has not happened. In order:\n' +
        '    1. GET /api/health/scheduler — if that is red too, fix the cron first.\n' +
        '    2. Vercel logs for /api/cron/heartbeat, stderr lines "[checkin-reminder]".\n' +
        '       The sweep never throws, so a failure is a log line and nothing else.\n' +
        '    3. Delivery: the audit row is written ONLY on a successful send, so a\n' +
        '       bouncing address produces exactly this finding.\n',
    );
    process.exitCode = 1;
    return;
  }

  console.log('\n✓ No rung is overdue and unrecorded.\n');
}

main()
  .catch(async (err) => {
    console.error(`\nERROR: ${String(err)}`);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeAllPools();
  });
