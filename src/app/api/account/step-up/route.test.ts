/**
 * Tests for /api/account/step-up (GET, POST, DELETE).
 *
 * WHY THIS FILE EXISTS. The handler shipped with 42 statements and 34 branches
 * and NOT ONE of them was executed by the suite — measured, not assumed: it read
 * 0% on every axis in `npm run test:coverage` on 2026-08-22. `lib/auth/step-up.ts`
 * was well covered the whole time, which is the trap: the module was tested and
 * the *door* was not. `lib/ops/step-up-guard.ts` asserts that sensitive routes
 * CALL step-up; nothing asserted that the route which GRANTS it behaves.
 *
 * The properties pinned here are the ones the handler's own header claims, so a
 * change that falsifies the comment now fails the suite rather than leaving the
 * comment to drift:
 *
 *  - a passkey belonging to somebody else does not elevate this session
 *    (`proved = userId === auth.ownerId` — the single line between "somebody
 *    holds a registered passkey" and "the holder of THIS session does");
 *  - a recovery code is not a step-up factor, which the header states in prose
 *    and the code expresses only by having no branch for it — the shape a later
 *    edit adds a branch to without noticing;
 *  - every failure answers the same 400, including the ones that arrive as
 *    thrown errors from a replayed challenge, so the response cannot be used to
 *    tell an attacker which factor to attack;
 *  - a refusal mints nothing and writes no audit row;
 *  - the attempt budget is per ACCOUNT, so it cannot be rotated away.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1, J13-R1, J13-R2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../../lib/release/liveness', () => ({
  recordDeliberateActivity: vi.fn(async () => undefined),
}));
vi.mock('../../../../../lib/audit/audit-service', () => ({
  writeAuditEntry: vi.fn(async () => ({})),
}));
vi.mock('../../../../../lib/db/connection', () => ({ query: vi.fn() }));
vi.mock('../../../../../lib/auth/totp', () => ({ validateTotpCodeFor: vi.fn() }));
vi.mock('../../../../../lib/auth/webauthn', () => ({
  openChallenge: vi.fn(),
  finishAuthentication: vi.fn(),
}));
vi.mock('../../../../../lib/auth/step-up', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/auth/step-up')>();
  return {
    ...actual,
    mintStepUp: vi.fn(),
    hasStepUp: vi.fn(),
    revokeStepUp: vi.fn(),
    availableStepUpFactors: vi.fn(),
  };
});

import { getOwnerSession } from '../../../../../lib/auth/session';
import { query } from '../../../../../lib/db/connection';
import { validateTotpCodeFor } from '../../../../../lib/auth/totp';
import { openChallenge, finishAuthentication } from '../../../../../lib/auth/webauthn';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import {
  mintStepUp,
  hasStepUp,
  revokeStepUp,
  availableStepUpFactors,
  STEP_UP_COOKIE,
  STEP_UP_TTL_SECONDS,
} from '../../../../../lib/auth/step-up';
import { _resetRateLimitForTesting } from '../../../../../lib/http/rate-limit';
import { ValidationError } from '../../../../../lib/validation';
import { GET, POST, DELETE } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockQuery = vi.mocked(query);
const mockTotp = vi.mocked(validateTotpCodeFor);
const mockOpenChallenge = vi.mocked(openChallenge);
const mockFinishAuth = vi.mocked(finishAuthentication);
const mockAudit = vi.mocked(writeAuditEntry);
const mockMint = vi.mocked(mintStepUp);
const mockHasStepUp = vi.mocked(hasStepUp);
const mockRevoke = vi.mocked(revokeStepUp);
const mockFactors = vi.mocked(availableStepUpFactors);

const OWNER = 'owner-1';

/**
 * The handler reads `req.method` (via requireOwner), `req.headers` and
 * `req.json` (via readJson), and `req.cookies` (via readStepUpCookie). A double
 * carrying exactly those is enough — `readJson`'s own header records that route
 * tests are expected to pass one rather than construct a whole Request.
 */
function makeReq(body?: unknown, opts: { cookie?: string; method?: string } = {}) {
  return {
    method: opts.method ?? 'POST',
    headers: new Headers(),
    cookies: { get: (n: string) => (n === STEP_UP_COOKIE && opts.cookie ? { value: opts.cookie } : undefined) },
    json: async () => body,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The limiter is process-memory and per key; without this the sixth test in a
  // file would start inheriting the fifth one's spent budget.
  _resetRateLimitForTesting();
  mockSession.mockResolvedValue({ ownerId: OWNER } as never);
  mockMint.mockResolvedValue({ token: 'grant-token', expiresAt: '2026-08-22T12:05:00.000Z' } as never);
  mockFactors.mockResolvedValue({ totp: true, passkey: false } as never);
  mockHasStepUp.mockResolvedValue(false);
  mockRevoke.mockResolvedValue(1);
});

describe('GET /api/account/step-up', () => {
  it('reports elevation, the offerable factors and the window length', async () => {
    mockHasStepUp.mockResolvedValueOnce(true);
    mockFactors.mockResolvedValueOnce({ totp: true, passkey: true } as never);

    const res = await GET(makeReq(undefined, { cookie: 'c', method: 'GET' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      elevated: true,
      factors: { totp: true, passkey: true },
      windowSeconds: STEP_UP_TTL_SECONDS,
    });
  });

  it('asks about elevation for THIS owner, using the cookie on THIS request', async () => {
    await GET(makeReq(undefined, { cookie: 'cookie-value', method: 'GET' }));
    expect(mockHasStepUp).toHaveBeenCalledWith('cookie-value', OWNER);
    expect(mockFactors).toHaveBeenCalledWith(OWNER);
  });

  it('returns 401 without a session', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await GET(makeReq(undefined, { method: 'GET' }));
    expect(res.status).toBe(401);
    expect(mockFactors).not.toHaveBeenCalled();
  });
});

describe('POST /api/account/step-up — the TOTP factor', () => {
  it('elevates on a correct code, attaches the cookie and records it in the owner audit chain', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: 'SEED' }] } as never);
    mockTotp.mockReturnValueOnce(true);

    const res = await POST(makeReq({ totpCode: ' 123456 ' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      elevated: true,
      expiresAt: '2026-08-22T12:05:00.000Z',
    });
    // Trimmed before validation — a pasted code carries whitespace.
    expect(mockTotp).toHaveBeenCalledWith('SEED', '123456');
    expect(mockMint).toHaveBeenCalledWith({ userId: OWNER });
    expect(res.headers.get('set-cookie') ?? '').toContain(STEP_UP_COOKIE);
    expect(mockAudit).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ action: 'step_up_granted', detail: { factor: 'totp' } }),
    );
  });

  it('refuses a wrong code with 400, mints nothing and writes no audit row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: 'SEED' }] } as never);
    mockTotp.mockReturnValueOnce(false);

    const res = await POST(makeReq({ totpCode: '000000' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'StepUpFailed' });
    expect(mockMint).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  /*
    An account with no seed at all must answer exactly as a wrong code does. The
    caller is already authenticated so there is no account to enumerate — but the
    handler's header commits to indistinguishability anyway, and this is the case
    where a helpful "you have no authenticator" message is most tempting to add.
  */
  it('answers identically when the account holds no TOTP secret', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ totp_secret: null }] } as never);

    const res = await POST(makeReq({ totpCode: '123456' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'StepUpFailed' });
    // The secret is absent, so the comparison is never reached: nothing is
    // validated against null, which would be the shape of an accidental pass.
    expect(mockTotp).not.toHaveBeenCalled();
  });

  it('answers identically when the user row does not come back at all', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const res = await POST(makeReq({ totpCode: '123456' }));
    expect(res.status).toBe(400);
    expect(mockMint).not.toHaveBeenCalled();
  });

  it('treats a blank code as no factor presented rather than as a code to check', async () => {
    const res = await POST(makeReq({ totpCode: '   ' }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockTotp).not.toHaveBeenCalled();
  });
});

describe('POST /api/account/step-up — the passkey factor', () => {
  it('elevates when the assertion belongs to this session’s owner', async () => {
    mockOpenChallenge.mockResolvedValueOnce('expected-challenge');
    mockFinishAuth.mockResolvedValueOnce({ userId: OWNER } as never);

    const res = await POST(makeReq({ challengeToken: 'sealed', response: { id: 'cred' } }));

    expect(res.status).toBe(200);
    expect(mockOpenChallenge).toHaveBeenCalledWith('sealed', 'authentication');
    expect(mockFinishAuth).toHaveBeenCalledWith({
      response: { id: 'cred' },
      expectedChallenge: 'expected-challenge',
    });
    expect(mockAudit).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ detail: { factor: 'passkey' } }),
    );
  });

  it('accepts the assertion as a JSON string, the way the browser posts it', async () => {
    mockOpenChallenge.mockResolvedValueOnce('expected-challenge');
    mockFinishAuth.mockResolvedValueOnce({ userId: OWNER } as never);

    const res = await POST(
      makeReq({ challengeToken: 'sealed', response: JSON.stringify({ id: 'cred' }) }),
    );

    expect(res.status).toBe(200);
    expect(mockFinishAuth).toHaveBeenCalledWith(
      expect.objectContaining({ response: { id: 'cred' } }),
    );
  });

  /*
    🔴 THE LOAD-BEARING ONE. `finishAuthentication` proves that SOMEBODY holds a
    registered passkey; it does not prove it is the person whose session this
    is. Without the identity comparison, a passkey on any other account elevates
    this one — and elevation is the gate in front of export, recovery-code
    reissue and account closure. Delete `userId === auth.ownerId` from the
    handler and only this test goes red.
  */
  it('does NOT elevate when the assertion belongs to a different account', async () => {
    mockOpenChallenge.mockResolvedValueOnce('expected-challenge');
    mockFinishAuth.mockResolvedValueOnce({ userId: 'somebody-else' } as never);

    const res = await POST(makeReq({ challengeToken: 'sealed', response: { id: 'cred' } }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'StepUpFailed' });
    expect(mockMint).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  /*
    `openChallenge` BURNS the nonce, so a replayed assertion arrives as a thrown
    error rather than a false return. It must land on the same 400 as a wrong
    code — not a 500, which would tell a prober that the challenge path is the
    live one.
  */
  it.each([
    // Typed, and the two that actually happen: both modules on this path refuse
    // with ValidationError, so these are decided by structure rather than prose.
    ['a replayed nonce', new ValidationError('That step expired or was already used. Try again.', 'challenge')],
    ['a misrouted nonce', new ValidationError('That challenge was not issued for this step.', 'challenge')],
    ['an unrecognised passkey', new ValidationError('That passkey is not recognised.', 'response')],
    // jose, by error code rather than by message.
    ['a bad seal signature', Object.assign(new Error('signature verification failed'), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' })],
    ['an expired seal', Object.assign(new Error('"exp" claim timestamp check failed'), { code: 'ERR_JWT_EXPIRED' })],
    // @simplewebauthn's own internal throws are plain Errors; the anchored
    // message test is their backstop.
    ['a library assertion failure', new Error('Unexpected authentication response challenge')],
  ])('maps %s to the same 400 as a wrong code', async (_label, err) => {
    mockOpenChallenge.mockRejectedValueOnce(err);

    const res = await POST(makeReq({ challengeToken: 'sealed', response: { id: 'cred' } }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'StepUpFailed',
      message: 'That did not match. Try again.',
    });
    expect(mockMint).not.toHaveBeenCalled();
  });

  it('refuses — rather than 500s — when the client’s own response string is not JSON', async () => {
    mockOpenChallenge.mockResolvedValueOnce('expected-challenge');

    const res = await POST(makeReq({ challengeToken: 'sealed', response: 'not json at all' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'StepUpFailed' });
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  /*
    🔴 THE REGRESSION TEST FOR A DEFECT THIS FILE FOUND. The classifier was
    `/challenge|expired|used|verified|jwt|signature/i` against the message, and
    `ECONNREFUSED` ends in `used` — so an outage was answered as "That did not
    match. Try again.", blaming the owner for the product's own fault and hiding
    the outage inside a step-up refusal rate. Restore the unanchored regex and
    this goes red on its own.
  */
  it.each([
    ['ECONNREFUSED', new Error('connect ECONNREFUSED 10.0.0.1:5432')],
    ['a DSQL concurrency abort', Object.assign(new Error('change conflicts with another transaction'), { code: '40001' })],
    ['a KMS fault', new Error('KMSInternalException')],
  ])('does not swallow %s — an infrastructure error is not a failed proof', async (_label, err) => {
    mockOpenChallenge.mockResolvedValueOnce('expected-challenge');
    mockFinishAuth.mockRejectedValueOnce(err);

    // mapError rethrows anything it does not recognise, so the platform's own
    // 500 handling sees it. Swallowing it into a 400 reports an outage as a
    // mistyped code.
    await expect(
      POST(makeReq({ challengeToken: 'sealed', response: { id: 'cred' } })),
    ).rejects.toThrow(err.message);
    expect(mockMint).not.toHaveBeenCalled();
  });
});

describe('POST /api/account/step-up — what is not a factor', () => {
  /*
    The header states this in prose: "A RECOVERY CODE IS DELIBERATELY NOT
    ACCEPTED: recovery codes are among the things step-up protects, so accepting
    one to authorise issuing new ones is a circle." The code expresses it only by
    having no branch — which is exactly the shape somebody later adds a branch to
    while believing they are filling a gap. Pinned here so that edit goes red.
  */
  it.each([
    ['a recovery code', { recoveryCode: 'AAAA-BBBB-CCCC' }],
    ['a password', { password: 'hunter2' }],
    ['an empty body', {}],
    ['no body at all', undefined],
    ['a response with no challenge token', { response: { id: 'cred' } }],
    ['a challenge token with no response', { challengeToken: 'sealed' }],
  ])('refuses %s without reaching any factor check', async (_label, body) => {
    const res = await POST(makeReq(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'StepUpFailed' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockOpenChallenge).not.toHaveBeenCalled();
    expect(mockMint).not.toHaveBeenCalled();
  });
});

describe('POST /api/account/step-up — the attempt budget', () => {
  it('refuses the seventh attempt in the window with 429 and a Retry-After', async () => {
    mockQuery.mockResolvedValue({ rows: [{ totp_secret: 'SEED' }] } as never);
    mockTotp.mockReturnValue(false);

    for (let i = 0; i < 6; i++) {
      expect((await POST(makeReq({ totpCode: '000000' }))).status).toBe(400);
    }

    const res = await POST(makeReq({ totpCode: '000000' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    await expect(res.json()).resolves.toMatchObject({ error: 'TooManyRequests' });
  });

  /*
    The budget is keyed on the OWNER, not on an IP or a header, and that is the
    property worth pinning: the caller is authenticated, so the account is the
    thing an attacker cannot rotate. A second account's attempts must not be
    charged to the first.
  */
  it('meters per account — a second owner starts with a full budget', async () => {
    mockQuery.mockResolvedValue({ rows: [{ totp_secret: 'SEED' }] } as never);
    mockTotp.mockReturnValue(false);

    for (let i = 0; i < 6; i++) await POST(makeReq({ totpCode: '000000' }));
    expect((await POST(makeReq({ totpCode: '000000' }))).status).toBe(429);

    mockSession.mockResolvedValue({ ownerId: 'owner-2' } as never);
    expect((await POST(makeReq({ totpCode: '000000' }))).status).toBe(400);
  });

  it('spends the budget before reading the body, so an oversized post cannot be free', async () => {
    // The limiter is consulted ahead of readJson in the handler; a body that
    // would be refused 413 still costs an attempt. Asserted by the ordering
    // being observable: six malformed posts exhaust the same budget.
    for (let i = 0; i < 6; i++) await POST(makeReq(undefined));
    const res = await POST(makeReq({ totpCode: '123456' }));
    expect(res.status).toBe(429);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/account/step-up', () => {
  it('ends elevation everywhere and clears the cookie in this browser', async () => {
    const res = await DELETE();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ elevated: false });
    // Everywhere, not just here: the row is revoked server-side as well as the
    // cookie being cleared, which is what makes "I am done on this machine"
    // also cover a machine the owner no longer has.
    expect(mockRevoke).toHaveBeenCalledWith(OWNER);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(STEP_UP_COOKIE);
    expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it('returns 401 without a session and revokes nothing', async () => {
    const { NextResponse } = await import('next/server');
    mockSession.mockReset();
    mockSession.mockRejectedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});
