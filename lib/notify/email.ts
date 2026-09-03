/**
 * Email delivery via Resend (Requirements 4.4, 6.2, 6.6).
 *
 * Thin boundary so routes/tests mock one seam. `sendEmail` throws on failure;
 * callers that must not let a mail failure roll back a state transition use
 * `sendEmailBestEffort`, which logs and swallows.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.4, 6.2
 */

import { Resend } from 'resend';

import { alertEnvironmentLabel } from '../ops/alert-address';

import { recordSendAttempt, recordSendRefusal } from './delivery-events';
import { textToHtml } from './text-to-html';
import { recordSend } from './transcript';

let _client: Resend | null = null;

function getClient(): Resend {
  if (!_client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY environment variable is not set');
    _client = new Resend(key);
  }
  return _client;
}

/** Test seam — inject a stub Resend client (or null to reset). */
export function _setResendClientForTesting(client: Resend | null): void {
  _client = client;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Overrides RESEND_REPLY_TO_ADDRESS for this one message. */
  replyTo?: string;
}

/**
 * TLDs RFC 6761 reserves as permanently undeliverable.
 *
 * 🔴 WHY THIS IS A SEAM GUARD AND NOT A CALL-SITE FIX. `demo@relay.test` is a
 * live seeded account in production, and `email_delivery_events` held 18
 * failures for that domain when this was measured (2026-08-14).
 * `lib/seed/demo-data.ts` states in a comment that "nothing addresses mail to
 * the demo owner" — and three paths do: a verifier confirming a release
 * (`/api/triggers/[id]/confirm`), a break-glass redemption, and `family-arc.ts`.
 * A comment asserting a property that three call sites violate is exactly the
 * shape that keeps costing this project, so the guard goes where every send
 * must pass instead of where somebody has to remember it.
 *
 * The cost is real, not theoretical. A send here cannot succeed; it buys
 * retries and then failures on a Resend account SHARED with report-bridge —
 * and sending reputation is the last surviving explanation for the Outlook
 * junk-filing this product has spent two weeks chasing. Burning it on
 * addresses that can never receive anything is self-harm.
 *
 * ⚠️ `example.com` / `.net` / `.org` are deliberately NOT here. They are
 * reserved second-level domains, they are used by fixtures throughout this
 * suite, and they are not what is costing anything.
 */
const RESERVED_TLDS = ['test', 'invalid', 'localhost'];

/**
 * Would `assertDeliverableDomain` refuse this address?
 *
 * Exported because "we refused it ourselves" and "the provider failed" are the
 * same `false` out of `sendEmailBestEffort`, and one caller has to tell them
 * apart: a release whose recipients are all reserved-TLD accounts reached
 * nobody, but nothing went wrong — see `notifyRecipientsOfRelease`.
 *
 * Shares RESERVED_TLDS with the guard rather than restating the rule, so the
 * question "would this be refused?" cannot drift from the refusal itself.
 */
export function isUndeliverableByConstruction(to: string): boolean {
  const tld = to.trim().toLowerCase().split('@').pop()?.split('.').pop();
  return Boolean(tld && RESERVED_TLDS.includes(tld));
}

function assertDeliverableDomain(to: string): void {
  const tld = to.trim().toLowerCase().split('@').pop()?.split('.').pop();
  if (isUndeliverableByConstruction(to)) {
    throw new Error(
      `Refusing to send to ${to}: .${tld} is reserved and can never receive mail, ` +
        'so the attempt would only spend sending reputation',
    );
  }
}

/**
 * 🔴 A LAPTOP COULD MAIL A REAL CAREGIVER, and did nothing to stop itself.
 *
 * `.env.local` carries the production Resend key and points at the production
 * cluster, because Relay has no dev database. So a `next dev` server running any
 * notification path — an invitation, a verifier notice, an access request — sent
 * a real email from the real sending domain to whatever address was in the row.
 * The ops-alert path was gated on 2026-08-15; this is the one that reaches
 * CUSTOMERS rather than operators, and it was still open.
 *
 * AN ALLOW-LIST, NOT A DOMAIN RULE, because the obvious rule is backwards here.
 * `assertDeliverableDomain` above already refuses .test/.invalid/.localhost, so
 * "outside production, only reserved domains" would permit exactly the set that
 * is already blocked — which is nothing. The only way to exercise mail off
 * production is a real address somebody controls, so that address gets named.
 *
 * The two guards are orthogonal and both apply: an allow-listed reserved domain
 * is still refused, because it still cannot receive anything.
 *
 * The three E2E walks are unaffected — they assert nothing about mail, and
 * their accounts sit on reserved domains that were already refused.
 */
function assertSendableFromThisEnvironment(to: string): void {
  const environment = alertEnvironmentLabel();
  if (environment === 'production') return;

  const allowed = (process.env.DEV_MAIL_ALLOWLIST ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.includes(to.trim().toLowerCase())) return;

  throw new Error(
    `Refusing to send to ${to} from ${environment}: this is not a production ` +
      'environment and the address is not in DEV_MAIL_ALLOWLIST. Mailing a real ' +
      'person from a dev server spends the sending reputation of an account ' +
      'shared with report-bridge, and reaches somebody who did not expect it.',
  );
}

/**
 * The address a recipient reaches by hitting reply.
 *
 * This is NOT cosmetic. Without a Reply-To header, a caregiver who reads
 * "someone is requesting access to your parent's vault" and replies is writing
 * to a mailbox nobody reads, and gets silence or a bounce instead of a person.
 * For a product whose entire proposition is trust, that is the worst possible
 * failure.
 *
 * ⚠️ THIS PARAGRAPH USED TO SAY THE APEX HAD NO MX RECORD AND COULD NOT RECEIVE
 * MAIL AT ALL. That stopped being true on 2026-08-09, when Cloudflare Email
 * Routing was enabled — `lib/contact.ts` recorded it that day and this file did
 * not, so two files carried two answers for six days. Measured 2026-08-15:
 * relaystandby.com has three apex MX records (route1/2/3.mx.cloudflare.net) and
 * receives mail.
 *
 * The header is still right, and now for a better reason: it names the inbox a
 * human actually watches. Note the runbook's outstanding follow-up — with the
 * apex receiving, RESEND_REPLY_TO_ADDRESS could point at relay@relaystandby.com
 * so From and Reply-To match, since a mismatch is a mild spam signal. It is
 * currently hello@relaystandby.com, which is monitored; the change is a
 * deliverability judgement, not a fix, and is unmade on purpose.
 *
 * Returns undefined when unset — an absent header is correct, an empty one is
 * malformed.
 */
function resolveReplyTo(explicit?: string): string | undefined {
  const addr = explicit ?? process.env.RESEND_REPLY_TO_ADDRESS;
  const trimmed = addr?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Sends one email. Throws on misconfiguration or a Resend error.
 *
 * ⚠️ The Resend SDK does NOT throw on API errors — it resolves with
 * `{ data, error }`. This function previously awaited that promise and returned
 * without inspecting either field, so EVERY failed send was reported as a
 * success: a rejected recipient, a restricted sending domain, an invalid
 * address and a rate-limit all looked identical to delivery.
 *
 * The consequence was total and silent. `sendEmailBestEffort` never logged,
 * because there was never an exception to catch, and a live test send to
 * `example.org` — a reserved domain that cannot receive mail — was reported
 * delivered. Found 2026-08-07 when a real test email never arrived.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!from) throw new Error('RESEND_FROM_ADDRESS environment variable is not set');

  // Both refused before the provider is asked.
  assertDeliverableDomain(msg.to);
  assertSendableFromThisEnvironment(msg.to);

  const replyTo = resolveReplyTo(msg.replyTo);

  /*
    TEST 2 of the Outlook investigation (docs/g1-ad-creatives.md §"Fix and
    re-test, one variable at a time"). Supplying `html` alongside `text` makes
    Resend emit multipart/alternative instead of the text/plain-only shape that
    every Relay message had until now — the last candidate we control, after
    test 1 (Reply-To) was run and refuted.

    `text` stays the authoritative body and is UNCHANGED: the HTML is derived
    from it, so no call site can make the two disagree, and no other variable
    moves in this experiment. The readout is the SCL in the next message's
    headers, read at the mailbox — never Resend's `Delivered`, which cannot see
    which folder a message was filed into.
  */
  /*
    🔴 EVERYTHING BELOW THIS LINE USED TO FAIL WITHOUT LEAVING A TRACE ANY
    MONITOR COULD READ (found 2026-08-21). `recordSendAttempt` runs only after
    acceptance, and `recordSend` is `lib/notify/transcript.ts` — in-memory, and
    refusing to arm in production by design because these bodies carry live
    access codes. So a revoked or wrongly-rotated `RESEND_API_KEY`, a suspended
    shared Resend account, a sending-domain restriction, or any 4xx wrote NO row
    at all: `/api/health/delivery-webhook` saw zero ripe sends, read that as a
    quiet week, and answered 200 while every message Relay sent was refused.
    `docs/secret-rotation-runbook.md` claimed the opposite in as many words.

    `recordSendRefusal` is the row that gives that switch something to see. It is
    awaited and cannot throw — telemetry must not be able to fail a send, and
    this is telemetry mid-failure.

    ⚠️ THE TWO GUARDS ABOVE ARE DELIBERATELY OUTSIDE IT. A reserved-TLD refusal
    and the non-production allow-list are Relay working correctly; they fire on
    every local run and `demo@relay.test` trips one in production by design.
    Counting them would make the monitor alarm about itself, and a monitor that
    cries wolf is a monitor that gets muted — the failure this file's own
    neighbours keep recording.
  */
  let result: Awaited<ReturnType<Resend['emails']['send']>>;
  try {
    result = await getClient().emails.send({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: textToHtml(msg.text),
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (err) {
    // A missing key (no client can be built) and a dead socket land here. Both
    // mean the provider was never able to answer, which is the shape of the
    // rotation failure the runbook was most confident about.
    const message = `Resend could not be reached: ${String(err)}`;
    recordSend(msg, { accepted: false, error: message });
    await recordSendRefusal('transport');
    throw new Error(message);
  }

  // The error field is the ONLY signal that a send failed.
  if (result?.error) {
    const e = result.error as { name?: string; message?: string };
    const message = `Resend rejected the send: ${e.name ?? 'error'} — ${e.message ?? 'no message'}`;
    recordSend(msg, { accepted: false, error: message });
    // The NAME only. `message` quotes the address it refused, and the attempts
    // table is deliberately the least personal thing Relay stores.
    await recordSendRefusal(e.name ?? 'error');
    throw new Error(message);
  }

  // A success carries an id. Its absence means we cannot claim delivery.
  if (!result?.data?.id) {
    const message = 'Resend returned no message id; the send cannot be considered accepted';
    recordSend(msg, { accepted: false, error: message });
    await recordSendRefusal('no_message_id');
    throw new Error(message);
  }

  recordSend(msg, { accepted: true });

  /*
    THE ONLY DURABLE RECORD THAT WE SENT ANYTHING. `recordSend` above is
    lib/notify/transcript.ts, which is in-memory and refuses to arm in production
    by design — message bodies carry live access codes. So until now nothing
    outlived the request, and the mail dead-man's switch had nothing to compare
    its silence against: it fell back to "have we EVER heard anything", which is
    monotonic over an append-only table and had been permanently true since the
    first event.

    This line is what gives that switch a condition that can still become false.
    It stores Resend's id and nothing else — no recipient, no subject, no body —
    and it is awaited but cannot throw, because telemetry must not be able to
    fail a send. See db/migrations/031.
  */
  await recordSendAttempt(result.data.id);
}

/** Sends one email, swallowing+logging any failure (never throws). */
export async function sendEmailBestEffort(msg: EmailMessage): Promise<boolean> {
  try {
    await sendEmail(msg);
    return true;
  } catch (err) {
    process.stderr.write(`[notify] email to ${msg.to} failed: ${String(err)}\n`);
    return false;
  }
}

/**
 * Sends the same message to each of a person's addresses. True if ANY was
 * accepted.
 *
 * The whole point of a second address is that the first may be silently junked
 * or suppressed, so the interesting case is the partial one — primary refused,
 * backup accepted. That is a success: the person was reached. Returning false
 * because one leg failed would put a warning in front of an owner about a
 * message that did arrive, and this product's recurring defect is a signal that
 * measures something adjacent to the question.
 *
 * An empty list returns FALSE rather than true. Nothing was sent, so nothing may
 * be claimed — the same rule the delivery-event reader follows for silence.
 *
 * ⚠️ WHICH MESSAGES MAY USE THIS IS NOT THIS FUNCTION'S DECISION. It sends what
 * it is given, to the addresses it is given. `lib/notify/fanout.ts` holds the
 * rule that a message carrying a credential gets exactly one address, and that
 * is where it belongs — one definition, not a judgement repeated at each site.
 *
 * Sequential, not `Promise.all`: two sends to one person are not worth a burst
 * against a shared provider account, and the ordering makes the primary the
 * message that actually goes first.
 */
export async function sendEmailToAllBestEffort(
  tos: string[],
  msg: Omit<EmailMessage, 'to'>,
): Promise<boolean> {
  let any = false;
  for (const to of tos) {
    if (await sendEmailBestEffort({ ...msg, to })) any = true;
  }
  return any;
}
