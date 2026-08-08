/**
 * Tests for free-tier entitlement caps.
 *
 * Caps are asserted in the route handlers so they cannot be bypassed by calling
 * the API directly. A client-side cap is a suggestion (J1-R7).
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  TIER_LIMITS,
  getEntitlement,
  assertWithinItemCap,
  assertWithinRecipientCap,
  assertCanRelease,
  EntitlementError,
} from './entitlements';

const mockQuery = vi.mocked(query);

beforeEach(() => vi.clearAllMocks());

describe('EntitlementError', () => {
  it('is distinguishable from the two ValidationError classes in this repo', async () => {
    const vaultErr = await import('../vault/vault-items');
    const sharedErr = await import('../validation');
    const e = new EntitlementError('nope', 10, 'free');

    expect(e).toBeInstanceOf(EntitlementError);
    expect(e).not.toBeInstanceOf(vaultErr.ValidationError);
    expect(e).not.toBeInstanceOf(sharedErr.ValidationError);
    expect(e.name).toBe('EntitlementError');
    expect(e.limit).toBe(10);
    expect(e.tier).toBe('free');
  });
});

describe('TIER_LIMITS', () => {
  it('free is 10 items, 4 recipients, no release', () => {
    // Raised from 1 for beta: a family with two adult children could not name
    // them both, and with no checkout the cap was a wall rather than a paywall.
    expect(TIER_LIMITS.free).toEqual({ items: 10, recipients: 4, canRelease: false });
  });

  it('paid is unbounded and can release', () => {
    expect(TIER_LIMITS.paid.canRelease).toBe(true);
    expect(TIER_LIMITS.paid.items).toBe(Number.POSITIVE_INFINITY);
    expect(TIER_LIMITS.paid.recipients).toBe(Number.POSITIVE_INFINITY);
  });

  it('the free item cap leaves headroom over the 8-item seed', () => {
    expect(TIER_LIMITS.free.items).toBeGreaterThan(8);
  });
});

describe('getEntitlement', () => {
  it('defaults to free when no subscription row exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    await expect(getEntitlement('o-1')).resolves.toEqual({ tier: 'free' });
  });

  it('returns paid for an active subscription', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [{ tier: 'paid' }] } as never);
    await expect(getEntitlement('o-1')).resolves.toEqual({ tier: 'paid' });
  });

  it('treats a DEMO account as paid — the H0 demo vault holds 25 items', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ is_demo_account: true }] } as never);

    await expect(getEntitlement('o-1')).resolves.toEqual({ tier: 'paid' });
    // Short-circuits: never even looks at subscriptions.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('scopes the lookup to the owner and to active subscriptions', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    await getEntitlement('o-1');

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/owner_id\s*=\s*\$1/);
    expect(sql).toMatch(/status\s*=\s*'active'/i);
    expect(params).toEqual(['o-1']);
  });
});

describe('assertWithinItemCap', () => {
  it('allows the 10th item on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '9' }] } as never);
    await expect(assertWithinItemCap('o-1')).resolves.toBeUndefined();
  });

  it('REJECTS the 11th item on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '10' }] } as never);
    await expect(assertWithinItemCap('o-1')).rejects.toThrow(EntitlementError);
  });

  it('never caps a paid owner and does not even count', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [{ tier: 'paid' }] } as never);
    await expect(assertWithinItemCap('o-1')).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('counts only the requesting owner rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
    await assertWithinItemCap('o-1');

    const [sql, params] = mockQuery.mock.calls[2];
    expect(sql).toMatch(/FROM vault_items WHERE owner_id = \$1/);
    expect(params).toEqual(['o-1']);
  });
});

describe('assertWithinRecipientCap', () => {
  it('allows the first recipient on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
    await expect(assertWithinRecipientCap('o-1')).resolves.toBeUndefined();
  });

  it('ALLOWS a second recipient on free — two siblings is the normal case', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never);
    await expect(assertWithinRecipientCap('o-1')).resolves.toBeUndefined();
  });

  it('REJECTS the 5th recipient on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '4' }] } as never);
    await expect(assertWithinRecipientCap('o-1')).rejects.toThrow(EntitlementError);
  });

  it('does not promise an upgrade that does not exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '4' }] } as never);
    const msg = await assertWithinRecipientCap('o-1').catch((e) => e.message);
    expect(msg).not.toContain('Upgrade');
    expect(msg).toContain('Email us');
  });
});

describe('assertCanRelease', () => {
  it('blocks release on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    await expect(assertCanRelease('o-1')).rejects.toThrow(EntitlementError);
  });

  it('allows release on paid', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [{ tier: 'paid' }] } as never);
    await expect(assertCanRelease('o-1')).resolves.toBeUndefined();
  });
});
