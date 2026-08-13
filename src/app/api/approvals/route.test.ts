/**
 * Tests for the helper's way into the owner's approvals queue.
 *
 * 🔴 The queue could never fill: `enqueueApproval` was called by nothing, so the
 * owner's approvals screen rendered an empty state waiting on a proposal no
 * surface could make. These assert the boundary that makes filling it safe.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R6, J3-R11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../lib/http/owner-route');
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../lib/http/delegate-route', () => ({
  resolveActor: vi.fn(),
  requireScope: vi.fn(),
}));
vi.mock('../../../../lib/people/approvals', () => ({
  listPendingApprovals: vi.fn(async () => []),
  enqueueApproval: vi.fn(async () => ({ id: 'ap-1' })),
}));

import { resolveActor, requireScope } from '../../../../lib/http/delegate-route';
import { enqueueApproval } from '../../../../lib/people/approvals';
import { IntegrityError } from '../../../../lib/db/integrity';
import { POST } from './route';

const mockResolve = vi.mocked(resolveActor);
const mockScope = vi.mocked(requireScope);
const mockEnqueue = vi.mocked(enqueueApproval);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const DELEGATE = { ownerId: OWNER, actingUserId: 'u-1', isDelegate: true, delegationId: 'd-1', scopes: ['people:propose'] };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue(DELEGATE as never);
  mockScope.mockReturnValue(undefined);
  mockEnqueue.mockResolvedValue({ id: 'ap-1' });
});

describe('a helper proposes', () => {
  it('queues a recipient proposal against the helped vault', async () => {
    const res = await POST(req({ ownerId: OWNER, kind: 'recipient', payload: { name: 'Sam', email: 's@example.com', role: 'recipient' } }));
    expect(res.status).toBe(201);
    expect(mockEnqueue).toHaveBeenCalledWith(OWNER, expect.objectContaining({
      kind: 'recipient',
      proposedByDelegationId: 'd-1',
    }));
  });

  it('allows a self-designation — the case the queue exists for', async () => {
    // A helper proposing THEMSELVES is the most dangerous thing they can ask
    // for, which is exactly why it is routed to the owner rather than refused.
    const res = await POST(req({ ownerId: OWNER, kind: 'self_designation', payload: { name: 'Me', email: 'me@example.com', role: 'caregiver' } }));
    expect(res.status).toBe(201);
    expect(mockEnqueue.mock.calls[0][1].kind).toBe('self_designation');
  });

  it('validates the payload BEFORE it enters the queue', async () => {
    // A malformed proposal must be refused while somebody can still fix it,
    // rather than surviving to fail under the owner's hands days later.
    const res = await POST(req({ ownerId: OWNER, kind: 'recipient', payload: { name: '', email: 'nope' } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('what it refuses', () => {
  it('refuses when no active delegation covers the pair', async () => {
    mockResolve.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }) as never,
    );
    const res = await POST(req({ ownerId: OWNER, kind: 'recipient', payload: { name: 'X', email: 'x@example.com' } }));
    expect(res.status).toBe(403);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('refuses an OWNER queuing proposals to themselves', async () => {
    mockResolve.mockResolvedValueOnce({ ...DELEGATE, isDelegate: false, delegationId: null } as never);
    const res = await POST(req({ ownerId: OWNER, kind: 'recipient', payload: { name: 'X', email: 'x@example.com' } }));
    expect(res.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('refuses a delegate without the people:propose scope', async () => {
    mockScope.mockImplementationOnce(() => { throw new IntegrityError('UNAUTHORIZED', 'nope'); });
    const res = await POST(req({ ownerId: OWNER, kind: 'recipient', payload: { name: 'X', email: 'x@example.com' } }));
    expect(res.status).toBe(403);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('refuses a kind outside the two it applies', async () => {
    // `decideApproval` only applies recipient and self_designation, so accepting
    // a 'policy' here would queue something approval could never act on.
    const res = await POST(req({ ownerId: OWNER, kind: 'policy', payload: { name: 'X', email: 'x@example.com' } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('refuses a malformed ownerId before resolving anything', async () => {
    const res = await POST(req({ ownerId: 'not-a-uuid', kind: 'recipient', payload: {} }));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
