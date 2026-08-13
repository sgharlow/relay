/**
 * Tests for the unauthenticated incident reporter.
 *
 * It is called by a page that has just failed, so it cannot require a session —
 * which makes it a spam surface. Everything asserted here is about what it
 * refuses to accept and what it refuses to say back.
 *
 * Feature: relay-h0-mvp
 * Requirements: J5-R7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../lib/ops/incident', () => ({ reportIncident: vi.fn(async () => ({ alerted: true })) }));
vi.mock('../../../../lib/http/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
  clientKey: vi.fn(() => 'k'),
}));

import { reportIncident } from '../../../../lib/ops/incident';
import { rateLimit } from '../../../../lib/http/rate-limit';
import { POST } from './route';

const mockReport = vi.mocked(reportIncident);

function req(body: unknown, raw?: string): NextRequest {
  return new NextRequest('https://relaystandby.com/api/incident', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rateLimit).mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
});

describe('it never varies its answer', () => {
  it.each([
    ['a valid report', JSON.stringify({ digest: 'd', path: '/standby', mode: 'access' })],
    ['junk', 'not json at all'],
    ['an empty object', JSON.stringify({})],
  ])('returns 204 for %s', async (_label, raw) => {
    const res = await POST(req(null, raw));
    expect(res.status).toBe(204);
  });

  it('returns 204 when rate limited, and reports nothing', async () => {
    vi.mocked(rateLimit).mockReturnValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const res = await POST(req({ digest: 'd', path: '/x', mode: 'owner' }));
    expect(res.status).toBe(204);
    expect(mockReport).not.toHaveBeenCalled();
  });
});

describe('🔴 what it refuses to carry', () => {
  it('strips a query string, which can hold a claim code or a token', async () => {
    await POST(req({ digest: 'd', path: '/claim?token=SECRET-TICKET', mode: 'access' }));
    expect(mockReport.mock.calls[0][0].path).toBe('/claim');
  });

  it('drops an over-long path rather than forwarding it', async () => {
    await POST(req({ digest: 'd', path: `/${'x'.repeat(500)}`, mode: 'access' }));
    expect(mockReport.mock.calls[0][0].path).toBe('unknown');
  });

  it('drops an over-long digest, so this cannot be used as a message channel', async () => {
    await POST(req({ digest: 'y'.repeat(5000), path: '/x', mode: 'owner' }));
    expect(mockReport.mock.calls[0][0].digest).toBeNull();
  });

  it('never forwards a field it does not know about', async () => {
    const secret = 'margarets-actual-password';
    await POST(req({ digest: 'd', path: '/x', mode: 'owner', message: secret, stack: secret }));
    expect(JSON.stringify(mockReport.mock.calls[0][0])).not.toContain(secret);
  });

  it('falls back to a safe mode rather than trusting an arbitrary one', async () => {
    await POST(req({ digest: 'd', path: '/x', mode: 'superuser' }));
    expect(mockReport.mock.calls[0][0].mode).toBe('public');
  });
});

describe('reporting a failure must never become a failure', () => {
  it('still returns 204 when the reporter throws', async () => {
    mockReport.mockRejectedValueOnce(new Error('mail exploded'));
    const res = await POST(req({ digest: 'd', path: '/x', mode: 'owner' }));
    expect(res.status).toBe(204);
  });
});
