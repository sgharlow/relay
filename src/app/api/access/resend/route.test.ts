/**
 * A locked-out caregiver asks for a fresh code — on an UNAUTHENTICATED request
 * that causes mail to be sent to a third party.
 *
 * This handler executed no test until 2026-08-30, and it is the most
 * enumeration-sensitive endpoint in the product. Its safety rests entirely on
 * three properties that are invisible in a 200:
 *
 * 🔴 THE RESPONSE IS IDENTICAL WHATEVER HAPPENS. Address unknown, address known
 * but no released trigger, address known and mail sent — all three return the
 * same bytes. Anything that distinguishes them turns this into an oracle for
 * "is this person named on somebody's vault", which is a question about a
 * stranger's private arrangements. Asserted by comparing the serialised bodies
 * of all three cases to each other, not to a literal, so the property survives a
 * change of wording.
 *
 * 🔴 THE CODE GOES TO THE ADDRESS ON FILE, NEVER THE ONE SUPPLIED. Someone who
 * guesses a recipient's address causes an email to the REAL recipient and learns
 * nothing. A handler that mailed `body.email` would pass every "returns 200"
 * test and hand an access code to whoever typed the address.
 *
 * 🔴 A CODE IS ISSUED ONLY FOR A RELEASE THAT IS ALREADY `released`. This grants
 * nothing new — it re-opens a door the owner configured and a verifier
 * confirmed. The `state = 'released'` clause is what makes that sentence true.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1, J8-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../lib/auth/recipient-code', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../lib/auth/recipient-code',
  );
  return { ...actual, issueRecipientCode: vi.fn(async () => 'ABCD1234') };
});
vi.mock('../../../../../lib/notify/email', () => ({
  sendEmailBestEffort: vi.fn(async () => true),
}));
vi.mock('../../../../../lib/people/owner-label', () => ({
  getOwnerLabel: vi.fn(async () => 'Margaret'),
}));
vi.mock('../../../../../lib/audit/audit-service', () => ({
  writeAuditEntry: vi.fn(async () => undefined),
}));
vi.mock('../../../../../lib/http/rate-limit', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../lib/http/rate-limit',
  );
  return {
    ...actual,
    rateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
  };
});

import { query } from '../../../../../lib/db/connection';
import { issueRecipientCode } from '../../../../../lib/auth/recipient-code';
import { sendEmailBestEffort } from '../../../../../lib/notify/email';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { rateLimit } from '../../../../../lib/http/rate-limit';
import { POST } from './route';

const mockQuery = vi.mocked(query);
const mockIssue = vi.mocked(issueRecipientCode);
const mockSend = vi.mocked(sendEmailBestEffort);
const mockAudit = vi.mocked(writeAuditEntry);
const mockRateLimit = vi.mocked(rateLimit);

const OWNER = '9510683f-af55-4265-8840-b2986824a2e1';
const RELEASE = 'a1a1a1a1-2222-4333-8444-555566667777';
const RECIPIENT = 'aaaaaaaa-2222-4333-8444-555566667777';

const ON_FILE = 'april.real@example.com';
const GUESSED = 'April.Real@Example.com';
const ATTACKER = 'attacker@evil.example';

const ROW = {
  recipient_id: RECIPIENT,
  recipient_name: 'April',
  recipient_email: ON_FILE,
  release_state_id: RELEASE,
  owner_id: OWNER,
  version: '3',
};

function req(body: unknown): NextRequest {
  return new NextRequest('https://relaystandby.com/api/access/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  mockQuery.mockResolvedValue({ rows: [] } as never);
  mockIssue.mockResolvedValue('ABCD1234' as never);
  mockSend.mockResolvedValue(true as never);
  mockAudit.mockResolvedValue(undefined as never);
});

describe('the response tells a stranger nothing', () => {
  it('answers identically whether or not the address is known', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] } as never);
    const found = await POST(req({ email: GUESSED }));
    const foundBody = JSON.stringify(await found.json());

    vi.clearAllMocks();
    mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mockQuery.mockResolvedValue({ rows: [] } as never);
    const missing = await POST(req({ email: 'nobody@example.com' }));
    const missingBody = JSON.stringify(await missing.json());

    expect(found.status).toBe(missing.status);
    expect(foundBody).toBe(missingBody);
  });

  it('answers identically for an empty address, without querying at all', async () => {
    const empty = await POST(req({ email: '   ' }));
    const emptyBody = JSON.stringify(await empty.json());
    expect(mockQuery).not.toHaveBeenCalled();

    mockQuery.mockResolvedValueOnce({ rows: [ROW] } as never);
    const found = await POST(req({ email: GUESSED }));
    expect(JSON.stringify(await found.json())).toBe(emptyBody);
  });

  it('answers identically when the address is missing entirely', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('where the code actually goes', () => {
  it('emails the address ON FILE, never the address supplied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] } as never);
    await POST(req({ email: ATTACKER }));
    expect(mockSend).toHaveBeenCalledTimes(1);
    const sent = mockSend.mock.calls[0][0];
    expect(sent.to).toBe(ON_FILE);
    expect(sent.to).not.toBe(ATTACKER);
    // And the attacker's address must not appear anywhere in the message.
    expect(JSON.stringify(sent)).not.toContain(ATTACKER);
  });

  it('issues the code bound to the recipient, release, owner and version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] } as never);
    await POST(req({ email: GUESSED }));
    expect(mockIssue).toHaveBeenCalledWith({
      recipientId: RECIPIENT,
      releaseStateId: RELEASE,
      ownerId: OWNER,
      version: '3',
    });
  });

  it('records the resend on the OWNER’s audit chain, attributed to the recipient', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] } as never);
    await POST(req({ email: GUESSED }));
    expect(mockAudit).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({
        actor: `recipient:${RECIPIENT}`,
        action: 'access_code_resent',
        entityId: RELEASE,
      }),
    );
  });

  it('issues nothing and sends nothing when no released access matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await POST(req({ email: GUESSED }));
    expect(mockIssue).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('it re-opens an open door, it does not open a new one', () => {
  it('only matches a release that is already RELEASED', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] } as never);
    await POST(req({ email: GUESSED }));
    const [sql, params] = mockQuery.mock.calls[0];
    // Without this clause the route would mint access for an ARMED trigger —
    // granting what no owner configured and no verifier confirmed.
    expect(String(sql)).toMatch(/rs\.state = 'released'/);
    expect(params).toEqual([GUESSED]);
  });

  it('matches the address case-insensitively', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] } as never);
    await POST(req({ email: GUESSED }));
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/lower\(r\.email\) = lower\(\$1\)/);
  });
});

describe('rate limiting', () => {
  it('refuses over the limit with a Retry-After and sends nothing', async () => {
    mockRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 900 });
    const res = await POST(req({ email: GUESSED }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('900');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('meters on a key scoped to this route, not a shared bucket', async () => {
    await POST(req({ email: GUESSED }));
    expect(String(mockRateLimit.mock.calls[0][0])).toMatch(/^aresend:/);
  });
});
