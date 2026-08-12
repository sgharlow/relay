/**
 * Tests for post-sign-in landing.
 *
 * THE DEFECT, seen on production 2026-08-12: the passkey button redirected to a
 * hardcoded '/start', so a standby contact who signed in with the passkey they
 * had just enrolled landed on "Start your vault" inside the owner shell. The
 * email-and-code form hardcoded '/vault'. Two sign-in paths, two guesses, and
 * neither asked who the person was.
 *
 * The both-hats ordering is the case worth pinning: §3.7 allows one human to
 * own a vault and stand by for others, and a test is the only thing stopping
 * that precedence from being silently reversed later.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R10, 17.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('./standby-resolve', () => ({ resolveStandbyFor: vi.fn() }));

import { query } from '../db/connection';
import { resolveStandbyFor } from './standby-resolve';
import { resolveLanding } from './landing';

const mockQuery = vi.mocked(query);
const mockResolve = vi.mocked(resolveStandbyFor);

/** Only the fields resolveLanding reads; the full shape is tested elsewhere. */
function standing(n: number) {
  return {
    relationships: Array.from({ length: n }, () => ({}) as never),
    anythingOpen: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockResolve.mockReset();
});

describe('resolveLanding', () => {
  it('sends an owner with a vault to owner mode', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '12' }], rowCount: 1 } as never);
    await expect(resolveLanding('u1')).resolves.toBe('/vault');
    // The membership lookup is not even reached — no vault, no question.
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('sends a standby-only contact to their standby page, not to onboarding', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }], rowCount: 1 } as never);
    mockResolve.mockResolvedValueOnce(standing(1) as never);
    await expect(resolveLanding('u2')).resolves.toBe('/standby');
  });

  it('prefers owner mode for someone who is BOTH — the §3.7 both-hats case', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '3' }], rowCount: 1 } as never);
    mockResolve.mockResolvedValueOnce(standing(2) as never);
    await expect(resolveLanding('u3')).resolves.toBe('/vault');
  });

  it('sends a genuinely new user to onboarding', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }], rowCount: 1 } as never);
    mockResolve.mockResolvedValueOnce(standing(0) as never);
    await expect(resolveLanding('u4')).resolves.toBe('/start');
  });

  it('treats a missing count row as no vault rather than throwing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    mockResolve.mockResolvedValueOnce(standing(1) as never);
    await expect(resolveLanding('u5')).resolves.toBe('/standby');
  });
});
