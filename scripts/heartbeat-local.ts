/**
 * B12.i — the off-GitHub heartbeat. The watchdog that does not live inside the
 * thing it watches.
 *
 * 🔴 WHY, MEASURED 2026-09-02 (B11.2, the re-measure the pack dated).
 * The sub-hourly monitors are collapsing and it is NOT a billing problem:
 *
 *   production-canary.yml   5-7 scheduled runs/day against a designed 96
 *   scheduler-monitor.yml   5-7 scheduled runs/day against a designed 48
 *   cadence-watch / date-guards / kms-wall (DAILY tier)   3 of 3 — 100%
 *
 * The collapse is frequency-selective and it SURVIVED the 2026-09-02 billing
 * reset. And the recorded cause — "Actions minutes exhaustion" — was never
 * possible: `sgharlow/relay` is a PUBLIC repository, where GitHub Actions
 * minutes are free and unlimited. GitHub simply drops sub-hourly schedules; it
 * does not queue them (`created_at == run_started_at`).
 *
 * So the detection window for a broken production deploy is ~4-6 hours against
 * a designed quarter of an hour, and no amount of tuning the cron fixes it.
 *
 * WHAT THIS DOES THAT THE GITHUB CANARY CANNOT. It runs from a machine GitHub
 * does not schedule, and it checks BOTH halves:
 *
 *   1. IS PRODUCTION HEALTHY — by running the real canary (`scripts/canary.ts`)
 *      against production. Not a run-count proxy: the actual behavioural
 *      checks, the same ones the workflow runs, with no credentials and no
 *      writes.
 *   2. IS GITHUB STILL DELIVERING — a read-only `gh api` count of scheduled
 *      canary runs in the trailing window. This is the half that tells you the
 *      cloud watchdog has gone quiet, which is the condition that made this
 *      script necessary.
 *
 * Either half failing is worth waking somebody for, and they fail differently:
 * (1) means customers are meeting a broken product; (2) means nobody would have
 * been told about (1).
 *
 * 🔴 IT REFUSES TO RUN SILENTLY. `opsAlertAddress()` deliberately returns
 * undefined in any environment it can positively identify as non-production —
 * correct for the app (a preview deploy must not page anyone) and WRONG here:
 * this is an operator tool that runs off-platform, where `NODE_ENV=development`
 * in a Task Scheduler environment would mute every alert while the script kept
 * exiting 0. That is the exact "silence looks like success" failure this whole
 * directory exists to prevent, so the address is read directly and its ABSENCE
 * is a fatal error rather than a quiet no-op.
 *
 * 🔴 AND IT MUST BE ABLE TO SEND. Found 2026-09-02, the day after the "alert
 * delivered" proof: that proof ran from a shell with RESEND_API_KEY exported,
 * and the Task Scheduler's environment has no such thing. Started bare, this
 * script detected a dead production and printed "ALERT COULD NOT BE SENT" —
 * exactly the muted watchdog the address guard exists to prevent. So
 * `npm run heartbeat` starts node with `--env-file-if-exists=.env.local`, the
 * same shape #55 gave the stripe monitor: the key is read from the repo's
 * gitignored env file, the environment still wins where both define a value,
 * and a missing file is not fatal (a hard `--env-file=` exits 9 before the
 * address guard could speak). The installer refuses to register the task
 * unless the key is visible to the scheduler by one of those routes.
 *
 * Exit codes follow this repo's convention:
 *   0  both halves healthy
 *   1  a finding — production is unhealthy, or GitHub has stopped delivering
 *   2  could not look (no alert address, gh unavailable, probe could not run)
 *
 * Feature: relay-h0-mvp
 * Requirements: B12.i
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const run = promisify(execFile);

/** Gitignored, like `.drill-scratch/` — this writes every few minutes. */
const STATE_DIR = join(process.cwd(), '.heartbeat');
const LOG = join(STATE_DIR, 'runs.jsonl');

const BASE_URL = process.env.CANARY_BASE_URL?.trim() || 'https://relaystandby.com';
const REPO = process.env.HEARTBEAT_REPO?.trim() || 'sgharlow/relay';
const WINDOW_HOURS = Number(process.env.HEARTBEAT_WINDOW_HOURS ?? 6);

/**
 * How many scheduled canary runs must appear in the window before we call
 * GitHub delivery "alive". Deliberately NOT the designed rate: at ~6 runs/day
 * observed, demanding the design would fire constantly and be muted within a
 * week. This asks the narrower question the operator actually needs answered —
 * *has it stopped completely?* — which is a different failure from *is it
 * degraded*, and the degraded case is already reported daily by cadence-watch.
 */
const MIN_RUNS_IN_WINDOW = Number(process.env.HEARTBEAT_MIN_RUNS ?? 1);

interface Finding {
  half: 'production' | 'delivery';
  detail: string;
  consequence: string;
}

/** The address, read WITHOUT the app's non-production gate. See the header. */
function alertAddress(): string | undefined {
  const v = (process.env.OPS_ALERT_ADDRESS ?? process.env.OPS_ALERT_EMAIL ?? '').trim();
  return v || undefined;
}

async function probeProduction(): Promise<Finding | null> {
  try {
    await run(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/canary.ts'], {
      env: { ...process.env, CANARY_BASE_URL: BASE_URL },
      timeout: 120_000,
    });
    return null;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    return {
      half: 'production',
      detail: out.slice(-1500) || `canary exited ${err.code ?? 'non-zero'} with no output`,
      consequence:
        'A behavioural check against production FAILED. This is the half that means customers ' +
        'are meeting a broken product right now.',
    };
  }
}

async function probeDelivery(): Promise<Finding | null> {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  let stdout: string;
  try {
    ({ stdout } = await run(
      'gh',
      [
        'api',
        `repos/${REPO}/actions/workflows/production-canary.yml/runs?per_page=100`,
        '--jq',
        `[.workflow_runs[] | select(.event=="schedule") | select(.created_at > "${since}")] | length`,
      ],
      { timeout: 60_000 },
    ));
  } catch (e) {
    // Cannot look is NOT the same as healthy, and must not be reported as one.
    throw new Error(`gh api unavailable: ${(e as Error).message.slice(0, 200)}`);
  }
  const n = Number(stdout.trim());
  if (!Number.isFinite(n)) throw new Error(`gh api returned an unreadable count: ${stdout.trim().slice(0, 80)}`);
  if (n >= MIN_RUNS_IN_WINDOW) return null;
  return {
    half: 'delivery',
    detail: `${n} scheduled canary run(s) in the last ${WINDOW_HOURS}h (need ≥ ${MIN_RUNS_IN_WINDOW})`,
    consequence:
      'GitHub has stopped delivering the scheduled canary entirely. Production may be fine — but ' +
      'if it were not, nothing on GitHub would tell you. This local check is the only watcher left.',
  };
}

async function sendAlert(to: string, findings: Finding[]): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_REPLY_TO_ADDRESS?.trim() || 'relay@relaystandby.com';
  if (!key) return false;
  const body =
    `The off-GitHub heartbeat (B12.i) found ${findings.length} problem(s) at ` +
    `${new Date().toISOString()}.\n\nThis alert was sent by the LOCAL watchdog on the operator's ` +
    `machine, deliberately outside GitHub Actions, because the GitHub-scheduled canary is being ` +
    `dropped (~6 runs/day against a designed 96).\n\n` +
    findings.map((f) => `── ${f.half.toUpperCase()}\n${f.detail}\n\n→ ${f.consequence}`).join('\n\n') +
    `\n\nProbed: ${BASE_URL}\n`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: `[relay] heartbeat: ${findings.map((f) => f.half).join(' + ')} FAILING`,
        text: body,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function stamp(record: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  } catch {
    /* a stamp that cannot be written must not take the watchdog down */
  }
}

async function main(): Promise<void> {
  const to = alertAddress();
  if (!to) {
    console.error(
      'heartbeat: NO ALERT ADDRESS. Set OPS_ALERT_ADDRESS (or OPS_ALERT_EMAIL).\n' +
        'Refusing to run: a watchdog that cannot alert is worse than none, because its silence ' +
        'is indistinguishable from good news.',
    );
    stamp({ result: 'could-not-look', why: 'no alert address' });
    process.exit(2);
  }

  const findings: Finding[] = [];
  let couldNotLook: string | null = null;

  const prod = await probeProduction();
  if (prod) findings.push(prod);

  try {
    const delivery = await probeDelivery();
    if (delivery) findings.push(delivery);
  } catch (e) {
    couldNotLook = (e as Error).message;
  }

  if (findings.length === 0 && !couldNotLook) {
    console.log(`heartbeat OK — production healthy, GitHub delivering (${BASE_URL})`);
    stamp({ result: 'ok' });
    return;
  }

  if (couldNotLook && findings.length === 0) {
    console.error(`heartbeat: could not look — ${couldNotLook}`);
    stamp({ result: 'could-not-look', why: couldNotLook });
    process.exit(2);
  }

  for (const f of findings) console.error(`🔴 ${f.half}: ${f.detail}\n   → ${f.consequence}`);
  const sent = await sendAlert(to, findings);
  console.error(sent ? `alert sent to ${to}` : `⚠️ ALERT COULD NOT BE SENT to ${to}`);
  stamp({ result: 'finding', halves: findings.map((f) => f.half), alerted: sent });
  process.exit(1);
}

main().catch((e) => {
  console.error('heartbeat: unexpected failure —', (e as Error).message);
  stamp({ result: 'could-not-look', why: (e as Error).message });
  process.exit(2);
});
