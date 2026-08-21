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

import { randomUUID } from 'crypto';

import { query } from '../db/connection';

/** Bounded so a hostile or chatty provider cannot write essays into our rows. */
export const MAX_DETAIL_CHARS = 200;

/**
 * What marks an attempt row as a send the provider REFUSED rather than accepted.
 *
 * A prefix rather than a column, deliberately. `email_send_attempts` holds
 * `provider_id TEXT NOT NULL` and nothing else meaningful (migration 031), and a
 * schema change is a sysadmin act that lands separately from the code that needs
 * it — so a fix that waits for a migration is a fix that is not running. Resend
 * ids are UUIDs, so nothing the provider can ever return collides with this, and
 * `webhook-health.ts` splits the two populations on it.
 */
export const REFUSED_PREFIX = 'refused:';

/** Class names are bounded so no provider text can grow into these rows. */
export const MAX_ERROR_CLASS_CHARS = 40;

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
 * Records that Resend accepted one message from us. The send-side half of the
 * dead-man's switch — see db/migrations/031 and lib/notify/webhook-health.ts.
 *
 * ⚠️ NO RECIPIENT AND NO BODY, deliberately. The switch needs to know THAT we
 * sent, not to whom: `provider_id` alone joins to the event that should come
 * back. That makes this strictly less personal data than the events table, and
 * it is why the objection that killed this idea before — `transcript.ts` cannot
 * arm in production because bodies carry live access codes — does not apply.
 *
 * BEST EFFORT, AND THAT DIRECTION IS DELIBERATE. A failure to record an attempt
 * must never fail the send itself; the mail is the product and this is the
 * telemetry about it. The cost of the choice, stated plainly: a dropped attempt
 * row makes the switch slightly less likely to fire, never more — it can lose a
 * warning, it cannot invent one.
 */
export async function recordSendAttempt(providerId: string): Promise<void> {
  const id = providerId.trim();
  if (!id) return;
  try {
    await query(`INSERT INTO email_send_attempts (provider_id) VALUES ($1)`, [id.slice(0, 128)]);
  } catch (err) {
    process.stderr.write(`[notify] could not record send attempt: ${String(err)}\n`);
  }
}

/**
 * Records that the provider REFUSED one message, or could not be asked at all.
 *
 * 🔴 THE HALF THE SWITCH COULD NOT SEE, until 2026-08-21. `recordSendAttempt`
 * above runs only after Resend has accepted a message, so the failure the
 * rotation runbook was most confident about — a revoked or wrongly-rotated
 * `RESEND_API_KEY` — produced NO row of any kind. No attempt, no event, and
 * therefore `ripeSends = 0`, which `webhook-health.ts` correctly reads as "a
 * quiet week" and reports healthy. Add a suspended shared account, a sending-
 * domain restriction, or any 4xx, and the same silence follows: all mail stops,
 * `/api/health/scheduler` stays 200 because the transitions themselves succeed,
 * and the only trace is a `[notify] email … failed` line in a Vercel log that
 * ages out inside a day. `docs/secret-rotation-runbook.md` asserted the reverse.
 *
 * ⚠️ ONLY THE PROVIDER'S OWN REFUSALS BELONG HERE. Relay's own pre-flight guards
 * — the reserved-TLD refusal and the non-production allow-list in `email.ts` —
 * are working correctly when they refuse, they fire on every local run, and
 * `demo@relay.test` triggers one in production by design. Recording those would
 * be a monitor that alarms about itself, which is how monitors get muted.
 *
 * ⚠️ NO ADDRESS, EVER. Provider error text quotes the address it refused, and
 * this table is deliberately the least personal thing Relay stores. So the input
 * is reduced to a bounded class name, and anything shaped like an address is
 * refused outright rather than escaped — a rule about what CAN be written beats
 * a rule about what callers should pass.
 *
 * Best-effort in the same direction as `recordSendAttempt`: a dropped row makes
 * the switch slightly less likely to fire, never more, and this runs on a path
 * that is already handling an error.
 */
export function refusalMarker(errorClass: string): string {
  const raw = errorClass.trim().toLowerCase();
  const cls = raw.includes('@')
    ? '' // Address-shaped: not a class name, and not something to sanitise into one.
    : raw
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, MAX_ERROR_CLASS_CHARS);
  return `${REFUSED_PREFIX}${cls || 'unknown'}:${randomUUID()}`;
}

/**
 * The class a marker was written with, or null if this is not a refusal marker.
 *
 * The counterpart of `refusalMarker`, and deliberately next to it: the format
 * `refused:<class>:<uuid>` is one contract, and a reader that lived in
 * `webhook-health.ts` would be a second place for it to drift.
 *
 * An ACCEPTED send stores Resend's own id, which is a UUID. So the prefix is
 * required rather than assumed: splitting any provider id on ':' and taking the
 * second field would invent a class for a message that was never refused.
 */
export function refusalClassOf(providerId: string): string | null {
  if (!providerId.startsWith(REFUSED_PREFIX)) return null;
  const cls = providerId.slice(REFUSED_PREFIX.length).split(':')[0];
  return cls ? cls : null;
}

/**
 * Refusal classes that say something about ONE MESSAGE, or about a moment,
 * rather than about Relay's ability to send at all.
 *
 * 🔴 WHY THIS LIST EXISTS (added 2026-08-21, the day after refusals started
 * being recorded at all). `webhook-health.ts` read *any* refusal with nothing
 * accepted after it as "Relay is currently sending no mail at all — check
 * RESEND_API_KEY first". But `email.ts` records a refusal on ANY `result.error`,
 * and the commonest error Resend returns is per-message: a mistyped recipient
 * address comes back as `validation_error`. At a product that sends rarely —
 * production held zero recipients when this was written — ONE owner typo
 * therefore latched the public health endpoint to 503 for up to the whole
 * 30-day window, cleared only if some later message happened to be accepted,
 * and pointed an operator at a key that was working. That is the alarm-fatigue
 * failure both of these files are written against, arriving by the front door.
 *
 * ⚠️ A DENY-LIST, NOT AN ALLOW-LIST, and the direction is the point. Resend can
 * add an error name tomorrow; an allow-list of known-bad classes would silently
 * stop noticing whatever that name describes, which is the exact shape of defect
 * the delivery switch has now been rebuilt for three times. So anything not
 * named here is treated as an outage: loud, visible, and correctable by adding a
 * line to this list once somebody has seen it.
 *
 * ⚠️ `validation_error` is the uncomfortable one and is here on purpose. Resend
 * also uses it for a sandbox account that may only mail its own owner, which IS
 * a total outage — but it is overwhelmingly a bad address, and a class that
 * cries wolf on every typo is a class nobody reads. The recency rule in
 * `webhook-health.ts` is what keeps that case visible: a non-systemic refusal
 * still reports unhealthy while it is FRESH, it just does not latch for a month.
 */
export const NON_SYSTEMIC_REFUSAL_CLASSES: readonly string[] = [
  // About the message we handed over.
  'validation_error',
  'invalid_parameter',
  'missing_required_field',
  'invalid_attachment',
  'invalid_to_address',
  'bounced',
  'not_found',
  'method_not_allowed',
  'invalid_idempotency_key',
  'invalid_idempotent_request',
  'concurrent_idempotent_requests',
  // The provider having a moment. The next message sails past.
  'rate_limit_exceeded',
  'internal_server_error',
  'application_error',
];

const NON_SYSTEMIC = new Set(NON_SYSTEMIC_REFUSAL_CLASSES);

/** Does this refusal class mean Relay cannot send at all? Unknown ⇒ yes. */
export function isSystemicRefusalClass(errorClass: string): boolean {
  return !NON_SYSTEMIC.has(errorClass);
}

export async function recordSendRefusal(errorClass: string): Promise<void> {
  try {
    await query(`INSERT INTO email_send_attempts (provider_id) VALUES ($1)`, [
      refusalMarker(errorClass),
    ]);
  } catch (err) {
    process.stderr.write(`[notify] could not record send refusal: ${String(err)}\n`);
  }
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
