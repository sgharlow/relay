/**
 * Rehearsing, in calm, with the people who would be asked.
 *
 * This handler executed no test until 2026-08-30. It is the owner-facing half of
 * the only reachability evidence this product can actually produce — a human
 * pressing a button, rather than a mail provider reporting on its own queue.
 *
 * 🔴 IT IS RATE LIMITED ON THE ACCOUNT, NOT ON THE CLIENT. This is a route where
 * an authenticated caller chooses the recipients of mail Relay sends from its own
 * domain. Metering by IP would let one account drill from many addresses; the
 * key is the owner id, and that is asserted rather than assumed.
 *
 * ⚠️ THE RESPONSE NAMES THE PEOPLE IT DID NOT MAIL, and that is the more useful
 * half — a verifier who cannot answer a drill cannot answer a release either.
 * The route must pass that through rather than reducing it to a count.
 *
 * Feature: relay-standby
 * Requirements: J4-R13, J7-R5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../lib/release/fire-drill', () => ({ runFireDrill: vi.fn() }));
vi.mock('../../../../lib/http/rate-limit', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../lib/http/rate-limit');
  return { ...actual, rateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })) };
});

import { requireOwner } from '../../../../lib/http/owner-route';
import { runFireDrill } from '../../../../lib/release/fire-drill';
import { rateLimit } from '../../../../lib/http/rate-limit';
import { IntegrityError } from '../../../../lib/db/integrity';
import { POST } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockRun = vi.mocked(runFireDrill);
const mockRateLimit = vi.mocked(rateLimit);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const RESULT = {
  mailed: [{ id: 'v-1', name: 'Ben' }],
  skipped: [{ id: 'v-2', name: 'Chris', reason: 'has never signed in' }],
};

function req(): NextRequest {
  return new NextRequest('https://relaystandby.com/api/fire-drill', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  mockRun.mockResolvedValue(RESULT as never);
});

describe('running a rehearsal', () => {
  it('drills the session owner and returns the result whole', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockRun).toHaveBeenCalledWith(OWNER);
    expect(await res.json()).toEqual(RESULT);
  });

  it('keeps the people it could not reach in the response', async () => {
    // The gap is the point. Reducing this to a count would hide the verifier who
    // cannot answer a release either.
    const body = await (await POST(req())).json();
    expect(body.skipped).toEqual(RESULT.skipped);
  });

  it('records the drill as deliberate owner activity', async () => {
    await POST(req());
    expect(mockRequireOwner.mock.calls[0][0]).toBeDefined();
  });
});

describe('the send is bounded per account', () => {
  it('meters on the owner id, not the client address', async () => {
    await POST(req());
    expect(mockRateLimit.mock.calls[0][0]).toBe('fire-drill:' + OWNER);
  });

  it('refuses over the limit with a Retry-After and mails nothing', async () => {
    mockRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 1800 });
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('1800');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('checks the session before it meters, so the key is never undefined', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('what it refuses', () => {
  it('maps an integrity failure to 403', async () => {
    mockRun.mockRejectedValueOnce(new IntegrityError('NOT_FOUND', 'nope'));
    expect((await POST(req())).status).toBe(403);
  });
});
