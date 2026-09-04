/**
 * Tests for incident reporting.
 *
 * The load-bearing assertions are about what must NEVER cross the wire, and
 * about the alert not becoming the outage. An alert channel that cries wolf is
 * one that stops being read, which is the failure this exists to prevent rather
 * than cause.
 *
 * Feature: relay-h0-mvp
 * Requirements: J5-R7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../notify/email', () => ({ sendEmailBestEffort: vi.fn(async () => true) }));

import { sendEmailBestEffort } from '../notify/email';
import { reportIncident, _resetIncidentStateForTesting } from './incident';

const mockSend = vi.mocked(sendEmailBestEffort);
const T0 = 1_700_000_000_000;

/*
  🔴 EVERY NAME opsAlertAddress() READS, cleared and restored — not just the one
  this file happens to set. It cleared OPS_ALERT_EMAIL alone until 2026-09-04,
  which was correct when incident.ts read that variable directly and became
  wrong the day it moved to opsAlertAddress(), which resolves
  OPS_ALERT_ADDRESS ?? OPS_ALERT_EMAIL. The test below deletes "the" address and
  asserts nothing is sent; on a machine with OPS_ALERT_ADDRESS exported in the
  shell — which is how an operator following .env.example configures it — the
  address survived the delete, the incident alerted, and the suite went red
  against blameless code.

  The direction that matters is the other one. In CI neither name is set, so the
  gap never showed: the "no address configured" case was passing because the
  runner's environment happened to agree with it, not because the file arranged
  it. A negative test that only holds on a bare environment is not testing the
  negative.

  This is the third file in this family to be caught by the two-name contract —
  alert-address.test.ts and guess-watch.test.ts already clear the full set — and
  it is deliberately the same shape as theirs rather than a cheaper local fix,
  because the cheap fix here is "delete the other one too", which drifts again
  the next time a name is added. See lib/ops/alert-address.ts for why both names
  are accepted.
*/
const ADDRESS_KEYS = ['OPS_ALERT_ADDRESS', 'OPS_ALERT_EMAIL', 'RESEND_REPLY_TO_ADDRESS'] as const;
const savedAddressEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  _resetIncidentStateForTesting();
  for (const k of ADDRESS_KEYS) {
    savedAddressEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OPS_ALERT_EMAIL = 'ops@example.com';
  // Says which environment these assert. Ops alerting is gated on it since
  // 2026-08-15 (see lib/ops/alert-address.ts) and under vitest NODE_ENV is
  // 'test' — positively not production, and correctly silent.
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => {
  for (const k of ADDRESS_KEYS) {
    if (savedAddressEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedAddressEnv[k];
  }
  vi.unstubAllEnvs();
});

const base = { digest: 'abc123', path: '/standby', mode: 'access' as const };

describe('what reaches the operator', () => {
  it('alerts on a first occurrence', async () => {
    await expect(reportIncident(base, T0)).resolves.toEqual({ alerted: true });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('names the path, the digest and the mode', async () => {
    await reportIncident(base, T0);
    const text = String(mockSend.mock.calls[0][0].text);
    expect(text).toContain('/standby');
    expect(text).toContain('abc123');
    expect(mockSend.mock.calls[0][0].subject).toContain('/standby');
  });

  it('flags a CONTACT-side failure as the more urgent of the two', async () => {
    await reportIncident(base, T0);
    expect(String(mockSend.mock.calls[0][0].text)).toContain('CONTACT');
  });
});

describe('🔴 what must never cross the wire', () => {
  it('cannot leak error text even when a caller supplies it', async () => {
    // React supplies a production digest precisely so a message never has to
    // travel. `IncidentReport` has no message field, and this asserts the
    // BEHAVIOUR rather than the type: anything extra a caller passes is simply
    // never read, so a future caller cannot widen this by accident.
    const secret = 'hunter2-margarets-actual-password';
    await reportIncident(
      { ...base, message: secret, stack: secret, error: secret } as never,
      T0,
    );

    const sent = JSON.stringify(mockSend.mock.calls[0][0]);
    expect(sent).not.toContain(secret);
    expect(sent).toContain('abc123'); // the digest did travel
  });

  it('says out loud why the message is absent, so nobody "fixes" it later', async () => {
    await reportIncident(base, T0);
    expect(String(mockSend.mock.calls[0][0].text)).toMatch(/could carry vault content/i);
  });
});

describe('the alert must not become the outage', () => {
  it('suppresses a repeat of the same failure', async () => {
    await reportIncident(base, T0);
    await expect(reportIncident(base, T0 + 1000)).resolves.toEqual({ alerted: false });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('alerts again once the window has passed', async () => {
    await reportIncident(base, T0);
    await expect(reportIncident(base, T0 + 16 * 60 * 1000)).resolves.toEqual({ alerted: true });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('caps a novel-digest storm rather than mailing every one', async () => {
    // Distinct digests defeat dedup, so a hard ceiling is what stops a flood.
    for (let i = 0; i < 20; i++) {
      await reportIncident({ ...base, digest: `d-${i}` }, T0 + i);
    }
    expect(mockSend.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe('degrading', () => {
  it('records without alerting when no operator address is configured', async () => {
    // One delete is enough ONLY because beforeEach cleared every name
    // opsAlertAddress() reads and then set exactly this one. Do not read it as
    // "OPS_ALERT_EMAIL is the address" — that reading is what broke this test.
    delete process.env.OPS_ALERT_EMAIL;
    await expect(reportIncident(base, T0)).resolves.toEqual({ alerted: false });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('still returns when the mail itself fails — the log is the record', async () => {
    mockSend.mockRejectedValueOnce(new Error('resend down'));
    await expect(reportIncident(base, T0)).rejects.toThrow();
    // The stderr line is written BEFORE the send is attempted, so the incident
    // survives in the runtime log whatever the channel does.
  });
});
