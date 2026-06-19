/**
 * Unit tests for getOwnerSession() helper (lib/auth/session.ts).
 *
 * Tests:
 *  - Returns {ownerId, isDemo} when a valid session exists
 *  - Throws 401 NextResponse when session is null
 *  - Throws 401 NextResponse when session is missing ownerId
 *  - Throws 401 NextResponse when session has wrong ownerId type
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock next-auth/next before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from 'next-auth/next';
import { getOwnerSession } from './session';

const mockGetServerSession = vi.mocked(getServerSession);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_SECRET = 'test-secret-32-chars-long-enough!!';
});

afterEach(() => {
  delete process.env.NEXTAUTH_SECRET;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getOwnerSession', () => {
  it('returns ownerId and isDemo when a valid session is present', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      ownerId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      isDemo: false,
      user: { email: 'owner@example.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await getOwnerSession();

    expect(result).toEqual({
      ownerId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      isDemo: false,
    });
  });

  it('returns isDemo=true for demo accounts', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      ownerId: 'aabbccdd-1234-5678-abcd-000000000001',
      isDemo: true,
      user: { email: 'demo@example.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await getOwnerSession();
    expect(result.isDemo).toBe(true);
  });

  it('throws with status 401 when session is null', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    let thrown: unknown;
    try {
      await getOwnerSession();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    // The thrown value is a NextResponse — check its status property
    expect((thrown as Response).status).toBe(401);
  });

  it('throws with status 401 when ownerId is missing from session', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      // ownerId intentionally omitted
      isDemo: false,
      user: { email: 'partial@example.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    let thrown: unknown;
    try {
      await getOwnerSession();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as Response).status).toBe(401);
  });

  it('throws with status 401 when ownerId is an empty string', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      ownerId: '',
      isDemo: false,
      user: { email: 'empty@example.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    let thrown: unknown;
    try {
      await getOwnerSession();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as Response).status).toBe(401);
  });

  it('throws with status 401 when ownerId is not a string', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      ownerId: 12345, // wrong type
      isDemo: false,
      user: { email: 'bad@example.com' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    let thrown: unknown;
    try {
      await getOwnerSession();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as Response).status).toBe(401);
  });
});
