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
import { existsSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../db/connection', () => ({ query: vi.fn() }));

import { query } from '../db/connection';
import {
  TIER_LIMITS,
  UPGRADE_PATH,
  getEntitlement,
  assertWithinItemCap,
  assertBatchWithinItemCap,
  assertWithinRecipientCap,
  assertWithinVerifierCap,
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
  it('free is 10 items, 4 recipients, 4 verifiers, and CAN release during beta', () => {
    // Recipients raised from 1: a family with two adult children could not name
    // them both. canRelease is true by dated decision — founding families are
    // onboarded by hand and will not have paid, so enforcing the paywall now
    // would stop the beta exercising the one feature the product exists for.
    // Flipping it to false is what turns enforcement on; the call site is live.
    // Verifiers added 2026-08-13: the key did not exist, so the route that names
    // them — and mails them — had no cap at all while its sibling had one.
    expect(TIER_LIMITS.free).toEqual({ items: 10, recipients: 4, verifiers: 4, canRelease: true });
  });

  it('paid is unbounded and can release', () => {
    expect(TIER_LIMITS.paid.canRelease).toBe(true);
    expect(TIER_LIMITS.paid.items).toBe(Number.POSITIVE_INFINITY);
    expect(TIER_LIMITS.paid.recipients).toBe(Number.POSITIVE_INFINITY);
    expect(TIER_LIMITS.paid.verifiers).toBe(Number.POSITIVE_INFINITY);
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

  /*
    🔴 REGRESSION GUARD. `POST /api/import` never called this at all, so the free
    tier's cap held on the one-at-a-time path and not on the bulk one — the path
    the product recommends as the way to start. A per-item check would not have
    closed it either: asking only "is the owner ALREADY at the limit" admits a
    500-row batch to an empty vault. The count has to be part of the question.
  */
  it('REJECTS a batch that would cross the cap even from an empty vault', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
    await expect(assertBatchWithinItemCap('o-1', 500)).rejects.toThrow(EntitlementError);
  });

  it('names the room left and the file size, and says nothing was imported', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '8' }] } as never);
    await expect(assertBatchWithinItemCap('o-1', 12)).rejects.toThrow(
      /room for 2 more.*this file has 12.*Nothing was imported/s,
    );
  });

  it('allows a batch that exactly fills the cap', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '4' }] } as never);
    await expect(assertBatchWithinItemCap('o-1', 6)).resolves.toBeUndefined();
  });

  // A no-op import (every row a duplicate) must not be refused for a cap it
  // does not consume — the route checks AFTER dedupe for exactly this reason.
  it('allows a zero-length batch at the cap', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '10' }] } as never);
    await expect(assertBatchWithinItemCap('o-1', 0)).resolves.toBeUndefined();
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
  it.skip('blocks release on free (re-enable when the beta paywall is turned on)', async () => {
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

/**
 * Where a capped owner is sent.
 *
 * 🔴 THE ITEM CAP SAID "Upgrade" AND POINTED AT NOTHING. Its two siblings — the
 * recipient and verifier caps — deliberately say "Email us", with the reason
 * written above each of them: *"'Upgrade' would be a lie until checkout exists
 * — there is nowhere to upgrade to."* Checkout then shipped, and the item cap
 * was the one message that had been using the word all along, so it was never
 * revisited. It became the only cap in the product that names an action the
 * owner cannot take.
 *
 * And there was genuinely nowhere to go. `POST /api/stripe/checkout` has
 * exactly two callers — the price card on `/start` and the buy-intent branch of
 * signup — and `/account` offers only "Manage or cancel subscription", which
 * answers *"There is no subscription on this account yet."* to the free owner
 * reading it. So a free owner who filled their vault was told to upgrade, and
 * every surface they could reach either had no such control or denied one
 * existed.
 *
 * The message now names the one page that does take money, and the constant is
 * exported so a screen can link it rather than re-typing a path that could rot.
 */
describe('the item cap tells the owner where to actually pay', () => {
  function atTheCap() {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '10' }] } as never);
  }

  it('names a destination rather than an abstract "Upgrade"', async () => {
    atTheCap();
    const msg: string = await assertWithinItemCap('o-1').catch((e) => e.message);
    expect(msg).toContain(UPGRADE_PATH);
  });

  it('says the vault is untouched, because a cap is not a deletion', async () => {
    // The same sentence the lapse notice and /terms make. An owner meeting a
    // limit for the first time is being told what happens to what they already
    // stored, and that answer must not differ by surface.
    atTheCap();
    const msg: string = await assertWithinItemCap('o-1').catch((e) => e.message);
    expect(msg.toLowerCase()).toMatch(/nothing (you have )?(stored|saved) is|already (stored|saved)/);
  });

  /*
    THE PATH IS A ROUTE THIS APP SERVES, checked structurally rather than
    trusted. A message naming a 404 is worse than one naming nothing: it looks
    like a way out and is a dead end, and nothing about a string constant would
    fail if the route were renamed.
  */
  it('the upgrade path is a page that exists', () => {
    expect(existsSync(join('src/app/(owner)', UPGRADE_PATH, 'page.tsx'))).toBe(true);
  });

  /*
    The BATCH message keeps "email us" and does not name the path. A refused
    import is a different situation — the owner has a file too big for the plan
    and the useful next step is a conversation, not a checkout — and it already
    said so honestly.
  */
  it('leaves the import refusal pointing at a person', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '8' }] } as never);
    const msg: string = await assertBatchWithinItemCap('o-1', 12).catch((e) => e.message);
    expect(msg).toContain('email us');
  });
});

/**
 * The verifier cap, which was enforced by a function no test ran.
 *
 * 🔴 IT WAS COVERED ONLY BY MOCKS OF ITSELF. `src/app/api/verifiers/route.test.ts`
 * replaces `assertWithinVerifierCap` with `vi.fn()` in both directions — pass
 * and reject — so the route tests proved the route reacts to a 402 that a mock
 * invented, and `entitlements.test.ts` had blocks for items and recipients and
 * none for verifiers. The coverage report showed lines 223-243 unexecuted.
 *
 * That matters more here than the symmetry suggests: this cap is the only bound
 * on how many addresses one free, self-serve account can introduce into an
 * outbound mail path on a sender shared with another project, and the whole key
 * simply did not exist until 2026-08-13. An off-by-one here ships green.
 *
 * Mirrors the recipient block case for case, deliberately.
 */
describe('assertWithinVerifierCap', () => {
  it('allows the 4th verifier on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '3' }] } as never);
    await expect(assertWithinVerifierCap('o-1')).resolves.toBeUndefined();
  });

  it('REJECTS the 5th verifier on free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '4' }] } as never);
    await expect(assertWithinVerifierCap('o-1')).rejects.toThrow(EntitlementError);
  });

  it('carries the limit and tier on the error, so the route can answer 402 with it', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '4' }] } as never);
    const err = await assertWithinVerifierCap('o-1').catch((e: EntitlementError) => e);
    expect(err).toBeInstanceOf(EntitlementError);
    expect((err as EntitlementError).limit).toBe(TIER_LIMITS.free.verifiers);
    expect((err as EntitlementError).tier).toBe('free');
  });

  it('never caps a paid owner and does not even count', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [{ tier: 'paid' }] } as never);
    await expect(assertWithinVerifierCap('o-1')).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('counts only the requesting owner rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);
    await assertWithinVerifierCap('o-1');

    const [sql, params] = mockQuery.mock.calls[2];
    expect(sql).toMatch(/FROM verifiers WHERE owner_id = \$1/);
    expect(params).toEqual(['o-1']);
  });

  it('routes to a person, like the recipient cap, rather than promising an upgrade', async () => {
    // Both caps are about people rather than storage, and an owner who hits
    // both must not be told two different stories about what to do next.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_demo_account: false }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '4' }] } as never);
    const msg: string = await assertWithinVerifierCap('o-1').catch((e) => e.message);
    expect(msg).not.toContain('Upgrade');
    expect(msg).toContain('Email us');
  });
});
