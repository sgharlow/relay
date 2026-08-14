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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { opsAlertAddress } from './alert-address';

const KEYS = ['OPS_ALERT_ADDRESS', 'OPS_ALERT_EMAIL', 'RESEND_REPLY_TO_ADDRESS'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
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
});
