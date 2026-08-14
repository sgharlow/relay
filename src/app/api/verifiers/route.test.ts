/**
 * Tests for /api/verifiers (collection) and /api/verifiers/[id]
 *
 * Validates: Requirements 3.2, 3.7
 */

import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/people/verifiers', async (io) => {
  const actual = await io<typeof import('../../../../lib/people/verifiers')>();
  return { ...actual, listVerifiers: vi.fn(), createVerifier: vi.fn(), updateVerifier: vi.fn(), deleteVerifier: vi.fn() };
});

vi.mock('../../../../lib/billing/entitlements', async (io) => {
  const actual = await io<typeof import('../../../../lib/billing/entitlements')>();
  return { ...actual, assertWithinVerifierCap: vi.fn(async () => undefined) };
});

import { getOwnerSession } from '../../../../lib/auth/session';
import { createVerifier, deleteVerifier } from '../../../../lib/people/verifiers';
import { POST } from './route';
import { DELETE } from './[id]/route';

const mockSession = vi.mocked(getOwnerSession);
const mockCreate = vi.mocked(createVerifier);
const mockDelete = vi.mocked(deleteVerifier);

function makeReq(body?: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'owner-1', isDemo: false });
});

it('POST 400 on a bad email', async () => {
  const res = await POST(makeReq({ name: 'Dr Lee', email: 'not-an-email' }));
  expect(res.status).toBe(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST 201 on a valid verifier', async () => {
  mockCreate.mockResolvedValueOnce({ id: 'v1' } as never);
  const res = await POST(makeReq({ name: 'Dr Lee', email: 'lee@example.com' }));
  expect(res.status).toBe(201);
});

it('DELETE removes confirmations + verifier', async () => {
  mockDelete.mockResolvedValueOnce(undefined);
  const res = await DELETE(makeReq(), { params: Promise.resolve({ id: 'v1' }) });
  expect(res.status).toBe(200);
  expect(mockDelete).toHaveBeenCalledWith('owner-1', 'v1');
});

/**
 * 🔴 THE VERIFIER CAP DID NOT EXIST until 2026-08-13, while its sibling route
 * `/api/recipients` had carried one since the tier was written. This route names
 * a person AND hands their address to the outbound mail path, so an uncapped
 * free account could introduce unlimited addresses to a sender shared with
 * another project.
 */
it('POST 402 when the free-tier verifier cap is reached', async () => {
  const { assertWithinVerifierCap, EntitlementError } = await import(
    '../../../../lib/billing/entitlements'
  );
  vi.mocked(assertWithinVerifierCap).mockRejectedValueOnce(
    new EntitlementError('The free plan allows 4 trusted contacts.', 4, 'free'),
  );

  const res = await POST(makeReq({ name: 'Dr Lee', email: 'lee@example.com' }));

  expect(res.status).toBe(402);
  // Refused BEFORE the row is written — a capped account must not accumulate
  // people it was told it could not add.
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST 400 on a name that is not a name', async () => {
  // Bounded and single-lined because it reaches an email body; the owner's
  // display name reaches the subject. See lib/validation.ts cleanPersonName.
  const res = await POST(makeReq({ name: 'x'.repeat(200), email: 'lee@example.com' }));
  expect(res.status).toBe(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST collapses a newline in a contact name rather than storing it', async () => {
  mockCreate.mockResolvedValueOnce({ id: 'v1' } as never);
  await POST(
    makeReq({ name: ['Dr Lee', 'Bcc: someone@example.com'].join('\n'), email: 'lee@example.com' }),
  );

  expect(mockCreate).toHaveBeenCalled();
  const input = mockCreate.mock.calls[0][1] as { name: string };
  expect(input.name).not.toContain('\n');
  expect(input.name).toBe('Dr Lee Bcc: someone@example.com');
});
