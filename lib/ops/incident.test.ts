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

beforeEach(() => {
  vi.clearAllMocks();
  _resetIncidentStateForTesting();
  process.env.OPS_ALERT_EMAIL = 'ops@example.com';
  // Says which environment these assert. Ops alerting is gated on it since
  // 2026-08-15 (see lib/ops/alert-address.ts) and under vitest NODE_ENV is
  // 'test' — positively not production, and correctly silent.
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => {
  delete process.env.OPS_ALERT_EMAIL;
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
