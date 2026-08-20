/**
 * A failed renewal reaches the owner, once, and the record says whether it did.
 *
 * 🔴 THE GAP THIS CLOSES. `invoice.payment_failed` was not a handled event, and
 * the final lapse wrote an audit entry and sent no mail. A card expires, Stripe
 * retries for about three weeks, the subscription ends — and the owner hears
 * nothing at any point.
 *
 * ⚠️ AND IT IS DATED. `TIER_LIMITS.free.canRelease` is one line from `false`
 * (`ratified.beta-free-release`, revisit 2026-10-01). After that flip an expired
 * card is a BLOCKED RELEASE — the one thing the product exists to do, stopped by
 * a billing event nobody was told about.
 *
 * THE THREE PROPERTIES WORTH PINNING, none of which is the wording:
 *
 *   1. ONCE PER INVOICE. Stripe retries and re-delivers; "handled" is not
 *      "told once". The audit log is the dedupe.
 *   2. THE RECORD TELLS THE TRUTH. A send that fails is still recorded, marked
 *      undelivered, rather than either lying or retrying forever.
 *   3. NOTHING IS SENT TO A RESERVED DOMAIN. `lib/notify/email.ts` refuses at
 *      the seam and these tests must not route around it.
 *
 * Feature: relay-h0-mvp
 * Requirements: J1-R8, J5-R6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));
vi.mock('../notify/email', () => ({ sendEmailBestEffort: vi.fn(async () => true) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { sendEmailBestEffort } from '../notify/email';
import {
  notifyRenewalFailed,
  notifySubscriptionLapsed,
  noticeAlreadySent,
  RENEWAL_FAILED_ACTION,
  SUBSCRIPTION_LAPSED_ACTION,
} from './lapse-notice';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);
const mockSend = vi.mocked(sendEmailBestEffort);

const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const INVOICE = 'in_1ABCDEF';
const SUB = 'sub_1ABCDEF';

/** count(*) for the dedupe probe, then the owner's address. */
function noPriorNotice(email: string | null = 'owner@example.org'): void {
  mockQuery.mockReset();
  mockQuery
    .mockResolvedValueOnce({ rows: [{ n: '0' }] } as never)
    .mockResolvedValueOnce({ rows: email ? [{ email }] : [] } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue(true);
});

describe('the owner is told', () => {
  it('sends on a failed renewal', async () => {
    noPriorNotice();
    expect(await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE })).toBe('sent');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('says nothing has changed yet, because nothing has', async () => {
    // past_due is inside ACTIVE_STATUSES. A message implying the plan has
    // stopped would be false, and frightening on an account somebody set up
    // for an emergency.
    noPriorNotice();
    await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE });
    const { text, subject } = mockSend.mock.calls[0]![0] as { text: string; subject: string };
    expect(text).toContain('NOTHING HAS CHANGED YET');
    expect(text).toMatch(/still active/i);
    expect(subject).not.toMatch(/urgent|suspend|closed/i);
  });

  it('gives the one link that fixes it', async () => {
    noPriorNotice();
    await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE });
    expect((mockSend.mock.calls[0]![0] as { text: string }).text).toContain('/account');
  });

  it('sends again when the subscription actually ends', async () => {
    noPriorNotice();
    expect(await notifySubscriptionLapsed({ ownerId: OWNER, subscriptionId: SUB })).toBe('sent');
    const { text } = mockSend.mock.calls[0]![0] as { text: string };
    expect(text).toContain('YOUR VAULT IS STILL THERE');
    expect(text).toMatch(/nothing has been deleted/i);
  });

  it('tells a lapsing owner about the export, which outlives the plan', async () => {
    noPriorNotice();
    await notifySubscriptionLapsed({ ownerId: OWNER, subscriptionId: SUB });
    expect((mockSend.mock.calls[0]![0] as { text: string }).text).toMatch(/export/i);
  });
});

describe('once per invoice, whatever Stripe does', () => {
  it('does not send when a notice for that invoice is already recorded', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '1' }] } as never);
    expect(await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE })).toBe('duplicate');
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('dedupes on the STRIPE ID, not on a time window', async () => {
    // A time window would double-send on a slow retry and suppress a genuinely
    // new failure on a fast one. Stripe's retry schedule is its own business.
    noPriorNotice();
    await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE });
    const [sql, params] = mockQuery.mock.calls[0]! as [string, unknown[]];
    expect(sql).toContain("detail->>'stripe_id'");
    expect(sql).not.toMatch(/INTERVAL/i);
    expect(params).toEqual([OWNER, RENEWAL_FAILED_ACTION, INVOICE]);
  });

  it('keeps the two notices in separate namespaces', async () => {
    // A lapse must not be suppressed because a payment-failure notice for the
    // same subscription already went out.
    expect(RENEWAL_FAILED_ACTION).not.toBe(SUBSCRIPTION_LAPSED_ACTION);
    noPriorNotice();
    await notifySubscriptionLapsed({ ownerId: OWNER, subscriptionId: SUB });
    expect((mockQuery.mock.calls[0]![1] as unknown[])[1]).toBe(SUBSCRIPTION_LAPSED_ACTION);
  });

  it('reports a prior notice through the exported probe', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '2' }] } as never);
    expect(await noticeAlreadySent(OWNER, RENEWAL_FAILED_ACTION, INVOICE)).toBe(true);
  });
});

describe('the record tells the truth about delivery', () => {
  it('marks a successful send delivered', async () => {
    noPriorNotice();
    await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE });
    const entry = mockAudit.mock.calls[0]![1] as { detail: Record<string, unknown> };
    expect(entry.detail.delivered).toBe(true);
    expect(entry.detail.stripe_id).toBe(INVOICE);
  });

  it('records an UNDELIVERED notice rather than lying or retrying forever', async () => {
    noPriorNotice();
    mockSend.mockResolvedValue(false);

    expect(await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE })).toBe('undelivered');

    const entry = mockAudit.mock.calls[0]![1] as { detail: Record<string, unknown> };
    expect(entry.detail.delivered).toBe(false);
  });

  it('leaves a distinct trace in the log when the notice did not arrive', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    noPriorNotice();
    mockSend.mockResolvedValue(false);

    await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE });

    const written = err.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('NOTICE NOT DELIVERED');
    err.mockRestore();
  });

  it('records, without sending, when the account has no address', async () => {
    noPriorNotice(null);
    expect(await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE })).toBe('no-address');
    expect(mockSend).not.toHaveBeenCalled();

    // Recorded anyway, or every redelivery would look the address up again.
    const entry = mockAudit.mock.calls[0]![1] as { detail: Record<string, unknown> };
    expect(entry.detail.reason).toBe('no_address');
    expect(entry.detail.delivered).toBe(false);
  });

  it('sends BEFORE it records, so the record can describe the outcome', async () => {
    noPriorNotice();
    const order: string[] = [];
    mockSend.mockImplementation(async () => {
      order.push('send');
      return true;
    });
    mockAudit.mockImplementation(async () => {
      order.push('audit');
      return {} as never;
    });

    await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE });
    expect(order).toEqual(['send', 'audit']);
  });
});

describe('the send seam is not routed around', () => {
  it('hands the address to sendEmailBestEffort rather than a raw provider call', async () => {
    // lib/notify/email.ts refuses reserved domains and refuses to send outside
    // production. Both guards live at that seam; a notice that bypassed it
    // would be the one path that could mail a .test address.
    noPriorNotice('owner@example.org');
    await notifyRenewalFailed({ ownerId: OWNER, invoiceId: INVOICE });
    expect((mockSend.mock.calls[0]![0] as { to: string }).to).toBe('owner@example.org');
  });
});

/**
 * The webhook actually calls it — asserted on the route, not on the module.
 *
 * This repository's most-repeated defect is a control that exists in a helper
 * while the caller does not use it (`body-limit.ts`, `step-up-guard.ts`,
 * `signin-is-throttled.test.ts` are all the sibling that closes it). Every test
 * above would stay green if the webhook stopped calling either notifier, and a
 * notice nobody triggers is the same as no notice.
 */
describe('the webhook calls both notices', () => {
  const route = readFileSync(
    join(process.cwd(), 'src/app/api/stripe/webhook/route.ts'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, ' ');

  it('handles invoice.payment_failed at all', () => {
    expect(route).toContain("case 'invoice.payment_failed'");
  });

  it('notifies on a failed renewal', () => {
    expect(route).toContain('notifyRenewalFailed(');
  });

  it('notifies on the final lapse, in the branch that records the cancellation', () => {
    expect(route).toContain('notifySubscriptionLapsed(');
    const at = route.indexOf('notifySubscriptionLapsed(');
    const before = route.slice(Math.max(0, at - 500), at);
    // Same `if (!active)` branch as the audit entry: the entry records that it
    // happened, the notice tells the person it happened to.
    expect(before).toContain('subscription_cancelled');
  });

  it('resolves the owner from the subscription id, since an invoice carries no metadata', () => {
    // `ownerIdFor` reads sub.metadata.owner_id, which an invoice payload does
    // not have. Reusing it would resolve null and silently notify nobody.
    expect(route).toContain('ownerIdForSubscriptionId(');
  });

  it('does not change entitlement from the payment-failed branch', () => {
    // past_due is inside ACTIVE_STATUSES deliberately. This branch is
    // notification only; upserting a tier here would revoke access during the
    // retry window that exists precisely so it is not revoked.
    const at = route.indexOf("case 'invoice.payment_failed'");
    const body = route.slice(at, route.indexOf('default:', at));
    expect(body).not.toContain('upsertSubscription(');
  });
});
