/**
 * What happened to the mail after we handed it over.
 *
 * 🔴 THE GAP THIS CLOSES. Resend accepts a send to a SUPPRESSED address and
 * answers 200 with a message id, so `sendEmailBestEffort` returns true and the
 * product reports "we notified your verifiers" when nobody was notified. A
 * previously-bounced address stays muted permanently with no error anywhere.
 * For this product that is the catastrophic shape: a release starts, the
 * verifier notices go nowhere, quorum is never met, and access never opens on
 * the one day it exists for.
 *
 * The production API key is SEND-ONLY by design (`restricted_api_key`, verified
 * 2026-08-14) and is shared with another project, so the app cannot ask Resend
 * what happened and widening that credential is the wrong trade. Resend pushes
 * instead; this module is the vocabulary and the reader.
 *
 * ⚠️ WHAT THIS CANNOT DO, stated so nobody trusts it further than it goes:
 * until the webhook is configured in the Resend dashboard, NO events arrive and
 * every address reads `unknown`. `unknown` therefore means "we have not heard",
 * never "fine" — which is why the reader below has no `reachable`-by-default
 * branch and the UI copy for `unknown` says nothing reassuring.
 *
 * Feature: relay-h0-mvp
 */

import { query } from '../db/connection';

/** Bounded so a hostile or chatty provider cannot write essays into our rows. */
export const MAX_DETAIL_CHARS = 200;

/**
 * The events we act on. Resend emits more; anything unrecognised is still
 * stored (see the migration) but classifies as `unknown` rather than failing.
 */
export type DeliveryVerdict = 'delivered' | 'undeliverable' | 'delayed' | 'unknown';

export function classify(event: string): DeliveryVerdict {
  switch (event) {
    case 'email.delivered':
      return 'delivered';
    // A complaint is not a bounce, but for our purpose it is the same
    // instruction: this person is not reachable by us any more, and continuing
    // to mail them is how a shared sending domain gets burned.
    case 'email.bounced':
    case 'email.complained':
      return 'undeliverable';
    case 'email.delivery_delayed':
      return 'delayed';
    default:
      return 'unknown';
  }
}

export interface DeliveryRecord {
  event: string;
  detail: string | null;
  occurredAt: string;
  verdict: DeliveryVerdict;
}

/**
 * The domain Relay sends from, or null when we have nothing to compare against.
 *
 * Read from `RESEND_FROM_ADDRESS` — the same variable `sendEmail` refuses to
 * send without — so the sender and the attribution rule can never disagree
 * about who "we" are. One definition, not two.
 */
function ourSendingDomain(): string | null {
  const from = process.env.RESEND_FROM_ADDRESS;
  const domain = addressDomain(from);
  return domain ?? null;
}

/**
 * The domain out of an address that may be bare or in display form.
 *
 * Resend sends `from` as a STRING that is usually `Acme <onboarding@acme.com>`
 * rather than a bare address (verified against Resend's own payload example for
 * `email.bounced`, 2026-08-15), so taking everything after the first `@` would
 * yield `acme.com>` and match nothing. Returns undefined for anything that is
 * not usably an address.
 */
function addressDomain(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const angled = value.match(/<([^>]*)>/);
  const addr = (angled ? angled[1] : value).trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at < 0) return undefined;
  const domain = addr.slice(at + 1).trim();
  return domain || undefined;
}

/**
 * Is this event about mail RELAY sent?
 *
 * 🔴 THE PROBLEM IT SOLVES: RELAY'S PRODUCTION DATABASE WAS STORING ANOTHER
 * PRODUCT'S MAIL. The Resend account is shared with report-bridge, and a Resend
 * webhook endpoint is configured per ACCOUNT, not per sending domain — so every
 * event for every project on that account POSTs to `/api/resend/webhook`, and
 * this module wrote all of them. Measured on production 2026-08-15: of 113 rows,
 * **70 were report-bridge's**, across eight distinct `synthetic*.report-bridge.com`
 * domains that do not resolve, and the NEWEST row in the entire table was one of
 * theirs. Relay's own real-recipient telemetry was 18 rows.
 *
 * Two consequences, and the first is the serious one:
 *
 *   1. PERSONAL DATA. Today those addresses are synthetic probes. The moment
 *      report-bridge mails a real person, that person's address lands in Relay's
 *      production database — someone with no relationship to Relay, no notice,
 *      and no basis in Relay's own privacy policy. Nothing about that is
 *      Relay's to hold.
 *   2. A COLLISION WOULD LIE TO AN OWNER. `latestDeliveryByEmail` keys on the
 *      address alone. If the other product ever mails an address that is also in
 *      a Relay owner's circle, `/circle` would show that owner a delivery verdict
 *      for a message Relay never sent.
 *
 * ⚠️ EXCLUSION REQUIRES POSITIVE EVIDENCE — the same fail-safe direction as
 * `positivelyNonProduction` in lib/ops/alert-address.ts, and it points this way
 * deliberately. This module's entire purpose is that going blind is invisible
 * (`unknown` means "we have not heard", never "fine"). So an event is dropped
 * ONLY when the payload positively says it came from somebody else. A payload
 * with no `from`, or an unparseable one, or a Relay with no configured sending
 * domain, is still recorded — that keeps this change strictly incapable of
 * making the sensor blinder than it was before it, which a rule that dropped on
 * doubt could not promise.
 *
 * Matched on DOMAIN, not the full address: a future `notifications@` or
 * `alerts@` on the same domain is still Relay, and a rule pinned to one mailbox
 * would silently drop it.
 */
export function attributableToRelay(from: unknown): boolean {
  const ours = ourSendingDomain();
  if (!ours) return true; // nothing to compare against — record, see above
  const theirs = addressDomain(from);
  if (!theirs) return true; // payload said nothing — record, see above
  return theirs === ours;
}

/**
 * Records one provider event. Lowercases the address; bounds the detail.
 *
 * `from` is the provider's claim about who sent the message. It is NOT stored —
 * only used to decide whether this event is ours to keep at all. The guard lives
 * here rather than in the route because this is the seam every write passes
 * through, and a guard at the call site is a guard the next call site forgets.
 */
export async function recordDeliveryEvent(params: {
  email: string;
  event: string;
  detail?: string | null;
  providerId?: string | null;
  from?: unknown;
}): Promise<void> {
  if (!attributableToRelay(params.from)) return;

  const email = params.email.trim().toLowerCase();
  if (!email) return;

  await query(
    `INSERT INTO email_delivery_events (email, event, detail, provider_id)
     VALUES ($1, $2, $3, $4)`,
    [
      email,
      params.event.slice(0, 64),
      params.detail ? params.detail.slice(0, MAX_DETAIL_CHARS) : null,
      params.providerId ? params.providerId.slice(0, 128) : null,
    ],
  );
}

/**
 * The latest verdict per address, for a set of addresses.
 *
 * Returns a map containing ONLY addresses we have heard something about. A
 * caller must treat an absent key as "we have not heard", never as good news —
 * see the warning in the module header.
 */
export async function latestDeliveryByEmail(
  emails: string[],
): Promise<Map<string, DeliveryRecord>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return new Map();

  /*
    DISTINCT ON is the natural form and DSQL supports it; the ORDER BY inside
    is what picks the newest per address. Kept to one round trip rather than a
    query per person: the circle screen may hold eight.
  */
  const res = await query<{
    email: string;
    event: string;
    detail: string | null;
    occurred_at: string;
  }>(
    `SELECT DISTINCT ON (email) email, event, detail, occurred_at::text
       FROM email_delivery_events
      WHERE email = ANY($1)
      ORDER BY email, occurred_at DESC`,
    [wanted],
  );

  const out = new Map<string, DeliveryRecord>();
  for (const r of res.rows) {
    out.set(r.email, {
      event: r.event,
      detail: r.detail,
      occurredAt: r.occurred_at,
      verdict: classify(r.event),
    });
  }
  return out;
}
