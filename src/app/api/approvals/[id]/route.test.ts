/**
 * The owner answers a helper's proposal — and that answer is a sign of life.
 *
 * This handler executed no test at all until 2026-08-30. Two properties were
 * therefore held in place by nothing:
 *
 * 🔴 THE DECISION IS NARROWED BEFORE IT REACHES THE VAULT. `decideApproval`
 * re-validates, but a route that forwarded an arbitrary string would be relying
 * on a check one layer down to hold a boundary this layer declares. The
 * assertions below pin the ARGUMENT, not the result — a mock returns its
 * fixture whatever it was asked, so asserting on the response would test the
 * response and nothing else.
 *
 * 🔴 `requireOwner(req)` — WITH `req`, so answering counts as checking in.
 * `owner-route.ts` states the consequence of dropping it: "a route that does not
 * pass `req` records nothing", and `runHeartbeatSweep` re-reads overdue owners
 * against exactly the column that would not be stamped. The sibling route
 * `/api/access-requests/[id]/respond` shipped that defect and carries a test
 * for the same property; this is the other half of the pair.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R6, J5-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../../lib/people/approvals', () => ({
  decideApproval: vi.fn(async () => ({ applied: true })),
}));

import { requireOwner } from '../../../../../lib/http/owner-route';
import { decideApproval } from '../../../../../lib/people/approvals';
import { IntegrityError } from '../../../../../lib/db/integrity';
import { ValidationError } from '../../../../../lib/validation';
import { POST } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockDecide = vi.mocked(decideApproval);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const APPROVAL = 'c0ffee00-1111-4222-8333-444455556666';

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/approvals/' + APPROVAL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: APPROVAL }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockDecide.mockResolvedValue({ applied: true });
});

describe('the owner decides', () => {
  it('forwards approve against the owner and the approval in the path', async () => {
    const res = await POST(req({ decision: 'approve' }), ctx);
    expect(res.status).toBe(200);
    // The owner id comes from the SESSION and the approval id from the PATH.
    // Sending either in the body must not be able to redirect the decision.
    expect(mockDecide).toHaveBeenCalledWith(OWNER, APPROVAL, 'approve');
  });

  it('forwards reject as reject, not as a falsy approve', async () => {
    await POST(req({ decision: 'reject' }), ctx);
    expect(mockDecide).toHaveBeenCalledWith(OWNER, APPROVAL, 'reject');
  });

  it('ignores an ownerId supplied in the body', async () => {
    await POST(req({ decision: 'approve', ownerId: 'someone-else' }), ctx);
    expect(mockDecide).toHaveBeenCalledWith(OWNER, APPROVAL, 'approve');
  });

  it('records the answer as deliberate activity', async () => {
    // The property the sibling route lost: requireOwner must receive the
    // request, because that is what stamps last_active_at.
    await POST(req({ decision: 'reject' }), ctx);
    expect(mockRequireOwner.mock.calls[0][0]).toBeDefined();
    expect(mockRequireOwner.mock.calls[0][0]?.method).toBe('POST');
  });
});

describe('what it refuses', () => {
  it('refuses without an owner session and decides nothing', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(req({ decision: 'approve' }), ctx);
    expect(res.status).toBe(401);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('refuses a decision that is neither approve nor reject', async () => {
    const res = await POST(req({ decision: 'maybe' }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'decision' });
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('refuses a missing decision rather than defaulting to one', async () => {
    // Defaulting either way is a decision the owner did not make.
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(400);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('refuses a non-string decision', async () => {
    const res = await POST(req({ decision: true }), ctx);
    expect(res.status).toBe(400);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('renders another owner’s approval id as 403, never as 404', async () => {
    // mapError collapses IntegrityError to a generic 403 so that "missing" and
    // "not yours" are indistinguishable — no enumeration oracle.
    mockDecide.mockRejectedValueOnce(new IntegrityError('NOT_FOUND', 'nope'));
    const res = await POST(req({ decision: 'approve' }), ctx);
    expect(res.status).toBe(403);
  });

  it('renders a downstream ValidationError as 400', async () => {
    mockDecide.mockRejectedValueOnce(new ValidationError('already decided', 'id'));
    const res = await POST(req({ decision: 'approve' }), ctx);
    expect(res.status).toBe(400);
  });
});
