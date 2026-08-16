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
  // These assert what a PRODUCTION 500 does, so they say which environment they
  // are exercising. Alerting is gated on it since 2026-08-15, and under vitest
  // NODE_ENV is 'test' — positively not production, and correctly silent.
  vi.stubEnv('VERCEL_ENV', 'production');
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
    written.push(String(c));
    return true;
  });
});
afterEach(() => {
  stderrSpy.mockRestore();
  delete process.env.OPS_ALERT_ADDRESS;
  vi.unstubAllEnvs();
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

  /*
    🔴 2026-08-15, and the reason this file now stubs an environment at all.

    A `next dev` server on a laptop emailed hello@relaystandby.com: "A request
    failed in production", path /api/webauthn/authenticate/options, error
    `relation "auth_challenges" does not exist`. Every frame of the stack read
    C:\Users\...\.next\dev\server. Nothing had failed in production — the table
    was missing for about four minutes on one machine while migration 029 was
    being applied, and the alert went out five minutes before that migration was
    even committed.

    Two things made it possible, and only the first was a bug in this file's
    neighbour. `.env.local` is a full production env file (no dev database), so
    the reply-to fallback resolved and the send guard — which only ever checked
    whether an address was *configured* — waved it through. Then this file
    asserted "in production" in the body regardless, so the one clue that would
    have identified it as noise was overwritten by a confident claim.

    The cost is not the wasted minutes. It is that this channel is the thing
    watching an open beta, and its own header says a channel that floods gets
    muted — that a muted channel is worse than none because it still looks like
    coverage. Every alert on it has to be true, or none of them get read.
  */
  it('sends nothing from a local dev server, however well configured it is', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    process.env.RESEND_REPLY_TO_ADDRESS = 'hello@relaystandby.com';
    try {
      await reportServerError(new Error('relation "auth_challenges" does not exist'), {
        path: '/api/webauthn/authenticate/options',
      });

      expect(sendEmailBestEffort).not.toHaveBeenCalled();
      // Still logged. A developer looking at their own terminal must lose
      // nothing — the change is who gets mailed, not what gets recorded.
      expect(written.join('')).toContain('auth_challenges');
    } finally {
      delete process.env.RESEND_REPLY_TO_ADDRESS;
    }
  });

  it('names the environment it actually came from, rather than asserting production', async () => {
    await reportServerError(new Error('boom'), { path: '/api/vault' });
    const body = (sendEmailBestEffort.mock.calls[0][0] as { text: string }).text;
    expect(body).toContain('failed in production');

    /*
      And when the process reports something else, the alert says so instead of
      claiming the environment that would send someone hunting Vercel logs.

      Note the shape needed to reach this branch, because it is the design in
      miniature: a PRESENT VERCEL_ENV is authoritative, so `VERCEL_ENV=staging`
      is positively-not-production and sends nothing at all. Only an ABSENT
      VERCEL_ENV falls through to NODE_ENV, and only a NODE_ENV that is neither
      'development' nor 'test' is unrecognised enough to still send. That is the
      fail-safe path — an environment nobody anticipated, mailed anyway, and
      labelled honestly rather than dressed up as production.
    */
    _resetErrorReporterForTesting();
    sendEmailBestEffort.mockReset().mockResolvedValue(true);
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'staging');
    await reportServerError(new Error('boom'), { path: '/api/vault' });
    const staged = (sendEmailBestEffort.mock.calls[0][0] as { text: string }).text;
    expect(staged).toContain('failed in staging');
    expect(staged).not.toContain('failed in production');
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
