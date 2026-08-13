/**
 * Tests for the recovery-code count.
 *
 * `remainingRecoveryCodes` was written, tested and called by nothing, so an
 * owner could not find out how many were left — a SILENT CLIFF, since codes are
 * consumed one per use and are the only way back when the authenticator is gone.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('../../../../../lib/http/owner-route', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../../lib/http/owner-route');
  return { ...actual, requireOwner: vi.fn(async () => ({ ownerId: 'o-1' })) };
});
vi.mock('../../../../../lib/auth/recovery-code', () => ({
  issueRecoveryCodes: vi.fn(async () => ['a', 'b']),
  formatRecoveryCode: vi.fn((c: string) => c),
  remainingRecoveryCodes: vi.fn(async () => 3),
}));
vi.mock('../../../../../lib/audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { requireOwner } from '../../../../../lib/http/owner-route';
import { remainingRecoveryCodes } from '../../../../../lib/auth/recovery-code';
import { GET } from './route';

const mockRemaining = vi.mocked(remainingRecoveryCodes);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({ ownerId: 'o-1' } as never);
  mockRemaining.mockResolvedValue(3);
});

describe('GET', () => {
  it('answers how many are left', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ remaining: 3 });
    expect(mockRemaining).toHaveBeenCalledWith('o-1');
  });

  it('reports zero honestly rather than hiding it', async () => {
    // Zero is the state most worth surfacing: the next lost phone is permanent.
    mockRemaining.mockResolvedValueOnce(0);
    expect(await (await GET()).json()).toEqual({ remaining: 0 });
  });

  it('🔴 returns a COUNT and never a code', async () => {
    // Codes are stored as hashes and readable exactly once, at issue. A count
    // endpoint that leaked one would undo that.
    const body = JSON.stringify(await (await GET()).json());
    expect(Object.keys(JSON.parse(body))).toEqual(['remaining']);
  });

  it('refuses without an owner session', async () => {
    vi.mocked(requireOwner).mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as never,
    );
    expect((await GET()).status).toBe(401);
    expect(mockRemaining).not.toHaveBeenCalled();
  });
});
