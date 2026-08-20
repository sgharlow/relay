/**
 * Somebody guessing codes leaves a trace.
 *
 * 🔴 A GUESS AT A CODE THAT DOES NOT EXIST LEFT NONE. `recordFailedAttempt`
 * increments a budget on the matched row, so it only ever fires when the
 * guesser was already right about which code exists — the keyspace walk that an
 * actual attack looks like incremented nothing and alerted nobody.
 *
 * The two properties worth pinning are the ones that would quietly undo it: the
 * miss has to be recorded on the NO-ROW branch of every redemption path (a
 * fifth credential added later is the obvious way this rots), and the alert must
 * never carry the attempted code.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../notify/email', () => ({ sendEmailBestEffort: vi.fn(async () => true) }));

import { sendEmailBestEffort } from '../notify/email';
import {
  recordCodeMiss,
  missesInWindow,
  ALERT_THRESHOLD,
  severityParagraph,
  _resetGuessWatchForTesting,
} from './guess-watch';

const mockSend = vi.mocked(sendEmailBestEffort);

beforeEach(() => {
  vi.clearAllMocks();
  _resetGuessWatchForTesting();
  process.env.OPS_ALERT_ADDRESS = 'ops@example.com';
  // Says which environment these assert. Ops alerting is gated on it since
  // 2026-08-15 (see lib/ops/alert-address.ts) and under vitest NODE_ENV is
  // 'test' — positively not production, and correctly silent.
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('counting', () => {
  it('counts a miss', async () => {
    await recordCodeMiss('recipient');
    expect(missesInWindow()).toBe(1);
  });

  it('stays quiet below the threshold', async () => {
    for (let i = 0; i < ALERT_THRESHOLD - 1; i++) await recordCodeMiss('recipient');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('alerts once the threshold is crossed', async () => {
    for (let i = 0; i < ALERT_THRESHOLD; i++) await recordCodeMiss('recipient');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  /*
    An alert that repeats every miss after the threshold is an alert somebody
    filters. One per hour, however loud it gets.
  */
  it('does not alert again inside the cooldown', async () => {
    for (let i = 0; i < ALERT_THRESHOLD + 30; i++) await recordCodeMiss('recipient');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('forgets misses once the window has passed', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) await recordCodeMiss('recipient', t0);
    expect(missesInWindow(t0)).toBe(10);
    expect(missesInWindow(t0 + 16 * 60 * 1000)).toBe(0);
  });

  it('says which credential was being guessed', async () => {
    for (let i = 0; i < ALERT_THRESHOLD; i++) {
      await recordCodeMiss(i % 2 === 0 ? 'recipient' : 'recovery');
    }
    const body = String((mockSend.mock.calls[0][0] as { text: string }).text);
    expect(body).toContain('recipient');
    expect(body).toContain('recovery');
  });

  it('does not throw when no alert address is configured', async () => {
    delete process.env.OPS_ALERT_ADDRESS;
    delete process.env.OPS_ALERT_EMAIL;
    delete process.env.RESEND_REPLY_TO_ADDRESS;
    for (let i = 0; i < ALERT_THRESHOLD; i++) await recordCodeMiss('recipient');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('what it must never leak', () => {
  /*
    🔴 THE SIGNATURE IS THE ENFORCEMENT. recordCodeMiss takes a fixed label and
    nothing else, so a caller holding the attempted code cannot hand it over
    even by accident. An ops mailbox that accumulates near-miss credentials is a
    better target than the thing it is protecting — a near miss against an
    8-character code is a real head start.
  */
  it('takes a kind, never a code', () => {
    const src = readFileSync('lib/ops/guess-watch.ts', 'utf8');
    expect(src).toMatch(/export async function recordCodeMiss\(\s*kind: GuessKind/);
  });

  it('no caller passes anything but a literal kind', () => {
    for (const f of [
      'lib/auth/recipient-code.ts',
      'lib/auth/verifier-code.ts',
      'lib/auth/recovery-code.ts',
      'lib/people/claim.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/recordCodeMiss\(([^)]*)\)/g)) {
        expect(m[1].trim(), `${f} passes a non-literal to recordCodeMiss`).toMatch(
          /^'(recipient|verifier|invitation|recovery)'$/,
        );
      }
    }
  });
});

describe('every redemption path reports its misses', () => {
  /*
    The fifth credential somebody adds later is how this rots. Each file's
    no-row branch must call it — asserted structurally, because a behavioural
    test would need a mocked driver per module and would still not notice a NEW
    module that forgot.
  */
  const PATHS: [file: string, kind: string][] = [
    ['lib/auth/recipient-code.ts', 'recipient'],
    ['lib/auth/verifier-code.ts', 'verifier'],
    ['lib/auth/recovery-code.ts', 'recovery'],
    ['lib/people/claim.ts', 'invitation'],
  ];

  it.each(PATHS)('%s records a miss as %s', (file, kind) => {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(
      src.includes(`recordCodeMiss('${kind}')`),
      `${file} does not report a guess that matched no row. That is the only ` +
        'case failed_attempts can never see, because there is no row to increment.',
    ).toBe(true);
  });

  /*
    And it must sit on the branch where NOTHING matched — not next to the
    already-used or expired refusals, which mean the guesser found a real code
    and are already counted on the row itself.
  */
  it.each(PATHS)('%s reports it on the no-row branch', (file) => {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const at = src.indexOf('recordCodeMiss(');
    const before = src.slice(Math.max(0, at - 300), at);
    expect(
      /if \(!(row|invite)\)/.test(before),
      `${file} calls recordCodeMiss somewhere other than its no-row branch`,
    ).toBe(true);
  });
});

describe('severity — the paragraph that would otherwise have lied', () => {
  /*
    🔴 THE DEFECT THIS PINS. Before `totp` was a GuessKind the alert closed with
    an unconditional reassurance: "Nothing is currently at risk from guessing
    alone (the short codes carry 2^39.6, recovery codes 2^49.5), so this is a
    prompt to look, not an incident." That is true of four long codes and false
    of a six-digit authenticator code, which is about 2^20 with three values
    valid at once against the skew window. Adding the kind without touching the
    copy would have produced an alert that reassures the reader at exactly the
    moment the arithmetic stops being comfortable — the alert doing the
    attacker's work.
  */

  it('does not reassure when authenticator codes are in the window', () => {
    const text = severityParagraph({ totp: 12 });
    expect(text).not.toContain('Nothing is currently at risk');
    expect(text).toContain('AUTHENTICATOR CODES');
  });

  it('names the count and calls it an incident rather than a prompt', () => {
    const text = severityParagraph({ recipient: 30, totp: 12 });
    expect(text).toContain('12');
    expect(text).toContain('incident');
  });

  it('keeps the original reassurance when only long codes were missed', () => {
    const text = severityParagraph({ recipient: 30, recovery: 10 });
    expect(text).toContain('Nothing is currently at risk');
    expect(text).not.toContain('AUTHENTICATOR');
  });

  it('treats an absent totp count the same as zero', () => {
    expect(severityParagraph({})).toContain('Nothing is currently at risk');
    expect(severityParagraph({ totp: 0 })).toContain('Nothing is currently at risk');
  });

  it('reaches the real alert — a totp-bearing window sends the alarmed text', async () => {
    // Real clock, like every alerting test above. `lastAlertAt` starts at 0
    // and the cooldown is measured against it, so a small fake `now` suppresses
    // the first alert entirely — a property of the harness, not of the module.
    for (let i = 0; i < ALERT_THRESHOLD; i += 1) {
      await recordCodeMiss('totp');
    }
    expect(mockSend).toHaveBeenCalledTimes(1);
    const sent = mockSend.mock.calls[0]![0] as { text: string };
    expect(sent.text).toContain('AUTHENTICATOR CODES');
    expect(sent.text).not.toContain('Nothing is currently at risk');
  });
});

describe('the paths list above is code-kinds only, and that is deliberate', () => {
  /*
    `totp` is the fifth kind and it is NOT in PATHS. It cannot be: those
    assertions look for a `if (!row)` / `if (!invite)` no-row branch, and the
    sign-in path has no row to miss — every failed authenticator code is a miss
    of the kind this module counts, which is why its budget lives in
    lib/auth/signin-throttle.ts rather than on a row.

    Its call site is guarded by lib/ops/signin-is-throttled.test.ts instead.
    This test exists so that reading PATHS as exhaustive fails rather than
    misleads.
  */
  it('the sign-in provider reports totp misses, guarded in its own file', () => {
    const guard = readFileSync('lib/ops/signin-is-throttled.test.ts', 'utf8');
    expect(guard).toContain("recordCodeMiss('totp')");
  });
});
