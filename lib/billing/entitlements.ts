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

/**
 * The one page in the product where a free owner can start paying.
 *
 * 🔴 THE ITEM CAP SAID "Upgrade" AND NAMED NOWHERE, and that word had been
 * wrong twice over. Its two siblings below carry the reason in their own
 * comments — *"'Upgrade' would be a lie until checkout exists — there is
 * nowhere to upgrade to"* — and when checkout did ship on 2026-08-08 the item
 * cap was the message nobody revisited, because it had been using the word
 * since before there was anything to point at.
 *
 * The gap was real and total. `POST /api/stripe/checkout` has exactly two
 * callers: the price card on `/start`, and the buy-intent branch of signup.
 * `/account` offers only "Manage or cancel subscription", which answers *"There
 * is no subscription on this account yet."* to the free owner reading it. So an
 * owner who filled their vault — the moment of most demonstrated value in the
 * product — was told to do something no screen they could reach would let them
 * do.
 *
 * Exported rather than inlined so a screen can render it as a link instead of
 * re-typing a path, and so a rename breaks one definition rather than leaking a
 * 404 into an error message. `entitlements.test.ts` asserts the route it names
 * actually exists, because a message pointing at a dead end is worse than one
 * pointing nowhere: it looks like a way out.
 */
export const UPGRADE_PATH = '/start';

export const TIER_LIMITS: Record<
  Tier,
  { items: number; recipients: number; verifiers: number; canRelease: boolean }
> = {
  // RECIPIENTS RAISED 1 → 4 for beta (2026-08-08). At one recipient a family
  // with two adult children could not name them both — and there is no checkout
  // to upgrade through, so the cap was not a paywall, it was a wall. Four covers
  // the realistic caregiver case (two siblings, a spouse, an executor) without
  // becoming an unlimited free tier.
  //
  // ~~canRelease stays false and stays UNWIRED. Nothing calls
  // assertCanRelease.~~ STALE IN BOTH HALVES, corrected 2026-08-13 by the
  // pre-release audit. The flag is `true`, and the call site has existed since
  // checkout shipped: lib/release/triggers.ts:125. A comment describing a
  // capability as dead code, sitting directly above the live value that
  // contradicts it, is worse than no comment — it is the one a reader trusts.
  //
  // canRelease is TRUE on free during beta, and this is a deliberate, dated
  // decision rather than an oversight. Founding families are being onboarded by
  // hand and will not have paid; enforcing the paywall now would mean the beta
  // cannot exercise the one feature the product exists for. Checkout is wired
  // and assertCanRelease is called on the release path, so flipping this to
  // false is the single line that turns enforcement on — and the path is
  // already live and tested rather than dead code discovered later.
  //
  // FLIP TO false WHEN BETA ENDS — reviewed at every /daily-priority from
  // 2026-10-01, owner Steve, recorded in PROJECT.yaml: ratified.beta-free-release.
  // A temporary flag with no date and no owner is simply a permanent flag that
  // nobody has admitted to yet, which is why the review is written down rather
  // than left to whoever next reads this line. Flipping it also turns
  // lib/billing/entitlements.test.ts's skipped case back on and makes
  // lib/billing/beta-flag.test.ts demand the guide be corrected in the same
  // change — the promise in §2.7 stops being true the moment this moves.
  //
  // VERIFIERS WERE UNCAPPED UNTIL 2026-08-13, and unlike the other two that was
  // never a decision — the key simply did not exist. Recipients were capped the
  // day the tier was written; verifiers, created through a route that sends mail
  // on their behalf, were not. Four for the same reason recipients are four: a
  // realistic circle is a spouse, a sibling, a doctor and a friend, and N-of-M
  // quorums in this product run at one or two. It also bounds how many addresses
  // one free account can introduce into the outbound path — see
  // lib/notify/invite-budget.ts, which bounds how often.
  free: { items: 10, recipients: 4, verifiers: 4, canRelease: true },
  paid: {
    items: Number.POSITIVE_INFINITY,
    recipients: Number.POSITIVE_INFINITY,
    verifiers: Number.POSITIVE_INFINITY,
    canRelease: true,
  },
};

/**
 * The marker that says "this plan was given, not bought".
 *
 * 🔴 A COMP MUST NEVER LOOK LIKE REVENUE. This portfolio's central
 * discipline is arms-length revenue evidence — PROJECT.yaml records
 * wtp_evidence as `none` and treats one self-purchased subscription as
 * advancing nothing. A founding family granted the paid tier by hand writes a
 * row that is, structurally, indistinguishable from a customer: same table,
 * same tier, same active status. Counting it once would corrupt the single
 * number the G1 gate rests on, and it would do so silently, months later, in a
 * report nobody re-derives.
 *
 * So a comp is marked twice and unmistakably: `cohort = COMP_COHORT`, and
 * `price_cents = 0`. Any revenue read excludes both. One definition, here,
 * because two spellings of this marker is how the corruption happens anyway.
 */
export const COMP_COHORT = 'founding-comp';

/**
 * What a comp becomes when the family behind it actually pays.
 *
 * 🔴 THE GUARD ONLY RAN IN ONE DIRECTION UNTIL 2026-08-21.
 * `scripts/grant-founding-tier.ts` refuses to overwrite a row carrying Stripe
 * identifiers, so a customer can never be turned into a comp. Nothing handled
 * the reverse: the webhook's UPDATE path wrote tier, status, the Stripe ids and
 * the period end and touched NEITHER marker, so a comped row that later took a
 * real annual subscription kept `cohort = founding-comp` and `price_cents = 0`
 * forever. `isComped` answers true on either marker by design — that is what
 * makes losing one insufficient to hide a gift — and here it would have hidden
 * a sale.
 *
 * The conversion this affects is not an edge case. A hand-onboarded founding
 * family deciding, at arm's length, to pay is exactly the evidence
 * `g1-arms-length-demand` is waiting for, and the one payment the product most
 * wants to count would have been excluded from every revenue read, silently and
 * months later.
 *
 * NOT null, and not the absence of a cohort. "Was given this, then chose to buy
 * it" is a different and more interesting fact than "was always a customer",
 * and erasing it to make a query simpler would throw away the evidence. It is
 * simply not a COMP marker, which is all `isComped` asks.
 */
export const CONVERTED_FROM_COMP_COHORT = 'converted-from-comp';

/** True when this subscription row was granted by hand rather than paid for. */
export function isComped(row: { cohort?: string | null; price_cents?: number | null }): boolean {
  return row.cohort === COMP_COHORT || row.price_cents === 0;
}

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
  table: 'vault_items' | 'recipients' | 'verifiers',
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
  return assertBatchWithinItemCap(ownerId, 1);
}

/**
 * The same cap, for a batch.
 *
 * 🔴 CSV IMPORT BYPASSED THE ITEM CAP ENTIRELY until 2026-08-13. `POST /api/import`
 * never called `assertWithinItemCap`, so the free tier's 10-item limit held only
 * on the one-at-a-time path — and the bulk path is the one the product actively
 * recommends ("Import CSV takes an export from a password manager, which is how
 * most people should start"). A free account could import a thousand items in a
 * single request. Found by reading the manual against the routes.
 *
 * A per-item guard would not have caught it either: `assertWithinItemCap` only
 * asks whether the owner is ALREADY at the limit, so calling it once before a
 * 500-row batch still admits all 500. The count has to be part of the question,
 * which is why the single-item helper now delegates here rather than the other
 * way round — one definition of the rule, and the batch case cannot drift from
 * the single case because there is only one.
 *
 * Refuses the whole batch rather than truncating it. Import is already
 * all-or-nothing (Req 10.4), and silently keeping the first 10 rows of somebody's
 * password-manager export would leave them believing a vault is complete when it
 * is not — the exact failure this product exists to prevent.
 */
export async function assertBatchWithinItemCap(ownerId: string, count: number): Promise<void> {
  const { tier } = await getEntitlement(ownerId);
  const limit = TIER_LIMITS[tier].items;
  if (!Number.isFinite(limit)) return;

  const existing = await countOwned('vault_items', ownerId);
  if (existing + count <= limit) return;

  const room = Math.max(0, limit - existing);
  throw new EntitlementError(
    count === 1
      ? // Names the page, not the abstraction. See UPGRADE_PATH above for why
        // the bare word "Upgrade" was the wrong instruction for two years'
        // worth of reasons and one that outlived them.
        `The free plan holds ${limit} items. Nothing you have already saved is affected — ` +
        `to add more, start a plan at ${UPGRADE_PATH}, or email us: we are onboarding ` +
        `founding families by hand.`
      : `The free plan holds ${limit} items and you have ${existing}, so there is room for ` +
        `${room === 1 ? '1 more' : `${room} more`} — this file has ${count}. ` +
        `Nothing was imported. Trim the file, or email us: we are onboarding founding families by hand.`,
    limit,
    tier,
  );
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

/**
 * The same ceiling, for verifiers.
 *
 * 🔴 THERE WAS NO CEILING AT ALL until 2026-08-13. `TIER_LIMITS` had no
 * `verifiers` key, so `POST /api/verifiers` — which is rate-limited by nothing
 * and calls `inviteOnCreateBestEffort` on success — would accept an unbounded
 * number of named people on a free, self-serve account. Recipients had been
 * capped since the tier was written; verifiers were simply never added, which is
 * how an omission outlives every decision made around it.
 *
 * The cap is about two things at once and both matter: a free plan that is a
 * plan, and a bound on how many addresses one account can introduce into the
 * outbound mail path on a sender shared with another project.
 */
export async function assertWithinVerifierCap(ownerId: string): Promise<void> {
  const { tier } = await getEntitlement(ownerId);
  const limit = TIER_LIMITS[tier].verifiers;
  if (!Number.isFinite(limit)) return;

  if ((await countOwned('verifiers', ownerId)) >= limit) {
    throw new EntitlementError(
      // Worded like the recipient cap deliberately: same shape of limit, same
      // route to a human, so an owner who hits both is not told two stories.
      `The free plan allows ${limit} trusted contact${limit === 1 ? '' : 's'} to confirm an ` +
        'emergency. Email us if you need more — we are onboarding founding families by hand.',
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
