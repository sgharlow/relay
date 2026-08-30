/**
 * Issuing the one long-lived bearer credential this architecture puts on paper.
 *
 * This handler executed no test until 2026-08-30, which is a notable place for
 * that to be true: §8.1 calls this the knowing exception to every other rule
 * about credentials in this product. The code is returned ONCE, only a hash is
 * stored, and anyone holding the paper can take that person's place.
 *
 * 🔴 THE PROPERTY WITH NO SECOND CHANCE: the plaintext code appears in this
 * response and nowhere else, so a handler that dropped it — or returned the
 * unformatted value, or forgot `shownOnce` — would hand the owner something
 * they cannot use and cannot ask for again. Asserted on the BODY, because that
 * body is the only artefact.
 *
 * 🔴 AND `assertOwns` BEFORE `issueBreakGlass`. The route's own header records
 * why this check was added on 2026-08-12: issuing against another owner's person
 * id was never exploitable — redemption re-checks `owner_id` — but it wrote junk
 * rows and put a stranger's person id in this owner's hash-chained audit log.
 * "Not exploitable" is not the same as "may run", and the order is what makes
 * that true rather than incidental.
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
vi.mock('../../../../../../lib/people/break-glass', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../../lib/people/break-glass',
  );
  return { ...actual, issueBreakGlass: vi.fn() };
});

import { requireOwner } from '../../../../../../lib/http/owner-route';
import { assertOwns, IntegrityError } from '../../../../../../lib/db/integrity';
import { issueBreakGlass, formatBreakGlass } from '../../../../../../lib/people/break-glass';
import { POST } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockAssertOwns = vi.mocked(assertOwns);
const mockIssue = vi.mocked(issueBreakGlass);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const PERSON = 'b1b1b1b1-2222-4333-8444-555566667777';
const RAW_CODE = 'K7M2P9QRXT4W';
const EXPIRES = '2026-09-29T00:00:00.000Z';

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/people/' + PERSON + '/break-glass', {
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
  mockIssue.mockResolvedValue({ code: RAW_CODE, expiresAt: EXPIRES });
});

describe('issuing the code', () => {
  it('returns the code the owner has to write down, grouped for transcription', async () => {
    const res = await POST(req({ personType: 'recipient' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Not "a code came back" — THE code, in the form a person copies onto paper.
    // formatBreakGlass is the real implementation, so this pins the shape too.
    expect(body.code).toBe(formatBreakGlass(RAW_CODE));
    expect(body.code).toBe('K7M2-P9QR-XT4W');
    expect(body.expiresAt).toBe(EXPIRES);
    expect(body.shownOnce).toBe(true);
    expect(String(body.warning)).toMatch(/cannot show it again/i);
  });

  it('issues against the recipients table for a recipient', async () => {
    await POST(req({ personType: 'recipient' }), ctx);
    expect(mockAssertOwns).toHaveBeenCalledWith(OWNER, 'recipients', PERSON);
    expect(mockIssue).toHaveBeenCalledWith({
      ownerId: OWNER,
      personId: PERSON,
      personType: 'recipient',
    });
  });

  it('issues against the verifiers table for a verifier', async () => {
    await POST(req({ personType: 'verifier' }), ctx);
    expect(mockAssertOwns).toHaveBeenCalledWith(OWNER, 'verifiers', PERSON);
    expect(mockIssue).toHaveBeenCalledWith(
      expect.objectContaining({ personType: 'verifier' }),
    );
  });

  it('checks ownership BEFORE minting anything', async () => {
    const order: string[] = [];
    mockAssertOwns.mockImplementationOnce(async () => { order.push('assertOwns'); });
    mockIssue.mockImplementationOnce(async () => {
      order.push('issueBreakGlass');
      return { code: RAW_CODE, expiresAt: EXPIRES };
    });
    await POST(req({ personType: 'recipient' }), ctx);
    expect(order).toEqual(['assertOwns', 'issueBreakGlass']);
  });

  it('binds the code to the person in the path, not one named in the body', async () => {
    await POST(req({ personType: 'recipient', personId: 'attacker-supplied' }), ctx);
    expect(mockIssue).toHaveBeenCalledWith(
      expect.objectContaining({ personId: PERSON, ownerId: OWNER }),
    );
  });

  it('records the issue as deliberate activity', async () => {
    await POST(req({ personType: 'recipient' }), ctx);
    expect(mockRequireOwner.mock.calls[0][0]?.method).toBe('POST');
  });
});

describe('what it refuses', () => {
  it('refuses without an owner session and mints nothing', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(req({ personType: 'recipient' }), ctx);
    expect(res.status).toBe(401);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('refuses a personType outside the two tables', async () => {
    const res = await POST(req({ personType: 'delegate' }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'personType' });
    expect(mockAssertOwns).not.toHaveBeenCalled();
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('refuses a missing personType', async () => {
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(400);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('refuses another owner’s person without minting', async () => {
    // The junk-row and audit-pollution case the 2026-08-12 fix was written for.
    mockAssertOwns.mockRejectedValueOnce(new IntegrityError('NOT_FOUND', 'nope'));
    const res = await POST(req({ personType: 'recipient' }), ctx);
    expect(res.status).toBe(403);
    expect(mockIssue).not.toHaveBeenCalled();
  });
});
