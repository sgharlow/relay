/**
 * E1.2 / route 3 — does a failed renewal actually reach the owner?
 *
 * `docs/e1-stripe-lapse-proof.md §5` option 3: take Stripe's real
 * `invoice.payment_failed` event, put the LIVE subscription id on it, sign it
 * with a webhook secret and POST it at a LOCAL PRODUCTION BUILD. That proves the
 * route, the signature check, the owner lookup, the notice and the dedupe.
 *
 * ⚠️ IT DOES NOT PROVE `live-proven`, and the label matters more than usual here
 * because the register's bar for the paywall flip is exactly that word. What is
 * NOT exercised is the one link that has never been exercised: that Stripe's own
 * delivery carries a subscription id this handler can resolve. Record the result
 * as `wired + route-proven` and nothing more.
 *
 * 🔴 AND THE SPLICE IS MORE SYNTHETIC THAN §5 SAYS, found 2026-08-30 by looking.
 * §5 says "swap the subscription id for the live one". There is nothing to swap:
 *
 *   - live mode has ZERO `invoice.payment_failed` events, ever (the one
 *     subscription is active and renews 2027-08-09), and
 *   - the only test-mode one — from an old `stripe trigger` — carries
 *     `billing_reason: manual` and NO subscription reference in either the modern
 *     (`parent.subscription_details.subscription`) or the legacy
 *     (`.subscription`) position.
 *
 * So this ADDS a subscription reference that no real payload in this account has
 * ever carried. That is still worth doing — everything downstream of the id is
 * real code on a real database — but it is the direct evidence for §2's claim
 * that `stripe trigger` cannot exercise this handler, and it is why route 1 (a
 * real renewal failure) remains the only thing that closes the question.
 *
 * 🔴 READ §6 BEFORE INTERPRETING A NULL RESULT. Nine spliced deliveries once
 * reached `sendOnce` with n=0 and wrote nothing, which the source cannot do, and
 * the leading explanation was that the responding build was not the built code.
 * This asserts the E1.1 build marker on the SAME response that carries the
 * event, so a stale-module result is distinguishable from a wiring result rather
 * than being another uninterpretable row.
 *
 * ⚠️ THIS WRITES TO PRODUCTION. Relay has no dev database; a local build writes
 * the same rows a deployed one does. It appends one fabricated-invoice entry to
 * the owner's hash-chained audit log, which is append-only and cannot be removed.
 * Authorised by Steve on 2026-08-30, for this run.
 *
 *   npm run verify:e1-route3
 *
 * 0 = route-proven · 1 = a finding · 2 = could not look.
 *
 * Feature: relay-h0-mvp
 * Requirements: E1.2
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { query } from '../lib/db/connection';
import { RENEWAL_FAILED_ACTION } from '../lib/billing/lapse-notice';

const PAYLOAD = process.env.E1_PAYLOAD ?? '.e1-scratch/captured.json';
const BASE = process.env.E2E_BASE;
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;

interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
  [k: string]: unknown;
}

function fail(msg: string): never {
  console.error(`\n  FINDING: ${msg}`);
  process.exit(1);
}
function cannotLook(msg: string): never {
  console.error(`\n  COULD NOT LOOK: ${msg}`);
  process.exit(2);
}

/** Stripe's signature scheme, so the handler's own verification does the work. */
function sign(payload: string, secret: string, ts: number): string {
  const v1 = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

async function noticeCount(ownerId: string): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_log WHERE owner_id = $1 AND action = $2`,
    [ownerId, RENEWAL_FAILED_ACTION],
  );
  return Number(r.rows[0].n);
}

async function post(body: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const ts = Math.floor(Date.now() / 1000);
  const res = await fetch(`${BASE}/api/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': sign(body, SECRET!, ts),
    },
    body,
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* a non-JSON body is itself the finding, reported by the caller */
  }
  return { status: res.status, json };
}

async function main(): Promise<void> {
  if (!BASE) cannotLook('E2E_BASE is not set. Point it at a LOCAL PRODUCTION BUILD (next build && next start on a free port) — never next dev, which is recorded serving stale modules on this machine.');
  if (!SECRET) cannotLook('STRIPE_WEBHOOK_SECRET is not set. The handler verifies against it and the same value must sign here.');
  if (!existsSync(PAYLOAD)) cannotLook(`${PAYLOAD} does not exist. Capture one first:\n    stripe events retrieve <evt_id> > ${PAYLOAD}`);

  const captured = JSON.parse(readFileSync(PAYLOAD, 'utf8')) as StripeEvent;
  if (captured.type !== 'invoice.payment_failed') {
    cannotLook(`${PAYLOAD} is a ${captured.type}, not an invoice.payment_failed`);
  }

  // ── the live subscription id, read from the table the handler looks in ────
  const subs = await query<{ owner_id: string; stripe_subscription_id: string }>(
    `SELECT owner_id, stripe_subscription_id FROM subscriptions ORDER BY owner_id`,
  );
  if (subs.rowCount !== 1) {
    cannotLook(
      `expected exactly one subscription row, found ${subs.rowCount}. This walk splices the ` +
        'LIVE subscription id and must not guess which one.',
    );
  }
  const { owner_id: ownerId, stripe_subscription_id: subId } = subs.rows[0];

  // ── the splice ────────────────────────────────────────────────────────────
  const invoiceId = `in_e1r3_${Date.now()}`;
  const ev = JSON.parse(JSON.stringify(captured)) as StripeEvent;
  ev.id = `evt_e1r3_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const inv = ev.data.object;
  inv.id = invoiceId;
  inv.billing_reason = 'subscription_cycle';
  // The modern shape — what Stripe sends for a subscription invoice today.
  inv.parent = {
    type: 'subscription_details',
    subscription_details: { subscription: subId, metadata: {} },
  };
  const body = JSON.stringify(ev);

  console.log('  E1.2 route 3 — the lapse notice, against a local production build\n');
  console.log(`    base            ${BASE}`);
  console.log(`    payload         ${PAYLOAD} (real Stripe event ${captured.id}, livemode=${captured.livemode})`);
  console.log(`    spliced sub     ${subId}`);
  console.log(`    owner           ${ownerId.slice(0, 8)}…`);
  console.log(`    invoice         ${invoiceId}  (fabricated, unique per run)\n`);

  const before = await noticeCount(ownerId);
  console.log(`    ${RENEWAL_FAILED_ACTION} rows before: ${before}`);

  // ── 1. deliver ────────────────────────────────────────────────────────────
  const first = await post(body);
  console.log(`\n    POST #1  ->  ${first.status}  ${JSON.stringify(first.json)}`);
  if (first.status !== 200) fail(`first delivery answered ${first.status}, not 200`);

  /*
    ⚠️ THE MARKER IS AN OBJECT — `{sha, loadedAt, instance}` — and the first
    version of this walk asserted it was a string, so it reported a FINDING
    against a product that had answered correctly. Third harness-defect-reported-
    as-product-defect in this session's work; `instance` is the field that
    actually discriminates two processes, `sha` reads "unknown" off Vercel.
  */
  const marker = first.json.build as { instance?: string; loadedAt?: string } | undefined;
  if (!marker || typeof marker.instance !== 'string' || marker.instance.length === 0) {
    fail(
      'the response carries no E1.1 build marker with an `instance`. That marker is the ONLY way ' +
        'to tell a wiring result from a stale-module result, and §6 exists because nine attempts ' +
        'could not. Do not read anything into the audit count below until it comes back.',
    );
  }
  console.log(`    build marker  instance=${marker.instance} loadedAt=${marker.loadedAt}`);

  // The handler writes the audit row before responding — audit writes block the
  // operation they record, by design — so no polling is needed or wanted: a
  // retry loop here would hide exactly the failure §6 describes.
  const afterFirst = await noticeCount(ownerId);
  console.log(`    ${RENEWAL_FAILED_ACTION} rows after #1: ${afterFirst}`);

  if (afterFirst === before) {
    fail(
      'the delivery was accepted and NOTHING was written. Every branch out of sendOnce writes a ' +
        'row: no-address writes one, a failed send writes one, a success writes one. This is the ' +
        `exact §6 symptom. The build marker came back as ${marker}, so the responding build did ` +
        'answer this request — which makes the stale-module explanation harder to hold and the ' +
        'finding sharper than it was in August.',
    );
  }
  if (afterFirst !== before + 1) {
    fail(`expected exactly one new row, got ${afterFirst - before}`);
  }

  // ── 2. re-deliver: Stripe retries, and a retry must not notify twice ──────
  const second = await post(body);
  console.log(`\n    POST #2  ->  ${second.status}  ${JSON.stringify(second.json)}`);
  if (second.status !== 200) fail(`re-delivery answered ${second.status}, not 200`);
  const marker2 = second.json.build as { instance?: string } | undefined;
  if (marker2?.instance !== marker.instance) {
    fail(
      `the build marker changed between deliveries (${marker.instance} -> ${String(marker2?.instance)}) — ` +
        'two processes are answering, which is the ambiguity §6 says makes every result uninterpretable',
    );
  }

  const afterSecond = await noticeCount(ownerId);
  console.log(`    ${RENEWAL_FAILED_ACTION} rows after #2: ${afterSecond}`);
  if (afterSecond !== afterFirst) {
    fail(
      `the re-delivery wrote another row (${afterFirst} -> ${afterSecond}). Stripe retries on any ` +
        'non-2xx and this handler returns 500 deliberately to force retries, so a notice that is ' +
        'not idempotent means a paying owner is emailed once per retry.',
    );
  }

  // ── what was actually written ─────────────────────────────────────────────
  const row = await query<{ action: string; detail: unknown; ts: string }>(
    `SELECT action, detail, ts::text AS ts FROM audit_log
     WHERE owner_id = $1 AND action = $2 ORDER BY ts DESC LIMIT 1`,
    [ownerId, RENEWAL_FAILED_ACTION],
  );
  console.log(`\n    newest row: ${row.rows[0]?.ts}  ${JSON.stringify(row.rows[0]?.detail)}`);

  console.log('\n  PASS — route 3. E1prime is `wired + route-proven`.');
  console.log(
    '\n  ⚠️ NOT live-proven, and the difference is the whole point: nothing here proves that a\n' +
      "     real Stripe delivery carries a subscription id this handler can resolve. No payload\n" +
      '     in this account ever has. Route 1 (a real renewal failure, 2027-08-09) or route 2\n' +
      '     (E1.3, a test-clock subscription through relay\'s own checkout) is what closes that.',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n  COULD NOT LOOK: ${String(e)}`);
  process.exit(2);
});
