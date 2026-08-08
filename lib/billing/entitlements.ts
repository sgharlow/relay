/**
 * Free-tier entitlement caps, enforced server-side.
 *
 * The free tier is the G1 on-ramp: enough vault to produce the risk-graph
 * reveal, not enough to be the product. Every cap is asserted inside the route
 * handler so it cannot be bypassed by calling the API directly — a cap enforced
 * only in the UI is a suggestion (J1-R7).
 *
 * No payment processor here. G4 (Stripe) stays gated behind G1/G2; this module
 * only reads a tier so the caps are enforceable now.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R7
 */

import { query } from '../db/connection';

/**
 * A cap breach is not malformed input — it is "this plan does not allow that".
 * A dedicated type also avoids the two-ValidationError problem: lib/vault and
 * lib/validation each define their own class, so an `instanceof` check in one
 * route silently misses the other's and returns 500 instead of a useful status.
 */
export class EntitlementError extends Error {
  constructor(
    message: string,
    public readonly limit: number,
    public readonly tier: Tier,
  ) {
    super(message);
    this.name = 'EntitlementError';
    Object.setPrototypeOf(this, EntitlementError.prototype);
  }
}

export type Tier = 'free' | 'paid';

export const TIER_LIMITS: Record<
  Tier,
  { items: number; recipients: number; canRelease: boolean }
> = {
  // RECIPIENTS RAISED 1 → 4 for beta (2026-08-08). At one recipient a family
  // with two adult children could not name them both — and there is no checkout
  // to upgrade through, so the cap was not a paywall, it was a wall. Four covers
  // the realistic caregiver case (two siblings, a spouse, an executor) without
  // becoming an unlimited free tier.
  //
  // canRelease stays false and stays UNWIRED. Nothing calls assertCanRelease,
  // and that dead code is currently load-bearing: connecting it before billing
  // exists would mean no account could ever release. Wire it in the same change
  // that ships checkout, not before.
  free: { items: 10, recipients: 4, canRelease: false },
  paid: {
    items: Number.POSITIVE_INFINITY,
    recipients: Number.POSITIVE_INFINITY,
    canRelease: true,
  },
};

export async function getEntitlement(ownerId: string): Promise<{ tier: Tier }> {
  // Demo accounts are not free-tier customers. The H0 demo vault holds 25
  // items; capping it at 10 would break the very flow the demo exists to show.
  const demo = await query<{ is_demo_account: boolean }>(
    `SELECT is_demo_account FROM users WHERE id = $1 LIMIT 1`,
    [ownerId],
  );
  if (demo.rows[0]?.is_demo_account) return { tier: 'paid' };

  const res = await query<{ tier: Tier }>(
    `SELECT tier FROM subscriptions
      WHERE owner_id = $1 AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1`,
    [ownerId],
  );

  return { tier: res.rows[0]?.tier ?? 'free' };
}

async function countOwned(
  table: 'vault_items' | 'recipients',
  ownerId: string,
): Promise<number> {
  // `table` is a closed union chosen by this module, never caller-supplied.
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE owner_id = $1`,
    [ownerId],
  );

  return Number(res.rows[0]?.count ?? '0');
}

export async function assertWithinItemCap(ownerId: string): Promise<void> {
  const { tier } = await getEntitlement(ownerId);
  const limit = TIER_LIMITS[tier].items;
  if (!Number.isFinite(limit)) return;

  if ((await countOwned('vault_items', ownerId)) >= limit) {
    throw new EntitlementError(
      `The free plan holds ${limit} items. Upgrade to add the rest of the vault.`,
      limit,
      tier,
    );
  }
}

export async function assertWithinRecipientCap(ownerId: string): Promise<void> {
  const { tier } = await getEntitlement(ownerId);
  const limit = TIER_LIMITS[tier].recipients;
  if (!Number.isFinite(limit)) return;

  if ((await countOwned('recipients', ownerId)) >= limit) {
    throw new EntitlementError(
      // "Upgrade" would be a lie until checkout exists — there is nowhere to
      // upgrade to. Say what is true and give them a way to reach a person.
      `The free plan allows ${limit} recipient${limit === 1 ? '' : 's'}. ` +
        `Email us if you need more — we are onboarding founding families by hand.`,
      limit,
      tier,
    );
  }
}

export async function assertCanRelease(ownerId: string): Promise<void> {
  const { tier } = await getEntitlement(ownerId);

  if (!TIER_LIMITS[tier].canRelease) {
    throw new EntitlementError('Releases require a paid plan.', 0, tier);
  }
}
