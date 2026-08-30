/**
 * The phrase did not match — sever the binding.
 *
 * This handler executed no test until 2026-08-30. It is the destructive half of
 * a deliberately split pair: `DELETE /confirm` withdraws an assertion and leaves
 * the person holding their slot; this treats the ticket channel as compromised
 * and severs the claim. The route header says the two were kept apart so that
 * "it is not possible to fire the wrong one by getting a flag wrong" — and the
 * flag that decides WHICH TABLE is severed had nothing asserting it.
 *
 * 🔴 THE ASSERTION THAT MATTERS IS `personType` → TABLE. `recipient` must reach
 * `recipients` and `verifier` must reach `verifiers`. Getting that pair backwards
 * would pass every "returns 200" test ever written, sever the wrong person, and
 * leave the compromised binding standing.
 *
 * 🔴 AND `assertOwns` MUST RUN BEFORE `rejectClaim`. DSQL has no foreign keys, so
 * cross-owner references are refused in the application layer or not at all.
 * Order is asserted directly, because both being called is not the same claim as
 * the check having happened first.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../../../lib/db/integrity', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../../lib/db/integrity',
  );
  return { ...actual, assertOwns: vi.fn(async () => undefined) };
});
vi.mock('../../../../../../lib/people/fingerprint', () => ({
  rejectClaim: vi.fn(async () => undefined),
}));

import { requireOwner } from '../../../../../../lib/http/owner-route';
import { assertOwns, IntegrityError } from '../../../../../../lib/db/integrity';
import { rejectClaim } from '../../../../../../lib/people/fingerprint';
import { POST } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockAssertOwns = vi.mocked(assertOwns);
const mockReject = vi.mocked(rejectClaim);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const PERSON = 'b1b1b1b1-2222-4333-8444-555566667777';

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/people/' + PERSON + '/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: PERSON }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockAssertOwns.mockResolvedValue(undefined);
  mockReject.mockResolvedValue(undefined);
});

describe('severing a claim', () => {
  it('severs a recipient against the recipients table', async () => {
    const res = await POST(req({ personType: 'recipient' }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: true });
    expect(mockAssertOwns).toHaveBeenCalledWith(OWNER, 'recipients', PERSON);
    expect(mockReject).toHaveBeenCalledWith({
      ownerId: OWNER,
      personId: PERSON,
      personType: 'recipient',
    });
  });

  it('severs a verifier against the verifiers table', async () => {
    await POST(req({ personType: 'verifier' }), ctx);
    expect(mockAssertOwns).toHaveBeenCalledWith(OWNER, 'verifiers', PERSON);
    expect(mockReject).toHaveBeenCalledWith({
      ownerId: OWNER,
      personId: PERSON,
      personType: 'verifier',
    });
  });

  it('checks ownership BEFORE severing anything', async () => {
    // Both being called is not the claim. The claim is the order: a cross-owner
    // person id must be refused while the row is still intact.
    const order: string[] = [];
    mockAssertOwns.mockImplementationOnce(async () => { order.push('assertOwns'); });
    mockReject.mockImplementationOnce(async () => { order.push('rejectClaim'); });
    await POST(req({ personType: 'recipient' }), ctx);
    expect(order).toEqual(['assertOwns', 'rejectClaim']);
  });

  it('takes the person id from the path, not the body', async () => {
    await POST(req({ personType: 'recipient', personId: 'attacker-supplied' }), ctx);
    expect(mockReject).toHaveBeenCalledWith(
      expect.objectContaining({ personId: PERSON }),
    );
  });

  it('records the rejection as deliberate activity', async () => {
    await POST(req({ personType: 'recipient' }), ctx);
    expect(mockRequireOwner.mock.calls[0][0]?.method).toBe('POST');
  });
});

describe('what it refuses', () => {
  it('refuses without an owner session and severs nothing', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(req({ personType: 'recipient' }), ctx);
    expect(res.status).toBe(401);
    expect(mockAssertOwns).not.toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
  });

  it('refuses a personType outside the two tables', async () => {
    const res = await POST(req({ personType: 'delegate' }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'personType' });
    expect(mockAssertOwns).not.toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
  });

  it('refuses a missing personType rather than guessing a table', async () => {
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(400);
    expect(mockReject).not.toHaveBeenCalled();
  });

  it('refuses another owner’s person without severing', async () => {
    mockAssertOwns.mockRejectedValueOnce(new IntegrityError('NOT_FOUND', 'nope'));
    const res = await POST(req({ personType: 'verifier' }), ctx);
    expect(res.status).toBe(403);
    expect(mockReject).not.toHaveBeenCalled();
  });
});
