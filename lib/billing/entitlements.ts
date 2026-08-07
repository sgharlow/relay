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
  free: { items: 10, recipients: 1, canRelease: false },
  paid: {
    items: Number.POSITIVE_INFINITY,
    recipients: Number.POSITIVE_INFINITY,
    canRelease: true,
  },
};

export async function getEntitlement(ownerId: string): Promise<{ tier: Tier }> {
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
      `The free plan allows ${limit} recipient. Upgrade to designate more.`,
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
