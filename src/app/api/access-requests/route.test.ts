/**
 * Tests for the session door on POST /api/access-requests.
 *
 * The token door is unchanged and stays — an unclaimed recipient holding a live
 * access code is still a legitimate requester. What is asserted here is that the
 * new door refuses everything it should, and that adding it did not weaken the
 * old one.
 *
 * Feature: relay-standby
 * Requirements: J6-R1, J6-R2, J4-R9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../lib/http/owner-route');
  return { ...actual, requireOwner: vi.fn() };
});
vi.mock('../../../../lib/access/requester-session', () => ({ resolveRequesterFor: vi.fn() }));
vi.mock('../../../../lib/auth/recipient-token', () => ({ verifyRecipientToken: vi.fn() }));
vi.mock('../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../../../../lib/notify/notifications', () => ({
  notifyOwnerOfAccessRequest: vi.fn(async () => true),
  notifyCircleOfRequest: vi.fn(async () => 0),
}));

import { query } from '../../../../lib/db/connection';
import { requireOwner } from '../../../../lib/http/owner-route';
import { resolveRequesterFor } from '../../../../lib/access/requester-session';
import { verifyRecipientToken } from '../../../../lib/auth/recipient-token';
import { writeAuditEntry } from '../../../../lib/audit/audit-service';
import { notifyCircleOfRequest } from '../../../../lib/notify/notifications';
import { POST } from './route';

const mockQuery = vi.mocked(query);
const mockAuth = vi.mocked(requireOwner);
const mockResolve = vi.mocked(resolveRequesterFor);
const mockToken = vi.mocked(verifyRecipientToken);

/** Real UUIDs: `owner_id` is shape-checked before it reaches a UUID column. */
const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const OTHER = '1463e162-6602-473d-bddb-8fe30524f7c7';

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://relaystandby.com/api/access-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** The queries the happy path makes, in order, after the requester resolves. */
function seedInsertPath() {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ owner_id: 'o-1' }], rowCount: 1 } as never) // owner lookup
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // velocity read
    .mockResolvedValueOnce({ rows: [{ id: 'ar-1' }], rowCount: 1 } as never) // insert
    .mockResolvedValue({ rows: [{ email: 'o@example.com', name: 'Jordan' }], rowCount: 1 } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
  mockAuth.mockResolvedValue({ ownerId: 'u-1' } as never);
  mockResolve.mockResolvedValue({ recipientId: 'r-1', ownerId: 'o-1' });
});

describe('the session door — J6 had no entry point at all before this', () => {
  it('accepts a signed-in recipient asking about a vault they are named on', async () => {
    seedInsertPath();
    const res = await POST(req({ owner_id: OWNER, trigger_type: 'emergency', reason: 'in hospital' }));
    expect(res.status).toBe(201);
    expect(mockResolve).toHaveBeenCalledWith('u-1', OWNER);
  });

  it('REFUSES a signed-in user who is not named on that vault', async () => {
    // The whole point of resolving from the roster: a session proves who you
    // are, not what you may ask about.
    mockResolve.mockResolvedValueOnce(null);
    const res = await POST(req({ owner_id: OTHER, trigger_type: 'emergency' }));
    expect(res.status).toBe(403);
  });

  it('refuses without an owner_id rather than guessing which vault is meant', async () => {
    // Somebody may stand by for two people. Picking one would be a coin flip
    // that starts an emergency on the wrong person's account.
    const res = await POST(req({ trigger_type: 'emergency' }));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('refuses a malformed owner_id with 400, not a database cast error', async () => {
    // `owner_id` lands in a UUID column, so a junk value became a Postgres cast
    // failure and a 500 — an outage-shaped response to a client mistake.
    const res = await POST(req({ owner_id: 'not-a-uuid', trigger_type: 'emergency' }));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('refuses when there is no session and no token', async () => {
    // Must be a NextResponse: `isResponse` is an instanceof check, so a plain
    // Response would fall through and be treated as a successful auth.
    mockAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as never,
    );
    const res = await POST(req({ owner_id: OWNER, trigger_type: 'emergency' }));
    expect(res.status).toBe(401);
  });

  it('still validates the trigger type on the session path', async () => {
    const res = await POST(req({ owner_id: OWNER, trigger_type: 'not_a_trigger' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('the token door is unchanged', () => {
  it('still accepts a recipient token and never consults the session', async () => {
    mockToken.mockResolvedValueOnce({ recipientId: 'r-9' } as never);
    seedInsertPath();

    const res = await POST(req({ recipient_token: 'tok', trigger_type: 'emergency' }));

    expect(res.status).toBe(201);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('still rejects an invalid token with 403, not a fallthrough to the session', async () => {
    // A bad token must NOT quietly fall through to "maybe they are signed in" —
    // that would turn a forged credential into a different privilege check.
    mockToken.mockRejectedValueOnce(new Error('bad'));
    const res = await POST(req({ recipient_token: 'forged', trigger_type: 'emergency' }));
    expect(res.status).toBe(403);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('accepts the token in an Authorization header as before', async () => {
    mockToken.mockResolvedValueOnce({ recipientId: 'r-9' } as never);
    seedInsertPath();

    const res = await POST(
      req({ trigger_type: 'emergency' }, { authorization: 'Bearer tok' }),
    );
    expect(res.status).toBe(201);
    expect(mockAuth).not.toHaveBeenCalled();
  });
});

describe('the circle broadcast does not reach people the owner removed', () => {
  /*
    🔴 REVOCATION IS "the control behind the coercion risk" (standby-architecture
    §3.7 rule 1), and this one query ignored it. Every sibling roster read
    excludes a revoked contact — `standby-resolve.ts` twice, `session-access.ts`,
    `closure.ts`, `requester-session.ts`, and `notifyOneVerifier`, whose comment
    says "a revoked one is deliberately skipped". The J6-R9 broadcast did not, so
    a person the owner had withdrawn from their circle still received "someone
    asked for access to X's vault", naming the requester, on every request.

    Asserted on the SQL: the mail goes to whatever rows come back, so the filter
    has to be in the query and nothing downstream can compensate for it.
  */
  it('excludes revoked contacts from both arms of the roster query', async () => {
    seedInsertPath();
    await POST(req({ owner_id: OWNER, trigger_type: 'emergency', reason: 'in hospital' }));

    const circleSql = mockQuery.mock.calls
      .map((c) => String(c[0]))
      .find((s) => /FROM recipients[\s\S]*UNION ALL[\s\S]*FROM verifiers/i.test(s));

    expect(circleSql, 'the circle roster query was not issued').toBeTruthy();

    const arms = circleSql!.split(/UNION ALL/i);
    expect(arms).toHaveLength(2);
    for (const [i, arm] of arms.entries()) {
      expect(
        arm,
        `arm ${i + 1} of the circle broadcast does not exclude revoked contacts:\n${arm}`,
      ).toMatch(/coalesce\(\s*standby_state\s*,\s*'invited'\s*\)\s*<>\s*'revoked'/i);
    }
  });
});

/**
 * 🔴 A REFUSAL WAS NOT VISIBLE TO THE RULE THAT ENFORCES IT — J6-R8, 2026-08-21.
 *
 * `assertRequestAllowed` is the one place that answers "may this request be
 * made", and it was handed `SELECT created_at` — so it could count asks and
 * could not see that the owner had already answered one of them with no. A
 * contact told no could ask again a minute later, and once more, inside the
 * three-a-day budget.
 *
 * Both halves are asserted here because the unit test cannot see either one: the
 * rule itself is proved in lib/release/access-request.test.ts against rows
 * somebody typed, and the mock will happily hand it a `status` the real query
 * never selected. This is the guard on WHERE the check is applied.
 */
describe('a refused requester is cooled off before the next ask (J6-R8)', () => {
  /** The velocity/cooling-off read, whichever position it occupies. */
  function priorRequestsSql(): string | undefined {
    return mockQuery.mock.calls
      .map((c) => String(c[0]))
      .find((s) => /FROM access_requests\s+WHERE recipient_id/i.test(s));
  }

  it('SELECTS the status, without which the rule silently never fires', async () => {
    seedInsertPath();
    await POST(req({ owner_id: OWNER, trigger_type: 'emergency', reason: 'in hospital' }));

    const sql = priorRequestsSql();
    expect(sql, 'the prior-requests read was not issued at all').toBeTruthy();
    /*
      Matched inside the select list rather than anywhere in the statement. A
      bare `toContain('status')` would be satisfied by a WHERE clause, or by the
      word appearing in some other query — the shape of false green this repo
      has been bitten by more than once.
    */
    expect(sql!.slice(0, sql!.search(/\bFROM\b/i))).toMatch(/\bstatus\b/);
  });

  it('refuses the next ask with 400 and names cooling_off', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'o-1' }], rowCount: 1 } as never) // owner lookup
      .mockResolvedValueOnce({
        rows: [{ created_at: new Date().toISOString(), status: 'denied_by_owner' }],
        rowCount: 1,
      } as never) // prior requests — one refusal, minutes ago
      .mockResolvedValue({ rows: [], rowCount: 0 } as never);

    const res = await POST(req({ owner_id: OWNER, trigger_type: 'emergency' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ field: 'cooling_off' });
  });

  it('writes NOTHING when it refuses — no row, no audit, no mail to the circle', async () => {
    /*
      The refusal has to happen BEFORE the INSERT. A cooling-off that files the
      request and then declines it would still broadcast "someone asked for
      access to your vault" to the whole circle on every attempt, which is the
      harassment the rule exists to stop, delivered by Relay itself.
    */
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'o-1' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({
        rows: [{ created_at: new Date().toISOString(), status: 'denied_by_owner' }],
        rowCount: 1,
      } as never)
      .mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await POST(req({ owner_id: OWNER, trigger_type: 'emergency' }));

    const statements = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(statements.some((s) => /INSERT INTO access_requests/i.test(s))).toBe(false);
    expect(vi.mocked(writeAuditEntry)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyCircleOfRequest)).not.toHaveBeenCalled();
  });

  it('still lets a requester through when the owner has not refused them', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ owner_id: 'o-1' }], rowCount: 1 } as never)
      .mockResolvedValueOnce({
        rows: [{ created_at: new Date().toISOString(), status: 'awaiting_owner' }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'ar-1' }], rowCount: 1 } as never)
      .mockResolvedValue({ rows: [{ email: 'o@example.com', name: 'Jordan' }], rowCount: 1 } as never);

    const res = await POST(req({ owner_id: OWNER, trigger_type: 'emergency' }));
    expect(res.status).toBe(201);
  });
});
