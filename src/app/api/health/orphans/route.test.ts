/**
 * The fourth dead-man probe — rows the live walks leave behind.
 *
 * 🔴 THE STATUS CODE IS THE PRODUCT. A monitor reads the code, not the body. If
 * a cluster with a leaked walk account ever answered 200, the schedule D4 asked
 * for would exist and mean nothing — which is worse than not having it, because
 * a green probe is read as evidence.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4, CC9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/ops/orphan-health', () => ({
  getOrphanHealth: vi.fn(),
}));

import { getOrphanHealth } from '../../../../../lib/ops/orphan-health';
import { GET } from './route';

const mockHealth = vi.mocked(getOrphanHealth);

const CLEAN = {
  healthy: true,
  disposableAccounts: 0,
  staleDisposableAccounts: 0,
  heldDisposableAccounts: 0,
  oldestDisposableHours: null,
  maxAgeHours: 24,
  danglingRows: 28,
  danglingBaseline: 28,
  retainedRows: 3486,
  checkedAt: '2026-08-30T12:00:00.000Z',
};

const LEAKED = {
  ...CLEAN,
  healthy: false,
  disposableAccounts: 1,
  staleDisposableAccounts: 1,
  oldestDisposableHours: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHealth.mockResolvedValue(CLEAN as never);
});

describe('the code a monitor reads', () => {
  it('answers 200 when nothing has been left behind', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CLEAN);
  });

  it('answers 503 when a walk left an account on production', async () => {
    mockHealth.mockResolvedValueOnce(LEAKED as never);
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).staleDisposableAccounts).toBe(1);
  });

  it('leaves the healthy decision in the library rather than re-deciding it', async () => {
    // One definition of "healthy". A second opinion in the route is how a probe
    // and its own library come apart.
    mockHealth.mockResolvedValueOnce({ healthy: false } as never);
    expect((await GET()).status).toBe(503);
  });
});

describe('what an unauthenticated caller may see', () => {
  it('exposes no address, id or table name, even when unhealthy', async () => {
    mockHealth.mockResolvedValueOnce(LEAKED as never);
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toMatch(/@/);
    expect(body).not.toMatch(/verifier_codes|break_glass|relay-e2e/);
  });
});
