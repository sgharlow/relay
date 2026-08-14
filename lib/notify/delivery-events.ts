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

/** Records one provider event. Lowercases the address; bounds the detail. */
export async function recordDeliveryEvent(params: {
  email: string;
  event: string;
  detail?: string | null;
  providerId?: string | null;
}): Promise<void> {
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
