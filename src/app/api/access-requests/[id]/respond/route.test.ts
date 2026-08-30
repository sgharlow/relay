/**
 * Answering a challenge is a sign of life, and it recorded none.
 *
 * 🔴 THE CASE THAT MATTERS MOST IS THE DENIAL. An owner who reads "your daughter
 * is asking for access" and answers "I'm fine — no" has just proved, personally
 * and deliberately, that they are alive and holding their own account. That is
 * the exact fact `last_active_at` exists to hold. This handler called
 * `requireOwner()` with no `req`, so nothing was stamped — and
 * `runHeartbeatSweep` re-reads overdue owners against that column. The person
 * most visibly present in the product stayed, in its eyes, silent.
 *
 * `lib/http/owner-route.ts` says the coverage rule out loud: "Pass `req` to also
 * record passive liveness ([A4]) — writes count, reads do not. ⚠️ COVERAGE IS
 * OPT-IN AND THAT IS A KNOWN LIMIT: a route that does not pass `req` records
 * nothing." docs/user-journeys.md J5-R1 promises liveness derived from
 * authenticated product activity, and the user guide (quoted in
 * lib/release/liveness-coverage.test.ts) promises "any deliberate action in the
 * product counts as checking in".
 *
 * ⚠️ NOT ADDED TO THAT FILE'S `MUST_RECORD` LIST HERE. That enumeration is the
 * portfolio-wide answer and belongs with the release code; this asserts the one
 * route, so the fix is held in place either way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS FILE HELD ONLY THE TWO SOURCE-TEXT ASSERTIONS BELOW UNTIL 2026-08-30,
 * AND THE HANDLER'S EXECUTED COVERAGE WAS 0% — a test file sitting beside a
 * route that no test had ever run. That was not an oversight: reading the source
 * is the RIGHT instrument for "the call site passes `req`", because the
 * behavioural consequence is a column stamped inside a mocked helper, which a
 * mock would report whatever it was asked. Both instruments are kept, and the
 * split is deliberate — the source assertions guard the call SHAPE, the
 * executing tests below guard what the handler DOES.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Feature: relay-h0-mvp
 * Requirements: J5-R1, J6-R4, J6-R5, J6-R10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';

const ROUTE = 'src/app/api/access-requests/[id]/respond/route.ts';

const src = () =>
  readFileSync(ROUTE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

describe('the owner’s answer counts as checking in', () => {
  it('passes the request to requireOwner, which is what records it', () => {
    expect(
      src(),
      `${ROUTE} calls requireOwner() with no request, so answering a challenge stamps nothing`,
    ).toMatch(/requireOwner\(\s*req\s*\)/);
  });

  it('does not call the bare form anywhere in the handler', () => {
    // Belt and braces: adding a second call site with no `req` would restore the
    // gap while the assertion above still passed.
    expect(src()).not.toMatch(/requireOwner\(\s*\)/);
  });
});

// ── The executing half ───────────────────────────────────────────────────────

vi.mock('../../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../../lib/http/owner-route',
  );
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'u-1' })) };
});
vi.mock('../../../../../../lib/release/challenge', () => ({
  respondToChallenge: vi.fn(),
}));
vi.mock('../../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../../lib/notify/notifications', () => ({
  notifyRequesterOfOutcome: vi.fn(async () => true),
}));
vi.mock('../../../../../../lib/people/owner-label', () => ({
  getOwnerLabel: vi.fn(async () => 'Margaret'),
}));

import { requireOwner } from '../../../../../../lib/http/owner-route';
import { respondToChallenge } from '../../../../../../lib/release/challenge';
import { query } from '../../../../../../lib/db/connection';
import { notifyRequesterOfOutcome } from '../../../../../../lib/notify/notifications';
import { getOwnerLabel } from '../../../../../../lib/people/owner-label';
import { IntegrityError } from '../../../../../../lib/db/integrity';
import { ValidationError } from '../../../../../../lib/validation';
import { POST } from './route';

const mockRequireOwner = vi.mocked(requireOwner);
const mockRespond = vi.mocked(respondToChallenge);
const mockQuery = vi.mocked(query);
const mockNotify = vi.mocked(notifyRequesterOfOutcome);
const mockLabel = vi.mocked(getOwnerLabel);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const OWNER_EMAIL = 'margaret.chen1948@example.com';
const REQUEST = 'c0ffee00-1111-4222-8333-444455556666';

function req(body: unknown): NextRequest {
  return new NextRequest(
    'https://relaystandby.com/api/access-requests/' + REQUEST + '/respond',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
const ctx = { params: Promise.resolve({ id: REQUEST }) };

const REQUESTER_ROW = {
  email: 'daughter@example.com',
  name: 'April',
  case_id: 'RLY-5T7C-PTQN',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOwner.mockResolvedValue({ ownerId: OWNER });
  mockRespond.mockResolvedValue({ status: 'denied_by_owner' } as never);
  mockQuery.mockResolvedValue({ rows: [REQUESTER_ROW] } as never);
  mockNotify.mockResolvedValue(true);
  mockLabel.mockResolvedValue('Margaret');
});

describe('the owner answers', () => {
  it('denies against the request in the path and the owner in the session', async () => {
    const res = await POST(req({ response: 'deny' }), ctx);
    expect(res.status).toBe(200);
    expect(mockRespond).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST, ownerId: OWNER, response: 'deny' }),
    );
  });

  it('approves with the same scoping', async () => {
    mockRespond.mockResolvedValueOnce({ status: 'approved_by_owner' } as never);
    await POST(req({ response: 'approve' }), ctx);
    expect(mockRespond).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST, ownerId: OWNER, response: 'approve' }),
    );
  });

  it('returns the result the challenge reported', async () => {
    mockRespond.mockResolvedValueOnce({ status: 'approved_by_owner' } as never);
    expect(await (await POST(req({ response: 'approve' }), ctx)).json()).toEqual({
      status: 'approved_by_owner',
    });
  });
});

describe('telling the requester — a dead-end is its own failure (J6-R10)', () => {
  it('notifies on a denial', async () => {
    await POST(req({ response: 'deny' }), ctx);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        to: REQUESTER_ROW.email,
        name: REQUESTER_ROW.name,
        outcome: 'denied_by_owner',
        caseId: REQUESTER_ROW.case_id,
      }),
    );
  });

  it('notifies on an approval too', async () => {
    mockRespond.mockResolvedValueOnce({ status: 'approved_by_owner' } as never);
    await POST(req({ response: 'approve' }), ctx);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'approved_by_owner' }),
    );
  });

  it('sends the owner LABEL, never their raw email address', async () => {
    /*
      🔴 THE STRONGEST PHISHING SIGNAL LEFT IN OUTBOUND MAIL, on the message most
      likely to be read in distress. This read the raw address until the
      getOwnerLabel cutover: a family member who asked for access got
      "margaret.chen1948@example.com has declined". A family must not get a name
      in one message and a bare address in the next.
    */
    mockLabel.mockResolvedValueOnce('Margaret');
    await POST(req({ response: 'deny' }), ctx);
    const sent = mockNotify.mock.calls[0][0];
    expect(sent.ownerLabel).toBe('Margaret');
    expect(sent.ownerLabel).not.toContain('@');
    expect(JSON.stringify(sent)).not.toContain(OWNER_EMAIL);
    expect(mockLabel).toHaveBeenCalledWith(OWNER);
  });

  it('looks the requester up scoped to BOTH the request and the owner', async () => {
    await POST(req({ response: 'deny' }), ctx);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/ar\.id = \$1 AND ar\.owner_id = \$2/);
    expect(params).toEqual([REQUEST, OWNER]);
  });

  it('stays silent when no requester row matches, rather than mailing a stranger', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const res = await POST(req({ response: 'deny' }), ctx);
    expect(res.status).toBe(200);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('what it refuses', () => {
  it('refuses without an owner session and answers nothing', async () => {
    mockRequireOwner.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(req({ response: 'deny' }), ctx);
    expect(res.status).toBe(401);
    expect(mockRespond).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('refuses a response outside approve and deny', async () => {
    const res = await POST(req({ response: 'escalate' }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'response' });
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it('refuses a missing response rather than defaulting to approve', async () => {
    // Defaulting to approve here would open a vault because a field was absent.
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(400);
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it('renders another owner’s request id as 403', async () => {
    mockRespond.mockRejectedValueOnce(new IntegrityError('NOT_FOUND', 'nope'));
    const res = await POST(req({ response: 'deny' }), ctx);
    expect(res.status).toBe(403);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('renders a downstream ValidationError as 400', async () => {
    mockRespond.mockRejectedValueOnce(new ValidationError('already answered', 'id'));
    const res = await POST(req({ response: 'approve' }), ctx);
    expect(res.status).toBe(400);
  });
});
