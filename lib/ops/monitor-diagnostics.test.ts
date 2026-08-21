/**
 * What an alarm says when it fires, and whether it can be made to fire at all.
 *
 * `alarm-of-record.test.ts` asserts the three monitors EXIST and are scheduled.
 * This asserts the two things that decide whether they are worth having when
 * they finally go off:
 *
 * 🔴 ONE — THE CANARY HAD NO WAY TO BE PROVEN. `production-canary.yml` carried
 * `workflow_dispatch: {} # so the alarm can be proven to work on demand`, and
 * that comment was not true: the job ran `node scripts/canary.ts` with no
 * argument, so a dispatch could only ever probe production and could only ever
 * pass. In ~1,200 scheduled runs since 2026-08-08 it had never once been red,
 * and PROJECT.yaml B4's own bar is that "a wall-checker that has only ever
 * passed has not been seen to work". Forcing it red needed a commit — which is
 * the thing nobody does to test an alarm. `scripts/canary.ts` already accepted
 * `argv[2]` and `CANARY_BASE_URL`; the workflow simply never passed either.
 *
 * 🔴 TWO — THE WEBHOOK MONITOR'S FAILURE TEXT DESCRIBED A CONDITION IT NO LONGER
 * ALARMS ON. It printed "No delivery event has EVER arrived" for every failure.
 * That was the only unhealthy state when it was written; `webhook-health.ts`
 * has since grown `refusing`, `deaf` and `mute`, and the commonest of them —
 * a revoked API key — would have been reported as its opposite. An operator
 * following that line goes to the Resend webhook page while every message the
 * product sends is being refused.
 *
 * The second check below is derived from `webhook-health.ts` rather than
 * hand-listed, so a fifth unhealthy condition cannot be added without the
 * workflow that reports it being updated in the same change. That is the whole
 * defect: the condition was extended and the diagnosis was not.
 *
 * Feature: relay-h0-mvp (CC9)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the canary can be forced red without editing code', () => {
  const workflow = read('.github/workflows/production-canary.yml');
  const script = read('scripts/canary.ts');

  it('accepts a base URL on dispatch', () => {
    expect(
      workflow,
      'production-canary.yml has no workflow_dispatch input for the target. Without one, a ' +
        'manual run can only probe production and can only pass, so the claim that the alarm ' +
        '"can be proven to work on demand" is unfalsifiable.',
    ).toMatch(/workflow_dispatch:\s*\n\s*inputs:/);
    expect(workflow).toContain('base_url');
  });

  it('passes that input through to the probe', () => {
    // Declaring an input the job ignores is the same decoration one layer in.
    expect(
      workflow,
      'the base_url input is declared but never reaches the canary step.',
    ).toMatch(/CANARY_BASE_URL:\s*\$\{\{/);
    expect(
      script,
      'scripts/canary.ts no longer reads CANARY_BASE_URL, so the workflow input goes nowhere.',
    ).toContain('CANARY_BASE_URL');
  });

  it('still defaults to production, so the schedule is unaffected', () => {
    expect(workflow).toContain('https://relaystandby.com');
  });
});

describe('a canary check states a consequence that is still true', () => {
  /*
    `canary.ts` opens with the rule that every check states its consequence,
    "because a canary that fails with check 4 failed at 3am is a canary that
    gets muted". The corollary went unwritten: a consequence about a retired
    channel is no better than none. The /caregivers check printed "Ad spend
    continues while the traffic it buys hits nothing" for five days after
    PROJECT.yaml's `retire-paid-advertising` ruling made that impossible.
  */
  const RETIRED_CHANNEL = /\b(ad spend|paid click|paid traffic|ad flight|google ads|paid advertising)\b/i;

  it('none of them describes the retired paid-advertising lane', async () => {
    const { CHECKS } = (await import('./canary')) as {
      CHECKS: { name: string; meaning: string }[];
    };
    const stale = CHECKS.filter((c) => RETIRED_CHANNEL.test(c.meaning)).map((c) => c.name);
    expect(
      stale,
      stale.length
        ? `These checks explain their failure in terms of paid advertising, which was retired ` +
          `on 2026-08-16 (PROJECT.yaml ratified.retire-paid-advertising):\n${stale
            .map((s) => `  ${s}`)
            .join('\n')}\n\nAn operator reading a consequence that cannot happen learns to ` +
          'skip the line, and then skips the one that mattered.'
        : 'ok',
    ).toEqual([]);
  });
});

describe('the webhook monitor names every condition it can fire on', () => {
  const health = read('lib/notify/webhook-health.ts');
  const workflow = read('.github/workflows/delivery-webhook-monitor.yml');

  /**
   * The unhealthy conditions, read out of the one expression that defines them:
   * `const healthy = everHeard && !refusing && !deaf && !mute;`
   */
  const conditions = (() => {
    const m = health.match(/const healthy = ([^;]+);/);
    expect(m, 'webhook-health.ts no longer has a single `const healthy = ...` expression — ' +
      'this check reads the conditions out of it and can no longer do so.').toBeTruthy();
    return [...(m as RegExpMatchArray)[1].matchAll(/!?([A-Za-z_]\w*)/g)].map((x) => x[1]);
  })();

  it('reads a plausible set of conditions, so this suite is not vacuous', () => {
    expect(conditions.length).toBeGreaterThanOrEqual(3);
    expect(conditions).toContain('everHeard');
  });

  it('every one of them appears in the failure text', () => {
    const missing = conditions.filter((c) => !workflow.includes(c));
    expect(
      missing,
      missing.length
        ? 'webhook-health.ts can report these unhealthy conditions and the monitor that ' +
          `alarms on them does not mention them:\n${missing.map((m) => `  ${m}`).join('\n')}\n\n` +
          'An operator reads the workflow log, not the JSON. Naming only the original ' +
          'condition sends them to fix the wrong thing — which is worse than saying nothing.'
        : 'ok',
    ).toEqual([]);
  });

  /*
    `meaning` is the LAST key of the health payload, and the keys before it run
    to roughly 250 bytes on a healthy cluster and further on an unhealthy one.
    The original `head -c 400` therefore cut the explanation off mid-sentence
    precisely when there was an explanation worth reading. Truncation is still
    right for the HTML error page a non-200 from Vercel produces; it is wrong
    for the JSON this endpoint returns.
  */
  it('prints the diagnosis rather than truncating it', () => {
    expect(
      workflow,
      'the monitor does not extract .meaning from the payload, so the explanation is ' +
        'whatever fits inside the byte limit — and it is the last key in the object.',
    ).toContain('.meaning');
  });
});
