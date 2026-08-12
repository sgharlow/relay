/**
 * Tests for GET /api/triggers and PUT /api/triggers/[id]/config
 *
 * Validates: Requirements 4.1, 5.1, 6.1, 9.1
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/release/release-list', () => ({
  listReleaseStates: vi.fn(),
  getCheckinInterval: vi.fn(),
  getVerifierCount: vi.fn(),
}));
vi.mock('../../../../lib/release/provisioning', () => ({ setRequiredConfirmations: vi.fn() }));
// M is no longer a COUNT(*): the route reads the roster and asks
// countEligibleVerifiers who can ACTUALLY answer, so an unsatisfiable quorum is
// refused at configuration time rather than stalling a release later.
vi.mock('../../../../lib/db/connection', () => ({ query: vi.fn() }));

import { getOwnerSession } from '../../../../lib/auth/session';
import { listReleaseStates, getCheckinInterval } from '../../../../lib/release/release-list';
import { setRequiredConfirmations } from '../../../../lib/release/provisioning';
import { query as dbQuery } from '../../../../lib/db/connection';
import { GET } from './route';
import { PUT } from './[id]/config/route';

const mockSession = vi.mocked(getOwnerSession);
const mockList = vi.mocked(listReleaseStates);
const mockInterval = vi.mocked(getCheckinInterval);
const mockSetN = vi.mocked(setRequiredConfirmations);
const mockQuery = vi.mocked(dbQuery);

/** verifiers roster, then the recipients who would receive this release. */
function rosterReturns(verifiers: unknown[], conflictedRecipients: unknown[] = []) {
  mockQuery.mockResolvedValueOnce({ rows: verifiers, rowCount: verifiers.length } as never);
  mockQuery.mockResolvedValueOnce({
    rows: conflictedRecipients,
    rowCount: conflictedRecipients.length,
  } as never);
}
/**
 * Someone whose answer COUNTS. `standby_state: 'confirmed'` since 2026-08-12 —
 * before the §4.3 tightening any non-revoked row counted, so this fixture used
 * `null`. The rename would be silent otherwise: a fixture that no longer means
 * what its name says is how a test keeps passing while testing nothing.
 */
const eligible = (id: string) => ({ id, claimed_user_id: null, standby_state: 'confirmed' });

/** Claimed but never checked — may answer, does not count. */
const unverified = (id: string) => ({ id, claimed_user_id: `u-${id}`, standby_state: 'claimed' });

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: true });
});

it('GET 401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server');
  mockSession.mockReset();
  mockSession.mockRejectedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  const res = await GET();
  expect(res.status).toBe(401);
});

it('GET returns release states, cadence, and isDemo', async () => {
  mockList.mockResolvedValueOnce([{ id: 'rs', trigger_type: 'emergency', state: 'armed' } as never]);
  mockInterval.mockResolvedValueOnce(30);
  const res = await GET();
  const json = await res.json();
  expect(json.releaseStates).toHaveLength(1);
  expect(json.checkinIntervalDays).toBe(30);
  expect(json.isDemo).toBe(true);
});

it('config PUT 400 on unknown trigger type', async () => {
  const res = await PUT(makeReq({ required_confirmations: 2 }), { params: Promise.resolve({ id: 'bogus' }) });
  expect(res.status).toBe(400);
  expect(mockSetN).not.toHaveBeenCalled();
});

it('config PUT sets N against the count of verifiers who can actually answer (M)', async () => {
  rosterReturns([eligible('v-1'), eligible('v-2'), eligible('v-3')]);
  mockSetN.mockResolvedValueOnce({ required_confirmations: 2 } as never);
  const res = await PUT(makeReq({ required_confirmations: 2 }), { params: Promise.resolve({ id: 'emergency' }) });
  expect(res.status).toBe(200);
  expect(mockSetN).toHaveBeenCalledWith('owner-1', 'emergency', 2, 3);
  expect((await res.json()).verifier_count).toBe(3);
});

it('config PUT refuses an N nobody could ever reach, and never writes it', async () => {
  // The unsatisfiable quorum, caught at configuration time. Previously this
  // would have been written and then discovered as a release that silently
  // never completed.
  rosterReturns([eligible('v-1')]);
  const res = await PUT(makeReq({ required_confirmations: 5 }), { params: Promise.resolve({ id: 'emergency' }) });
  expect(res.status).toBe(400);
  expect(mockSetN).not.toHaveBeenCalled();
});

it('does not count a verifier who is also a recipient on this release', async () => {
  // Separation of duties: nobody helps authorize their own access.
  rosterReturns(
    [{ id: 'v-1', claimed_user_id: 'user-1', standby_state: 'confirmed' }, eligible('v-2')],
    [{ claimed_user_id: 'user-1' }],
  );
  const res = await PUT(makeReq({ required_confirmations: 2 }), { params: Promise.resolve({ id: 'emergency' }) });
  expect(res.status).toBe(400);
  expect(mockSetN).not.toHaveBeenCalled();
});

it('config PUT does not count verifiers the owner has never verified', async () => {
  // §4.3, tightened 2026-08-12. Three people are named and none has been
  // checked, so N=2 is refused: their answers would be recorded and would move
  // nothing. Before the tightening this was accepted and the shortfall only
  // showed up as a release that quietly never completed.
  rosterReturns([unverified('v-1'), unverified('v-2'), unverified('v-3')]);
  const res = await PUT(makeReq({ required_confirmations: 2 }), { params: Promise.resolve({ id: 'emergency' }) });
  expect(res.status).toBe(400);
  expect(mockSetN).not.toHaveBeenCalled();
});
