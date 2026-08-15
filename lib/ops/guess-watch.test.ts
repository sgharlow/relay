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
