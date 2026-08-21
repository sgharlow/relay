/**
 * The alarm of record is three GitHub workflows, and a ruling that nothing
 * enforces is a ruling that expires.
 *
 * THE FINDING (`PROJECT.yaml → deferred → the-in-app-alarm-shares-fate-with-product-email`,
 * B6). `error-reporter.ts` and `incident.ts` alert through Resend — the same
 * provider the product's own mail rides, whose Outlook deliverability is an open
 * ticket and whose DMARC posture is still `p=none`. A watchdog sharing fate with
 * the thing it watches is the mistake `scheduler-monitor.yml` and
 * `delivery-webhook-monitor.yml` were each written to avoid, made one layer up.
 *
 * THE RULING, 2026-08-20: the GitHub-hosted monitors are the alarm of record and
 * the in-app mail is advisory. That is a legitimate answer — the three of them
 * run off-platform and share fate with neither Vercel nor Resend, and a Resend
 * outage is itself reported by the delivery-webhook monitor. It is only
 * legitimate while it stays TRUE, which is what this file is for: delete a
 * monitor, or quietly stop it running on a schedule, and the ruling becomes a
 * paragraph describing coverage that no longer exists.
 *
 * ⚠️ THIS IS A COVERAGE CHECK, NOT A LIVENESS CHECK. It reads workflow files;
 * it cannot tell whether GitHub actually ran them. Nothing in a unit suite can.
 * What it prevents is the silent version — a monitor removed in a tidy-up while
 * three files still claim it is the reason they are allowed to be unreliable.
 *
 * Feature: relay-h0-mvp
 * Requirements: J5-R7, CC9
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS = join(process.cwd(), '.github/workflows');
const read = (f: string) => readFileSync(join(WORKFLOWS, f), 'utf8');

/** The three that constitute the alarm of record, and what each one covers. */
const MONITORS: [file: string, covers: string][] = [
  ['scheduler-monitor.yml', 'the release sweep stopped'],
  ['delivery-webhook-monitor.yml', 'mail telemetry stopped — i.e. Resend itself'],
  ['production-canary.yml', 'the refusals that cost something stopped refusing'],
];

describe('the alarm of record still exists', () => {
  it.each(MONITORS)('%s is present — it covers: %s', (file) => {
    expect(
      existsSync(join(WORKFLOWS, file)),
      `${file} is gone, and three source files cite it as the reason their own ` +
        'alerting is allowed to be advisory. Either restore it or reopen B6.',
    ).toBe(true);
  });

  it.each(MONITORS)('%s runs on a schedule rather than only on demand', (file) => {
    const src = read(file);
    expect(src).toContain('schedule:');
    expect(src, `${file} has a schedule: block with no cron in it`).toMatch(/cron:\s*'/);
  });

  it.each(MONITORS)('%s runs on GitHub, not on the platform it watches', (file) => {
    // The whole property. A monitor hosted on Vercel would share fate with the
    // app: if Vercel stops, the heartbeat stops AND the monitor stops, and
    // silence looks exactly like health.
    expect(read(file)).toContain('runs-on:');
  });
});

describe('the ruling is written where the advisory alerters are', () => {
  const reporter = readFileSync(join(process.cwd(), 'lib/ops/error-reporter.ts'), 'utf8');
  const incident = readFileSync(join(process.cwd(), 'lib/ops/incident.ts'), 'utf8');

  it('error-reporter.ts says it is not the alarm of record', () => {
    expect(reporter).toContain('ALARM OF RECORD');
  });

  it('incident.ts says the same, so a reader of either lands on the ruling', () => {
    expect(incident).toContain('ALARM OF RECORD');
  });

  it('both name the monitors that carry it, rather than gesturing at "the monitors"', () => {
    for (const [file] of MONITORS) {
      expect(reporter, `error-reporter.ts does not name ${file}`).toContain(file);
    }
  });
});

describe('the one thing only the reporter can know', () => {
  const reporter = readFileSync(join(process.cwd(), 'lib/ops/error-reporter.ts'), 'utf8');

  it('reads the send result instead of dropping it', () => {
    // It returns false when the provider refuses. Discarding that meant a 500
    // during a Resend outage was silent twice: the incident, and the fact that
    // its alert had been lost.
    expect(reporter).toMatch(/const\s+delivered\s*=\s*await\s+sendEmailBestEffort\(/);
  });

  it('leaves a distinctly-marked trace when its own alert was refused', () => {
    expect(reporter).toContain('ALERT NOT DELIVERED');
    const at = reporter.indexOf('ALERT NOT DELIVERED');
    const around = reporter.slice(Math.max(0, at - 400), at);
    expect(around, 'the trace is not guarded by the delivery result').toContain('if (!delivered)');
  });

  it('writes that trace without being able to throw from the error path', () => {
    const at = reporter.indexOf('ALERT NOT DELIVERED');
    const after = reporter.slice(at, at + 400);
    // Same rule guess-watch keeps: a broken stderr must not escalate a handled
    // failure into an unhandled one.
    expect(after).toContain('catch');
  });
});

/**
 * 🔴 THE FATE THE ALARM OF RECORD SHARES WITH A QUIET OWNER, and which nothing
 * in this repo recorded until 2026-08-21.
 *
 * The B6 ruling rests on these three running off-platform, sharing fate with
 * neither Vercel nor Resend. True — and all three, plus `date-guards.yml`, share
 * fate with GitHub continuing to fire cron triggers. `sgharlow/relay` is a
 * PUBLIC repository, and GitHub automatically disables scheduled workflows in a
 * public repository after 60 days with no repository activity.
 *
 * That is the exact shape every header in this directory warns about, one layer
 * further out: the product's dead-man is designed for an owner who has gone
 * quiet, and the repo going quiet for two months turns the dead-men off. GitHub
 * emails before disabling, so it is not silent — but a disabled workflow cannot
 * report that it was disabled, and the warning lands in the same inbox the
 * holiday is being taken away from.
 *
 * ⚠️ THIS TEST DOES NOT FIX IT. Closing it needs an off-GitHub heartbeat — a
 * Route 53 health check or CloudWatch Synthetics canary alarming to the SNS
 * topic `docs/backup-restore-runbook.md` proved reaches a human. That is new
 * infrastructure with a cost, so it is proposed rather than taken. What this
 * does is make the trap impossible to add a fourth scheduled alarm without
 * meeting: every one of them has to carry the account of it.
 */
describe('every scheduled alarm records the trap it shares with the others', () => {
  const SCHEDULED = [...MONITORS.map(([f]) => f), 'date-guards.yml'];

  it.each(SCHEDULED)('%s names the 60-day auto-disable', (file) => {
    expect(
      read(file),
      `${file} runs on a schedule and does not mention that GitHub disables scheduled ` +
        'workflows in a public repository after 60 days of repository inactivity. Every ' +
        'alarm here depends on that not happening, and a reader deciding whether this ' +
        'workflow can be relied on during a quiet period needs to know it.',
    ).toContain('after 60 days');
  });

  it('the scheduled set is the monitors plus the date guards, and nothing has been dropped', () => {
    // A file removed from .github/workflows but left in this list would make the
    // check above throw on a missing file rather than report a gap.
    for (const f of SCHEDULED) {
      expect(existsSync(join(WORKFLOWS, f)), `${f} is gone`).toBe(true);
      expect(read(f), `${f} no longer runs on a schedule`).toContain('schedule:');
    }
  });
});
