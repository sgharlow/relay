/**
 * The signed-in verifier's door — the screen where somebody says yes or no to
 * another person's emergency.
 *
 * This handler executed no test until 2026-08-30, and it is one of the two
 * doors into `submitConfirmation`. Three properties were held by prose alone:
 *
 * 🔴 `requireOwner()` IS CALLED WITHOUT `req`, AND THAT IS THE POINT (§3.7 rule
 * 8). Everywhere else in this codebase the omission is the bug — the sibling
 * routes carry tests asserting `req` IS passed, because passing it stamps
 * `last_active_at`. Here the opposite is required: answering somebody else's
 * emergency must not extend the VERIFIER'S own dead-man's switch. A future
 * session tidying this into consistency with its siblings would silently make
 * every verifier immortal in the eyes of `runHeartbeatSweep`. The assertion
 * below is the reason that tidy-up will fail.
 *
 * 🔴 THE BODY'S `releaseStateId` ONLY NARROWS; IT NEVER AUTHORIZES. The route
 * re-resolves against the row on this request rather than trusting the client.
 * Asserted by pinning what `resolveVerifierFor` receives — the SESSION user id,
 * always — because a handler that passed a body-supplied user id would return
 * exactly the same 200.
 *
 * 🔴 "NOTHING OPEN" IS A 403 AND SAYS SO IN WORDS. There is no link on this
 * path, so the token route's "this link is no longer valid" would be a lie of
 * the kind the graceful close was written to remove.
 *
 * Feature: relay-standby
 * Requirements: J7-R1, J7-R3, J7-R5, J4-R9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../lib/release/verifier-session', () => ({
  resolveVerifierFor: vi.fn(),
}));
vi.mock('../../../../lib/release/verifier-context', () => ({
  buildVerifierContext: vi.fn(),
}));
vi.mock('../../../../lib/release/triggers', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../lib/release/triggers',
  );
  return { ...actual, submitConfirmation: vi.fn() };
});

import { requireOwner } from '../../../../lib/http/owner-route';
import { resolveVerifierFor } from '../../../../lib/release/verifier-session';
import { buildVerifierContext } from '../../../../lib/release/verifier-context';
import { submitConfirmation, TriggerError } from '../../../../lib/release/triggers';
import { GET, POST } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockResolve = vi.mocked(resolveVerifierFor);
const mockContext = vi.mocked(buildVerifierContext);
const mockSubmit = vi.mocked(submitConfirmation);

const USER = '9510683f-af55-4265-8840-b2986824a2e1';
const RELEASE = 'a1a1a1a1-2222-4333-8444-555566667777';
const OTHER_RELEASE = 'd4d4d4d4-2222-4333-8444-555566667777';
const VERIFIER = 'c3c3c3c3-2222-4333-8444-555566667777';

function get(qs = ''): NextRequest {
  return new NextRequest('https://relaystandby.com/api/verify' + qs);
}
function post(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: USER });
  mockResolve.mockResolvedValue({ releaseStateId: RELEASE, verifierId: VERIFIER } as never);
  mockContext.mockResolvedValue({ caseId: 'RLY-TEST-0001', itemCount: 3 } as never);
  mockSubmit.mockResolvedValue({ status: 'grace' } as never);
});

describe('answering must not count as the verifier checking in', () => {
  it('does not pass the request to requireOwner on GET', async () => {
    await GET(get());
    // §3.7 rule 8. With `req`, recordDeliberateActivity stamps last_active_at
    // and this verifier's OWN heartbeat is silently extended by attending to
    // somebody else's emergency.
    expect(mockRequireOwner.mock.calls[0][0]).toBeUndefined();
  });

  it('does not pass the request to requireOwner on POST', async () => {
    await POST(post({ decision: 'confirm' }));
    expect(mockRequireOwner.mock.calls[0][0]).toBeUndefined();
  });
});

describe('GET — the decision context', () => {
  it('resolves against the SESSION user, never a caller-supplied one', async () => {
    const res = await GET(get('?release=' + OTHER_RELEASE));
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith(USER, { releaseStateId: OTHER_RELEASE });
  });

  it('passes no release filter when the query string omits one', async () => {
    await GET(get());
    expect(mockResolve).toHaveBeenCalledWith(USER, { releaseStateId: undefined });
  });

  it('builds the context from the RESOLVED ids, not the requested ones', async () => {
    await GET(get('?release=' + OTHER_RELEASE));
    expect(mockContext).toHaveBeenCalledWith(RELEASE, VERIFIER);
  });

  it('answers 403 in plain words when nothing is waiting', async () => {
    mockResolve.mockResolvedValueOnce(null);
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      message: 'There is no decision waiting for you right now.',
    });
    expect(mockContext).not.toHaveBeenCalled();
  });

  it('collapses a release that vanished mid-request into the same 403', async () => {
    mockContext.mockRejectedValueOnce(new TriggerError('gone', 404));
    const res = await GET(get());
    expect(res.status).toBe(403);
  });

  it('lets a real failure stay a real failure', async () => {
    // A 500 from the context builder must NOT be laundered into "nothing
    // waiting" — that would hide an outage behind a calm sentence.
    mockContext.mockRejectedValueOnce(new TriggerError('boom', 500));
    await expect(GET(get())).rejects.toBeInstanceOf(TriggerError);
  });

  it('refuses without a session', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('POST — the decision', () => {
  it.each(['confirm', 'deny', 'abstain'] as const)('accepts %s and forwards it verbatim', async (d) => {
    const res = await POST(post({ decision: d }));
    expect(res.status).toBe(200);
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ decision: d }));
  });

  it('submits against the RESOLVED release and verifier', async () => {
    // The body only narrows which open release. Authorization is decided
    // against the row on this request.
    await POST(post({ decision: 'confirm', releaseStateId: OTHER_RELEASE }));
    expect(mockResolve).toHaveBeenCalledWith(USER, { releaseStateId: OTHER_RELEASE });
    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ releaseStateId: RELEASE, verifierId: VERIFIER }),
    );
  });

  it('returns the outcome status the state machine reported', async () => {
    mockSubmit.mockResolvedValueOnce({ status: 'armed' } as never);
    const res = await POST(post({ decision: 'deny' }));
    expect(await res.json()).toEqual({ status: 'armed' });
  });

  it('refuses a decision outside the three, before resolving anything', async () => {
    const res = await POST(post({ decision: 'approve' }));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('refuses a missing decision', async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('answers 403 when the caller has no open decision', async () => {
    mockResolve.mockResolvedValueOnce(null);
    const res = await POST(post({ decision: 'confirm' }));
    expect(res.status).toBe(403);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('maps a TriggerError to its own status rather than a 500', async () => {
    mockSubmit.mockRejectedValueOnce(new TriggerError('already answered', 409));
    const res = await POST(post({ decision: 'confirm' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'TriggerError' });
  });

  it('lets a non-TriggerError failure surface', async () => {
    mockSubmit.mockRejectedValueOnce(new Error('database gone'));
    await expect(POST(post({ decision: 'confirm' }))).rejects.toThrow('database gone');
  });

  it('refuses without a session', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(post({ decision: 'confirm' }));
    expect(res.status).toBe(401);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
