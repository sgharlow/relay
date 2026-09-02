/**
 * No branch on the lapse-notice path may answer 200 and say nothing.
 *
 * 🔴 WHY, FOUND 2026-09-02. E1′ — "the lapse notice records nothing" — has been
 * open since 2026-08-21 on a premise that was never true. The register's words:
 *
 *   "Every branch out of `sendOnce` writes a row, so this is not a state the
 *    source can produce."
 *
 * It is a state the source can produce, in THREE places, all of which answer
 * `{received:true}` while writing no audit row:
 *
 *   1. `sendOnce`'s FIRST branch — the dedupe returning `'duplicate'`. It
 *      returns before any other work and, until today, wrote and logged nothing.
 *   2. `if (!subId || !invoice.id) break` in the webhook's
 *      `invoice.payment_failed` case.
 *   3. `if (!ownerId) break` in the same case.
 *
 * (2) is documented as having ALREADY HAPPENED once, when the subscription id
 * moved under `parent` — the fix widened the reader and left the silence in
 * place, so the next cause of the same symptom was indistinguishable from it.
 *
 * The stale-module theory that six deliveries were spent chasing was built on
 * the false premise. This test does not claim which branch fired on any run —
 * the evidence does not settle that. It makes the question answerable next time
 * by refusing a silent exit on this path.
 *
 * ⚠️ WHY SOURCE-LEVEL. The behaviour needs a signed Stripe delivery against a
 * production build to exercise, which is `npm run verify:e1-route3` and costs a
 * real webhook. A structural check runs on every commit instead, and catches
 * the thing that actually recurs: somebody adding a fourth early return.
 *
 * Feature: relay-h0-mvp
 * Requirements: E1.2, E1′
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const NOTICE = readFileSync('lib/billing/lapse-notice.ts', 'utf8');
const WEBHOOK = readFileSync('src/app/api/stripe/webhook/route.ts', 'utf8');

/** The `invoice.payment_failed` case body, which is the path in question. */
function paymentFailedCase(): string {
  const from = WEBHOOK.indexOf("case 'invoice.payment_failed':");
  expect(from, "the webhook no longer has an invoice.payment_failed case this can read").toBeGreaterThan(-1);
  const rest = WEBHOOK.slice(from);
  /*
    ⚠️ The next sibling is `default:`, NOT another `case '…'`. The first version
    of this looked only for `case '` and fell through to a 4000-character slice
    that swallowed the default block and its breaks — reporting silent exits
    that belong to other cases. A boundary that misses makes a guard accuse the
    wrong code, which is worse than one that does not run.
  */
  const ends = [rest.indexOf("\n      case '"), rest.indexOf('\n      default:')].filter((i) => i > 0);
  expect(ends.length, 'cannot find the end of the invoice.payment_failed case').toBeGreaterThan(0);
  return rest.slice(0, Math.min(...ends));
}

describe('the lapse-notice path has no silent exit', () => {
  it('the dedupe branch says so instead of returning in silence', () => {
    // The branch that produced the symptom the register called impossible.
    const idx = NOTICE.indexOf('noticeAlreadySent(ownerId, action, stripeId)');
    expect(idx, 'the dedupe call has moved or been renamed').toBeGreaterThan(-1);
    const branch = NOTICE.slice(idx, idx + 1800);
    expect(
      /process\.stderr\.write|console\.(error|warn)/.test(branch),
      "sendOnce's duplicate branch returns without writing an audit row — deliberately, since an " +
        'entry per refused duplicate would let a replayed event grow an owner\'s tamper-evident ' +
        'log. That makes a LOG the only trace it can leave, and it must leave one.',
    ).toBe(true);
  });

  it('🔴 every early exit in the invoice.payment_failed case explains itself', () => {
    /*
      The one that matters. A bare `break` here is a clean 200 in Stripe's
      dashboard for an event that told nobody anything — and this exact failure
      is already recorded as having happened once.
    */
    const body = paymentFailedCase();
    const breaks = [...body.matchAll(/\n\s*(?:\/\/[^\n]*\n\s*)?break;/g)];
    expect(breaks.length, 'no break statements found — the case shape has changed').toBeGreaterThan(0);

    // Every break except the final fall-through must be preceded by a log.
    const segments = body.split(/\bbreak;/).slice(0, -1);
    const silent = segments.filter((seg) => !/console\.(error|warn)|process\.stderr\.write/.test(seg.slice(-700)));
    expect(
      silent.length,
      'An early exit in invoice.payment_failed writes no audit row AND logs nothing, so it ' +
        'answers {received:true} for an event that told nobody their renewal failed. Name the ' +
        'precondition that failed before breaking — see the case comment.',
    ).toBeLessThanOrEqual(1);
  });

  it('the guards themselves are unchanged — this pins observability, not behaviour', () => {
    // Deduping and refusing an unresolvable invoice are both CORRECT. This file
    // exists so they are correct out loud; it must not be read as licence to
    // remove them.
    const body = paymentFailedCase();
    expect(body).toContain('subscriptionIdOnInvoice(invoice)');
    expect(body).toContain('ownerIdForSubscriptionId(subId)');
    expect(NOTICE).toContain("return 'duplicate'");
  });
});
