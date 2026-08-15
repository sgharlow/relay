/**
 * POST /api/resend/webhook — Resend telling us what became of a message.
 *
 * 🔴 WHY THIS EXISTS. Resend accepts a send to a SUPPRESSED address and answers
 * 200 with a message id, so the product reports "we notified your verifiers"
 * when nobody was notified, and a previously-bounced address stays muted
 * forever with no error anywhere. For this product that is the catastrophic
 * shape: a release starts, the notices go nowhere, quorum is never met, and
 * access never opens on the day it exists for.
 *
 * The production API key is SEND-ONLY (`restricted_api_key`, verified
 * 2026-08-14) and shared with another project, so the app cannot ASK what
 * happened — and widening that credential to find out would be the wrong
 * trade. So Resend pushes here instead.
 *
 * UNAUTHENTICATED BY NECESSITY, like /api/incident and /api/csp-report — the
 * caller is Resend, which holds no session. The credential is the SIGNATURE:
 * Svix-signed, verified against RESEND_WEBHOOK_SECRET, inside a five-minute
 * replay window. Nothing is written unless that check passes.
 *
 * ANSWERS A CONSTANT 204 to everything, including its own refusals. A webhook
 * that answers differently is a webhook that can be probed for whether a
 * secret is configured, whether an address is known, or whether a body parsed.
 * Resend does nothing with the body of our reply.
 *
 * ⚠️ IT STORES AN OUTCOME, NEVER A MESSAGE. Our bodies carry live access codes;
 * a provider payload that echoed one back would turn a diagnostic into a
 * credential store. Only the event name, the address, a bounded reason and
 * Resend's own id are kept.
 *
 * Feature: relay-h0-mvp
 */

import { NextResponse, type NextRequest } from 'next/server';

import { rateLimit, clientKey } from '../../../../../lib/http/rate-limit';
import { verifySvixSignature } from '../../../../../lib/notify/svix-signature';
import { recordDeliveryEvent } from '../../../../../lib/notify/delivery-events';

/** A provider retrying a burst is normal; a flood is not. */
const LIMIT = 120;
const WINDOW_MS = 60 * 1000;

/** Provider payloads are small. Anything larger is not Resend. */
const MAX_BODY_BYTES = 16 * 1024;

/** Enough to say why a bounce happened; short enough not to be a channel. */
const MAX_DETAIL = 200;

interface ResendEvent {
  type?: unknown;
  created_at?: unknown;
  data?: {
    email_id?: unknown;
    to?: unknown;
    /**
     * WHO SENT IT. The Resend account is shared with another project and a
     * webhook endpoint is configured per ACCOUNT, so events for mail Relay never
     * sent arrive here too — 70 of the 113 rows on production were another
     * product's when this was measured. Passed to `recordDeliveryEvent`, which
     * owns the rule; see its header for why the rule fails open.
     */
    from?: unknown;
    bounce?: { type?: unknown; subType?: unknown; message?: unknown };
  };
}

/** `to` arrives as a string or an array; take the first real address. */
function firstRecipient(to: unknown): string | null {
  if (typeof to === 'string' && to.trim()) return to.trim();
  if (Array.isArray(to)) {
    for (const t of to) if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}

function bounceDetail(data: ResendEvent['data']): string | null {
  const b = data?.bounce;
  if (!b) return null;
  const parts = [b.type, b.subType, b.message].filter((p): p is string => typeof p === 'string');
  const joined = parts.join(' · ').trim();
  return joined ? joined.slice(0, MAX_DETAIL) : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Constant answer, decided once. Every path below returns exactly this.
  const ok = new NextResponse(null, { status: 204 });

  if (!rateLimit(clientKey(req.headers, 'resend-hook'), LIMIT, WINDOW_MS).allowed) return ok;

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // FAIL CLOSED AND SILENT. Unconfigured means we record nothing — which is
  // correct, and is why `unknown` in the reader never reads as reassurance.
  if (!secret) return ok;

  /*
    THE RAW BYTES, not a parsed-then-reserialised body: the signature is over
    exactly what arrived, and re-serialising JSON changes key order and
    whitespace, breaking verification for a reason nobody can see. Bounded
    before reading, because this handler runs before any authentication.
  */
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return ok;

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return ok;
  }
  if (raw.length > MAX_BODY_BYTES) return ok;

  const valid = verifySvixSignature({
    secret,
    rawBody: raw,
    headers: {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
  });
  if (!valid) {
    process.stderr.write('[resend-hook] signature rejected\n');
    return ok;
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(raw) as ResendEvent;
  } catch {
    return ok;
  }

  const type = typeof event.type === 'string' ? event.type : null;
  const to = firstRecipient(event.data?.to);
  if (!type || !to) return ok;

  try {
    await recordDeliveryEvent({
      email: to,
      event: type,
      detail: bounceDetail(event.data),
      providerId: typeof event.data?.email_id === 'string' ? event.data.email_id : null,
      from: event.data?.from,
    });
  } catch (err) {
    // A recording failure must not make Resend retry forever against a broken
    // database; it is logged and dropped, and the reader reports `unknown`.
    process.stderr.write(`[resend-hook] record failed: ${String(err)}\n`);
  }

  return ok;
}
