/**
 * One answer to "where do alerts go", because three answers muted one of them.
 *
 * 🔴 THE SAME MISCONFIGURATION, TWICE, IN THREE FILES. On 2026-08-13 production
 * had OPS_ALERT_EMAIL set deliberately while the code read only
 * OPS_ALERT_ADDRESS; the fallback to the reply-to inbox meant alerts still
 * arrived, so nothing looked broken and the setting somebody made did nothing.
 * error-reporter.ts and guess-watch.ts were taught both names. incident.ts was
 * missed — and it has NO fallback, so an operator following .env.example (which
 * recommends OPS_ALERT_ADDRESS) silently muted every client-side error alert.
 *
 * The symptom of a broken alerting path is silence, which is also what a
 * healthy day looks like. That is why this is pinned rather than trusted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { opsAlertAddress } from './alert-address';

const KEYS = ['OPS_ALERT_ADDRESS', 'OPS_ALERT_EMAIL', 'RESEND_REPLY_TO_ADDRESS'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Every test below asserts where a PRODUCTION alert goes, so each one says so
  // rather than inheriting whatever the runner's environment happens to be.
  // Under vitest NODE_ENV is 'test', which is now positively non-production.
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllEnvs();
});

describe('opsAlertAddress', () => {
  it('accepts EITHER configured name — neither can be the silently-wrong one', () => {
    process.env.OPS_ALERT_ADDRESS = 'ops@example.com';
    expect(opsAlertAddress()).toBe('ops@example.com');

    delete process.env.OPS_ALERT_ADDRESS;
    process.env.OPS_ALERT_EMAIL = 'ops2@example.com';
    expect(opsAlertAddress()).toBe('ops2@example.com');
  });

  it('prefers OPS_ALERT_ADDRESS when both are set, matching what .env.example recommends', () => {
    process.env.OPS_ALERT_ADDRESS = 'primary@example.com';
    process.env.OPS_ALERT_EMAIL = 'legacy@example.com';
    expect(opsAlertAddress()).toBe('primary@example.com');
  });

  /*
    The fallback is opt-in on purpose. It is right for the monitors whose job is
    to notice silence — they must never be off — and wrong for an incident
    report, which should reach the operator or nobody rather than surprising the
    public reply-to inbox.
  */
  it('does not reach for the reply-to inbox unless asked', () => {
    process.env.RESEND_REPLY_TO_ADDRESS = 'hello@relaystandby.com';
    expect(opsAlertAddress()).toBeUndefined();
    expect(opsAlertAddress({ fallbackToReplyTo: true })).toBe('hello@relaystandby.com');
  });

  it('treats blank and whitespace as unset — a set-but-empty var must not look configured', () => {
    process.env.OPS_ALERT_ADDRESS = '   ';
    expect(opsAlertAddress()).toBeUndefined();
  });

  it('returns undefined when nothing is set, so local and preview mail nobody', () => {
    expect(opsAlertAddress()).toBeUndefined();
    expect(opsAlertAddress({ fallbackToReplyTo: true })).toBeUndefined();
  });
});

/*
  🔴 THE GUARD ABOVE WAS NEVER AN ENVIRONMENT GUARD. On 2026-08-15 a `next dev`
  server on a laptop emailed hello@relaystandby.com to report that "a request
  failed in production", with a stack trace whose every frame read
  C:\Users\...\.next\dev\server. Nothing had failed in production. The operator
  was told to go read Vercel logs that would never contain it.

  The reason is one assumption in this file's own docstring: "Returns undefined
  when nothing is configured — local and preview environments must not try to
  mail anyone." That sentence silently equates *unconfigured* with *not
  production*, and in THIS repo the two are opposites. `.env.local` is a full
  production env file — CLAUDE.md says so outright, because Relay has no dev
  database — so the laptop had RESEND_REPLY_TO_ADDRESS, a live RESEND_API_KEY
  and the production cluster. The one machine the guard was written to stop was
  the one machine that satisfied every condition for sending.

  The old test only ever proved the unconfigured case, then described itself as
  covering "local and preview". A check that measures config-absence and reports
  environment-safety is the same failure this repo has now recorded four times.

  So the environment is decided HERE, once, structurally — not by asking every
  caller to remember. The direction is deliberately fail-safe: silence requires
  POSITIVE evidence of a non-production process, and anything unrecognised still
  sends. Silencing the ops channel by accident is strictly worse than the noise
  this closes, because a channel that has gone quiet looks exactly like a
  healthy one.
*/
describe('the environment decides whether an alert may be sent at all', () => {
  it('sends nothing from a local dev server, however well configured it is', () => {
    // Today's shape, exactly: the full production env file on a laptop.
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    process.env.OPS_ALERT_ADDRESS = 'ops@example.com';
    process.env.RESEND_REPLY_TO_ADDRESS = 'hello@relaystandby.com';

    expect(opsAlertAddress()).toBeUndefined();
    expect(opsAlertAddress({ fallbackToReplyTo: true })).toBeUndefined();
  });

  it('sends nothing from a preview deployment', () => {
    // A preview inherits production's environment variables on Vercel, so it is
    // configured to mail the real operator inbox about a branch nobody shipped.
    vi.stubEnv('VERCEL_ENV', 'preview');
    process.env.OPS_ALERT_ADDRESS = 'ops@example.com';

    expect(opsAlertAddress()).toBeUndefined();
  });

  it('sends from production, which is the whole point', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    process.env.OPS_ALERT_ADDRESS = 'ops@example.com';

    expect(opsAlertAddress()).toBe('ops@example.com');
  });

  /*
    The fail-safe direction, and the reason this is not written as
    `if (VERCEL_ENV !== 'production') return undefined`.

    VERCEL_ENV is a system variable that a project setting can stop exposing.
    Gate on its PRESENCE and the day it goes missing is the day every ops alert
    stops, invisibly, with no failure to notice — this file's docstring already
    warns that a monitor needing a variable before it works is a monitor that is
    silently off. So an unrecognised environment sends.
  */
  it('still alerts when VERCEL_ENV is missing but the build is a production one', () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    process.env.OPS_ALERT_ADDRESS = 'ops@example.com';

    expect(opsAlertAddress()).toBe('ops@example.com');
  });
});

/*
  The structural half: nothing may resolve this address on its own again. Three
  independent readings is what allowed one of them to be wrong for months.
*/
describe('the address is resolved in exactly one place', () => {
  it('no ops module reads the raw environment variables itself', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const offenders = readdirSync('lib/ops')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'alert-address.ts')
      .filter((f) => {
        // Comments quote the variable names to explain the history, so strip
        // them — four checks in this codebase have matched their own prose.
        const code = readFileSync(`lib/ops/${f}`, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');
        return /process\.env\.OPS_ALERT_(ADDRESS|EMAIL)/.test(code);
      });

    expect(offenders, `these resolve the alert address themselves:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  /*
    The same argument, applied to the other half of the decision.

    "Is this production?" is now load-bearing: get it wrong in one direction and
    a laptop mails the operator, get it wrong in the other and the channel goes
    quiet with nobody noticing. That is precisely the kind of question that must
    have one answer, for the reason the block above exists — three independent
    readings of OPS_ALERT_ADDRESS is what let one of them be wrong for months.

    A new ops module reaching for VERCEL_ENV itself is that drift starting over,
    so it fails here instead of in an inbox.
  */
  it('no ops module decides for itself whether it is running in production', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const offenders = readdirSync('lib/ops')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'alert-address.ts')
      .filter((f) => {
        const code = readFileSync(`lib/ops/${f}`, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');
        return /process\.env\.(VERCEL_ENV|NODE_ENV)/.test(code);
      });

    expect(
      offenders,
      `these decide the environment themselves instead of using ` +
        `alertEnvironmentLabel() / opsAlertAddress():\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
