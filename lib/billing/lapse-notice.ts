/**
 * Telling an owner that their renewal failed, and telling them once.
 *
 * 🔴 THE GAP. `src/app/api/stripe/webhook/route.ts` handles
 * `checkout.session.completed` and `customer.subscription.updated/deleted`, and
 * `invoice.payment_failed` is not handled at all. When a subscription finally
 * lapses the handler writes an audit entry and sends NO MAIL. So the sequence a
 * real customer experiences is: a card expires, Stripe retries for about three
 * weeks, the subscription is cancelled, the tier drops — and the first the owner
 * hears of it is whenever they next look.
 *
 * ⚠️ STATED PRECISELY, BECAUSE THE FIRST DRAFT OF THIS FINDING WAS WRONG ABOUT
 * THE HALF THAT MATTERS: `ACTIVE_STATUSES` already INCLUDES `past_due`, so a
 * failed renewal does NOT revoke access during Stripe's retry window. That is
 * correct and deliberate, and it is why this module is about NOTIFICATION rather
 * than about entitlement. Nothing here changes who can do what.
 *
 * WHY IT IS DATED. `TIER_LIMITS.free.canRelease` is one line from `false`
 * (`ratified.beta-free-release`, revisit 2026-10-01). The moment it flips, an
 * expired card becomes a BLOCKED RELEASE — the one thing the product exists to
 * do, stopped by a billing event nobody was told about. This has to be true
 * before that decision, not after it.
 *
 * ── ONCE PER INVOICE, AND THE RECORD IS THE DEDUPE ─────────────────────────
 *
 * Stripe retries a failed payment several times and re-delivers events on its
 * own schedule, so "handle it" is not the same as "tell them once". The audit
 * log is the dedupe: each notice writes an entry carrying the invoice id, and a
 * notice whose id is already recorded is not sent again. Same shape as
 * `lib/notify/invite-budget.ts`, which meters invitation mail against
 * `audit_log` rather than against a new table — storage this product already
 * owns, and a record the OWNER can read in their own audit trail.
 *
 * `detail->>` is used to read the id back. That operator is already exercised
 * against Aurora DSQL in two live paths (`lib/access/closure.ts`,
 * `lib/notify/notifications.ts`), so it is proven here rather than assumed.
 *
 * ── THE ENTRY TELLS THE TRUTH ABOUT DELIVERY ───────────────────────────────
 *
 * The order is check → send → record, and the record carries whether the send
 * actually succeeded. Recording first would be cleaner for dedupe and would
 * write `notified` for mail that never left; recording only on success would
 * retry forever against a permanently bouncing address. So the entry is written
 * either way and says which happened — and a failed send is logged distinctly,
 * the way `lib/ops/error-reporter.ts` marks an undelivered alert, because a
 * notification nobody received is exactly the kind of silence that reads as
 * health.
 *
 * Feature: relay-h0-mvp
 * Requirements: J1-R8, J5-R6
 */

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { sendEmailBestEffort } from '../notify/email';
import { appUrl } from '../notify/notifications';

/** One notice per failed invoice. */
export const RENEWAL_FAILED_ACTION = 'renewal_payment_failed_notice';

/** One notice per subscription that actually ended. */
export const SUBSCRIPTION_LAPSED_ACTION = 'subscription_lapsed_notice';

export type NoticeOutcome = 'sent' | 'undelivered' | 'duplicate' | 'no-address';

/**
 * Has this exact notice already gone out?
 *
 * Keyed on the Stripe object id rather than on time, because Stripe's retry
 * schedule is its own business and a time window would either double-send on a
 * slow retry or suppress a genuinely new failure on a fast one.
 */
export async function noticeAlreadySent(
  ownerId: string,
  action: string,
  stripeId: string,
): Promise<boolean> {
  const r = await query<{ n: string }>(
    `SELECT count(*) AS n FROM audit_log
      WHERE owner_id = $1 AND action = $2 AND detail->>'stripe_id' = $3`,
    [ownerId, action, stripeId],
  );
  return Number(r.rows[0]?.n ?? 0) > 0;
}

async function ownerEmail(ownerId: string): Promise<string | null> {
  const r = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [
    ownerId,
  ]);
  return r.rows[0]?.email ?? null;
}

/**
 * The one shape both notices share: dedupe, send, record what happened.
 *
 * Exported for the tests, which need to prove the ordering rather than infer it.
 */
export async function sendOnce(params: {
  ownerId: string;
  action: string;
  stripeId: string;
  subject: string;
  text: string;
}): Promise<NoticeOutcome> {
  const { ownerId, action, stripeId, subject, text } = params;

  if (await noticeAlreadySent(ownerId, action, stripeId)) return 'duplicate';

  const to = await ownerEmail(ownerId);
  if (!to) {
    /*
      No address is not a failure to retry — it is a fact about the account, and
      an unrecorded one would make every later redelivery try again. Recorded so
      the dedupe holds and so the gap is visible in the owner's own trail.
    */
    await writeAuditEntry(ownerId, {
      actor: 'system',
      action,
      entity: 'subscription',
      detail: { source: 'stripe', stripe_id: stripeId, delivered: false, reason: 'no_address' },
    });
    return 'no-address';
  }

  const delivered = await sendEmailBestEffort({ to, subject, text });

  if (!delivered) {
    try {
      process.stderr.write(
        `[billing] NOTICE NOT DELIVERED (${action}) for ${stripeId} — the owner has not been ` +
          'told their renewal failed.\n',
      );
    } catch {
      /* a broken stderr must not escalate a handled failure */
    }
  }

  await writeAuditEntry(ownerId, {
    actor: 'system',
    action,
    entity: 'subscription',
    detail: { source: 'stripe', stripe_id: stripeId, delivered },
  });

  return delivered ? 'sent' : 'undelivered';
}

/**
 * A renewal charge failed and Stripe will keep trying.
 *
 * The tone is deliberate: nothing has been lost, nothing has closed, and the
 * fix is one link. An email that reads like a threat about an account somebody
 * set up FOR AN EMERGENCY is the wrong instrument — and it would also be
 * factually wrong, because `past_due` is inside `ACTIVE_STATUSES`.
 */
export async function notifyRenewalFailed(params: {
  ownerId: string;
  invoiceId: string;
}): Promise<NoticeOutcome> {
  return sendOnce({
    ownerId: params.ownerId,
    action: RENEWAL_FAILED_ACTION,
    stripeId: params.invoiceId,
    subject: 'Relay could not renew your plan',
    text:
      `A payment for your Relay subscription did not go through.\n\n` +
      `NOTHING HAS CHANGED YET. Your plan is still active, your vault is untouched, and everyone ` +
      `you named can still be reached the way you arranged. Your bank will usually be retried ` +
      `automatically over the next couple of weeks.\n\n` +
      `If the card has expired or been replaced, you can update it here:\n` +
      `  ${appUrl()}/account\n\n` +
      `We will write again only if it stops retrying, so this is not something you need to ` +
      `watch.\n`,
  });
}

/**
 * The subscription actually ended.
 *
 * ⚠️ THE DATA SENTENCE IS THE POINT OF THIS MESSAGE, and it must match what the
 * code actually does rather than what feels reassuring. `assertCanAddItems`
 * gates ADDING only, so nothing is deleted on a lapse — see
 * `PROJECT.yaml → deferred → the-post-lapse-state-is-undefined` and the /terms
 * sentence it produced. If that behaviour ever changes, this copy changes in the
 * same commit; `lib/ops/lapse-notice-matches-terms.test.ts` holds them together.
 */
export async function notifySubscriptionLapsed(params: {
  ownerId: string;
  subscriptionId: string;
}): Promise<NoticeOutcome> {
  return sendOnce({
    ownerId: params.ownerId,
    action: SUBSCRIPTION_LAPSED_ACTION,
    stripeId: params.subscriptionId,
    subject: 'Your Relay plan has ended',
    text:
      `Your Relay subscription has ended and your account is back on the free plan.\n\n` +
      `YOUR VAULT IS STILL THERE. Nothing has been deleted, nothing has been locked, and the ` +
      `people you named are still named. What the free plan changes is what you can ADD — it ` +
      `holds fewer items than a paid plan, so you may not be able to add new ones until you ` +
      `either remove some or start a plan again.\n\n` +
      `Start again whenever you like:\n` +
      `  ${appUrl()}/account\n\n` +
      `If you would rather keep a copy of everything outside Relay, the export on that page ` +
      `decrypts your whole vault in your own browser and writes it to a file you keep.\n`,
  });
}
