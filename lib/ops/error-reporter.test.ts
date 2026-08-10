/**
 * Tests for server error reporting.
 *
 * The gap: nothing told us when a real user hit a 500. The canary catches the
 * paths it was written to exercise — it exists precisely because a validly
 * signed verifier link 500'd in production behind a green suite — but it can
 * only ever assert the failures someone already thought of. An open self-serve
 * beta driven by ads is strangers walking paths nobody scripted.
 *
 * The two properties that decide whether this is useful or harmful:
 *   - it must never throw. An error reporter that fails inside an error handler
 *     converts a handled 500 into an unhandled one.
 *   - it must not mail-bomb. One bad deploy is thousands of errors; an alerting
 *     channel that floods gets muted, and a muted channel is worse than none
 *     because it looks like coverage.
 *
 * Feature: relay-h0-mvp (CC9)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendEmailBestEffort = vi.fn();
vi.mock('../notify/email', () => ({
  sendEmailBestEffort: (...a: unknown[]) => sendEmailBestEffort(...a),
}));

import { reportServerError, _resetErrorReporterForTesting } from './error-reporter';

let written: string[] = [];
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  written = [];
  sendEmailBestEffort.mockReset().mockResolvedValue(true);
  _resetErrorReporterForTesting();
  process.env.OPS_ALERT_ADDRESS = 'ops@example.com';
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
    written.push(String(c));
    return true;
  });
});
afterEach(() => {
  stderrSpy.mockRestore();
  delete process.env.OPS_ALERT_ADDRESS;
});

describe('reportServerError', () => {
  it('logs the error with its route so it can be found later', async () => {
    await reportServerError(new Error('boom'), { path: '/api/vault', digest: 'abc123' });

    const line = written.join('');
    expect(line).toContain('boom');
    expect(line).toContain('/api/vault');
  });

  it('alerts on the first occurrence', async () => {
    await reportServerError(new Error('boom'), { path: '/api/vault' });
    expect(sendEmailBestEffort).toHaveBeenCalledTimes(1);
    const msg = sendEmailBestEffort.mock.calls[0][0] as { to: string; subject: string };
    expect(msg.to).toBe('ops@example.com');
    expect(msg.subject).toMatch(/relay/i);
  });

  it('does not send a second alert for the same error in the same window', async () => {
    // One bad deploy is thousands of identical errors. The first one tells you
    // everything; the next thousand only teach you to mute the channel.
    for (let i = 0; i < 50; i++) {
      await reportServerError(new Error('boom'), { path: '/api/vault' });
    }
    expect(sendEmailBestEffort).toHaveBeenCalledTimes(1);
  });

  it('still logs every occurrence, so the count is not lost', async () => {
    for (let i = 0; i < 5; i++) {
      await reportServerError(new Error('boom'), { path: '/api/vault' });
    }
    expect(written.filter((w) => w.includes('boom')).length).toBe(5);
  });

  it('alerts separately for a different failure', async () => {
    // Suppressing a repeat must not suppress a NEW problem that happens to
    // arrive during the same window.
    await reportServerError(new Error('boom'), { path: '/api/vault' });
    await reportServerError(new Error('totally different'), { path: '/api/triggers' });
    expect(sendEmailBestEffort).toHaveBeenCalledTimes(2);
  });

  it('never throws, even when the alert channel is broken', async () => {
    // This runs inside the error path. Throwing here turns a handled 500 into
    // an unhandled one and loses the original error.
    sendEmailBestEffort.mockRejectedValue(new Error('resend down'));
    await expect(
      reportServerError(new Error('boom'), { path: '/api/vault' }),
    ).resolves.toBeUndefined();
  });

  it('never throws on a non-Error thrown value', async () => {
    await expect(reportServerError('a bare string', { path: '/x' })).resolves.toBeUndefined();
    await expect(reportServerError(undefined, { path: '/x' })).resolves.toBeUndefined();
  });

  it('falls back to the reply-to inbox, the way lead notification does', async () => {
    // A monitor that needs a new environment variable before it works is a
    // monitor that is silently off until someone remembers. lib/g1/leads.ts
    // already established this fallback and it is set in production.
    delete process.env.OPS_ALERT_ADDRESS;
    process.env.RESEND_REPLY_TO_ADDRESS = 'fallback@example.com';
    try {
      await reportServerError(new Error('boom'), { path: '/api/vault' });
      expect(sendEmailBestEffort).toHaveBeenCalledTimes(1);
      expect((sendEmailBestEffort.mock.calls[0][0] as { to: string }).to).toBe('fallback@example.com');
    } finally {
      delete process.env.RESEND_REPLY_TO_ADDRESS;
    }
  });

  it('stays silent on alerts when no address is configured at all', async () => {
    // Local and preview environments must not try to mail anyone.
    delete process.env.OPS_ALERT_ADDRESS;
    delete process.env.RESEND_REPLY_TO_ADDRESS;
    await reportServerError(new Error('boom'), { path: '/api/vault' });
    expect(sendEmailBestEffort).not.toHaveBeenCalled();
    expect(written.join('')).toContain('boom'); // still logged
  });

  it('keeps secrets out of the alert', async () => {
    // Error messages carry connection strings and tokens more often than
    // anyone expects, and this one leaves the building by email.
    const err = new Error('connect failed: postgres://user:hunter2@db.example/relay?token=abcd');
    await reportServerError(err, { path: '/api/vault' });
    const body = JSON.stringify(sendEmailBestEffort.mock.calls[0][0]);
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('abcd');
  });
});
